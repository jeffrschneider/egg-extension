// Lightweight article-body heuristic.  Walks the DOM and picks the
// element with the largest concentration of paragraph text.  Good
// enough for most blog and news layouts; a Mozilla-Readability port
// is the obvious upgrade later.
window.__eggReadable = (function () {
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NAV",
    "HEADER",
    "FOOTER",
    "ASIDE",
    "NOSCRIPT",
  ]);

  function scoreNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return 0;
    if (SKIP.has(node.tagName)) return 0;
    let pText = 0;
    for (const p of node.querySelectorAll("p")) {
      pText += (p.innerText || "").length;
    }
    return pText;
  }

  function extract() {
    const candidates = document.querySelectorAll(
      'article, main, [role="main"], div, section',
    );
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const s = scoreNode(c);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    if (!best || bestScore < 200) {
      return {
        text: document.body?.innerText?.slice(0, 50000) || "",
        html: null,
        kind: "fallback",
      };
    }
    return {
      text: best.innerText.slice(0, 50000),
      html: best.outerHTML.slice(0, 200000),
      kind: "heuristic",
    };
  }

  return { extract };
})();
