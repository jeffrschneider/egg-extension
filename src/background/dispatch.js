import { gatewayPost } from "./gateway.js";
import { MSG } from "../shared/messages.js";

// Ask the content script in `tab` to extract `kind` from the page.
async function extractFromTab(tab, kind) {
  return await chrome.tabs.sendMessage(tab.id, {
    type: MSG.EXTRACT_REQUEST,
    kind,
  });
}

// Capture a viewport screenshot of the tab's window as a PNG data URL.
async function captureViewport(tab) {
  return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
}

// Build the Gateway payload.  Same shape for every capture source so
// the Gateway's routing logic does not branch on origin.
async function buildPayload({ kind, tab, selection, url, image }) {
  const base = {
    kind,
    captured_at: new Date().toISOString(),
    page: { url: tab.url, title: tab.title },
  };
  switch (kind) {
    case "page": {
      const extracted = await extractFromTab(tab, "page");
      const screenshot = await captureViewport(tab);
      return { ...base, article: extracted?.article, metadata: extracted?.metadata, screenshot };
    }
    case "article": {
      const extracted = await extractFromTab(tab, "article");
      return { ...base, article: extracted?.article, metadata: extracted?.metadata };
    }
    case "selection": {
      const extracted = await extractFromTab(tab, "selection");
      return {
        ...base,
        selection: selection || extracted?.text || "",
        context: extracted?.context || null,
      };
    }
    case "link":
      return { ...base, link: { url } };
    case "image":
      return { ...base, image: { url: image || url } };
    case "screenshot":
      return { ...base, screenshot: await captureViewport(tab) };
    default:
      throw new Error(`Unknown capture kind: ${kind}`);
  }
}

export async function dispatch({
  kind,
  destination,
  tab,
  selection,
  url,
  image,
}) {
  const payload = await buildPayload({ kind, tab, selection, url, image });
  payload.destination = destination || "auto";
  return await gatewayPost("/api/extension/capture", payload);
}
