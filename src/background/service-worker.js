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

menus.installMenus(async ({ kind, tab, selection, url }) => {
  try {
    await dispatch({ kind, tab, selection, url, image: url });
  } catch (e) {
    console.warn("[egg-ext] capture failed:", e?.message || e);
  }
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
          const tab = await getActiveTab();
          if (!tab) {
            sendResponse({ ok: false, error: "No active tab." });
            return;
          }
          await dispatch({ kind: msg.kind, tab });
          sendResponse({ ok: true });
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
