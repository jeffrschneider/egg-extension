import { getSync, setSync } from "../shared/storage.js";

// Shape: { [host]: { signals: boolean, captureAuto: boolean } }
// Defaults are conservative.  Nothing is recorded for a host until
// the user explicitly opts in for that host.
const KEY = "host_permissions";

export async function getAll() {
  const { [KEY]: data } = await getSync([KEY]);
  return data || {};
}

export async function get(host) {
  const all = await getAll();
  return all[host] || { signals: false, captureAuto: false };
}

export async function set(host, partial) {
  const all = await getAll();
  const merged = { ...(all[host] || {}), ...partial };
  all[host] = merged;
  await setSync({ [KEY]: all });
  return merged;
}

export async function revoke(host) {
  const all = await getAll();
  delete all[host];
  await setSync({ [KEY]: all });
}

export async function clearAll() {
  await setSync({ [KEY]: {} });
}
