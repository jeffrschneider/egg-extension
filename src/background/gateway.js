import { getLocal, setLocal, removeLocal } from "../shared/storage.js";

// Cached config so we do not hit chrome.storage on every request.  The
// service worker can be torn down at any moment, so the cache is just
// an in-memory accelerator; the source of truth is chrome.storage.
let _cfg = null;

async function loadCfg() {
  if (_cfg) return _cfg;
  const { gateway } = await getLocal(["gateway"]);
  _cfg = gateway || null;
  return _cfg;
}

export async function getConfig() {
  return await loadCfg();
}

export async function setConfig(cfg) {
  _cfg = cfg;
  await setLocal({ gateway: cfg });
}

export async function clearConfig() {
  _cfg = null;
  await removeLocal(["gateway"]);
}

export async function isPaired() {
  const cfg = await loadCfg();
  return !!(cfg && cfg.port && cfg.token);
}

// Bearer-authenticated request against the user's local Gateway.
// Throws on network failure, non-2xx, or missing pairing.
export async function gatewayFetch(path, init = {}) {
  const cfg = await loadCfg();
  if (!cfg) throw new Error("Extension not paired with a Gateway.");
  const url = `http://127.0.0.1:${cfg.port}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${cfg.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("Content-Type") || "";
  return ct.includes("application/json") ? await res.json() : await res.text();
}

export async function gatewayPost(path, body) {
  return await gatewayFetch(path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function gatewayGet(path) {
  return await gatewayFetch(path, { method: "GET" });
}
