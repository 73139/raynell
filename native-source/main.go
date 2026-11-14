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
const version = "2026.11.14-r16-auto-map"

var screenshotRe = regexp.MustCompile(`(?i)^(\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\])_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)(?:_([+-]?[0-9.]+))?\s+\((\d+)\)\.png$`)
var safeImageRe = regexp.MustCompile(`(?i)^[^/\\:\x00-\x1f\x7f]{1,255}\.(png|jpg|jpeg|webp|bmp)$`)
var logMapRe = regexp.MustCompile(`(?i)scene\s+preset[^\r\n]*?maps[\\/]([a-z0-9_-]+)\.bundle`)
var networkRe = regexp.MustCompile(`(?i)Location:\s*([a-z0-9_-]+)`)
var applicationLogRe = regexp.MustCompile(`(?i)^application(?:_\d+)?\.logpackage main

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
const version = "2026.11.14-r16-auto-map"

var screenshotRe = regexp.MustCompile(`(?i)^(\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\])_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)(?:_([+-]?[0-9.]+))?\s+\((\d+)\)\.png$`)
var safeImageRe = regexp.MustCompile(`(?i)^[^/\\:\x00-\x1f\x7f]{1,255}\.(png|jpg|jpeg|webp|bmp)$`)
var logMapRe = regexp.MustCompile(`(?i)scene\s+preset[^\r\n]*?maps[\\/]([a-z0-9_-]+)\.bundle`)
)
var registryInstallRe = regexp.MustCompile(`(?im)^\s*InstallLocation\s+REG_\w+\s+(.+?)\s*package main

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
const version = "2026.11.14-r16-auto-map"

var screenshotRe = regexp.MustCompile(`(?i)^(\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\])_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)_?([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+),\s*([+-]?[0-9.]+)(?:_([+-]?[0-9.]+))?\s+\((\d+)\)\.png$`)
var safeImageRe = regexp.MustCompile(`(?i)^[^/\\:\x00-\x1f\x7f]{1,255}\.(png|jpg|jpeg|webp|bmp)$`)
var logMapRe = regexp.MustCompile(`(?i)scene\s+preset[^\r\n]*?maps[\\/]([a-z0-9_-]+)\.bundle`)
)
var maps = map[string]string{"bigmap": "customs", "customs": "customs", "woods": "woods", "shoreline": "shoreline", "interchange": "interchange", "rezervbase": "reserve", "reserve": "reserve", "lighthouse": "lighthouse", "tarkovstreets": "streets-of-tarkov", "city": "streets-of-tarkov", "city_preset": "streets-of-tarkov", "streets": "streets-of-tarkov", "factory4_day": "factory", "factory4_night": "factory", "factory": "factory", "factory_preset": "factory", "sandbox": "ground-zero", "sandbox_high": "ground-zero", "groundzero": "ground-zero", "laboratory": "the-lab", "laboratory_preset": "the-lab", "lab": "the-lab", "labyrinth": "the-labyrinth", "labyrinth_preset": "the-labyrinth", "icebreaker": "icebreaker", "terminal": "terminal"}

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
	logAuto, logHistorical                                                       bool
	logPartial, logError, logLastScan                                             string
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
// Registry discovery covers BSG Launcher and Steam installations; no process
// inspection, game modification, memory access or key simulation occurs.
func detectLogs() string {
    roots := []string{os.Getenv("TFG_EFT_LOGS")}
    for _, env := range []string{"TFG_EFT_HOME", "TFG_EFT_INSTALL"} {
        if p:=os.Getenv(env);p!="" { roots=append(roots,p) }
    }
    for _, root := range []string{`C:\Battlestate Games`, `D:\Battlestate Games`,
        `E:\Battlestate Games`, `C:\Games`, `D:\Games`,
        os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)")} {
        if root=="" { continue }
        roots=append(roots,filepath.Join(root,"Escape from Tarkov"))
        roots=append(roots,filepath.Join(root,"Battlestate Games","Escape from Tarkov"))
    }
    if runtime.GOOS=="windows" {
        for _, regKey := range []string{
            `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov`,
            `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov`,
            `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 3932890`,
        } {
            output,err:=exec.Command("reg","query",regKey,"/v","InstallLocation").Output()
            if err==nil { if m:=registryInstallRe.FindStringSubmatch(string(output));m!=nil { roots=append(roots,strings.TrimSpace(m[1])) } }
        }
        for _,drive:=range []string{`C:`,`D:`,`E:`,`F:`,`G:`} {
            for _,stem:=range []string{`SteamLibrary`,`Steam`,`Program Files (x86)\Steam`,`Program Files\Steam`} {
                roots=append(roots,filepath.Join(drive,stem,"steamapps","common","Escape from Tarkov"))
            }
        }
    }
    seen:=map[string]bool{}
    for _,root:=range roots {
        if root=="" { continue }
        for _,p:=range []string{root, filepath.Join(root,"Logs"),filepath.Join(root,"build","Logs")} {
            p=filepath.Clean(p);if seen[strings.ToLower(p)] {continue}; seen[strings.ToLower(p)]=true
            if !isFolder(p) {continue}
            if strings.EqualFold(filepath.Base(p),"Logs") {return p}
        }
    }
    return ""
}

// Known aliases are intentionally explicit: unfamiliar game-map identifiers
// must never trigger a guessed map switch.
func mapForPreset(preset string) string {
    raw:=strings.ToLower(strings.TrimSpace(preset))
    if result:=maps[raw]; result!="" {return result}
    raw=strings.TrimSuffix(raw,"_preset")
    if result:=maps[raw];result!="" {return result}
    if raw=="factory_day"||raw=="factory_night" {return "factory"}
    return ""
}
func mapEventFromLine(line string)(mapKey,preset,source string) {
    if m:=logMapRe.FindStringSubmatch(line);m!=nil {
        preset=strings.ToLower(m[1]);return mapForPreset(preset),preset,"scene-preset"
    }
    if strings.Contains(line,"TRACE-NetworkGameCreate")||strings.Contains(line,"GameStarting")||strings.Contains(line,"GameStarted")||strings.Contains(line,"profileStatus") {
        if m:=networkRe.FindStringSubmatch(line);m!=nil {
            preset=strings.ToLower(m[1]);return mapForPreset(preset),preset,"network-game"
        }
    }
    return "","",""
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
		LogAuto *bool `json:"logAuto"`
	}
	if json.Unmarshal(b, &c) == nil {
		if isFolder(c.Folder) {
			a.folder = c.Folder
		}
		if isFolder(c.LogsFolder) {
			a.logFolder = c.LogsFolder
		}
		if c.LogAuto!=nil {a.logAuto=*c.LogAuto}
	}
}
func (a *App) saveConfig() {
	b, _ := json.MarshalIndent(map[string]any{"version": 2, "folder": a.folder, "logsFolder": a.logFolder, "logAuto":a.logAuto}, "", "  ")
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
	return map[string]any{"app": appName, "version": version, "instanceId": a.instance, "generation": a.generation, "revision": a.revision, "diagnosticRevision": a.diagRevision, "eventRevision": a.eventRevision, "imageRevision": a.imageRevision, "folder": nullable(a.folder), "running": a.running, "status": a.status, "latest": a.latest, "latestRejected": a.latestRejected, "latestImage": a.latestImage, "imagePending": len(a.pending) > 0, "totalFiles": a.totalFiles, "imageFiles": a.imageFiles, "lastScanAt": nullable(a.lastScan), "readErrors": []any{}, "error": err, "intervalMs": 750, "logs": map[string]any{"folder": nullable(a.logFolder), "running": a.logAuto && a.logFolder != "", "autoEnabled": a.logAuto, "revision": a.logRevision, "latest": a.logsLatest, "error": nullable(a.logError), "lastScanAt": nullable(a.logLastScan), "source": nullable(a.logSource)}, "configWarning": "", "pickerBusy": false, "capabilities": map[string]any{"folderPicker": runtime.GOOS == "windows", "captureImage": true, "maxCaptureImageBytes": maxImage}}
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
    a.logLastScan=now()
    if !a.logAuto {return}
    if a.logFolder=="" {
        a.logError="타르코프 Logs 폴더를 찾지 못했어요. 게임이 설치된 Logs 폴더를 지정해 주세요."
        return
    }
    candidates:=[]string{}
    _=filepath.WalkDir(a.logFolder,func(p string,d fs.DirEntry,e error)error{
        if e!=nil{return filepath.SkipDir}
        if d.IsDir()&&p!=a.logFolder {
            // The session directories are log_YYYY.MM.DD_... (including the
            // later version suffix). The user can also select one directly.
            if !strings.HasPrefix(strings.ToLower(d.Name()),"log_"){return filepath.SkipDir}
            return nil
        }
        if !d.IsDir()&&applicationLogRe.MatchString(d.Name()) {candidates=append(candidates,p)}
        return nil
    })
    if len(candidates)==0 {
        a.logsSeen=true
        a.logError="application_000.log를 찾지 못했어요. 게임 실행 후 Logs 폴더를 확인해 주세요."
        return
    }
    sort.Slice(candidates,func(i,j int)bool{
        ai,e1:=os.Stat(candidates[i]);aj,e2:=os.Stat(candidates[j])
        if e1!=nil||e2!=nil{return candidates[i]>candidates[j]}
        if ai.ModTime().Equal(aj.ModTime()){return candidates[i]>candidates[j]}
        return ai.ModTime().After(aj.ModTime())
    })
    p:=candidates[0]
    info,e:=os.Stat(p);if e!=nil{a.logError="게임 로그 파일을 열 수 없어요.";return}
    newSource:=a.logSource!=p
    if newSource {
        a.logSource=p;a.logsOffset=0;a.logPartial=""
        // Existing log lines predate the app launch and cannot prove that the
        // player is still in that raid. New session logs can switch immediately.
        a.logHistorical=!a.logsSeen
        a.logsSeen=true
    }
    if info.Size()<a.logsOffset {a.logsOffset=0;a.logPartial=""}
    if info.Size()==a.logsOffset {a.logError="";return}
    f,e:=os.Open(p);if e!=nil{a.logError="게임 로그 파일 접근이 거부됐어요.";return}
    defer f.Close()
    start:=a.logsOffset
    truncated:=false
    if info.Size()-start>128*1024 {
        start=info.Size()-128*1024;truncated=true;a.logPartial=""
    }
    if _,e=f.Seek(start,io.SeekStart);e!=nil{a.logError="게임 로그 읽기 오류";return}
    buf,e:=io.ReadAll(io.LimitReader(f,128*1024))
    if e!=nil {a.logError="게임 로그 읽기 오류";return}
    a.logsOffset=start+int64(len(buf))
    pending:=a.logPartial+string(buf)
    if truncated {if index:=strings.IndexByte(pending,'\n');index>=0{pending=pending[index+1:]}else{pending=""}}
    lines:=strings.Split(pending,"\n")
    a.logPartial=lines[len(lines)-1]
    if len(a.logPartial)>8192 {a.logPartial=""}
    for _,line:=range lines[:len(lines)-1]{
        mapKey,preset,source:=mapEventFromLine(line)
        if mapKey=="" {continue}
        priorKey,_:=a.logsLatest["mapKey"].(string)
        priorHistorical,_:=a.logsLatest["historical"].(bool)
        if priorKey==mapKey&&priorHistorical==a.logHistorical {continue}
        a.logRevision++
        a.logsLatest=map[string]any{"mapKey":mapKey,"source":source,"preset":preset,
            "historical":a.logHistorical,"observedAt":now()}
    }
    if !newSource {a.logHistorical=false}
    a.logError=""
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
			Enabled *bool `json:"enabled"`
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
			a.logPartial = ""
			a.logsSeen = false
			a.logError = ""
			a.saveConfig()
			a.mu.Unlock()
		case "api/logs-auto":
            if req.Enabled==nil {sendJSON(w,400,map[string]any{"error":"자동 전환 설정이 없어요."});return}
            a.mu.Lock()
            a.logAuto=*req.Enabled
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
		case "api/choose-logs-folder":
            if runtime.GOOS!="windows" {sendJSON(w,400,map[string]any{"error":"Windows에서만 폴더 선택 지원"});return}
            script:=`Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Escape from Tarkov Logs folder'; if($dialog.ShowDialog() -eq 'OK'){[Console]::WriteLine($dialog.SelectedPath)}`
            out,e:=exec.Command("powershell.exe","-NoProfile","-STA","-Command",script).Output()
            if e!=nil {sendJSON(w,400,map[string]any{"error":"폴더 선택 오류. 경로 직접 입력을 이용해 주세요."});return}
            selected:=strings.TrimSpace(string(out))
            if selected!="" {
                if !isFolder(selected) {sendJSON(w,400,map[string]any{"error":"실제 Logs 폴더를 선택해 주세요."});return}
                a.mu.Lock()
                a.logFolder=filepath.Clean(selected);a.logSource="";a.logsOffset=0;a.logsLatest=nil
                a.logPartial="";a.logsSeen=false;a.logError=""
                a.saveConfig();a.mu.Unlock()
            }
            a.mu.Lock();snap:=a.snapLocked();a.mu.Unlock()
            snap["cancelled"]=selected==""
            sendJSON(w,200,snap);return
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
	a := &App{token: unique(32), instance: unique(12), seen: map[string]string{}, pending: map[string]time.Time{}, started: time.Now(), status: "not-configured", logAuto: true}
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
