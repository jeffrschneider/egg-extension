// Site Agents (EXT-11) — detection in the browser itself.
//
// A direct port of the Gateway's src/mesh/site_agents.rs, kept rule-for-rule
// in sync with extensions/EXT-11-site-agents.md. Discovery is the site's own
// /.well-known/agentmesh file; proof is PAN resolution at the registrar.
// Verified means BOTH held: the handle's anchor domain matches the serving
// host (whole labels, so docs.acme.com may carry a handle anchored @acme.com
// but acme.com.evil.example may not), and the handle resolves to a card.
// There is no unverified presentation tier.
//
// The declaration is a LIST, and every entry gets its own anchor check and its
// own resolution — a site cannot smuggle an unverified agent in behind a
// verified first one. The list is capped (MAX_AGENTS) so a 16 KB file cannot
// turn one page load into an unbounded burst of registrar lookups. Order is
// the site's: entry one is the primary, the one the chip opens.
//
// Detection deliberately does NOT involve the Gateway: the declaration file
// is public, the extension is already on the site, and the registrar lookup
// is one unauthenticated GET — so the chip works in a browser that has never
// paired. Pairing starts where it is actually needed, at the conversation.
//
// Privacy shape is unchanged from the Gateway version: the well-known fetch
// goes to the site the user is already on, the registrar lookup happens only
// after a claim exists, and both outcomes are cached (a day when verified,
// an hour when absent/invalid). The cache lives in storage.session, so the
// browsing trail it mirrors dies with the browser.

const REGISTRAR = "https://naming.agentmesh.ai";
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const RESOLVE_TIMEOUT_MS = 6000;
const MAX_FILE_BYTES = 16 * 1024;
const MAX_PURPOSE_CHARS = 200;
/** How many declared agents one site may present. The file has room for far
 *  more than a person can choose between, and each admitted entry costs a
 *  registrar lookup. */
const MAX_AGENTS = 4;

/** Lowercased host with any port stripped, or null for hosts that cannot
 *  carry a site agent at all: IP literals and single-label names have no
 *  anchor domain to match, and localhost is not a site. */
export function normalizeHost(raw) {
  let host = (raw || "").trim().toLowerCase();
  if (host.startsWith("https://")) host = host.slice(8);
  host = host.split("/")[0].split(":")[0].replace(/^\.+|\.+$/g, "");
  if (!host || !host.includes(".") || host === "localhost") return null;
  if (/^[\d.]+$/.test(host) || host.includes("[")) return null; // IPv4 / IPv6 literal
  return host;
}

/** EXT-11 §2.1: the serving host must BE the anchor domain or sit under it,
 *  compared on whole labels. */
export function anchorMatches(host, anchor) {
  return host === anchor || host.endsWith("." + anchor);
}

function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal, credentials: "omit", redirect: "follow" })
    .finally(() => clearTimeout(t));
}

/** The anchor domain a handle claims, lowercased, or null when the handle
 *  carries none. Everything after the LAST "@", so a local part containing
 *  one cannot shift the anchor. */
function anchorOf(handle) {
  const at = handle.lastIndexOf("@");
  if (at < 0) return null;
  const anchor = handle.slice(at + 1).trim().toLowerCase();
  return anchor && anchor.includes(".") ? anchor : null;
}

/** Verification 2 for one admitted entry: the handle resolves to a card at
 *  the registrar, and the card names an agent key. Returns the chip's shape
 *  or null. */
async function resolveEntry(host, handle, purposeRaw) {
  let card;
  try {
    const resp = await fetchWithTimeout(
      `${REGISTRAR}/api/resolve?handle=${encodeURIComponent(handle)}`,
      RESOLVE_TIMEOUT_MS,
    );
    if (!resp.ok) return null;
    card = await resp.json();
  } catch {
    return null;
  }
  const agentId = card?.card?.endpoints?.[0]?.agent_id;
  if (typeof agentId !== "string" || !agentId) return null;

  let purpose = typeof purposeRaw === "string" ? [...purposeRaw].slice(0, MAX_PURPOSE_CHARS).join("") : null;
  if (purpose != null && !purpose.trim()) purpose = null;

  console.log(`[Egg:SiteAgent] verified for ${host}: ${handle} (${agentId})`);
  return { host, handle, purpose, agent_id: agentId };
}

/** One uncached discovery + verification pass for a normalized host.
 *  Returns the verified agents in the site's declared order, primary first —
 *  an empty array when nothing verified, because errors on the way (no file,
 *  bad JSON, anchor mismatch, no resolution) are all the same fact to the
 *  chip: nothing to show. */
async function probe(host) {
  // ── Discovery: the site's own declaration ──
  let text;
  try {
    const resp = await fetchWithTimeout(`https://${host}/.well-known/agentmesh`, FETCH_TIMEOUT_MS);
    if (!resp.ok) return [];
    const len = Number(resp.headers.get("Content-Length") || 0);
    if (len > MAX_FILE_BYTES) return [];
    text = await resp.text();
  } catch {
    return [];
  }
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) return [];
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  if (doc?.v !== 1) return [];

  // ── Verification 1: the anchor match, on every entry ──
  // Local and cheap, so it runs first and thins the list before any lookup.
  // A repeated handle is dropped rather than resolved twice.
  const seen = new Set();
  const admitted = [];
  for (const entry of Array.isArray(doc.agents) ? doc.agents : []) {
    if (admitted.length >= MAX_AGENTS) break;
    const handle = typeof entry?.handle === "string" ? entry.handle.trim() : "";
    if (!handle || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());
    const anchor = anchorOf(handle);
    if (!anchor) continue;
    if (!anchorMatches(host, anchor)) {
      console.log(`[Egg:SiteAgent] claim on ${host} REFUSED: ${handle} is anchored at ${anchor}, not here`);
      continue;
    }
    admitted.push({ handle, purpose: entry.purpose });
  }
  if (!admitted.length) return [];

  // ── Verification 2: each admitted handle resolves to a card ──
  // Concurrent, because they are independent lookups and the chip waits on
  // the slowest either way; the declared order survives Promise.all.
  const resolved = await Promise.all(
    admitted.map((a) => resolveEntry(host, a.handle, a.purpose)),
  );
  return resolved.filter(Boolean);
}

/** The verified site agents for a host, in declared order. Cached in
 *  storage.session so browsing does not turn into a resolution stream; an
 *  empty array is an answer, not a failure. */
export async function lookup(hostRaw) {
  const host = normalizeHost(hostRaw);
  if (!host) return [];
  const key = "siteAgent:" + host;
  try {
    const hit = (await chrome.storage.session.get(key))[key];
    if (Array.isArray(hit?.agents)) {
      const ttl = hit.agents.length ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      if (Date.now() - hit.at < ttl) return hit.agents;
    }
  } catch { /* session storage unavailable — probe every time */ }
  const agents = await probe(host);
  try { await chrome.storage.session.set({ [key]: { at: Date.now(), agents } }); } catch { /* best effort */ }
  return agents;
}
