import { gatewayPost } from "./gateway.js";
import { MSG } from "../shared/messages.js";

// Ask the content script in `tab` to extract `kind` from the page.
async function extractFromTab(tab, kind) {
  return await chrome.tabs.sendMessage(tab.id, {
    type: MSG.EXTRACT_REQUEST,
    kind,
  });
}

// Best-effort readable-text extraction (never throws) so a screenshot capture
// still carries a title/text even on pages without a content script.
export async function extractArticle(tab) {
  try {
    return await extractFromTab(tab, "article");
  } catch {
    return null;
  }
}

// Capture a viewport screenshot of the tab's window as a PNG data URL.
async function captureViewport(tab) {
  return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
}

// Capture the viewport and downscale it before upload, so a memorized/handed-
// off screenshot is a lightweight thumbnail rather than a multi-MB PNG. Draws
// the shot onto an OffscreenCanvas (available in the service worker) at a
// bounded max dimension and re-encodes as JPEG. Returns a data URL.
// Downscale a PNG/JPEG data URL to a bounded max dimension, re-encoded as
// JPEG. Used as the no-crop fallback (chrome:// pages with no content script).
export async function resizeDataUrl(dataUrl, maxDim = 1024, quality = 0.85) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const buf = new Uint8Array(await out.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return `data:${out.type};base64,${btoa(binary)}`;
}

export async function captureViewportResized(tab, maxDim = 1024, quality = 0.82) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const buf = new Uint8Array(await out.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return `data:${out.type};base64,${btoa(binary)}`;
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
    case "screenshot": {
      // A downsized viewport image, plus the readable text so a screenshot
      // saved to Memorize still gets a title/summary and is searchable.
      const extracted = await extractFromTab(tab, "article").catch(() => null);
      return {
        ...base,
        image: await captureViewportResized(tab),
        article: extracted?.article,
        metadata: extracted?.metadata,
      };
    }
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
