// Detect RSS/Atom feeds on the current page. Three sources, merged and
// deduped: (1) <link rel="alternate"> head autodiscovery tags, (2) visible
// anchors that look like feeds (by href or link text), and (3) smart
// per-host source types (YouTube channel, subreddit, GitHub repo, HN).
//
// The background stores the result per-tab (for the toolbar badge + popup
// "Follow this feed" UI) and forwards the first hit to the ambient discovery
// log. Everything here is best-effort: a scan must never throw and never break
// the host page.
window.__eggFeeds = (function () {
  const RSS_EXT = /\.(rss|atom|xml)(\?|#|$)/i;
  const FEED_PATH = /\/(feed|rss|atom)\/?(\?|#|$)/i;
  const FEED_TEXT = /\b(rss|atom|feed|subscribe)\b/i;
  // github.com/<owner> paths that are site chrome, not repositories.
  const GH_RESERVED = new Set([
    "about", "features", "pricing", "marketplace", "explore", "topics",
    "trending", "collections", "sponsors", "settings", "notifications",
    "issues", "pulls", "orgs", "apps", "login", "join", "new", "search",
    "codespaces", "dashboard",
  ]);

  function absUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return null;
    }
  }

  // (1) Head autodiscovery links.
  function headFeeds() {
    const out = [];
    try {
      const links = document.querySelectorAll(
        'link[rel="alternate"][type="application/rss+xml"], ' +
          'link[rel="alternate"][type="application/atom+xml"]',
      );
      for (const l of links) {
        const feedUrl = absUrl(l.getAttribute("href") || l.href);
        if (!feedUrl) continue;
        out.push({
          feedUrl,
          title: l.getAttribute("title") || document.title,
          kind: (l.getAttribute("type") || "").includes("atom") ? "atom" : "rss",
        });
      }
    } catch (e) {
      console.log("[Egg:Feeds] headFeeds error", e);
    }
    return out;
  }

  // (2) Visible anchors that resolve to a feed URL or carry feed-y link text.
  function anchorFeeds() {
    const out = [];
    try {
      const anchors = document.querySelectorAll("a[href]");
      for (const a of anchors) {
        const feedUrl = absUrl(a.getAttribute("href"));
        if (!feedUrl) continue;
        const text = (a.textContent || "").trim();
        const byUrl = RSS_EXT.test(feedUrl) || FEED_PATH.test(feedUrl);
        const byText = text && text.length <= 40 && FEED_TEXT.test(text);
        if (!byUrl && !byText) continue;
        out.push({ feedUrl, title: text || document.title, kind: "link" });
        if (out.length >= 20) break; // cap: don't scan an infinite page dry
      }
    } catch (e) {
      console.log("[Egg:Feeds] anchorFeeds error", e);
    }
    return out;
  }

  // (3) Smart, host-specific feeds the page never links to explicitly.
  function smartFeeds() {
    const out = [];
    try {
      const host = location.hostname;
      const path = location.pathname || "/";

      if (/(^|\.)youtube\.com$/i.test(host)) {
        let channelId = null;
        const meta = document.querySelector('meta[itemprop="channelId"]');
        if (meta && meta.content) channelId = meta.content;
        if (!channelId) {
          const canon = document.querySelector('link[rel="canonical"]');
          const m = canon && canon.href && canon.href.match(/\/channel\/([\w-]+)/);
          if (m) channelId = m[1];
        }
        if (!channelId) {
          const m = path.match(/\/channel\/([\w-]+)/);
          if (m) channelId = m[1];
        }
        if (!channelId) {
          // Last resort: pull the externalId/channelId out of the page's JSON.
          const html = (document.body && document.body.innerHTML) || "";
          const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]+)"/);
          if (m) channelId = m[1];
        }
        const ytTitle = (document.title || "YouTube channel").replace(/ - YouTube$/, "");
        if (channelId) {
          out.push({
            feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=" + channelId,
            title: ytTitle,
            kind: "youtube.com",
            sourceType: "youtube",
          });
        } else if (/\/@[\w.-]+/.test(path) || /\/(channel|c|user)\//.test(path)) {
          // Handle-only page — offer the channel URL; the Gateway resolves it.
          const channelUrl = location.origin + "/" + path.split("/").filter(Boolean).slice(0, 1).join("/");
          out.push({ feedUrl: channelUrl, title: ytTitle, kind: "youtube.com", sourceType: "youtube" });
        }
      } else if (/(^|\.)reddit\.com$/i.test(host)) {
        const m = path.match(/\/r\/([A-Za-z0-9_]+)/);
        if (m) {
          out.push({
            feedUrl: "https://www.reddit.com/r/" + m[1] + "/.rss",
            title: "r/" + m[1],
            kind: "reddit.com",
            sourceType: "reddit",
          });
        }
      } else if (/(^|\.)github\.com$/i.test(host)) {
        const m = path.match(/^\/([^/]+)\/([^/]+)/);
        if (m && !GH_RESERVED.has(m[1].toLowerCase())) {
          const owner = m[1];
          const repo = m[2].replace(/\.git$/, "");
          out.push({
            feedUrl: "https://github.com/" + owner + "/" + repo + "/releases.atom",
            title: owner + "/" + repo + " releases",
            kind: "github.com",
            sourceType: "github",
          });
        }
      } else if (/(^|\.)news\.ycombinator\.com$/i.test(host)) {
        out.push({ feedUrl: "top", title: "Hacker News — Top", kind: "hn", sourceType: "hn" });
      }
    } catch (e) {
      console.log("[Egg:Feeds] smartFeeds error", e);
    }
    return out;
  }

  function scan() {
    try {
      // Order matters for dedupe: head + smart (strong signals) win over
      // anchor "link" matches pointing at the same URL.
      const all = [...headFeeds(), ...smartFeeds(), ...anchorFeeds()];
      const seen = new Map();
      for (const f of all) {
        if (!f || !f.feedUrl) continue;
        const key = f.feedUrl.toLowerCase();
        if (!seen.has(key)) seen.set(key, f);
      }
      const result = Array.from(seen.values()).slice(0, 25);
      if (result.length) {
        console.log(
          "[Egg:Feeds] detected " + result.length + " feed(s):",
          result.map((f) => f.feedUrl),
        );
      }
      return result;
    } catch (e) {
      console.log("[Egg:Feeds] scan failed", e);
      return [];
    }
  }

  return { scan };
})();
