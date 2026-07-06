// Content script entry point.  The earlier scripts in the manifest's
// content_scripts.js array have already attached helpers to window.

(function () {
  // Ctrl+M now opens the Egg menu (a command palette injected by the
  // background on the keyboard command, which grants the activeTab that
  // screenshot capture needs). Memorize is the default item — Ctrl+M then
  // Enter memorizes, the old muscle memory. No page-level keydown here.

  // Feed autodiscovery: emit once after the page settles. Send the FULL list
  // so the service worker can badge the tab and offer every feed in the popup;
  // it also forwards the first hit to the ambient discovery log.
  try {
    const feeds = window.__eggFeeds.scan();
    if (feeds.length) {
      chrome.runtime
        .sendMessage({
          type: "feed_discovered",
          payload: { pageUrl: location.href, feeds },
        })
        .catch(() => {});
      console.log("[Egg:Feeds] reported " + feeds.length + " feed(s) to service worker");
    }
  } catch (e) {
    /* tolerated: feed scan should never break the page */
    console.log("[Egg:Feeds] content scan error", e);
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

  // The Ctrl+M / "Send to Egg…" menu is registered by menu.js at document_start
  // (more reliable on heavy pages than this document_idle script). The unused
  // function below is dead code, kept only to minimize this diff; removed next
  // cleanup.
  // eslint-disable-next-line no-unused-vars
  function pageEggMenu(items, title, apps) {
    if (window.__eggMenuActive) return;
    window.__eggMenuActive = true;
    try {
      const done = () => { window.__eggMenuActive = false; };

      const back = document.createElement("div");
      back.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;font:400 14px/1.4 system-ui,-apple-system,sans-serif";
      const card = document.createElement("div");
      card.style.cssText = "margin-top:14vh;background:#15151c;color:#fff;border:1px solid #2a2a34;border-radius:14px;min-width:340px;max-width:400px;box-shadow:0 16px 50px rgba(0,0,0,.55);overflow:hidden";
      const head = document.createElement("div");
      head.textContent = title || "Egg";
      head.style.cssText = "padding:12px 16px 6px;font-weight:700;font-size:12px;color:#a78bfa;letter-spacing:.04em";
      card.appendChild(head);
      const list = document.createElement("div");
      list.style.cssText = "padding:4px";
      card.appendChild(list);
      back.appendChild(card);
      document.documentElement.appendChild(back);

      const cleanup = () => { back.remove(); document.removeEventListener("keydown", onKey, true); done(); };
      const fire = (action, payload) => {
        cleanup();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          chrome.runtime.sendMessage({ type: "egg_action", action, payload });
        }));
      };

      let sel = 0;
      const rows = items.map((it, i) => {
        const r = document.createElement("div");
        r.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 12px;border-radius:9px;cursor:pointer";
        const lab = document.createElement("span"); lab.textContent = it.label; lab.style.cssText = "font-weight:500";
        const hint = document.createElement("span"); hint.textContent = it.hint || ""; hint.style.cssText = "font-size:11px;color:#8a8a96;border:1px solid #34343f;border-radius:5px;padding:1px 6px";
        if (!it.hint) hint.style.display = "none";
        r.append(lab, hint);
        r.onmouseenter = () => { sel = i; paint(); };
        r.onclick = () => fire(items[sel].action, items[sel].payload);
        list.appendChild(r);
        return r;
      });
      const paint = () => rows.forEach((r, i) => { r.style.background = i === sel ? "#2e2e3a" : "transparent"; });
      paint();

      if (apps && apps.length) {
        const appHead = document.createElement("div");
        appHead.textContent = "APPS";
        appHead.style.cssText = "padding:10px 14px 2px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#6a6a76";
        card.appendChild(appHead);
        const dock = document.createElement("div");
        dock.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;padding:2px 8px 4px";
        for (const app of apps) {
          const b = document.createElement("button");
          b.type = "button";
          b.title = app.label;
          b.style.cssText = "flex:0 0 auto;width:56px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 2px;background:transparent;border:0;border-radius:9px;cursor:pointer;color:#cfcfe0";
          const ic = document.createElement("div");
          ic.style.cssText = "display:flex;height:20px";
          try {
            // DOMParser (not innerHTML) so strict Trusted-Types pages don't block it.
            const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + app.icon + "</svg>";
            const parsed = new DOMParser().parseFromString(svgStr, "image/svg+xml").documentElement;
            ic.appendChild(document.importNode(parsed, true));
          } catch {
            ic.textContent = app.label.slice(0, 1);
          }
          const lb = document.createElement("span"); lb.textContent = app.label;
          lb.style.cssText = "font-size:10px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:54px";
          b.append(ic, lb);
          b.onmouseenter = () => { b.style.background = "#2e2e3a"; };
          b.onmouseleave = () => { b.style.background = "transparent"; };
          b.onclick = () => fire("open_app", app.id);
          dock.appendChild(b);
        }
        card.appendChild(dock);
        const browse = document.createElement("div");
        browse.textContent = "Browse all apps →";
        browse.style.cssText = "padding:6px 14px 12px;color:#a78bfa;font-size:12px;cursor:pointer";
        browse.onmouseenter = () => { browse.style.textDecoration = "underline"; };
        browse.onmouseleave = () => { browse.style.textDecoration = "none"; };
        browse.onclick = () => fire("browse_apps");
        card.appendChild(browse);
      }

      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); cleanup(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; paint(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); }
        else if (e.key === "Enter") { e.preventDefault(); fire(items[sel].action, items[sel].payload); }
      }
      document.addEventListener("keydown", onKey, true);
      back.addEventListener("click", (e) => { if (e.target === back) cleanup(); });
    } catch {
      window.__eggMenuActive = false;
    }
  }

})();
