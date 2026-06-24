"""End-to-end: enqueue a capture_url command on the daemon, let the real
Chrome extension claim + execute it in a background tab, verify the captured
article comes back. Self-contained: serves a test article, pairs the extension,
drives the service worker over CDP."""
import json, os, sys, time, tempfile, threading, subprocess, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
import requests, websocket

# The daemon's port + master token rotate each launch; read them from the
# discovery file rather than hard-coding.
_info = json.load(open(os.path.join(
    os.environ["APPDATA"], "com.eggbrowser.desktop", "daemon_info.json")))
DAEMON = f"http://127.0.0.1:{_info['port']}"
MASTER = _info["token"]
EXT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# Recent Chrome ignores --load-extension; Edge (same extension format) honours
# it, so we drive the E2E through Edge.
CHROME = next(p for p in [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
DBG_PORT = 9333
ART_PORT = 8765
ART_URL = f"http://localhost:{ART_PORT}/article.html"

ARTICLE = b"""<!doctype html><html lang=en><head><meta charset=utf-8>
<title>The Egg Capture Test Article</title>
<meta name=description content="A page used to validate extension capture.">
<meta property="og:site_name" content="Egg Test Lab"></head>
<body><article><h1>The Egg Capture Test Article</h1>
<p>This is the first paragraph of a deliberately readable article so that the
Mozilla Readability pass inside the extension content script has real prose to
extract. It needs enough text to clear the readability heuristics.</p>
<p>This second paragraph adds more body copy. The extension opens this page in a
background tab, runs its extractor, and returns the result to the Gateway over
the pull-based command channel under test.</p></article></body></html>"""

def serve():
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers(); self.wfile.write(ARTICLE)
        def log_message(self, *a): pass
    HTTPServer(("127.0.0.1", ART_PORT), H).serve_forever()

threading.Thread(target=serve, daemon=True).start()

# 1. Pair: mint a one-time code (master) then exchange it (public) for a token.
code = requests.post(f"{DAEMON}/api/extension/pair/new",
    headers={"Authorization": f"Bearer {MASTER}"}, json={"label": "e2e"}).json()["code"]
pair = requests.post(f"{DAEMON}/api/extension/pair", json={"code": code}).json()
ext_token, install_id = pair["token"], pair["install_id"]
print(f"[e2e] paired install={install_id[:8]} token={ext_token[:8]}")

# 2. Launch an isolated Chrome with the unpacked extension + remote debugging.
profile = tempfile.mkdtemp(prefix="egg-ext-e2e-")
chrome = subprocess.Popen([CHROME,
    f"--load-extension={EXT_DIR}", f"--user-data-dir={profile}",
    f"--remote-debugging-port={DBG_PORT}", "--no-first-run",
    "--no-default-browser-check", "--disable-popup-blocking", "about:blank"])

def cdp(ws_url):
    return websocket.create_connection(ws_url, suppress_origin=True)

def ev(ws, expr):
    _id = ev.n = getattr(ev, "n", 0) + 1
    ws.send(json.dumps({"id": _id, "method": "Runtime.evaluate", "params": {
        "expression": expr, "awaitPromise": True, "returnByValue": True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == _id:
            if "error" in m: raise RuntimeError(m["error"])
            r = m["result"]
            if r.get("exceptionDetails"):
                raise RuntimeError(json.dumps(r["exceptionDetails"]))
            return r["result"].get("value")

try:
    # 3. Find the extension's service-worker target.
    sw = None
    for _ in range(40):
        try:
            tgts = requests.get(f"http://127.0.0.1:{DBG_PORT}/json").json()
            sw = next((t for t in tgts if t.get("type") == "service_worker"
                       and "service-worker.js" in t.get("url", "")), None)
            if sw: break
        except Exception: pass
        time.sleep(0.5)
    if not sw: sys.exit("[e2e] FAIL: extension service worker never appeared")
    print(f"[e2e] service worker up: {sw['url'].split('/')[2][:24]}")
    ws = cdp(sw["webSocketDebuggerUrl"])
    # The worker's chrome.* bindings can lag the CDP attach; wait for them.
    for _ in range(30):
        if ev(ws, "typeof(chrome&&chrome.storage&&chrome.storage.local)") == "object":
            break
        time.sleep(0.3)
    else:
        sys.exit("[e2e] FAIL: chrome.storage never became available")

    # 4. Inject the pairing config the popup would normally store.
    cfg = json.dumps({"port": 4747, "token": ext_token, "host": "127.0.0.1"})
    ev(ws, f"chrome.storage.local.set({{gateway:{cfg}}}).then(()=>'set')")
    print("[e2e] gateway config injected into extension storage")

    # 5. Enqueue the capture_url command (master), targeting our test article.
    cmd = requests.post(f"{DAEMON}/api/extension/commands",
        headers={"Authorization": f"Bearer {MASTER}"},
        json={"install_id": install_id, "kind": "capture_url",
              "args": {"url": ART_URL}}).json()
    cmd_id = cmd["id"]
    print(f"[e2e] enqueued capture_url id={cmd_id[:8]} -> {ART_URL}")

    # 6. Reschedule the command alarm to fire in ~3s instead of waiting for the
    # natural 1-min tick. The onAlarm listener was registered at SW startup, so
    # this drives drainCommands without injecting any test-only hooks.
    ev(ws, "chrome.alarms.create('egg-poll-commands',{delayInMinutes:0.05});'ok'")
    print("[e2e] rescheduled command alarm (~3s); also covered by 1-min tick")

    # 7. Poll the command status (master) until it resolves (up to ~90s so the
    # natural alarm tick is a fallback if the short delay gets clamped).
    for _ in range(180):
        st = requests.get(f"{DAEMON}/api/extension/commands/{cmd_id}",
            headers={"Authorization": f"Bearer {MASTER}"}).json()
        if st["status"] in ("done", "error"): break
        time.sleep(0.5)
    print(f"[e2e] final status={st['status']}")
    if st["status"] == "done":
        r = st["result"] or {}
        title = (r.get("article") or {}).get("title") or (r.get("metadata") or {}).get("title")
        print(f"[e2e] page.title   = {(r.get('page') or {}).get('title')!r}")
        print(f"[e2e] article.title= {(r.get('article') or {}).get('title')!r}")
        has_text = bool((r.get("article") or {}).get("textContent") or
                        (r.get("article") or {}).get("content"))
        print(f"[e2e] article has body text = {has_text}")
        print("[e2e] RESULT:", "PASS" if title else "PARTIAL (no title extracted)")
    else:
        print("[e2e] error:", st.get("error"))
finally:
    chrome.terminate()
