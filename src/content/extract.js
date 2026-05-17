// Page metadata + selection extraction.  Runs in the page's content
// script world, so it sees the live DOM but its globals do not collide
// with the page's own JavaScript.
window.__eggExtract = (function () {
  function meta(name) {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`);
    return el?.getAttribute("content") || null;
  }

  function pageMetadata() {
    const canonical =
      document.querySelector('link[rel="canonical"]')?.href || null;
    return {
      url: location.href,
      canonical,
      title: document.title,
      description: meta("description") || meta("og:description"),
      ogTitle: meta("og:title"),
      ogImage: meta("og:image"),
      siteName: meta("og:site_name"),
      language: document.documentElement.lang || null,
    };
  }

  function selectionPayload() {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : "";
    let context = null;
    if (sel && sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).commonAncestorContainer;
      const el =
        node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      context = el?.innerText?.slice(0, 1000) || null;
    }
    return { text, context, page: pageMetadata() };
  }

  return { pageMetadata, selectionPayload };
})();
