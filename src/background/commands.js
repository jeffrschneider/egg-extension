import { gatewayGet, gatewayPost, isPaired } from "./gateway.js";
import { MSG } from "../shared/messages.js";

// Pull-based command channel.  The Gateway enqueues a command; we pull
// pending commands, run them in the user's real browser (their session,
// their cookies), and post the result back.  We poll instead of holding a
// socket because Manifest V3 service workers are torn down on idle — the
// alarms API revives us on a fixed cadence, and the drain loop empties any
// backlog in a single wake-up.
const ALARM = "egg-poll-commands";
const MAX_DRAIN = 20; // commands handled per wake-up before we yield
const LOAD_TIMEOUT_MS = 25000; // how long a navigated page may take to load
const SETTLE_MS = 600; // grace after "complete" before messaging the page

export function installCommandPolling() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== ALARM) return;
    if (!(await isPaired())) return;
    await drainCommands();
  });
}

// Let in-extension callers (popup "sync now", a finished capture) kick a poll
// without waiting for the next alarm tick.
export async function pollCommandsNow() {
  if (!(await isPaired())) return;
  await drainCommands();
}

async function drainCommands() {
  for (let i = 0; i < MAX_DRAIN; i++) {
    let pending;
    try {
      pending = await gatewayGet("/api/extension/commands/pending");
    } catch {
      return; // gateway unreachable / unpaired — try again next tick
    }
    if (!Array.isArray(pending) || pending.length === 0) return;

    for (const cmd of pending) {
      let body;
      try {
        body = { result: await executeCommand(cmd) };
      } catch (e) {
        body = { error: e?.message || String(e) };
      }
      try {
        await gatewayPost(
          `/api/extension/commands/${encodeURIComponent(cmd.id)}/result`,
          body,
        );
      } catch (e) {
        // The command is already 'running' on the Gateway; if we cannot
        // report, leave it for a later reconcile rather than dropping silently.
        console.warn("[egg-ext] command result POST failed:", e?.message || e);
      }
    }
    // The batch we just claimed is now 'running'; loop to pick up anything
    // that arrived while we worked. An empty page above breaks us out.
  }
}

async function executeCommand(cmd) {
  switch (cmd.kind) {
    case "capture_url":
      return await captureUrl(cmd.args || {});
    default:
      // Record a clear error so the requester is not left polling forever.
      throw new Error(`Unsupported command kind: ${cmd.kind}`);
  }
}

// Open the URL in a real background tab, let it load under the user's session,
// extract the readable article + metadata via the content script, then close
// the tab and return the result to the Gateway.
async function captureUrl(args) {
  const url = args.url;
  if (!url) throw new Error("capture_url requires args.url");

  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`capture_url: invalid url: ${url}`);
  }

  // Honour the same per-host consent the rest of the extension enforces —
  // never load a host the user has not granted.
  const allowed = await chrome.permissions.contains({
    origins: [`${origin}/*`],
  });
  if (!allowed) {
    throw new Error(`capture_url: host not permitted: ${origin}`);
  }

  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForComplete(tab.id, LOAD_TIMEOUT_MS);
    // Content scripts inject at document_idle, but message routing can still
    // race a freshly-completed load; a short settle avoids the first miss.
    await delay(SETTLE_MS);
    const extracted = await chrome.tabs
      .sendMessage(tab.id, { type: MSG.EXTRACT_REQUEST, kind: "article" })
      .catch(() => null);
    const info = await chrome.tabs.get(tab.id).catch(() => tab);
    return {
      page: { url: info.url || url, title: info.title || null },
      article: extracted?.article ?? null,
      metadata: extracted?.metadata ?? null,
    };
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* tab already closed */
    }
  }
}

// Resolve once the tab reports status "complete" (or reject on timeout).
function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onUpdated = (id, change) => {
      if (id === tabId && change.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(
      () => finish(new Error("capture_url: page load timed out")),
      timeoutMs,
    );
    // The tab may already be "complete" before the listener attached.
    chrome.tabs.get(tabId, (t) => {
      if (!chrome.runtime.lastError && t && t.status === "complete") finish();
    });
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
