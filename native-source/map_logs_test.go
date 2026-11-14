package main

import (
  "bytes"
  "encoding/json"
  "os"
  "path/filepath"
  "strings"
  "testing"
  "time"
  "net/http"
  "net/http/httptest"
)
func appendLog(t *testing.T, file, line string){
  t.Helper()
  f,err:=os.OpenFile(file,os.O_WRONLY|os.O_APPEND,0600)
  if err!=nil{t.Fatal(err)}
  if _,err:=f.WriteString(line);err!=nil{t.Fatal(err)}
  if err:=f.Close();err!=nil{t.Fatal(err)}
}
func TestMapLogPresetsAndUnknowns(t *testing.T){
  cases:=[]struct{line,key string}{
    {`2026-11-14 10:22:49.723|info|application|scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset`,"customs"},
    {`scene preset path:maps/shoreline_preset.bundle rcid:shoreline.scenespreset.asset`,"shoreline"},
    {`scene preset path:maps/woods_preset.bundle`,"woods"},
    {`scene preset path:maps/lighthouse_preset.bundle`,"lighthouse"},
    {`scene preset path:maps/rezervbase_preset.bundle`,"reserve"},
    {`scene preset path:maps/city_preset.bundle`,"streets-of-tarkov"},
    {`scene preset path:maps/sandbox_high.bundle`,"ground-zero"},
    {`scene preset path:maps/factory4_night.bundle`,"factory"},
    {`scene preset path:maps/laboratory_preset.bundle`,"the-lab"},
    {`scene preset path:maps/labyrinth_preset.bundle`,"the-labyrinth"},
    {`TRACE-NetworkGameCreate profileStatus Location: bigmap, Sid: EU-1`,"customs"},
    {`scene preset path:maps/unknown_world.bundle`,""},
    {`unrelated Location: customs`,""},
  }
  for _,tc:=range cases {
    got,_,_:=mapEventFromLine(tc.line)
    if got!=tc.key{t.Errorf("parse %q = %q, want %q",tc.line,got,tc.key)}
  }
}
func TestLogTailHistoricalCurrentAndNewSession(t *testing.T){
  root:=t.TempDir()
  first:=filepath.Join(root,"log_2026.11.13_12-00-00_1.0.0")
  if err:=os.MkdirAll(first,0700);err!=nil{t.Fatal(err)}
  path:=filepath.Join(first,"application_000.log")
  if err:=os.WriteFile(path,[]byte("scene preset path:maps/customs_preset.bundle\n"),0600);err!=nil{t.Fatal(err)}
  a:=testApp();a.logFolder=root;a.logAuto=true
  a.pollLogs()
  if a.logsLatest["mapKey"]!="customs"||a.logsLatest["historical"]!=true||a.logRevision!=1{
    t.Fatalf("initial old log should be historical: %#v rev %d",a.logsLatest,a.logRevision)
  }
  appendLog(t,path,"scene preset path:maps/shoreline_pre")
  a.pollLogs()
  if a.logRevision!=1{t.Fatalf("partial line parsed prematurely: %d",a.logRevision)}
  appendLog(t,path,"set.bundle rcid:shoreline.scenespreset.asset\n")
  a.pollLogs()
  if a.logsLatest["mapKey"]!="shoreline"||a.logsLatest["historical"]!=false||a.logRevision!=2{
    t.Fatalf("live partial line was not completed: %#v rev %d",a.logsLatest,a.logRevision)
  }
  appendLog(t,path,"scene preset path:maps/shoreline_preset.bundle\n")
  a.pollLogs()
  if a.logRevision!=2{t.Fatal("same-map duplicate must not re-trigger auto switch")}
  second:=filepath.Join(root,"log_2026.11.14_16-55-07_1.1.0")
  if err:=os.MkdirAll(second,0700);err!=nil{t.Fatal(err)}
  path2:=filepath.Join(second,"application_001.log")
  if err:=os.WriteFile(path2,[]byte("scene preset path:maps/factory4_night.bundle\n"),0600);err!=nil{t.Fatal(err)}
  yesterday:=time.Now().Add(-24*time.Hour)
  if err:=os.Chtimes(path,yesterday,yesterday);err!=nil{t.Fatal(err)}
  a.pollLogs()
  if a.logsLatest["mapKey"]!="factory"||a.logsLatest["historical"]!=false||a.logRevision!=3{
    t.Fatalf("new session should auto-switch: %#v rev %d",a.logsLatest,a.logRevision)
  }
}
func TestEmptyLogFolderNewRaidAndManualOptOut(t *testing.T){
  root:=t.TempDir()
  t.Setenv("TFG_EFT_LOGS",root)
  if got:=detectLogs();got!=root{t.Fatalf("configured Logs folder = %q",got)}
  a:=testApp();a.logFolder=root;a.logAuto=true
  a.pollLogs()
  if !a.logsSeen{t.Fatal("initial empty folder must register baseline")}
  dir:=filepath.Join(root,"log_2026.11.14_15-00-00")
  if err:=os.MkdirAll(dir,0700);err!=nil{t.Fatal(err)}
  file:=filepath.Join(dir,"application_000.log")
  if err:=os.WriteFile(file,[]byte("scene preset path:maps/sandbox_high.bundle\n"),0600);err!=nil{t.Fatal(err)}
  a.pollLogs()
  if a.logsLatest["mapKey"]!="ground-zero"||a.logsLatest["historical"]!=false{
    t.Fatalf("new log after idle app should be live: %#v",a.logsLatest)
  }
  a.logAuto=false
  appendLog(t,file,"scene preset path:maps/customs_preset.bundle\n")
  a.pollLogs()
  if a.logsLatest["mapKey"]!="ground-zero"{t.Fatal("disabled auto log watcher must not inspect new lines")}
  t.Setenv("LOCALAPPDATA",t.TempDir())
  req:=httptest.NewRequest("POST","http://127.0.0.1:"+port+"/api/logs-auto",bytes.NewBufferString(`{"enabled":true}`))
  req.RemoteAddr="127.0.0.1:8123"
  req.Header.Set("X-TFG-Token",a.token);req.Header.Set("Origin","http://127.0.0.1:"+port)
  rr:=httptest.NewRecorder();a.serve(rr,req)
  if rr.Code!=http.StatusOK{t.Fatalf("toggle status %d %s",rr.Code,rr.Body.String())}
  var result map[string]any
  if err:=json.Unmarshal(rr.Body.Bytes(),&result);err!=nil{t.Fatal(err)}
  if result["logs"].(map[string]any)["autoEnabled"]!=true{t.Fatal("native toggle was not reflected in state")}
  a.pollLogs()
  if a.logsLatest["mapKey"]!="customs"{t.Fatal("enabled watcher should process pending raid change")}
  if !strings.Contains(string(mustRead(t,configPath())),"\"logAuto\": true"){t.Fatal("auto map preference was not stored")}
}
func mustRead(t *testing.T,p string)[]byte{t.Helper();b,e:=os.ReadFile(p);if e!=nil{t.Fatal(e)};return b}
