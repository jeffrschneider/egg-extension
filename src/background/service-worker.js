import { MSG } from "../shared/messages.js";
import { isPaired, getConfig, setConfig } from "./gateway.js";
import * as pairing from "./pairing.js";
import * as perms from "./permissions.js";
import * as menus from "./menus.js";
import * as feeds from "./feeds.js";
import * as signals from "./signals.js";
import * as notifications from "./notifications.js";
import * as commands from "./commands.js";
import { dispatch } from "./dispatch.js";

// Chrome has no native capture feedback like the Egg Browser's frame pulse,
// so confirm every capture with a notification and a brief toolbar badge.
function notify(title, message) {
  try {
    chrome.notifications.create("egg-cap-" + Date.now(), {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon.png"),
      title,
      message,
    });
  } catch (e) {
    /* notifications may be disabled */
  }
}

function flashBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: color || "#7c5cff" });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
  } catch (e) {
    /* ignore */
  }
}

// One capture path for the context menu and the keyboard shortcut, with
// visible feedback either way.
async function runCapture({ kind, tab, selection, url }) {
  if (!tab) return { ok: false, reason: "no_tab" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”, then try again.");
    return { ok: false, reason: "not_connected" };
  }
  try {
    await dispatch({ kind, tab, selection, url, image: url });
    flashBadge("✓", "#2fa84f");
    notify("Saved to Egg", (tab.title || "This page") + " — open Memorize to keep it.");
    return { ok: true };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn’t save", e?.message || "The Egg Gateway wasn’t reachable.");
    return { ok: false, reason: "error", message: e?.message || String(e) };
  }
}

menus.installMenus((args) => runCapture(args));

// Ctrl+M (rebindable at chrome://extensions/shortcuts) memorizes the page.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "memorize-page") return;
  await runCapture({ kind: "page", tab: await getActiveTab() });
});

notifications.installPolling();
commands.installCommandPolling();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case MSG.STATUS: {
          const cfg = await getConfig();
          sendResponse({
            ok: true,
            paired: !!cfg,
            port: cfg?.port,
            host: cfg?.host,
            pairedAt: cfg?.pairedAt,
          });
          return;
        }
        case MSG.PAIR: {
          const result = await pairing.pair(msg.input);
          sendResponse({ ok: true, ...result });
          return;
        }
        case MSG.CONNECT: {
          // One-click pairing: the Gateway's /connect page provisioned a
          // token and its content-script bridge forwarded it here. Store it
          // exactly like a completed pair — no code round-trip.
          if (!msg.token || !msg.port) {
            sendResponse({ ok: false, error: "connect: missing token/port" });
            return;
          }
          await setConfig({
            port: Number(msg.port),
            token: msg.token,
            host: msg.host || "127.0.0.1",
            pairedAt: Date.now(),
          });
          sendResponse({ ok: true });
          return;
        }
        case MSG.UNPAIR: {
          await pairing.unpair();
          sendResponse({ ok: true });
          return;
        }
        case MSG.CAPTURE: {
          // Route through runCapture and return the result so the caller (the
          // content script's Ctrl+M handler) can show on-page feedback.
          const result = await runCapture({ kind: msg.kind || "page", tab: await getActiveTab() });
          sendResponse(result || { ok: true });
          return;
        }
        case MSG.GET_PERMISSIONS: {
          sendResponse({ ok: true, hosts: await perms.getAll() });
          return;
        }
        case MSG.SET_PERMISSION: {
          await perms.set(msg.host, msg.value);
          sendResponse({ ok: true });
          return;
        }
        case MSG.REVOKE_HOST: {
          await perms.revoke(msg.host);
          sendResponse({ ok: true });
          return;
        }
        case MSG.PANIC: {
          await perms.clearAll();
          await pairing.unpair();
          sendResponse({ ok: true });
          return;
        }
        case MSG.FEED_DISCOVERED: {
          if (await isPaired()) {
            await feeds.reportDiscovered(msg.payload);
          }
          sendResponse({ ok: true });
          return;
        }
        case MSG.SIGNAL_BATCH: {
          if (await isPaired()) {
            await signals.recordBatch(msg.host, msg.events);
          }
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${msg?.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tab || null;
}
