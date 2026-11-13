package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"regexp"
	"strings"
	"testing"
	"time"
)

func testApp() *App {
	return &App{
		token: strings.Repeat("a", 64), instance: strings.Repeat("b", 24),
		listenPort: port, seen: map[string]string{}, pending: map[string]time.Time{},
		started: time.Now(), status: "not-configured",
	}
}

func localRequest(a *App, method, target string, token bool) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:"+a.listenPort+target, nil)
	r.RemoteAddr = "127.0.0.1:50000"
	if token {
		r.Header.Set("X-TFG-Token", a.token)
	}
	return r
}

func TestNativeServesBootstrapAndModuleMIME(t *testing.T) {
	a := testApp()
	rr := httptest.NewRecorder()
	a.serve(rr, localRequest(a, "GET", "/", false))
	if rr.Code != http.StatusOK {
		t.Fatalf("index status = %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("index Content-Type = %q", got)
	}
	pattern := regexp.MustCompile(`<script type="application/json" id="tfg-companion-bootstrap">([^<]+)</script>`)
	matches := pattern.FindAllStringSubmatch(rr.Body.String(), -1)
	if len(matches) != 1 {
		t.Fatalf("expected exactly one local bootstrap, got %d", len(matches))
	}
	var boot map[string]string
	if err := json.Unmarshal([]byte(matches[0][1]), &boot); err != nil {
		t.Fatal(err)
	}
	if boot["token"] != a.token || boot["instanceId"] != a.instance {
		t.Fatal("bootstrap does not identify this native instance")
	}
	for _, asset := range []struct{ name, mime string }{
		{"/app.mjs", "text/javascript; charset=utf-8"},
		{"/companion-client.mjs", "text/javascript; charset=utf-8"},
		{"/maps-source.json", "application/json; charset=utf-8"},
		{"/styles.css", "text/css; charset=utf-8"},
		{"/vendor/ocr/tesseract.min.js", "text/javascript; charset=utf-8"},
	} {
		t.Run(asset.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			a.serve(rr, localRequest(a, "GET", asset.name, false))
			if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != asset.mime {
				t.Fatalf("asset response = %d, %q", rr.Code, rr.Header().Get("Content-Type"))
			}
			if strings.Contains(rr.Body.String(), a.token) {
				t.Fatal("token was injected into a non-HTML asset")
			}
		})
	}
	rr = httptest.NewRecorder()
	a.serve(rr, localRequest(a, "HEAD", "/", false))
	if rr.Code != http.StatusOK || rr.Body.Len() != 0 || rr.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD must retain index metadata without a body")
	}
}

func TestNativeStateRequiresLocalHostAndToken(t *testing.T) {
	a := testApp()
	for _, tc := range []struct {
		name, host, remote, origin string
		token                      bool
		want                       int
	}{
		{"authenticated local state", "", "", "", true, http.StatusOK},
		{"missing token", "", "", "", false, http.StatusForbidden},
		{"foreign host", "example.com:" + port, "", "", true, http.StatusForbidden},
		{"foreign remote", "", "192.0.2.1:50000", "", true, http.StatusForbidden},
		{"foreign origin", "", "", "https://example.com", true, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := localRequest(a, "GET", "/api/state", tc.token)
			if tc.host != "" {
				r.Host = tc.host
			}
			if tc.remote != "" {
				r.RemoteAddr = tc.remote
			}
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			rr := httptest.NewRecorder()
			a.serve(rr, r)
			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d", rr.Code, tc.want)
			}
			if tc.want == http.StatusOK {
				var state map[string]any
				if err := json.Unmarshal(rr.Body.Bytes(), &state); err != nil {
					t.Fatal(err)
				}
				if state["app"] != appName || state["version"] != version || state["instanceId"] != a.instance {
					t.Fatal("state does not identify the running native app")
				}
				if state["latestImage"] != nil || state["running"] != false {
					t.Fatal("unconfigured app must not claim screenshot activity")
				}
			}
		})
	}
}

func TestBundledModuleGraphAndOCRAssets(t *testing.T) {
	// Check the actual go:embed payload, not website on the build machine.
	// A missing static import prevents all of app.mjs from evaluating.
	imports := regexp.MustCompile(`(?:from\s*|import\s*)['"](\.[^'"]+)['"]`)
	err := fs.WalkDir(assets, "dist", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(name, ".mjs") {
			return err
		}
		b, err := fs.ReadFile(assets, name)
		if err != nil {
			return err
		}
		for _, match := range imports.FindAllSubmatch(b, -1) {
			target := path.Clean(path.Join(path.Dir(name), string(match[1])))
			if _, err := fs.Stat(assets, target); err != nil {
				t.Errorf("%s imports missing bundled module %s", name, target)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"tesseract.min.js", "worker.min.js", "quest-worker.js", "eng.traineddata",
		"tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js",
	} {
		b, err := fs.ReadFile(assets, "dist/vendor/ocr/"+name)
		if err != nil || len(b) == 0 {
			t.Errorf("OCR asset %s missing or empty in native binary: %v", name, err)
		}
	}
}
