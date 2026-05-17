// Context-menu entries.  All routes through one dispatcher in
// dispatch.js so the destination chooser stays in one place.
const MENU_IDS = {
  PAGE: "egg-send-page",
  SELECTION: "egg-send-selection",
  LINK: "egg-send-link",
  IMAGE: "egg-send-image",
};

export function installMenus(onClick) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_IDS.PAGE,
        title: "Send page to Egg",
        contexts: ["page"],
      });
      chrome.contextMenus.create({
        id: MENU_IDS.SELECTION,
        title: "Send selection to Egg",
        contexts: ["selection"],
      });
      chrome.contextMenus.create({
        id: MENU_IDS.LINK,
        title: "Send link to Egg",
        contexts: ["link"],
      });
      chrome.contextMenus.create({
        id: MENU_IDS.IMAGE,
        title: "Send image to Egg",
        contexts: ["image"],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    switch (info.menuItemId) {
      case MENU_IDS.PAGE:
        onClick({ kind: "page", tab });
        break;
      case MENU_IDS.SELECTION:
        onClick({
          kind: "selection",
          tab,
          selection: info.selectionText || "",
        });
        break;
      case MENU_IDS.LINK:
        onClick({ kind: "link", tab, url: info.linkUrl });
        break;
      case MENU_IDS.IMAGE:
        onClick({ kind: "image", tab, url: info.srcUrl });
        break;
    }
  });
}
