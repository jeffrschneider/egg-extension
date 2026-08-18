// Agents — the injected roster and conversation panel.
//
// Browser chrome is not available to an extension beyond one action icon, and
// in Egg (WebView2) even the badge and context menus are unreliable, so this
// draws its own surface in the page. Two rules follow from living inside an
// untrusted document:
//
//   1. Everything renders in a CLOSED shadow root, so page CSS cannot restyle
//      it and page script cannot read or fake its contents.
//   2. The chip says only "this site has an agent". Every claim that matters
//      -- the handle, the purpose, "verified for this host" -- is rendered by
//      us from the Gateway's answer, never from anything the page said, and
//      the page can neither see it nor forge a click into it.
//
// No Gateway token is held here. Every call goes to the service worker.
(function () {
  if (window.__eggAgentsInstalled) return;
  window.__eggAgentsInstalled = true;

  const Z = "2147483646"; // just under the Egg menu, which is a modal
  let hostEl = null;
  let root = null;
  let chipEl = null;
  let panelEl = null;
  let siteAgents = []; // the agents this host declares, in the site's own order
  const threads = new Map(); // agent_id -> [{ role, text }]

  function ask(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "egg_agents", ...msg }, (r) =>
          resolve(r || { error: "no answer from the Egg extension" }),
        );
      } catch (e) {
        resolve({ error: e?.message || String(e) });
      }
    });
  }

  function ensureRoot() {
    if (root) return root;
    hostEl = document.createElement("div");
    hostEl.style.cssText = "all:initial;position:fixed;inset:auto 0 0 auto;z-index:" + Z;
    root = hostEl.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .chip {
        position: fixed; right: 14px; bottom: 16px; display: flex; align-items: center; gap: 6px;
        padding: 7px 11px; border-radius: 999px; cursor: pointer;
        background: #15151c; color: #d7d7e2; border: 1px solid #2f2f3b;
        box-shadow: 0 6px 20px rgba(0,0,0,.35);
        font: 500 12px/1 system-ui, -apple-system, sans-serif;
      }
      .chip:hover { background: #1d1d26; }
      .chip .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; }
      .panel {
        position: fixed; top: 0; right: 0; height: 100vh; width: 380px; max-width: 100vw;
        display: flex; flex-direction: column;
        background: #15151c; color: #e6e6ef; border-left: 1px solid #2a2a34;
        box-shadow: -18px 0 50px rgba(0,0,0,.45);
        font: 400 13px/1.45 system-ui, -apple-system, sans-serif;
      }
      .head { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #24242e; }
      .head .title { font-weight: 600; font-size: 13px; }
      .head .sub { font-size: 11px; color: #8a8a96; margin-top: 2px; }
      .head .trust { font-size: 10px; color: #34d399; margin-top: 3px; }
      .switch { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #24242e; overflow-x: auto; }
      .switch button {
        flex: 0 0 auto; cursor: pointer; border-radius: 999px; padding: 4px 10px;
        background: transparent; color: #8a8a96; border: 1px solid #2f2f3b;
        font: 500 11px/1.4 system-ui, -apple-system, sans-serif;
      }
      .switch button:hover { color: #e6e6ef; }
      .switch button.on { background: #262633; color: #e6e6ef; border-color: #3f3f4e; }
      .x { margin-left: auto; background: transparent; border: 0; color: #8a8a96; cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; }
      .x:hover { color: #e6e6ef; }
      .body { flex: 1; min-height: 0; overflow-y: auto; }
      .group { padding: 12px 14px 4px; font-size: 9px; letter-spacing: .07em; color: #6a6a76; text-transform: uppercase; }
      .row { display: flex; align-items: flex-start; gap: 8px; padding: 9px 14px; border-bottom: 1px solid #1e1e27; }
      .row:hover { background: #1a1a23; }
      .row .name { font-size: 12px; font-weight: 500; }
      .row .desc { font-size: 10px; color: #8a8a96; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .row .facts { font-size: 9px; color: #7c7c88; margin-top: 2px; }
      .row .facts .v { color: #34d399; }
      .row .facts .warn { color: #fbbf24; }
      .grow { flex: 1; min-width: 0; }
      .pres { width: 6px; height: 6px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto; }
      .btn { background: #6d5cf0; color: #fff; border: 0; border-radius: 7px; padding: 4px 9px; font-size: 10px; font-weight: 600; cursor: pointer; }
      .btn.ghost { background: transparent; color: #8a8a96; border: 1px solid #2f2f3b; }
      .btn:hover { filter: brightness(1.1); }
      .msgs { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
      .msg { max-width: 100%; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; }
      .msg.user { align-self: flex-end; background: #262633; padding: 7px 10px; border-radius: 10px 10px 2px 10px; }
      .msg.agent { align-self: flex-start; background: #1c1c25; padding: 7px 10px; border-radius: 10px 10px 10px 2px; }
      .msg.err { color: #f87171; }
      .composer { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #24242e; }
      .composer input { flex: 1; min-width: 0; background: #101017; color: #e6e6ef; border: 1px solid #2a2a34; border-radius: 8px; padding: 7px 9px; font: inherit; font-size: 12px; outline: none; }
      .composer input:focus { border-color: #6d5cf0; }
      .empty { padding: 16px 14px; font-size: 11px; color: #8a8a96; }
    `;
    root.appendChild(style);
    document.documentElement.appendChild(hostEl);
    return root;
  }

  // ── Row wording. Unverified says so; unknown presence is amber, never the
  //    grey we use for offline, because "we never learned" is not "away".
  function trustLine(a) {
    const site = (a.source || "").startsWith("site:") ? a.source.slice(5) : null;
    switch (a.verified) {
      case "hosted": return "Runs on your machine";
      case "site": return site ? `Verified agent for ${site}` : "Verified site agent";
      case "handle": return "Public handle checked";
      case "paired": return "Paired device";
      case "owner": return a.owner ? `${a.owner}'s agent` : "Same owner key";
      default: return "Unverified key";
    }
  }
  function reachLine(a) {
    if (a.reach === "live") return "answers now";
    if (a.reach === "mail") return "holds mail until its program opens";
    return "reachability unknown";
  }
  function presenceColor(a) {
    const v = a.availability;
    if (v === "online" || v === "listening") return "#34d399";
    if (v === "offline" || v === "away") return "#4b4b57";
    return "#fbbf24";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function closePanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
  }

  function openPanel() {
    ensureRoot();
    closePanel();
    panelEl = el("div", "panel");
    root.appendChild(panelEl);
    return panelEl;
  }

  // ── The roster ───────────────────────────────────────────────────────
  async function showRoster() {
    const p = openPanel();
    const head = el("div", "head");
    const box = el("div", "grow");
    box.appendChild(el("div", "title", "Agents"));
    box.appendChild(el("div", "sub", "Everything you can reach, here and elsewhere"));
    head.appendChild(box);
    const x = el("button", "x", "✕");
    x.onclick = closePanel;
    head.appendChild(x);
    p.appendChild(head);

    const body = el("div", "body");
    body.appendChild(el("div", "empty", "Asking your Gateway..."));
    p.appendChild(body);

    const r = await ask({ op: "roster", host: location.hostname });
    body.textContent = "";
    if (r.error) {
      body.appendChild(el("div", "empty", r.error));
      return;
    }
    const agents = r.agents || [];
    const here = agents.filter((a) => a.where === "here");
    const elsewhere = agents.filter((a) => a.where !== "here");

    const section = (label, list, emptyText) => {
      body.appendChild(el("div", "group", label));
      if (!list.length) { body.appendChild(el("div", "empty", emptyText)); return; }
      for (const a of list) body.appendChild(agentRow(a, showRoster));
    };
    section("On your machine", here, "None yet.");
    section(
      "Elsewhere",
      elsewhere,
      "Nothing kept yet. Agents you meet on a site or through a contact can be kept here.",
    );
  }

  function agentRow(a, refresh) {
    const row = el("div", "row");
    const dot = el("div", "pres");
    dot.style.background = presenceColor(a);
    row.appendChild(dot);

    const mid = el("div", "grow");
    mid.appendChild(el("div", "name", a.handle || a.name));
    if (a.description) mid.appendChild(el("div", "desc", a.description));
    const facts = el("div", "facts");
    const v = el("span", "v", trustLine(a));
    facts.append(v, document.createTextNode(" · " + reachLine(a)));
    if (a.on_mesh === false) {
      facts.append(document.createTextNode(" · "), el("span", "warn", "off the mesh"));
    }
    if (a.admission === "owner") facts.append(document.createTextNode(" · you only"));
    mid.appendChild(facts);
    row.appendChild(mid);

    if (a.agent_id && a.reach !== "mail") {
      const talk = el("button", "btn", "Talk");
      talk.onclick = () => showChat(a, null);
      row.appendChild(talk);
    }
    if (a.agent_id && a.where === "elsewhere") {
      const saved = a.source === "saved";
      const keep = el("button", "btn ghost", saved ? "Forget" : "Keep");
      keep.onclick = async () => {
        keep.disabled = true;
        await ask(saved ? { op: "forget", agentId: a.agent_id } : { op: "save", agent: a });
        refresh();
      };
      row.appendChild(keep);
    }
    return row;
  }

  // The label a site agent goes by in the switcher: the handle's own name,
  // the part before its anchor mailbox ("Concierge.hello@acme.com" is
  // "Concierge"). Never anything the page supplied.
  function handleLabel(handle) {
    return String(handle || "").split(".")[0] || handle;
  }

  // A declared site agent in the shape a conversation wants.
  function asChatAgent(a) {
    return {
      agent_id: a.agent_id,
      handle: a.handle,
      name: a.handle,
      description: a.purpose,
      verified: "site",
      source: "site:" + a.host,
    };
  }

  // ── One conversation ─────────────────────────────────────────────────
  // `pageUrl` is passed only when the conversation was opened from this
  // site's own chip. Opening the same agent from the roster deliberately
  // sends nothing about the page.
  function showChat(agent, pageUrl) {
    const p = openPanel();
    const id = agent.agent_id;
    const head = el("div", "head");
    const box = el("div", "grow");
    box.appendChild(el("div", "title", agent.handle || agent.name));
    if (agent.description || agent.purpose) {
      box.appendChild(el("div", "sub", agent.description || agent.purpose));
    }
    box.appendChild(el("div", "trust", trustLine(agent)));
    head.appendChild(box);

    const back = el("button", "x", "‹");
    back.title = "Back to your agents";
    back.onclick = showRoster;
    head.appendChild(back);
    const x = el("button", "x", "✕");
    x.onclick = closePanel;
    head.appendChild(x);
    p.appendChild(head);

    // ── The other agents this site declares ──
    // The site named an order, so the chip lands you on its first agent and
    // the rest sit here, one click away, rather than making you choose from a
    // menu before you have said anything. Each keeps its own thread, because
    // threads are keyed by agent. Only shown for a conversation with one of
    // THIS site's declared agents, and only when there is somewhere to switch.
    if (siteAgents.length > 1 && siteAgents.some((a) => a.agent_id === id)) {
      const strip = el("div", "switch");
      for (const a of siteAgents) {
        const b = el("button", a.agent_id === id ? "on" : null, handleLabel(a.handle));
        if (a.purpose) b.title = a.purpose;
        b.onclick = () => { if (a.agent_id !== id) showChat(asChatAgent(a), pageUrl); };
        strip.appendChild(b);
      }
      p.appendChild(strip);
    }

    const body = el("div", "body");
    const msgs = el("div", "msgs");
    body.appendChild(msgs);
    p.appendChild(body);

    const paint = () => {
      msgs.textContent = "";
      for (const m of threads.get(id) || []) {
        msgs.appendChild(el("div", "msg " + m.role + (m.err ? " err" : ""), m.text));
      }
      body.scrollTop = body.scrollHeight;
    };
    paint();

    const composer = el("div", "composer");
    const input = document.createElement("input");
    input.placeholder = "Message " + (agent.handle || agent.name);
    const send = el("button", "btn", "Send");
    composer.append(input, send);
    p.appendChild(composer);
    input.focus();

    const push = (role, text, err) => {
      const t = threads.get(id) || [];
      t.push({ role, text, err });
      threads.set(id, t);
      paint();
    };

    const submit = async () => {
      const text = input.value.trim();
      if (!text || input.disabled) return;
      input.value = "";
      push("user", text);
      input.disabled = true;
      send.disabled = true;
      input.placeholder = "Waiting for " + (agent.handle || agent.name) + "...";
      const r = await ask({ op: "ask", agentId: id, message: text, pageUrl });
      input.disabled = false;
      send.disabled = false;
      input.placeholder = "Message " + (agent.handle || agent.name);
      if (r.error) push("agent", "No answer: " + r.error, true);
      else push("agent", r.text);
      input.focus();
    };
    send.onclick = submit;
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === "Escape") closePanel();
    };
  }

  // ── The chip: a doorbell, nothing more ───────────────────────────────
  // One chip per site however many agents it declares: the site has one front
  // door, and its first agent is who answers it.
  function showChip(list) {
    ensureRoot();
    siteAgents = list;
    const primary = list[0];
    if (chipEl) chipEl.remove();
    chipEl = el("div", "chip");
    chipEl.appendChild(el("span", "dot"));
    chipEl.appendChild(el("span", null, list.length > 1 ? "Agents" : "Agent"));
    chipEl.title =
      list.length > 1
        ? `This site has ${list.length} agents on AgentMesh. Click to talk to ${handleLabel(primary.handle)}.`
        : "This site has an agent on AgentMesh. Click to talk.";
    chipEl.onclick = () => showChat(asChatAgent(primary), location.href);
    root.appendChild(chipEl);
  }

  function hideChip() {
    siteAgents = [];
    if (chipEl) { chipEl.remove(); chipEl = null; }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "egg_show_agents") {
      try { showRoster(); } catch { /* tolerated */ }
      sendResponse({ ok: true });
    } else if (msg?.type === "egg_site_agent") {
      // `agents` is the list; `agent` is the primary an older worker sends.
      const list = Array.isArray(msg.agents) ? msg.agents : msg.agent ? [msg.agent] : [];
      try { list.length ? showChip(list) : hideChip(); } catch { /* tolerated */ }
      sendResponse({ ok: true });
    }
    return false;
  });
})();
