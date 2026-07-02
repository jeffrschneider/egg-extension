// Runs only on the Gateway's /connect page. That page (served by the local
// Gateway, so it holds the master token) provisions this browser's extension
// token on a Connect click and posts it to the window. We relay it to the
// service worker, which stores it — completing pairing with no code to copy.
(function () {
  window.addEventListener("message", (e) => {
    // Only trust messages from this same page (the Gateway connect page).
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "egg-connect" || !d.token || !d.port) return;
    try {
      chrome.runtime.sendMessage({
        type: "connect",
        token: d.token,
        port: d.port,
        host: d.host || "127.0.0.1",
        install_id: d.install_id,
      });
    } catch (err) {
      // extension context can be torn down mid-navigation; ignore
    }
  });
})();
