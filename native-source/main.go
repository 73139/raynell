package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed dist
var assets embed.FS

const port = "43873"
const maxImage = 20 << 20
const appName = "tarkov-field-guide-companion"
const version = "2026.11.13-r16-bag-icons"

var screenshotRe = regexp.MustCompile(`(?i)^(\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\])_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)(?:_([+-]?[0-9.]+))?\s+\((\d+)\)\.png$`)
var safeImageRe = regexp.MustCompile(`(?i)^[^/\\:\x00-\x1f\x7f]{1,255}\.(png|jpg|jpeg|webp|bmp)$`)
var logMapRe = regexp.MustCompile(`(?i)scene\s+preset[^\r\n]*?maps[\\/]([a-z0-9_-]+)\.bundle`)
var networkRe = regexp.MustCompile(`(?i)Location:\s*([a-z0-9_-]+)`)
var maps = map[string]string{"bigmap": "customs", "customs": "customs", "woods": "woods", "shoreline": "shoreline", "interchange": "interchange", "rezervbase": "reserve", "reserve": "reserve", "lighthouse": "lighthouse", "tarkovstreets": "streets-of-tarkov", "city": "streets-of-tarkov", "city_preset": "streets-of-tarkov", "streets": "streets-of-tarkov", "factory4_day": "factory", "factory4_night": "factory", "factory": "factory", "factory_preset": "factory", "sandbox": "ground-zero", "sandbox_high": "ground-zero", "groundzero": "ground-zero", "laboratory": "the-lab", "laboratory_preset": "the-lab", "lab": "the-lab", "labyrinth": "labyrinth", "terminal": "terminal"}

type FileStamp struct {
	Name   string
	Size   int64
	Mtime  int64
	Finger string
	Type   string
	Parsed map[string]any
}
type App struct {
	mu                                                                            sync.Mutex
	token, instance, listenPort                                                   string
	folder, logFolder, logSource                                                  string
	running                                                                       bool
	generation, revision, diagRevision, eventRevision, imageRevision, logRevision int
	latest, latestRejected, latestImage                                           map[string]any
	seen                                                                          map[string]string
	pending                                                                       map[string]time.Time
	started                                                                       time.Time
	status                                                                        string
	errorText                                                                     string
	logsLatest                                                                    map[string]any
	logsOffset                                                                    int64
	logsSeen                                                                      bool
	lastScan                                                                      string
	totalFiles, imageFiles                                                        int
}

func unique(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func now() string            { return time.Now().UTC().Format(time.RFC3339Nano) }
func isFolder(s string) bool { i, e := os.Stat(s); return e == nil && i.IsDir() }
func tryFolder() string {
	home, _ := os.UserHomeDir()
	paths := []string{os.Getenv("TFG_SCREENSHOTS"), filepath.Join(home, "Documents", "Escape from Tarkov", "Screenshots"), filepath.Join(home, "OneDrive", "Documents", "Escape from Tarkov", "Screenshots")}
	for _, p := range paths {
		if p != "" && isFolder(p) {
			return p
		}
	}
	return ""
}
func detectLogs() string {
	candidates := []string{os.Getenv("TFG_EFT_LOGS")}
	for _, root := range []string{`C:\Battlestate Games`, `D:\Battlestate Games`, os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)")} {
		if root == "" {
			continue
		}
		for _, base := range []string{"Escape from Tarkov", filepath.Join("Battlestate Games", "Escape from Tarkov")} {
			for _, sub := range []string{"Logs", filepath.Join("build", "Logs")} {
				candidates = append(candidates, filepath.Join(root, base, sub))
			}
		}
	}
	for _, p := range candidates {
		if p != "" && isFolder(p) {
			return p
		}
	}
	return ""
}
func configPath() string {
	p := os.Getenv("LOCALAPPDATA")
	if p == "" {
		p = os.TempDir()
	}
	return filepath.Join(p, "TarkovFieldGuide", "config.json")
}
func tryConfig(a *App) {
	b, e := os.ReadFile(configPath())
	if e != nil {
		return
	}
	var c struct {
		Folder     string `json:"folder"`
		LogsFolder string `json:"logsFolder"`
	}
	if json.Unmarshal(b, &c) == nil {
		if isFolder(c.Folder) {
			a.folder = c.Folder
		}
		if isFolder(c.LogsFolder) {
			a.logFolder = c.LogsFolder
		}
	}
}
func (a *App) saveConfig() {
	b, _ := json.MarshalIndent(map[string]any{"version": 1, "folder": a.folder, "logsFolder": a.logFolder}, "", "  ")
	p := configPath()
	_ = os.MkdirAll(filepath.Dir(p), 0700)
	_ = os.WriteFile(p, b, 0600)
}
func (a *App) setFolder(p string) error {
	if !filepath.IsAbs(p) || !isFolder(p) {
		return errors.New("실제 스크린샷 폴더의 전체 경로를 입력해 주세요.")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.folder = filepath.Clean(p)
	a.generation++
	a.latest = nil
	a.latestImage = nil
	a.latestRejected = nil
	a.seen = map[string]string{}
	a.pending = map[string]time.Time{}
	a.status = "starting"
	a.running = true
	a.saveConfig()
	return nil
}
func (a *App) snapLocked() map[string]any {
	var err any = nil
	if a.errorText != "" {
		err = map[string]any{"code": "FOLDER_ERROR", "message": a.errorText}
	}
	return map[string]any{"app": appName, "version": version, "instanceId": a.instance, "generation": a.generation, "revision": a.revision, "diagnosticRevision": a.diagRevision, "eventRevision": a.eventRevision, "imageRevision": a.imageRevision, "folder": nullable(a.folder), "running": a.running, "status": a.status, "latest": a.latest, "latestRejected": a.latestRejected, "latestImage": a.latestImage, "imagePending": len(a.pending) > 0, "totalFiles": a.totalFiles, "imageFiles": a.imageFiles, "lastScanAt": nullable(a.lastScan), "readErrors": []any{}, "error": err, "intervalMs": 750, "logs": map[string]any{"folder": nullable(a.logFolder), "running": a.logFolder != "", "revision": a.logRevision, "latest": a.logsLatest, "error": nil, "lastScanAt": now(), "source": nullable(a.logSource)}, "configWarning": "", "pickerBusy": false, "capabilities": map[string]any{"folderPicker": runtime.GOOS == "windows", "captureImage": true, "maxCaptureImageBytes": maxImage}}
}
func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func stamp(n string, info fs.FileInfo) FileStamp {
	ext := strings.ToLower(filepath.Ext(n))
	typ := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".bmp": "image/bmp"}[ext]
	return FileStamp{n, info.Size(), info.ModTime().UnixNano(), fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano()), typ, parseOriginal(n)}
}
func parseOriginal(n string) map[string]any {
	m := screenshotRe.FindStringSubmatch(n)
	if m == nil {
		return nil
	}
	dt, e := time.Parse("2006-01-02[15-04]", m[1])
	if e != nil || dt.Year() < 2000 {
		return nil
	}
	v := make([]float64, 7)
	for i := 0; i < 7; i++ {
		v[i], e = strconv.ParseFloat(m[i+2], 64)
		if e != nil || math.IsNaN(v[i]) || math.IsInf(v[i], 0) {
			return nil
		}
	}
	norm := math.Hypot(math.Hypot(v[3], v[4]), math.Hypot(v[5], v[6]))
	if norm < 0.5 || norm > 1.5 {
		return nil
	}
	x, y, z, w := v[3]/norm, v[4]/norm, v[5]/norm, v[6]/norm
	fx := 2 * (x*z + w*y)
	fz := 1 - 2*(x*x+y*y)
	hd := math.Mod(math.Atan2(fx, fz)*180/math.Pi+360, 360)
	seq, _ := strconv.Atoi(m[10])
	var hour any = nil
	if m[9] != "" {
		hour, _ = strconv.ParseFloat(m[9], 64)
	}
	return map[string]any{"filename": n, "captureLabel": m[1], "capturedAt": m[1], "captureParts": map[string]int{"year": dt.Year(), "month": int(dt.Month()), "day": dt.Day(), "hour": dt.Hour(), "minute": dt.Minute()}, "position": map[string]any{"x": v[0], "y": v[1], "z": v[2]}, "x": v[0], "y": v[1], "z": v[2], "quaternion": map[string]float64{"x": x, "y": y, "z": z, "w": w}, "headingDegrees": hd, "gameHour": hour, "sequence": seq, "forward": map[string]float64{"x": fx, "y": 2 * (y*z - w*x), "z": fz}, "source": "eft-original-filename"}
}
func (a *App) scan() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.running || a.folder == "" {
		return
	}
	entries, e := os.ReadDir(a.folder)
	a.lastScan = now()
	if e != nil {
		a.status = "folder-error"
		a.errorText = e.Error()
		return
	}
	a.errorText = ""
	a.status = "watching"
	a.totalFiles = len(entries)
	a.imageFiles = 0
	var current FileStamp
	changed := false
	var candidates []FileStamp
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		n := entry.Name()
		if !safeImageRe.MatchString(n) {
			continue
		}
		a.imageFiles++
		info, e := entry.Info()
		if e != nil || info.Size() <= 0 || info.Size() > maxImage {
			continue
		}
		s := stamp(n, info)
		if old, ok := a.seen[n]; !ok || old != s.Finger {
			a.seen[n] = s.Finger
			a.pending[n] = time.Now()
			changed = true
		}
		candidates = append(candidates, s)
	}
	if !changed && len(a.pending) == 0 {
		return
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Mtime == candidates[j].Mtime {
			return candidates[i].Name < candidates[j].Name
		}
		return candidates[i].Mtime < candidates[j].Mtime
	})
	if len(candidates) == 0 {
		return
	}
	current = candidates[len(candidates)-1]
	first, exists := a.pending[current.Name]
	if !exists || time.Since(first) < 350*time.Millisecond {
		return
	}
	for _, image := range candidates {
		delete(a.pending, image.Name)
	}
	a.imageRevision++
	a.latestImage = map[string]any{"name": current.Name, "lastModified": float64(current.Mtime) / 1e6, "fingerprint": current.Finger, "size": current.Size, "mimeType": current.Type, "initial": time.Since(a.started) < 3*time.Second, "generation": a.generation, "imageRevision": a.imageRevision, "observedAt": a.lastScan}
	a.eventRevision++
	if current.Parsed != nil {
		a.revision++
		a.latest = map[string]any{"name": current.Name, "lastModified": float64(current.Mtime) / 1e6, "parsed": current.Parsed, "observedAt": a.lastScan, "revision": a.revision, "eventRevision": a.eventRevision}
	} else {
		a.diagRevision++
		a.latestRejected = map[string]any{"name": current.Name, "lastModified": float64(current.Mtime) / 1e6, "reason": "파일명에서 타르코프 원본 좌표를 읽지 못했어요.", "observedAt": a.lastScan, "revision": a.diagRevision, "eventRevision": a.eventRevision}
	}
}
func (a *App) pollLogs() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.logFolder == "" {
		return
	}
	var candidates []string
	_ = filepath.WalkDir(a.logFolder, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return filepath.SkipDir
		}
		if d.IsDir() && p != a.logFolder {
			if !strings.HasPrefix(strings.ToLower(d.Name()), "log_") {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() && regexp.MustCompile(`(?i)^application(?:_\d+)?\.log$`).MatchString(d.Name()) {
			candidates = append(candidates, p)
		}
		return nil
	})
	if len(candidates) == 0 {
		return
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, _ := os.Stat(candidates[i])
		b, _ := os.Stat(candidates[j])
		return a.ModTime().After(b.ModTime())
	})
	p := candidates[0]
	info, e := os.Stat(p)
	if e != nil {
		return
	}
	if a.logSource != p {
		a.logSource = p
		a.logsOffset = info.Size()
		a.logsSeen = true
		return
	}
	if info.Size() < a.logsOffset {
		a.logsOffset = 0
	}
	if info.Size() == a.logsOffset {
		return
	}
	f, e := os.Open(p)
	if e != nil {
		return
	}
	defer f.Close()
	start := a.logsOffset
	if info.Size()-start > 128*1024 {
		start = info.Size() - 128*1024
	}
	_, _ = f.Seek(start, 0)
	buf, _ := io.ReadAll(io.LimitReader(f, 128*1024))
	a.logsOffset = start + int64(len(buf))
	lines := strings.Split(string(buf), "\n")
	for _, line := range lines {
		var id, src string
		if m := logMapRe.FindStringSubmatch(line); m != nil {
			id = strings.ToLower(m[1])
			src = "scene-preset"
		} else if strings.Contains(line, "TRACE-NetworkGameCreate") || strings.Contains(line, "GameStarting") || strings.Contains(line, "profileStatus") {
			if m := networkRe.FindStringSubmatch(line); m != nil {
				id = strings.ToLower(m[1])
				src = "network-game"
			}
		}
		if mapID := maps[id]; mapID != "" {
			a.logRevision++
			a.logsLatest = map[string]any{"mapKey": mapID, "source": src, "preset": id, "historical": false, "observedAt": now()}
		}
	}
}
func (a *App) image(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	expected := a.latestImage
	folder := a.folder
	generation := a.generation
	a.mu.Unlock()
	if expected == nil || folder == "" {
		http.Error(w, "이미지 없음", 404)
		return
	}
	rev := intVal(expected["imageRevision"])
	if r.URL.Query().Get("revision") != strconv.Itoa(rev) || r.URL.Query().Get("generation") != strconv.Itoa(generation) {
		http.Error(w, "이미지 변경됨", 409)
		return
	}
	name, _ := expected["name"].(string)
	if !safeImageRe.MatchString(name) || filepath.Base(name) != name {
		http.Error(w, "잘못된 이름", 403)
		return
	}
	p := filepath.Join(folder, name)
	fi, e := os.Lstat(p)
	if e != nil || !fi.Mode().IsRegular() || fi.Size() > maxImage || fi.Size() < 1 {
		http.Error(w, "이미지 읽기 실패", 409)
		return
	}
	s := stamp(name, fi)
	if s.Finger != expected["fingerprint"] || s.Size != expected["size"] {
		http.Error(w, "이미지 변경됨", 409)
		return
	}
	b, e := os.ReadFile(p)
	if e != nil || int64(len(b)) != s.Size {
		http.Error(w, "이미지 읽기 실패", 409)
		return
	}
	if strings.HasSuffix(strings.ToLower(name), ".png") && !(len(b) > 8 && string(b[:4]) == "\x89PNG") {
		http.Error(w, "PNG 파일 오류", 415)
		return
	}
	a.mu.Lock()
	same := a.generation == generation && a.latestImage != nil && a.latestImage["fingerprint"] == s.Finger
	a.mu.Unlock()
	if !same {
		http.Error(w, "이미지 변경됨", 409)
		return
	}
	w.Header().Set("X-TFG-Instance", a.instance)
	w.Header().Set("X-TFG-Image-Generation", strconv.Itoa(generation))
	w.Header().Set("X-TFG-Image-Revision", strconv.Itoa(rev))
	w.Header().Set("X-TFG-Image-Fingerprint", s.Finger)
	w.Header().Set("Content-Type", s.Type)
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func intVal(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case float64:
		return int(x)
	}
	return 0
}
func (a *App) state(w http.ResponseWriter) {
	a.mu.Lock()
	s := a.snapLocked()
	a.mu.Unlock()
	sendJSON(w, 200, s)
}
func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func (a *App) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; connect-src 'self' https://raw.githubusercontent.com https://assets.tarkov.dev https://json.tarkov.dev https://cdn.jsdelivr.net https://escapefromtarkov.fandom.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
	if r.Host != "127.0.0.1:"+a.listenPort {
		http.Error(w, "local only", 403)
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host != "127.0.0.1" && host != "::1" {
		http.Error(w, "local only", 403)
		return
	}
	if o := r.Header.Get("Origin"); o != "" && o != "http://127.0.0.1:"+a.listenPort {
		http.Error(w, "wrong origin", 403)
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if r.Header.Get("X-TFG-Token") != a.token {
			sendJSON(w, 403, map[string]any{"error": "토큰 오류"})
			return
		}
		if r.Method == http.MethodGet && p == "api/state" {
			a.state(w)
			return
		}
		if r.Method == http.MethodGet && p == "api/capture-image" {
			a.image(w, r)
			return
		}
		if r.Method != "POST" {
			http.Error(w, "method", 405)
			return
		}
		if r.Header.Get("Origin") != "http://127.0.0.1:"+a.listenPort {
			http.Error(w, "wrong origin", 403)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		var req struct {
			Folder  string `json:"folder"`
			Running *bool  `json:"running"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, "JSON 오류", 400)
			return
		}
		switch p {
		case "api/folder":
			if e := a.setFolder(req.Folder); e != nil {
				sendJSON(w, 400, map[string]any{"error": e.Error()})
				return
			}
		case "api/logs-folder":
			if !isFolder(req.Folder) {
				sendJSON(w, 400, map[string]any{"error": "실제 Logs 폴더를 지정해 주세요."})
				return
			}
			a.mu.Lock()
			a.logFolder = req.Folder
			a.logSource = ""
			a.logsOffset = 0
			a.logsLatest = nil
			a.saveConfig()
			a.mu.Unlock()
		case "api/running":
			if req.Running == nil {
				http.Error(w, "missing running", 400)
				return
			}
			a.mu.Lock()
			a.running = *req.Running
			if a.running {
				a.status = "starting"
			} else {
				a.status = "stopped"
			}
			a.mu.Unlock()
		case "api/rescan":
			a.scan()
		case "api/choose-folder":
			if runtime.GOOS != "windows" {
				sendJSON(w, 400, map[string]any{"error": "Windows 폴더 선택만 지원합니다."})
				return
			}
			script := `Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Tarkov screenshots folder'; if($dialog.ShowDialog() -eq 'OK'){[Console]::WriteLine($dialog.SelectedPath)}`
			cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", script)
			out, e := cmd.Output()
			if e != nil {
				sendJSON(w, 400, map[string]any{"error": "폴더 선택 창 오류. 경로를 직접 입력해 주세요."})
				return
			}
			path := strings.TrimSpace(string(out))
			if path != "" {
				if e := a.setFolder(path); e != nil {
					sendJSON(w, 400, map[string]any{"error": e.Error()})
					return
				}
			}
			a.mu.Lock()
			snap := a.snapLocked()
			a.mu.Unlock()
			snap["cancelled"] = path == ""
			sendJSON(w, 200, snap)
			return
		default:
			http.NotFound(w, r)
			return
		}
		a.state(w)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		http.Error(w, "method", 405)
		return
	}
	if p == "" {
		p = "index.html"
	}
	if strings.Contains(p, "..") || strings.Contains(p, "\\") || strings.HasPrefix(p, "/") {
		http.NotFound(w, r)
		return
	}
	f, e := assets.Open("dist/" + p)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, _ := f.Stat()
	if fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	b, e := io.ReadAll(f)
	if e != nil {
		http.Error(w, "asset error", 500)
		return
	}
	if p == "index.html" {
		boot, _ := json.Marshal(map[string]string{"token": a.token, "instanceId": a.instance})
		b = []byte(strings.Replace(string(b), "</head>", "<script type=\"application/json\" id=\"tfg-companion-bootstrap\">"+string(boot)+"</script></head>", 1))
	}
	ext := strings.ToLower(filepath.Ext(p))
	ctype := map[string]string{".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".traineddata": "application/octet-stream"}[ext]
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		_, _ = w.Write(b)
	}
}
func main() {
	if runtime.GOOS != "windows" {
		log.Print("Windows 개발 대상: Linux smoke test mode")
	}
	a := &App{token: unique(32), instance: unique(12), seen: map[string]string{}, pending: map[string]time.Time{}, started: time.Now(), status: "not-configured"}
	tryConfig(a)
	if a.folder == "" {
		a.folder = tryFolder()
	}
	if a.logFolder == "" {
		a.logFolder = detectLogs()
	}
	if a.folder != "" {
		a.generation = 1
		a.running = true
		a.status = "starting"
	}
	mux := http.HandlerFunc(a.serve)
	ln, e := net.Listen("tcp", "127.0.0.1:"+port)
	if e != nil {
		// A second instance must not terminate just because another local app
		// occupies the preferred port. Kernel-assigned ephemeral localhost port.
		fmt.Println("기본 포트 사용 중. 별도 로컬 포트를 찾습니다:", e)
		ln, e = net.Listen("tcp", "127.0.0.1:0")
		if e != nil {
			fmt.Println("로컬 서버를 시작할 수 없습니다:", e)
			return
		}
	}
	a.listenPort = strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 330 * time.Second}
	go func() {
		for range time.NewTicker(750 * time.Millisecond).C {
			a.scan()
		}
	}()
	go func() {
		for range time.NewTicker(1800 * time.Millisecond).C {
			a.pollLogs()
		}
	}()
	go server.Serve(ln)
	url := "http://127.0.0.1:" + a.listenPort + "/"
	fmt.Println("TARKOV FIELD GUIDE " + version)
	fmt.Println("로컬 지도:", url)
	fmt.Println("이 창을 닫으면 앱이 종료됩니다.")
	if runtime.GOOS == "windows" {
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
	select {}
}
