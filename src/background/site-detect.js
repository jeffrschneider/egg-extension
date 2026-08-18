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
// SECOND TIER: a site may instead, or also, publish a Google A2A agent card,
// which is the convention actually in the wild. Both files are fetched every
// time, in parallel, and everything found is surfaced, because a site can
// publish both and they can name different agents. What separates the tiers is
// what can be checked, and the panel says which is which in words:
//
//   verified       our declaration: anchored at this domain and resolved at
//                  the registrar to a key, an identity that outlives the page.
//   site-declared  an A2A card: the site's own word, worth what the page you
//                  are already reading is worth.
//
// A card is admitted only when it names a JSON-RPC endpoint (the only binding
// we speak) on the SAME site, over https, that accepts anonymous callers. The
// same-site rule is the anchor rule applied to an endpoint: it stops a page
// from serving somebody else's card to borrow their credibility, and it means
// a card can never point us at a stranger. The anonymous rule keeps the chip
// from being a doorbell nobody can answer.
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
/** Where the A2A convention keeps its card. The first name is current; the
 *  second is what sites published before the rename, and plenty still do. */
const A2A_CARD_PATHS = ["/.well-known/agent-card.json", "/.well-known/agent.json"];
/** A card is somebody else's document with somebody else's skill list in it,
 *  so it gets a looser cap than our own file, but still a cap. */
const MAX_CARD_BYTES = 64 * 1024;

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
  return { tier: "verified", host, handle, purpose, agent_id: agentId };
}

// ── The A2A tier ─────────────────────────────────────────────────────

/** A card's description down to the length our own purposes are held to. A
 *  card writes for a machine and runs long, so the cut lands on a word and
 *  says it was cut, rather than stopping mid-syllable as if that were the
 *  whole sentence. */
function shorten(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const chars = [...raw.trim()];
  if (chars.length <= MAX_PURPOSE_CHARS) return chars.join("");
  const cut = chars.slice(0, MAX_PURPOSE_CHARS - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_PURPOSE_CHARS - 60 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "") + "…";
}

/** Second-level names that are really public suffixes: under them, two hosts
 *  sharing the last two labels are strangers, not siblings. Not a public
 *  suffix list, which is a megabyte and needs updating; the pairs below are
 *  the ones that actually carry a country's registrations. */
const SUFFIX_SLDS = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go"]);

/** The registrable part of a host: the last two labels, or three where the
 *  second-to-last is a country registry's own level (acme.co.uk, not co.uk). */
function registrable(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const [sld, tld] = parts.slice(-2);
  const depth = tld.length === 2 && SUFFIX_SLDS.has(sld) ? 3 : 2;
  return parts.slice(-depth).join(".");
}

/** Is the endpoint on the same site as the page? Registrable domains compared,
 *  so the ordinary split of a page on www or docs and an endpoint on api
 *  passes, while a page serving somebody else's card to borrow their
 *  credibility does not.
 *
 *  Known limit: hosts under a shared suffix this heuristic does not know
 *  (user pages on a platform domain, say) count as siblings. That admits a
 *  page borrowing its own platform's agent, which is a far smaller thing than
 *  a card pointing anywhere on the web, and it is the price of not shipping a
 *  public suffix list in a browser extension. */
export function sameSite(pageHost, endpointHost) {
  const base = registrable(pageHost);
  if (!base || !base.includes(".")) return false;
  return endpointHost === base || endpointHost.endsWith("." + base);
}

/** The JSON-RPC endpoint a card names, with the dialect its shape implies, or
 *  null when it names none we can speak. `supportedInterfaces` is A2A 1.0;
 *  a top-level `url` is the older card, whose default binding was JSON-RPC. */
export function a2aEndpoint(card) {
  const list = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : null;
  if (list) {
    const hit = list.find(
      (i) => typeof i?.url === "string" && String(i.protocolBinding ?? "").toUpperCase() === "JSONRPC",
    );
    return hit ? { url: hit.url, dialect: "v1" } : null;
  }
  if (typeof card?.url !== "string") return null;
  const transport = String(card.preferredTransport ?? "JSONRPC").toUpperCase();
  return transport === "JSONRPC" ? { url: card.url, dialect: "legacy" } : null;
}

/** Will this agent talk to a caller carrying nothing? An absent `security` is
 *  the OpenAPI spelling of "no requirement"; an empty requirement object in
 *  the list is the explicit one. Anything else wants a credential a visit
 *  does not have. */
export function acceptsAnonymous(card) {
  const sec = card?.security;
  if (sec === undefined || sec === null) return true;
  return Array.isArray(sec) && sec.some((r) => r && typeof r === "object" && Object.keys(r).length === 0);
}

/** The site's A2A card, when it publishes one we can honestly present. At most
 *  one: a card describes a single agent. */
async function probeA2A(host) {
  let card = null;
  for (const path of A2A_CARD_PATHS) {
    try {
      const resp = await fetchWithTimeout(`https://${host}${path}`, FETCH_TIMEOUT_MS);
      if (!resp.ok) continue;
      const len = Number(resp.headers.get("Content-Length") || 0);
      if (len > MAX_CARD_BYTES) continue;
      const text = await resp.text();
      if (new TextEncoder().encode(text).length > MAX_CARD_BYTES) continue;
      card = JSON.parse(text);
      break;
    } catch {
      /* absent, unreadable, or not JSON — try the older name, then give up */
    }
  }
  if (!card || typeof card !== "object") return null;

  const iface = a2aEndpoint(card);
  if (!iface) return null;
  let url;
  try { url = new URL(iface.url); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (!sameSite(host, url.hostname.toLowerCase())) {
    console.log(`[Egg:SiteAgent] A2A card on ${host} REFUSED: its endpoint is at ${url.hostname}, not here`);
    return null;
  }
  if (!acceptsAnonymous(card)) {
    console.log(`[Egg:SiteAgent] A2A card on ${host} skipped: it requires a credential a visit cannot carry`);
    return null;
  }

  const name = typeof card.name === "string" && card.name.trim() ? card.name.trim() : host;
  const purpose = shorten(card.description);

  console.log(`[Egg:SiteAgent] A2A card on ${host}: ${name} at ${url.href} (${iface.dialect})`);
  return {
    tier: "site-declared",
    host,
    handle: name,
    purpose,
    // No key stands behind this agent, so it has no mesh id. The endpoint is
    // what identifies it, which also keeps its thread separate per site.
    agent_id: "a2a:" + url.href,
    endpoint: url.href,
    dialect: iface.dialect,
  };
}

/** One uncached discovery + verification pass for a normalized host.
 *  Returns the verified agents in the site's declared order, primary first —
 *  an empty array when nothing verified, because errors on the way (no file,
 *  bad JSON, anchor mismatch, no resolution) are all the same fact to the
 *  chip: nothing to show. */
async function probeMesh(host) {
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

/** Everything this site declares, both conventions, verified tier first.
 *  Both are fetched every time: a site can publish both files, and they can
 *  name different agents, so looking for one only when the other is missing
 *  would show a picture the site did not publish. */
async function probe(host) {
  const [mesh, a2a] = await Promise.all([
    probeMesh(host).catch(() => []),
    probeA2A(host).catch(() => null),
  ]);
  // A site describing one agent both ways (likely, once a site publishes our
  // file and an A2A card for the same agent) should not appear as two. The
  // card's name against the handle's own name is the only comparison the two
  // formats share; when it matches, the verified description wins.
  const names = new Set(mesh.map((m) => m.handle.split(".")[0].toLowerCase()));
  const extra = a2a && !names.has(a2a.handle.toLowerCase()) ? [a2a] : [];
  return [...mesh, ...extra];
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

/** One cached entry for a host, by agent id. This reads only what detection
 *  itself put there, which is the point: an A2A visit is sent to an endpoint
 *  this module admitted for this host, never to a URL that arrived with the
 *  request. */
export async function cachedAgent(hostRaw, agentId) {
  const host = normalizeHost(hostRaw);
  if (!host) return null;
  try {
    const key = "siteAgent:" + host;
    const hit = (await chrome.storage.session.get(key))[key];
    const list = Array.isArray(hit?.agents) ? hit.agents : [];
    return list.find((a) => a.agent_id === agentId) || null;
  } catch {
    return null;
  }
}
