// Detect RSS/Atom autodiscovery links on the current page.  The
// background filters duplicates and decides whether to surface a
// subscribe affordance, so we can report unconditionally.
window.__eggFeeds = (function () {
  function scan() {
    const links = document.querySelectorAll(
      'link[rel="alternate"][type="application/rss+xml"], ' +
        'link[rel="alternate"][type="application/atom+xml"]',
    );
    return Array.from(links)
      .map((l) => ({
        feedUrl: l.href,
        title: l.title || document.title,
        kind: l.type.includes("atom") ? "atom" : "rss",
      }))
      .filter((f) => !!f.feedUrl);
  }
  return { scan };
})();
