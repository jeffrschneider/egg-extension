// Content script entry point.  The earlier scripts in the manifest's
// content_scripts.js array have already attached helpers to window.

(function () {
  // Ctrl+M now opens the Egg menu (a command palette injected by the
  // background on the keyboard command, which grants the activeTab that
  // screenshot capture needs). Memorize is the default item — Ctrl+M then
  // Enter memorizes, the old muscle memory. No page-level keydown here.

  // Feed autodiscovery: emit once after the page settles.
  try {
    const feeds = window.__eggFeeds.scan();
    if (feeds.length) {
      chrome.runtime
        .sendMessage({
          type: "feed_discovered",
          payload: {
            pageUrl: location.href,
            feedUrl: feeds[0].feedUrl,
            title: feeds[0].title,
            kind: feeds[0].kind,
          },
        })
        .catch(() => {});
    }
  } catch {
    /* tolerated: feed scan should never break the page */
  }

  // Reading signals: always run; background filters by per-host opt-in.
  try {
    window.__eggSignals.start();
  } catch {
    /* tolerated */
  }

  // Extraction requests from the background.  Returning true keeps the
  // message channel open for the async sendResponse.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "extract_request") return;
    try {
      switch (msg.kind) {
        case "page":
        case "article": {
          const article = window.__eggReadable.extract();
          sendResponse({
            ok: true,
            metadata: window.__eggExtract.pageMetadata(),
            article,
          });
          return;
        }
        case "selection":
          sendResponse({
            ok: true,
            ...window.__eggExtract.selectionPayload(),
          });
          return;
        case "metadata":
          sendResponse({
            ok: true,
            ...window.__eggExtract.pageMetadata(),
          });
          return;
        default:
          sendResponse({ ok: false, error: "Unknown extract kind" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
    return true;
  });

  // On-page feedback toast — the notification/badge live on the toolbar icon,
  // which is easy to miss (unpinned icon, notifications off). This shows right
  // on the page, like the Egg Browser's frame pulse.
  function eggToast(text, color) {
    let el = document.getElementById("__egg_toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "__egg_toast";
      el.style.cssText = [
        "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
        "background:#15151c", "color:#fff", "padding:10px 14px", "border-radius:10px",
        "font:600 13px/1.3 system-ui,-apple-system,sans-serif",
        "box-shadow:0 8px 30px rgba(0,0,0,.45)", "border:1px solid #2a2a34",
        "transition:opacity .2s", "pointer-events:none", "max-width:320px",
      ].join(";");
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text;
    el.style.borderLeft = "3px solid " + (color || "#7c5cff");
    el.style.opacity = "1";
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.style.opacity = "0"; }, 2800);
  }

  // Ctrl+M now opens the Egg menu (handled by the background command, which
  // grants activeTab). Nothing to do in the page.

})();
