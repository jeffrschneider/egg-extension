import { gatewayPost } from "./gateway.js";

// Forward an autodiscovery hit to the Gateway.  The Gateway dedupes
// (so we can call this on every page view without coordination) and
// decides whether to surface the subscribe affordance to the user.
export async function reportDiscovered({ pageUrl, feedUrl, title, kind }) {
  try {
    await gatewayPost("/api/extension/feeds/discovered", {
      page_url: pageUrl,
      feed_url: feedUrl,
      title,
      kind,
    });
  } catch (e) {
    console.warn("[egg-ext] feed report failed:", e?.message || e);
  }
}

// Actively follow a feed. `url` is the feed URL, or a smart source token like
// "top" for Hacker News (paired with sourceType). Returns the Gateway result:
// { status: "added"|"already_following"|"invalid", feed_id?, title?, item_count?, error? }.
export async function addFeed({ url, sourceType, label }) {
  const body = { url };
  if (sourceType) body.source_type = sourceType;
  if (label) body.label = label;
  const res = await gatewayPost("/api/extension/feeds/add", body);
  console.log("[Egg:Feeds] add", url, "→", res?.status || res);
  return res;
}

// Ask the Gateway which of these feed URLs the user already follows.
// Returns { following: { "<url>": feed_id } }.
export async function feedStatus(urls) {
  if (!Array.isArray(urls) || !urls.length) return { following: {} };
  const res = await gatewayPost("/api/extension/feeds/status", { urls });
  return res || { following: {} };
}
