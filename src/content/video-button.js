// Floating Egg button on YouTube watch pages: download or transcribe the video.
// Self-contained content script (no imports). YouTube is a single-page app, so
// we re-check on its navigation events and on URL changes.
(function () {
  const BTN_ID = "egg-video-btn";
  const MENU_ID = "egg-video-menu";

  function isVideoPage() {
    return location.pathname === "/watch" && /[?&]v=/.test(location.search);
  }

  function removeButton() {
    document.getElementById(BTN_ID)?.remove();
    closeMenu();
  }

  function ensureButton() {
    if (!isVideoPage()) return removeButton();
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "🥚 Egg";
    btn.title = "Download or transcribe this video with Egg";
    btn.style.cssText =
      "position:fixed;right:18px;bottom:88px;z-index:2147483000;background:#15151c;color:#fff;" +
      "border:1px solid #2a2a34;border-radius:22px;padding:9px 16px;font:600 13px system-ui,-apple-system,sans-serif;" +
      "box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer";
    btn.onmouseenter = () => { btn.style.borderColor = "#7c5cff"; };
    btn.onmouseleave = () => { btn.style.borderColor = "#2a2a34"; };
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openMenu(); };
    document.documentElement.appendChild(btn);
  }

  function openMenu() {
    if (document.getElementById(MENU_ID)) return closeMenu();
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.style.cssText =
      "position:fixed;right:18px;bottom:130px;z-index:2147483001;background:#15151c;color:#fff;" +
      "border:1px solid #2a2a34;border-radius:12px;padding:6px;min-width:214px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.55);font:500 13px system-ui,-apple-system,sans-serif";
    const items = [
      ["transcript", "Get transcript"],
      ["download", "Download video"],
      ["both", "Download + transcript"],
    ];
    for (const [action, label] of items) {
      const row = document.createElement("div");
      row.dataset.eggAction = action;
      row.textContent = label;
      row.style.cssText = "padding:9px 12px;border-radius:8px;cursor:pointer";
      row.onmouseenter = () => { row.style.background = "#2e2e3a"; };
      row.onmouseleave = () => { row.style.background = "transparent"; };
      row.onclick = () => {
        closeMenu();
        toast("Egg: working on it…");
        chrome.runtime.sendMessage({ type: "video_action", action, url: location.href });
      };
      menu.appendChild(row);
    }
    document.documentElement.appendChild(menu);
    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);

    // Reflect transcript availability on the menu: probe (metadata only), then
    // grey out "Get transcript" if the video genuinely has no captions. If the
    // probe can't tell (rate-limited), leave it enabled.
    const tRow = menu.querySelector('[data-egg-action="transcript"]');
    if (tRow) {
      const orig = tRow.textContent;
      tRow.textContent = orig + " — checking…";
      chrome.runtime.sendMessage({ type: "video_probe", url: location.href }, (resp) => {
        if (chrome.runtime.lastError || !document.getElementById(MENU_ID)) return;
        if (resp && resp.ok && !resp.has_transcript) {
          tRow.textContent = "No transcript available";
          tRow.style.opacity = "0.45";
          tRow.style.cursor = "default";
          tRow.onclick = null;
          tRow.onmouseenter = null;
          tRow.onmouseleave = null;
        } else {
          tRow.textContent = orig;
        }
      });
    }
  }

  function onDocClick(e) {
    const menu = document.getElementById(MENU_ID);
    if (menu && !menu.contains(e.target) && e.target.id !== BTN_ID) closeMenu();
  }

  function closeMenu() {
    document.getElementById(MENU_ID)?.remove();
    document.removeEventListener("click", onDocClick, true);
  }

  function toast(text) {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.cssText =
      "position:fixed;right:18px;bottom:130px;z-index:2147483002;background:#15151c;color:#fff;" +
      "border:1px solid #2a2a34;border-left:4px solid #2fa84f;border-radius:10px;padding:10px 14px;" +
      "font:600 13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:280px";
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // Results/errors pushed from the service worker.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "video_result") toast(msg.text || "Done");
  });

  ensureButton();
  window.addEventListener("yt-navigate-finish", ensureButton);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; ensureButton(); }
  }, 1000);
})();
