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

async function renderStatus() {
  const root = document.getElementById("status");
  root.innerHTML = "";
  const s = await send(MSG.STATUS);
  if (s?.paired) {
    root.appendChild(el("p", {}, `Paired with localhost:${s.port}.`));
  } else {
    root.appendChild(
      el(
        "p",
        {},
        "Not paired.  Open the extension popup and enter the code Egg displays.",
      ),
    );
  }
}

async function renderHosts() {
  const root = document.getElementById("hosts");
  root.innerHTML = "";
  const r = await send(MSG.GET_PERMISSIONS);
  const hosts = r?.hosts || {};
  const entries = Object.entries(hosts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    root.appendChild(
      el("p", { class: "muted" }, "No site permissions yet."),
    );
    return;
  }
  for (const [host, perm] of entries) {
    root.appendChild(hostRow(host, perm));
  }
}

function hostRow(host, perm) {
  const sig = el("input", { type: "checkbox" });
  sig.checked = !!perm.signals;
  sig.addEventListener("change", async () => {
    await send(MSG.SET_PERMISSION, {
      host,
      value: { signals: sig.checked },
    });
  });
  const cap = el("input", { type: "checkbox" });
  cap.checked = !!perm.captureAuto;
  cap.addEventListener("change", async () => {
    await send(MSG.SET_PERMISSION, {
      host,
      value: { captureAuto: cap.checked },
    });
  });
  const remove = el(
    "button",
    {
      onclick: async () => {
        await send(MSG.REVOKE_HOST, { host });
        renderHosts();
      },
    },
    "Remove",
  );
  return el(
    "div",
    { class: "host-row" },
    el("div", { class: "host-name" }, host),
    el("label", {}, sig, "Reading signals"),
    el("label", {}, cap, "Auto-capture"),
    remove,
  );
}

document.getElementById("add-host").addEventListener("click", async () => {
  const host = prompt("Hostname (no scheme, no path):");
  if (!host) return;
  await send(MSG.SET_PERMISSION, {
    host: host.trim().toLowerCase(),
    value: {},
  });
  renderHosts();
});

document.getElementById("panic").addEventListener("click", async () => {
  if (!confirm("Forget pairing and revoke every per-site permission?")) {
    return;
  }
  await send(MSG.PANIC);
  renderStatus();
  renderHosts();
});

renderStatus();
renderHosts();
