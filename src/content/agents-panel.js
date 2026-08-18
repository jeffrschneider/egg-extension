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
  // When the user last pressed a pointer down somewhere that is NOT our UI.
  // Leaving on purpose must never be undone; only focus that the PAGE took is
  // worth taking back.
  let lastPagePointer = 0;
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
      .chip .dot.unver { background: transparent; border: 1px solid #9a9aa6; }
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
      .head .trust.unver { color: #fbbf24; }
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
      .panel.over { outline: 2px dashed #6d5cf0; outline-offset: -6px; }
      .attach { display: none; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid #24242e; font-size: 11px; color: #8a8a96; }
      .attach .file { background: #23232e; color: #cfcfe0; border-radius: 6px; padding: 3px 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .attach .note { color: #fbbf24; }
      .attach .rm { background: transparent; border: 0; color: #8a8a96; cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 4px; }
      .attach .rm:hover { color: #e6e6ef; }
      .composer { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #24242e; }
      .composer input { flex: 1; min-width: 0; background: #101017; color: #e6e6ef; border: 1px solid #2a2a34; border-radius: 8px; padding: 7px 9px; font: inherit; font-size: 12px; outline: none; }
      .composer input:focus { border-color: #6d5cf0; }
      .empty { padding: 16px 14px; font-size: 11px; color: #8a8a96; }
    `;
    root.appendChild(style);
    // What you type here is not the page's business. Keyboard events are
    // composed, so without this they cross the shadow boundary and land in
    // whatever the site has bound to the document -- and sites bind a lot to
    // single keys. Stopping them at our own host keeps them from every
    // BUBBLE-phase handler on the page.
    //
    // It does not stop a page that listens in the CAPTURE phase, which is
    // what GitHub does: capture runs from the window downward and reaches the
    // document before the event has got anywhere near this element, and
    // stopping it that early would stop it reaching our own input as well.
    // Nothing inside a shared document can fix that one; not sharing the
    // document is what fixes it.
    for (const type of ["keydown", "keypress", "keyup", "input", "paste", "cut", "copy"]) {
      hostEl.addEventListener(type, (e) => e.stopPropagation());
    }
    // Watch for the user choosing to go back to the page. Clicking away is a
    // decision and must stand; only focus the page TOOK gets taken back.
    document.addEventListener(
      "pointerdown",
      (e) => {
        let ours = false;
        try { ours = e.composedPath().includes(hostEl); } catch { ours = false; }
        if (!ours) lastPagePointer = Date.now();
      },
      true,
    );
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
      // The A2A tier. Nothing here was checked by anyone: the site published a
      // card, and that is the whole of it. Say so in the words a person would
      // use, and never borrow the word "verified".
      case "site-declared":
        return site ? `${site} says this is its agent. Not checked` : "The site's own word. Not checked";
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

  // The label a site agent goes by in the switcher. For our own declaration
  // that is the handle's name, the part before its anchor mailbox
  // ("Concierge.hello@acme.com" is "Concierge"). An A2A card has no handle,
  // only a name it chose for itself, so that gets used as-is and cut to a
  // length that fits a pill.
  function agentLabel(a) {
    const raw = String(a.handle || "");
    if (a.tier === "site-declared") return raw.length > 18 ? raw.slice(0, 17) + "…" : raw;
    return raw.split(".")[0] || raw;
  }

  // A declared site agent in the shape a conversation wants.
  function asChatAgent(a) {
    return {
      agent_id: a.agent_id,
      handle: a.handle,
      name: a.handle,
      description: a.purpose,
      verified: a.tier === "site-declared" ? "site-declared" : "site",
      source: "site:" + a.host,
    };
  }

  // ── Dropping things into a conversation ──────────────────────────────
  // This panel lives in the page's own document, so a drag from the page to
  // here is an ordinary drop: no permission, no second window. The toolbar
  // popup cannot do this at all, because pressing the mouse down on the page
  // blurs it and a popup that lost focus has already closed.
  //
  // What a page drag actually hands over decides the shape of this. Text
  // arrives as text and goes straight into the composer. An image arrives as
  // its ADDRESS, not its bytes, so it rides along as a file with a `uri` --
  // the same shape the A2A bridge maps in both directions -- and whoever
  // receives it fetches it. Bytes from the desktop are a different feature and
  // say so rather than failing quietly.
  const pendingFiles = new Map(); // agent_id -> { uri, name, media_type }

  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
  const MAX_DROPPED_TEXT = 2000;

  /** The image a drag is carrying, if it is carrying one: the dragged <img>
   *  itself first, then a dragged link that names an image. A link to anything
   *  else is not an image and falls through to the text path. */
  function draggedImage(dt) {
    const html = dt.getData("text/html") || "";
    const tag = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
    if (tag) return tag[1];
    const uri = (dt.getData("text/uri-list") || "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    return uri && IMAGE_EXT.test(uri) ? uri : null;
  }

  /** A dragged image URL as the file a message can carry, or null when it has
   *  no address anyone else could fetch (data: and blob: are the page's own
   *  private handles, not somewhere to send an agent). */
  function fileFromUrl(raw) {
    let u;
    try { u = new URL(raw, location.href); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    let name = "image";
    try { name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "image"); } catch { /* keep the default */ }
    const ext = (IMAGE_EXT.exec(u.pathname) || [])[1]?.toLowerCase();
    const mediaType = !ext ? null : ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
    return { uri: u.href, name, ...(mediaType ? { media_type: mediaType } : {}) };
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
    box.appendChild(
      el("div", agent.verified === "site-declared" ? "trust unver" : "trust", trustLine(agent)),
    );
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
        const b = el("button", a.agent_id === id ? "on" : null, agentLabel(a));
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

    // What a drop left behind: an attached image, or a line saying why the
    // drop could not become one. Both sit directly above the composer, where
    // what you are about to send belongs.
    let note = "";
    const attach = el("div", "attach");
    const paintAttach = () => {
      attach.textContent = "";
      const f = pendingFiles.get(id);
      if (f) {
        attach.appendChild(el("span", "file", f.name));
        const rm = el("button", "rm", "✕");
        rm.title = "Don't send this";
        rm.onclick = () => { pendingFiles.delete(id); paintAttach(); };
        attach.appendChild(rm);
      } else if (note) {
        attach.appendChild(el("span", "note", note));
      }
      attach.style.display = attach.childNodes.length ? "flex" : "none";
    };
    p.appendChild(attach);

    const composer = el("div", "composer");
    const input = document.createElement("input");
    input.placeholder = "Message " + (agent.handle || agent.name);
    const send = el("button", "btn", "Send");
    composer.append(input, send);
    p.appendChild(composer);
    input.focus();
    paintAttach();

    p.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      p.classList.add("over");
    });
    p.addEventListener("dragleave", (e) => { if (e.target === p) p.classList.remove("over"); });
    p.addEventListener("drop", (e) => {
      e.preventDefault();
      p.classList.remove("over");
      const dt = e.dataTransfer;
      if (!dt) return;
      note = "";
      if (dt.files && dt.files.length) {
        note = "Files from your computer are not sent yet. An image dragged from a page works.";
        paintAttach();
        return;
      }
      const img = draggedImage(dt);
      if (img) {
        const file = fileFromUrl(img);
        if (file) pendingFiles.set(id, file);
        else note = "That image is built into the page rather than hosted, so there is no address to pass on.";
        paintAttach();
        input.focus();
        return;
      }
      let text = (dt.getData("text/plain") || "").trim();
      if (!text) return;
      if (text.length > MAX_DROPPED_TEXT) {
        text = text.slice(0, MAX_DROPPED_TEXT);
        note = `Kept the first ${MAX_DROPPED_TEXT} characters.`;
      }
      input.value = input.value ? input.value + " " + text : text;
      paintAttach();
      input.focus();
    });

    const push = (role, text, err) => {
      const t = threads.get(id) || [];
      t.push({ role, text, err });
      threads.set(id, t);
      paint();
    };

    // The composer stays ENABLED while an answer is outstanding. It used to
    // disable itself, and a disabled input cannot hold focus: the moment you
    // pressed Enter, focus fell to the page's body and everything typed during
    // the wait went to the page, which on a site with keyboard shortcuts is
    // worse than lost. Waiting is a flag now, so you keep the cursor and can
    // type the next message while the last one is still out.
    let busy = false;
    const submit = async () => {
      const text = input.value.trim();
      const file = pendingFiles.get(id) || null;
      if ((!text && !file) || busy) return;
      input.value = "";
      pendingFiles.delete(id);
      note = "";
      paintAttach();
      push("user", file ? (text ? text + "\n" : "") + "(attached " + file.name + ")" : text);
      busy = true;
      send.disabled = true;
      input.placeholder = "Waiting for " + (agent.handle || agent.name) + "...";
      // The attachment also goes in the message itself, not only in `files`.
      // Two reasons. An empty message is not a message: sending one with only
      // an attachment produced a model call with no content at all, which the
      // far end rejected outright. And most agents today read the text and
      // nothing else, so an address named in the fenced field is the only part
      // of an attachment they will ever notice.
      const sent = file
        ? (text ? text + "\n\n" : "") + "[attached image: " + file.uri + "]"
        : text;
      const r = await ask({ op: "ask", agentId: id, message: sent, pageUrl, files: file ? [file] : undefined });
      busy = false;
      send.disabled = false;
      input.placeholder = "Message " + (agent.handle || agent.name);
      if (r.error) push("agent", "No answer: " + r.error, true);
      else push("agent", r.text);
      input.focus();
    };
    // ── Taking the cursor back ──
    // A page can move focus out of here without the user asking: a keyboard
    // shortcut bound in the capture phase (which we cannot stop from inside a
    // shared document), or a live feed that re-renders and focuses something
    // of its own. Either way the sentence in progress starts landing on the
    // page. So: if focus leaves the composer while the user is mid-sentence,
    // and they did not click away themselves, take it back.
    //
    // Bounded on purpose. A page that insists is a page we would otherwise
    // fight in a loop, so after a few tries in a row we stop and let the user
    // click back rather than spin.
    let lastTyped = 0;
    let restores = 0;
    let restoreWindowAt = 0;
    input.addEventListener("keydown", () => { lastTyped = Date.now(); });
    input.addEventListener("focusout", (e) => {
      if (panelEl !== p) return; // this conversation is no longer on screen
      const to = e.relatedTarget;
      if (to && root.contains(to)) return; // moved within our own UI
      const now = Date.now();
      if (now - lastTyped > 10000) return; // not mid-sentence
      if (now - lastPagePointer < 400) return; // the user clicked away
      if (now - restoreWindowAt > 2000) { restoreWindowAt = now; restores = 0; }
      if (++restores > 5) return;
      setTimeout(() => { if (panelEl === p) input.focus(); }, 0);
    });

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
    // The dot is the only thing on the chip that carries a claim: filled when
    // an identity was checked, hollow when the site is merely saying so. The
    // word stays "Agent" either way, because the chip's job is to say someone
    // is here, and what is known about them belongs in the panel.
    const verified = list.some((a) => a.tier !== "site-declared");
    if (chipEl) chipEl.remove();
    chipEl = el("div", "chip");
    chipEl.appendChild(el("span", verified ? "dot" : "dot unver"));
    chipEl.appendChild(el("span", null, list.length > 1 ? "Agents" : "Agent"));
    chipEl.title =
      list.length > 1
        ? `This site names ${list.length} agents. Click to talk to ${agentLabel(primary)}.`
        : verified
          ? "This site has an agent on AgentMesh, and the claim checks out. Click to talk."
          : "This site says it has an agent. Nothing about that is checked. Click to talk.";
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
