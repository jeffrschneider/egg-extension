// Track visit + dwell time + scroll depth for the current page.  The
// content script always emits; the background enforces per-host
// opt-in before anything leaves the browser.
window.__eggSignals = (function () {
  const host = location.hostname;
  const visitedAt = Date.now();
  let dwellMs = 0;
  let maxScroll = 0;
  let lastTick = Date.now();
  let visible = document.visibilityState === "visible";

  function tick() {
    const now = Date.now();
    if (visible) dwellMs += now - lastTick;
    lastTick = now;
    const docHeight = Math.max(1, document.documentElement.scrollHeight);
    const scrolled = Math.min(
      1,
      (window.scrollY + window.innerHeight) / docHeight,
    );
    if (scrolled > maxScroll) maxScroll = scrolled;
  }

  function flush(final = false) {
    tick();
    const events = [
      {
        type: "page_signal",
        host,
        url: location.href,
        title: document.title,
        visited_at: visitedAt,
        dwell_ms: dwellMs,
        max_scroll: maxScroll,
        final,
      },
    ];
    chrome.runtime
      .sendMessage({ type: "signal_batch", host, events })
      .catch(() => {});
  }

  function start() {
    document.addEventListener("visibilitychange", () => {
      tick();
      visible = document.visibilityState === "visible";
      if (!visible) flush(false);
    });
    window.addEventListener("beforeunload", () => flush(true));
    setInterval(() => flush(false), 30000);
  }

  return { start };
})();
