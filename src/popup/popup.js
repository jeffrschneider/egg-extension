import { MSG } from "../shared/messages.js";

function send(type, extras = {}) {
  return chrome.runtime.sendMessage({ type, ...extras });
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
        "Open Egg, find the pairing code under Settings → Extension, and paste it here.",
      ),
    );
    const input = el("input", { type: "text", placeholder: "54321-ABC123" });
    const errEl = el("div", { class: "err" });
    const pairBtn = el(
      "button",
      {
        class: "primary",
        onclick: async () => {
          errEl.textContent = "";
          pairBtn.disabled = true;
          try {
            const r = await send(MSG.PAIR, { input: input.value });
            if (r?.ok) {
              render();
            } else {
              errEl.textContent = r?.error || "Pairing failed.";
            }
          } catch (e) {
            errEl.textContent = e?.message || "Pairing failed.";
          } finally {
            pairBtn.disabled = false;
          }
        },
      },
      "Pair",
    );
    root.appendChild(el("div", { class: "row" }, input, pairBtn));
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
      el("button", { onclick: () => capture("page") }, "Send page"),
      el("button", { onclick: () => capture("article") }, "Send article"),
      el("button", { onclick: () => capture("selection") }, "Send selection"),
      el(
        "button",
        { onclick: () => capture("screenshot") },
        "Send screenshot",
      ),
    ),
  );
  root.appendChild(okEl);
  root.appendChild(errEl);

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

document.addEventListener("DOMContentLoaded", render);
