// Egg menu — its message listener is registered at document_start so it's
// present as early and reliably as possible, even on heavy pages whose
// document_idle content-script injection lags or misses (e.g. cnbc). The
// background sends "egg_show_menu"; we draw a keyboard-driven command palette
// and report the user's pick back via an "egg_action" message. pageEggMenu is
// only invoked when that message arrives (page fully loaded), so running the
// registration at document_start is safe.
(function () {
  // The voice header that showed what the Gateway was hearing is gone with the
  // "Hey Egg" listener the Gateway removed on 2026-07-06. Its feed, the
  // "egg_voice_transcript" message, had no sender left.

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "egg_show_menu") {
      try { pageEggMenu(msg.items, msg.title, msg.apps); } catch { /* tolerated */ }
      sendResponse({ ok: true });
    }
  });

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
