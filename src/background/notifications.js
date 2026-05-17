import { gatewayGet, isPaired } from "./gateway.js";

// Poll the Gateway for pending notifications.  We poll instead of
// holding an SSE connection because Manifest V3 service workers get
// torn down on idle; the alarms API revives us on a fixed schedule.
const ALARM = "egg-poll-notifications";

export function installPolling() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== ALARM) return;
    if (!(await isPaired())) return;
    await pollOnce();
  });

  chrome.notifications?.onClicked.addListener(async (id) => {
    try {
      const r = await gatewayGet(
        `/api/extension/notifications/click/${encodeURIComponent(id)}`,
      );
      if (r?.open_url) {
        await chrome.tabs.create({ url: r.open_url });
      }
    } catch {
      /* ignore */
    }
  });
}

async function pollOnce() {
  let pending;
  try {
    pending = await gatewayGet("/api/extension/notifications/pending");
  } catch {
    return;
  }
  for (const n of pending?.items || []) {
    await chrome.notifications.create(n.id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon.png"),
      title: n.title || "Egg",
      message: n.message || "",
    });
    // Acknowledge so the Gateway does not redeliver on the next poll.
    try {
      await gatewayGet(
        `/api/extension/notifications/ack/${encodeURIComponent(n.id)}`,
      );
    } catch {
      /* ignore */
    }
  }
}
