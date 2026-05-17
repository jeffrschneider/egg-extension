// Content script entry point.  The earlier scripts in the manifest's
// content_scripts.js array have already attached helpers to window.

(function () {
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
})();
