import { MSG } from "../shared/messages.js";

function send(type, extras = {}) {
  return chrome.runtime.sendMessage({ type, ...extras });
}

// Find the local Egg Gateway by knocking on its fixed port window (4747..)
// — the same window the daemon binds and the SDK probes. Returns the port of
// the first one that identifies itself as Egg, or null.
async function discoverGateway() {
  const BASE = 4747;
  const COUNT = 10;
  for (let i = 0; i < COUNT; i++) {
    const port = BASE + i;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 400);
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body && body.service === "egg-gateway") return port;
      }
    } catch (e) {
      // refused / timed out / not JSON — not the Gateway on this port
    }
  }
  return null;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

async function render() {
  const root = document.getElementById("root");
  root.innerHTML = "";

  const status = await send(MSG.STATUS);

  root.appendChild(el("h1", {}, "Egg"));

  if (!status?.paired) {
    root.appendChild(
      el(
        "p",
        { class: "muted" },
        "Connect this browser to your Egg Gateway to capture pages and run Egg apps.",
      ),
    );
    const errEl = el("div", { class: "err" });

    // Manual code fallback — hidden unless auto-connect can't find the Gateway.
    const input = el("input", { type: "text", placeholder: "54321-ABC123" });
    const pairBtn = el(
      "button",
      {
        class: "primary",
        onclick: async () => {
          errEl.textContent = "";
          pairBtn.disabled = true;
          try {
            const r = await send(MSG.PAIR, { input: input.value });
            if (r?.ok) render();
            else errEl.textContent = r?.error || "Pairing failed.";
          } catch (e) {
            errEl.textContent = e?.message || "Pairing failed.";
          } finally {
            pairBtn.disabled = false;
          }
        },
      },
      "Pair",
    );
    const codeRow = el("div", { class: "row", style: "display:none;margin-top:8px" }, input, pairBtn);

    const connectBtn = el(
      "button",
      {
        class: "primary",
        style: "width:100%",
        onclick: async () => {
          errEl.textContent = "";
          connectBtn.disabled = true;
          connectBtn.textContent = "Finding Egg…";
          const port = await discoverGateway();
          if (port) {
            // Open the Gateway's one-click connect page; its content-script
            // bridge stores the token this browser gets. No code to copy.
            chrome.tabs.create({ url: `http://127.0.0.1:${port}/connect` });
            window.close();
            return;
          }
          connectBtn.disabled = false;
          connectBtn.textContent = "Connect this browser";
          errEl.textContent = "Couldn't find a running Egg Gateway. Is Egg open? You can enter a code instead.";
          codeRow.style.display = "flex";
        },
      },
      "Connect this browser",
    );

    root.appendChild(connectBtn);
    root.appendChild(codeRow);
    root.appendChild(errEl);
    return;
  }

  root.appendChild(
    el("p", { class: "muted" }, `Paired with localhost:${status.port}.`),
  );

  // Front door to the Egglets: open the Gateway's launcher page in a tab.
  // The page lists every installed Egglet with an Open button; each Egglet
  // self-authorizes when loaded, so no token plumbing is needed here. We
  // reuse the port the extension already paired with.
  root.appendChild(
    el(
      "div",
      { class: "section" },
      el(
        "button",
        {
          class: "primary",
          style: "width:100%",
          onclick: () => {
            const url = `http://127.0.0.1:${status.port}/egglets`;
            console.log("[Egg:Popup] opening Egglet launcher", url);
            chrome.tabs.create({ url });
            window.close();
          },
        },
        "Open Egglets",
      ),
    ),
  );

  const okEl = el("div", { class: "ok" });
  const errEl = el("div", { class: "err" });

  async function capture(kind) {
    okEl.textContent = "";
    errEl.textContent = "";
    try {
      const r = await send(MSG.CAPTURE, { kind });
      if (r?.ok) okEl.textContent = "Sent to Egg.";
      else errEl.textContent = r?.error || "Capture failed.";
    } catch (e) {
      errEl.textContent = e?.message || "Capture failed.";
    }
  }

  root.appendChild(
    el(
      "div",
      { class: "actions" },
      el("button", { onclick: () => capture("page") }, "Memorize page"),
      el("button", { onclick: () => capture("article") }, "Memorize article"),
      el("button", { onclick: () => capture("selection") }, "Memorize selection"),
      el(
        "button",
        { onclick: () => capture("screenshot") },
        "Screenshot & crop",
      ),
    ),
  );
  root.appendChild(okEl);
  root.appendChild(errEl);

  // Feeds on this page — one-click follow. Populated asynchronously; the
  // section stays hidden until we know the tab actually has feeds.
  const feedsList = el("div", { class: "feeds" });
  const feedsSection = el(
    "div",
    { class: "section", style: "display:none" },
    el("div", { class: "section-title" }, "Feeds on this page"),
    feedsList,
  );
  root.appendChild(feedsSection);
  loadFeeds(feedsSection, feedsList);

  // Screenshot: closes the popup and starts the on-page crop. Destination is
  // chosen AFTER cropping, in the page's chooser — not here.
  root.appendChild(
    el(
      "div",
      { class: "section" },
      el(
        "button",
        {
          class: "primary",
          style: "width:100%",
          onclick: () => {
            chrome.runtime.sendMessage({ type: "start_screenshot" }).catch(() => {});
            window.close();
          },
        },
        "Snip a screenshot",
      ),
      el("div", { class: "muted", style: "font-size:11px;margin-top:4px" }, "Or press Ctrl+M → Screenshot & crop"),
    ),
  );

  root.appendChild(
    el(
      "div",
      { class: "section row" },
      el(
        "a",
        {
          href: "#",
          onclick: (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
          },
        },
        "Settings",
      ),
      el("span", { class: "muted", style: "flex:1" }),
      el(
        "button",
        {
          onclick: async () => {
            if (!confirm("Unpair this extension from Egg?")) return;
            await send(MSG.UNPAIR);
            render();
          },
        },
        "Unpair",
      ),
    ),
  );
}

// A readable host label for a feed (smart source tokens like "top" have no
// parseable URL, so fall back to the known host or the feed's kind).
function feedHost(feed) {
  if (feed.sourceType === "hn") return "news.ycombinator.com";
  try {
    return new URL(feed.feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return feed.kind || "";
  }
}

function feedRow(feed, alreadyFollowing) {
  const title = feed.title || feedHost(feed) || feed.feedUrl;
  const btn = el("button", { class: "feed-btn" });
  const markFollowing = () => {
    btn.textContent = "Following ✓";
    btn.disabled = true;
    btn.classList.add("following");
  };
  if (alreadyFollowing) {
    markFollowing();
  } else {
    btn.textContent = "Add to Feed";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Adding…";
      try {
        const r = await send("egg_add_feed", { feed });
        console.log("[Egg:Feeds] add result", r);
        if (r?.ok && (r.status === "added" || r.status === "already_following")) {
          markFollowing();
        } else {
          btn.disabled = false;
          btn.textContent = "Add to Feed";
        }
      } catch (e) {
        console.log("[Egg:Feeds] add error", e);
        btn.disabled = false;
        btn.textContent = "Add to Feed";
      }
    });
  }
  return el(
    "div",
    { class: "feed-row" },
    el(
      "div",
      { class: "feed-info" },
      el("div", { class: "feed-title", title }, title),
      el("div", { class: "feed-host" }, feedHost(feed)),
    ),
    btn,
  );
}

async function loadFeeds(section, list) {
  let resp;
  try {
    resp = await send("egg_get_page_feeds");
  } catch (e) {
    console.log("[Egg:Feeds] popup fetch failed", e);
    return;
  }
  const feeds = resp?.feeds || [];
  const following = resp?.following || {};
  console.log("[Egg:Feeds] popup got", feeds.length, "feed(s)");
  if (!feeds.length) return; // leave the section hidden
  list.innerHTML = "";
  for (const f of feeds) list.appendChild(feedRow(f, !!following[f.feedUrl]));
  section.style.display = "";
}

document.addEventListener("DOMContentLoaded", render);
