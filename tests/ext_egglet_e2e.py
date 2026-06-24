"""End-to-end for the EGGLET-scoped command path: a portable egglet's wire
contract (POST /api/egglet/extension/commands with an egglet token) is claimed
and run by the real extension in Edge, and the result is read back through the
egglet-scoped status route. Proves the chain ctx.extension.captureUrl relies on.

Sets up a throwaway egglet (manifest declaring uses.extension.commands + a
scoped token), drives the extension exactly like ext_e2e.py, and cleans up."""
import json, os, sys, time, tempfile, threading, subprocess, shutil, sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
import requests, websocket

APP = os.path.join(os.environ["APPDATA"], "com.eggbrowser.desktop")
_info = json.load(open(os.path.join(APP, "daemon_info.json")))
DAEMON = f"http://127.0.0.1:{_info['port']}"
MASTER = _info["token"]
DB = os.path.join(APP, "egg.db")
EGG_DIR = os.path.join(APP, "egglets")
EGGLET_ID = "xte2e"
EGG_TOKEN = "tok-xte2e-e2e"
EXT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EDGE = next(p for p in [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p))
DBG_PORT, ART_PORT = 9377, 8766
ART_URL = f"http://localhost:{ART_PORT}/article.html"

ARTICLE = b"""<!doctype html><html lang=en><head><meta charset=utf-8>
<title>Egglet Path Capture Article</title>
<meta property="og:site_name" content="Egg Test Lab"></head>
<body><article><h1>Egglet Path Capture Article</h1>
<p>Prose body so the extractor returns something for the egglet path test.</p>
</article></body></html>"""

def serve():
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers(); self.wfile.write(ARTICLE)
        def log_message(self, *a): pass
    HTTPServer(("127.0.0.1", ART_PORT), H).serve_forever()

threading.Thread(target=serve, daemon=True).start()

# Throwaway egglet: manifest declaring the capability + a scoped token.
d = os.path.join(EGG_DIR, EGGLET_ID); os.makedirs(d, exist_ok=True)
json.dump({"id": EGGLET_ID, "version": "0.0.1",
           "uses": {"extension": {"commands": True, "captures": True}}},
          open(os.path.join(d, "manifest.json"), "w"))
c = sqlite3.connect(DB, timeout=10)
c.execute("DELETE FROM daemon_egglet_tokens WHERE egglet_id=?", (EGGLET_ID,))
c.execute("INSERT INTO daemon_egglet_tokens (token, egglet_id, origin, created_at, token_key) "
          "VALUES (?,?,?,?,0)", (EGG_TOKEN, EGGLET_ID, "test", int(time.time() * 1000)))
c.commit(); c.close()
EH = {"Authorization": f"Bearer {EGG_TOKEN}", "Content-Type": "application/json"}

# Pair the extension (mint + exchange a one-time code).
code = requests.post(f"{DAEMON}/api/extension/pair/new",
    headers={"Authorization": f"Bearer {MASTER}"}, json={"label": "egglet-e2e"}).json()["code"]
pair = requests.post(f"{DAEMON}/api/extension/pair", json={"code": code}).json()
ext_token, install_id = pair["token"], pair["install_id"]
print(f"[e2e] egglet={EGGLET_ID} paired-install={install_id[:8]}")

profile = tempfile.mkdtemp(prefix="egg-egglet-e2e-")
edge = subprocess.Popen([EDGE, f"--load-extension={EXT_DIR}",
    f"--user-data-dir={profile}", f"--remote-debugging-port={DBG_PORT}",
    "--no-first-run", "--no-default-browser-check", "about:blank"])

def ev(ws, expr):
    ev.n = getattr(ev, "n", 0) + 1
    ws.send(json.dumps({"id": ev.n, "method": "Runtime.evaluate", "params": {
        "expression": expr, "awaitPromise": True, "returnByValue": True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == ev.n:
            r = m["result"]
            if r.get("exceptionDetails"): raise RuntimeError(json.dumps(r["exceptionDetails"]))
            return r["result"].get("value")

try:
    sw = None
    for _ in range(40):
        try:
            sw = next((t for t in requests.get(f"http://127.0.0.1:{DBG_PORT}/json").json()
                       if t.get("type") == "service_worker" and "service-worker.js" in t.get("url", "")), None)
            if sw: break
        except Exception: pass
        time.sleep(0.5)
    if not sw: sys.exit("[e2e] FAIL: extension service worker never appeared")
    ws = websocket.create_connection(sw["webSocketDebuggerUrl"], suppress_origin=True)
    for _ in range(30):
        if ev(ws, "typeof(chrome&&chrome.storage&&chrome.storage.local)") == "object": break
        time.sleep(0.3)
    cfg = json.dumps({"port": _info["port"], "token": ext_token, "host": "127.0.0.1"})
    ev(ws, f"chrome.storage.local.set({{gateway:{cfg}}}).then(()=>'set')")

    # Enqueue through the EGGLET-scoped route with the egglet token.
    r = requests.post(f"{DAEMON}/api/egglet/extension/commands", headers=EH,
                      json={"install_id": install_id, "kind": "capture_url", "args": {"url": ART_URL}})
    cmd_id = r.json()["id"]
    print(f"[e2e] egglet-enqueued capture_url id={cmd_id[:8]} (status {r.status_code})")

    ev(ws, "chrome.alarms.create('egg-poll-commands',{delayInMinutes:0.05});'ok'")

    # Read status back through the EGGLET-scoped route.
    st = {"status": "?"}
    for _ in range(180):
        st = requests.get(f"{DAEMON}/api/egglet/extension/commands/{cmd_id}", headers=EH).json()
        if st["status"] in ("done", "error"): break
        time.sleep(0.5)
    print(f"[e2e] egglet-read status={st['status']}")
    if st["status"] == "done":
        r = st["result"] or {}
        title = (r.get("page") or {}).get("title") or (r.get("metadata") or {}).get("title")
        print(f"[e2e] captured title = {title!r}")
        print("[e2e] RESULT:", "PASS" if title else "PARTIAL (no title)")
    else:
        print("[e2e] error:", st.get("error")); print("[e2e] RESULT: FAIL")
finally:
    edge.terminate()
    c = sqlite3.connect(DB, timeout=10)
    c.execute("DELETE FROM daemon_egglet_tokens WHERE egglet_id=?", (EGGLET_ID,))
    c.commit(); c.close()
    shutil.rmtree(os.path.join(EGG_DIR, EGGLET_ID), ignore_errors=True)
