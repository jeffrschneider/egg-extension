// Context-menu entries.  All routes through one dispatcher in
// dispatch.js so the destination chooser stays in one place.
const MENU_IDS = {
  PAGE: "egg-send-page",
  SELECTION: "egg-send-selection",
  SELECTION_PONDER: "egg-ponder-selection",
  SELECTION_READ: "egg-read-selection",
  LINK: "egg-send-link",
  ADD_FEED: "egg-add-feed",
  IMAGE: "egg-send-image",
  SHOT: "egg-shot",
};

// (Re)create every context-menu item. Runs on install/update AND on every
// service-worker startup, so a plain extension reload — which doesn't reliably
// fire onInstalled — still refreshes the menu to match the current code.
// removeAll first makes it idempotent (no duplicate-id errors).
function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    // Page and image open the scoped Egg menu (the same styled chooser Ctrl+M
    // uses) so you pick a destination — no more silent memorize. The trailing
    // "…" signals "opens a chooser."
    chrome.contextMenus.create({
      id: MENU_IDS.PAGE,
      title: "Send to Egg…",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.IMAGE,
      title: "Send image to Egg…",
      contexts: ["image"],
    });

    // Selected text: memorize it, or send it to Ponder as an exploration.
    chrome.contextMenus.create({
      id: MENU_IDS.SELECTION,
      title: "Memorize selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.SELECTION_PONDER,
      title: "Ponder selection",
      contexts: ["selection"],
    });
    // Hear the selection read aloud via the Gateway's text-to-speech.
    chrome.contextMenus.create({
      id: MENU_IDS.SELECTION_READ,
      title: "Read aloud with Egg",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.LINK,
      title: "Memorize linked page",
      contexts: ["link"],
    });
    // Follow the link's feed (RSS/Atom or a smart source) directly in Egg.
    chrome.contextMenus.create({
      id: MENU_IDS.ADD_FEED,
      title: "Add to Egg Feed",
      contexts: ["link"],
    });

    // Screenshot: snap → crop → choose destination.
    chrome.contextMenus.create({
      id: MENU_IDS.SHOT,
      title: "Screenshot to Egg",
      contexts: ["page"],
    });
  });
}

export function installMenus(onClick) {
  chrome.runtime.onInstalled.addListener(buildMenus);
  // Also rebuild on SW startup so reloads pick up menu changes.
  buildMenus();

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    switch (info.menuItemId) {
      case MENU_IDS.SHOT:
        onClick({ kind: "screenshot", tab });
        break;
      case MENU_IDS.PAGE:
        // Opens the full Egg menu (same as Ctrl+M).
        onClick({ kind: "page-menu", tab });
        break;
      case MENU_IDS.IMAGE:
        // Opens the image menu: Ponder / Studio / Memorize.
        onClick({ kind: "image-menu", tab, url: info.srcUrl });
        break;
      case MENU_IDS.SELECTION:
        onClick({
          kind: "selection",
          tab,
          selection: info.selectionText || "",
        });
        break;
      case MENU_IDS.SELECTION_PONDER:
        onClick({
          kind: "selection-ponder",
          tab,
          selection: info.selectionText || "",
        });
        break;
      case MENU_IDS.SELECTION_READ:
        onClick({
          kind: "read-aloud",
          tab,
          selection: info.selectionText || "",
        });
        break;
      case MENU_IDS.LINK:
        onClick({ kind: "link", tab, url: info.linkUrl });
        break;
      case MENU_IDS.ADD_FEED:
        onClick({ kind: "add-feed", tab, url: info.linkUrl });
        break;
    }
  });
}
