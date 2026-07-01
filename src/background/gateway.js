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

// ── Browser self-identification ──────────────────────────────────────
// The Gateway can't tell which browser an extension runs in, so we tell
// it: brand + version + platform, sent when connecting and on every call.
// Computed once per service-worker lifetime.
let _browser = null;

function normalizeBrand(b) {
  if (/edge/i.test(b)) return "Edge";
  if (/opera|opr/i.test(b)) return "Opera";
  if (/brave/i.test(b)) return "Brave";
  if (/google chrome/i.test(b) || /^chrome$/i.test(b)) return "Chrome";
  if (/vivaldi/i.test(b)) return "Vivaldi";
  if (/chromium/i.test(b)) return "Chromium";
  if (/firefox/i.test(b)) return "Firefox";
  return b || "Browser";
}

async function computeBrowser() {
  try {
    const uaData = navigator.userAgentData;
    if (uaData && Array.isArray(uaData.brands)) {
      const brands = uaData.brands;
      const find = (re) => brands.find((x) => re.test(x.brand));
      // Prefer the most specific brand; the generic "Not.A/Brand" greased
      // entry and bare "Chromium" fall to the back.
      const pick =
        find(/Edge/i) || find(/OPR|Opera/i) || find(/Brave/i) ||
        find(/Vivaldi/i) || find(/Google Chrome/i) || find(/Chromium/i);
      let brand = pick ? pick.brand : "";
      let version = pick ? pick.version : "";
      // Brave doesn't advertise itself in `brands`; ask directly.
      try { if (navigator.brave && (await navigator.brave.isBrave())) brand = "Brave"; } catch {}
      try {
        const hi = await uaData.getHighEntropyValues(["uaFullVersion"]);
        if (hi && hi.uaFullVersion) version = hi.uaFullVersion;
      } catch {}
      return { brand: normalizeBrand(brand), version: version || "", platform: uaData.platform || "" };
    }
  } catch {}
  // Fallback: parse the UA string (older Chromium, or non-Chromium).
  const ua = navigator.userAgent || "";
  let brand = "Browser";
  if (/Edg\//.test(ua)) brand = "Edge";
  else if (/OPR\//.test(ua)) brand = "Opera";
  else if (/Firefox\//.test(ua)) brand = "Firefox";
  else if (/Chrome\//.test(ua)) brand = "Chrome";
  const token = brand === "Edge" ? "Edg" : brand === "Opera" ? "OPR" : brand;
  const vm = ua.match(new RegExp(token + "\\/([\\d.]+)"));
  return { brand, version: vm ? vm[1] : "", platform: navigator.platform || "" };
}

export async function browserInfo() {
  if (!_browser) _browser = await computeBrowser();
  return _browser;
}

// Compact header form the Gateway parses: "brand|version|platform".
export function browserHeader(info) {
  return [info.brand || "", info.version || "", info.platform || ""].join("|");
}

// Bearer-authenticated request against the user's local Gateway.
// Throws on network failure, non-2xx, or missing pairing.
export async function gatewayFetch(path, init = {}) {
  const cfg = await loadCfg();
  if (!cfg) throw new Error("Extension not paired with a Gateway.");
  const url = `http://127.0.0.1:${cfg.port}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${cfg.token}`);
  headers.set("X-Egg-Browser", browserHeader(await browserInfo()));
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
