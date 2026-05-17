// Message kinds traded between popup, options, content scripts, and
// the background service worker.  Keeping them in one file makes it
// easy to keep both sides in sync and to grep for every site that
// sends or handles a given kind.
export const MSG = {
  STATUS: "status",
  PAIR: "pair",
  UNPAIR: "unpair",
  CAPTURE: "capture",
  GET_PERMISSIONS: "get_permissions",
  SET_PERMISSION: "set_permission",
  REVOKE_HOST: "revoke_host",
  PANIC: "panic",
  EXTRACT_REQUEST: "extract_request",
  FEED_DISCOVERED: "feed_discovered",
  SIGNAL_BATCH: "signal_batch",
  AGENT_TASK_REQUEST: "agent_task_request",
};
