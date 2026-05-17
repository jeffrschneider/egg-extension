import { gatewayPost } from "./gateway.js";
import * as perms from "./permissions.js";

// Per-host opt-in is enforced before any signal leaves the browser.
// The content script does not know whether signals are allowed; it
// always emits, and the background filters here.  Centralising the
// check keeps the privacy guarantee in one auditable place.
export async function recordBatch(host, events) {
  const p = await perms.get(host);
  if (!p.signals) return;
  if (!events || events.length === 0) return;
  try {
    await gatewayPost("/api/extension/signals", { host, events });
  } catch (e) {
    console.warn("[egg-ext] signal post failed:", e?.message || e);
  }
}
