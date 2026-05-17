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
