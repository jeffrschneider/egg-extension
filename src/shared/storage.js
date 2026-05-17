// Thin async wrappers around chrome.storage so the rest of the
// extension does not have to special-case callback vs promise APIs.
export async function getLocal(keys) {
  return await chrome.storage.local.get(keys);
}
export async function setLocal(obj) {
  return await chrome.storage.local.set(obj);
}
export async function removeLocal(keys) {
  return await chrome.storage.local.remove(keys);
}
export async function getSync(keys) {
  return await chrome.storage.sync.get(keys);
}
export async function setSync(obj) {
  return await chrome.storage.sync.set(obj);
}
