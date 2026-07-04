import { MSG } from "../shared/messages.js";
import { isPaired, getConfig, setConfig, gatewayPost } from "./gateway.js";
import * as pairing from "./pairing.js";
import * as perms from "./permissions.js";
import * as menus from "./menus.js";
import * as feeds from "./feeds.js";
import * as signals from "./signals.js";
import * as notifications from "./notifications.js";
import * as commands from "./commands.js";
import { dispatch, resizeDataUrl, extractArticle } from "./dispatch.js";

// Chrome has no native capture feedback like the Egg Browser's frame pulse,
// so confirm every capture with a notification and a brief toolbar badge.
function notify(title, message) {
  try {
    chrome.notifications.create("egg-cap-" + Date.now(), {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon.png"),
      title,
      message,
    });
  } catch (e) {
    /* notifications may be disabled */
  }
}

function flashBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: color || "#7c5cff" });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
  } catch (e) {
    /* ignore */
  }
}

// One capture path for the context menu and the keyboard shortcut, with
// visible feedback either way.
async function runCapture({ kind, destination, tab, selection, url }) {
  if (!tab) return { ok: false, reason: "no_tab" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”, then try again.");
    return { ok: false, reason: "not_connected" };
  }
  try {
    const resp = await dispatch({ kind, destination, tab, selection, url, image: url });
    flashBadge("✓", "#2fa84f");
    notify("Saved to Egg", (tab.title || "This page") + " — open Memorize to keep it.");
    // Experiment: send the viewport screenshot so the daemon can fly it to the
    // tray. Best-effort — captureVisibleTab fails on chrome:// and a few others.
    try {
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      if (shot) gatewayPost("/api/extension/flourish", { image: shot }).catch(() => {});
    } catch (e) {
      /* no screenshot on this page — skip the flourish */
    }
    return { ok: true, id: resp?.id };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn’t save", e?.message || "The Egg Gateway wasn’t reachable.");
    return { ok: false, reason: "error", message: e?.message || String(e) };
  }
}

menus.installMenus((args) => {
  // Right-click routing. Page and image open the scoped Egg menu; screenshot
  // starts the crop; selection/link stay direct memorize actions.
  if (args.kind === "screenshot") return startCrop(args.tab);
  if (args.kind === "page-menu") return openEggMenu(args.tab);
  if (args.kind === "image-menu") return openImageMenu(args.tab, args.url);
  if (args.kind === "link") return memorizeLink(args.url);
  if (args.kind === "selection-ponder") return ponderSelection(args.selection, args.tab);
  return runCapture(args);
});

// ── Screenshot snipping ───────────────────────────────────────────────
// Flow: snap the viewport → the page shows a crop cropper (ported from the
// Egg Browser's screen-capture.html) → user drags a region → ONLY THEN a
// destination chooser appears → the cropped image is sent where chosen.
// Three triggers (toolbar "Screenshot" button, right-click "Screenshot to
// Egg", Ctrl+I) all start the same crop; none pick a destination up front.

// Snap the viewport and hand the full-resolution image to the page's cropper.
// captureVisibleTab needs activeTab, which a command / menu / action gesture
// grants (a raw content-script keydown would not).
async function startCrop(tab, forcedDest) {
  if (!tab) return { ok: false, reason: "no_tab" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    return { ok: false, reason: "not_connected" };
  }
  let image;
  try {
    image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (e) {
    flashBadge("!", "#ef4444");
    return { ok: false, reason: "capture_failed", message: e?.message || String(e) };
  }
  // Inject the cropper on demand (works on any already-open tab, no reload
  // needed and no dependency on the persistent content script being fresh).
  // forcedDest, when set, skips the destination chooser after cropping.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageCropper,
      args: [image, forcedDest || null],
    });
    return { ok: true };
  } catch (e) {
    // Restricted page (chrome://, Web Store, PDF viewer) — can't inject a
    // cropper there; send the whole shot where it was headed (or Memorize).
    const resized = await resizeDataUrl(image);
    const extracted = await extractArticle(tab).catch(() => null);
    return await sendShot(
      { image: resized, page: { url: tab.url, title: tab.title }, article: extracted?.article },
      forcedDest || "memorize",
    );
  }
}

// Runs IN THE PAGE (injected via executeScript). Self-contained — it can't see
// anything in this file. Shows the snapped image, lets the user drag a crop
// region, then a destination chooser, and posts {shot_send} back to the SW.
function pageCropper(imageDataUrl, forcedDest) {
  if (window.__eggCropActive) return;
  window.__eggCropActive = true;
  const done = () => { window.__eggCropActive = false; };

  const img = new Image();
  img.src = imageDataUrl;

  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;-webkit-user-select:none;background:#000 no-repeat top left / 100% 100%;background-image:url(" + JSON.stringify(imageDataUrl) + ")";
  const dimmer = document.createElement("div");
  dimmer.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.3);pointer-events:none;z-index:1;transition:background .15s";
  const sel = document.createElement("div");
  sel.style.cssText = "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.1);display:none;pointer-events:none;z-index:5";
  const hint = document.createElement("div");
  hint.textContent = "Click and drag to select a region — Press Escape to cancel";
  hint.style.cssText = "position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;padding:12px 28px;border-radius:24px;font:500 15px system-ui,sans-serif;pointer-events:none;z-index:10;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.4)";
  const sizeLabel = document.createElement("div");
  sizeLabel.style.cssText = "position:fixed;background:rgba(0,0,0,.75);color:#fff;padding:2px 8px;border-radius:4px;font:11px monospace;pointer-events:none;display:none;z-index:10";
  root.append(dimmer, sel, hint, sizeLabel);
  document.documentElement.appendChild(root);

  let sx = 0, sy = 0, dragging = false;
  const cleanupCrop = () => { root.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); cleanupCrop(); done(); } };
  document.addEventListener("keydown", onKey, true);

  root.addEventListener("mousedown", (e) => {
    sx = e.clientX; sy = e.clientY; dragging = true;
    sel.style.display = "block";
    sel.style.left = sx + "px"; sel.style.top = sy + "px"; sel.style.width = "0px"; sel.style.height = "0px";
    hint.style.display = "none";
  });
  root.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, sx), y = Math.min(e.clientY, sy);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    sel.style.left = x + "px"; sel.style.top = y + "px"; sel.style.width = w + "px"; sel.style.height = h + "px";
    dimmer.style.background = "rgba(0,0,0,.5)";
    dimmer.style.clipPath = "polygon(0% 0%,0% 100%," + x + "px 100%," + x + "px " + y + "px," + (x + w) + "px " + y + "px," + (x + w) + "px " + (y + h) + "px," + x + "px " + (y + h) + "px," + x + "px 100%,100% 100%,100% 0%)";
    sizeLabel.style.display = "block";
    sizeLabel.style.left = x + "px"; sizeLabel.style.top = (y + h + 8) + "px";
    sizeLabel.textContent = w + " × " + h;
  });
  root.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, sx), y = Math.min(e.clientY, sy);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    if (w < 10 || h < 10) {
      sel.style.display = "none"; sizeLabel.style.display = "none";
      dimmer.style.background = "rgba(0,0,0,.3)"; dimmer.style.clipPath = "";
      hint.style.display = "block";
      return;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const scaleX = (img.naturalWidth || vw) / vw, scaleY = (img.naturalHeight || vh) / vh;
    const cropW = Math.round(w * scaleX), cropH = Math.round(h * scaleY);
    const shrink = Math.min(1, 1400 / Math.max(cropW, cropH));
    const outW = Math.max(1, Math.round(cropW * shrink)), outH = Math.max(1, Math.round(cropH * shrink));
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    canvas.getContext("2d").drawImage(img, Math.round(x * scaleX), Math.round(y * scaleY), cropW, cropH, 0, 0, outW, outH);
    const cropped = canvas.toDataURL("image/jpeg", 0.85);
    cleanupCrop();
    // Forced destination (e.g. Ctrl+M → "Coach a game") skips the chooser and
    // sends straight where it's going.
    if (forcedDest) {
      done();
      chrome.runtime.sendMessage({ type: "shot_send", image: cropped, destination: forcedDest });
      return;
    }
    showChooser(cropped);
  });

  function showChooser(croppedImage) {
    const back = document.createElement("div");
    back.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:400 13px/1.4 system-ui,-apple-system,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "background:#15151c;color:#fff;border:1px solid #2a2a34;border-radius:14px;padding:16px;min-width:300px;box-shadow:0 12px 40px rgba(0,0,0,.5)";
    const preview = document.createElement("img");
    preview.src = croppedImage;
    preview.style.cssText = "display:block;max-width:100%;max-height:200px;border-radius:8px;border:1px solid #2a2a34;margin-bottom:12px";
    const title = document.createElement("div");
    title.textContent = "Send screenshot to…";
    title.style.cssText = "font-weight:600;font-size:14px;margin-bottom:12px";
    card.append(preview, title);
    const cleanupChooser = () => { back.remove(); document.removeEventListener("keydown", onKey2, true); done(); };
    const onKey2 = (e) => { if (e.key === "Escape") { e.preventDefault(); cleanupChooser(); } };
    document.addEventListener("keydown", onKey2, true);
    const rowEl = document.createElement("div");
    rowEl.style.cssText = "display:flex;gap:8px";
    [["memorize", "Memorize"], ["ponder", "Ponder"], ["studio", "Studio"], ["game-coach", "Game Coach"]].forEach(([dest, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "flex:1;cursor:pointer;background:#23232e;color:#fff;border:1px solid #34343f;border-radius:9px;padding:9px 10px;font:600 13px system-ui,-apple-system,sans-serif";
      b.onmouseenter = () => { b.style.background = "#2e2e3a"; b.style.borderColor = "#7c5cff"; };
      b.onmouseleave = () => { b.style.background = "#23232e"; b.style.borderColor = "#34343f"; };
      b.onclick = () => { cleanupChooser(); chrome.runtime.sendMessage({ type: "shot_send", image: croppedImage, destination: dest }); };
      rowEl.appendChild(b);
    });
    card.appendChild(rowEl);
    const cancel = document.createElement("div");
    cancel.textContent = "Cancel";
    cancel.style.cssText = "text-align:center;margin-top:12px;color:#9a9aa6;cursor:pointer;font-size:12px";
    cancel.onclick = cleanupChooser;
    card.appendChild(cancel);
    back.appendChild(card);
    back.addEventListener("click", (e) => { if (e.target === back) cleanupChooser(); });
    document.documentElement.appendChild(back);
  }
}

// Upload a (cropped) shot to the Gateway with a destination, then hand off:
// Memorize keeps it; Ponder/Studio open with the capture id.
async function sendShot(shot, destination) {
  const resp = await gatewayPost("/api/extension/capture", {
    kind: "screenshot",
    destination,
    captured_at: new Date().toISOString(),
    page: shot.page,
    image: shot.image,
    article: shot.article,
    metadata: shot.metadata,
  });
  flashBadge("✓", "#2fa84f");
  if (destination !== "memorize" && resp?.id) {
    const cfg = await getConfig();
    if (cfg?.port) {
      chrome.tabs.create({
        url: `http://127.0.0.1:${cfg.port}/e/${destination}/?capture=${resp.id}`,
      });
    }
  }
  return { ok: true, id: resp?.id };
}

// Send a right-clicked web image to a destination. The extension can't read
// cross-origin image bytes, so we hand the Gateway the URL — it fetches the
// bytes server-side and stashes them under the capture id. Ponder/Studio then
// open with ?capture=id; Memorize keeps the image with the source page.
async function sendImage(srcUrl, destination, tab) {
  if (!srcUrl) return { ok: false, reason: "no_image" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”.");
    return { ok: false, reason: "not_connected" };
  }
  try {
    const resp = await gatewayPost("/api/extension/capture", {
      kind: "image",
      destination,
      captured_at: new Date().toISOString(),
      page: { url: tab?.url, title: tab?.title },
      image_url: srcUrl,
    });
    flashBadge("✓", "#2fa84f");
    if (destination !== "memorize" && resp?.id) {
      const cfg = await getConfig();
      if (cfg?.port) {
        chrome.tabs.create({
          url: `http://127.0.0.1:${cfg.port}/e/${destination}/?capture=${resp.id}`,
        });
      }
    } else if (destination === "memorize") {
      notify("Saved to Egg", "Image saved — open Memorize to keep it.");
    }
    return { ok: true, id: resp?.id };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn't send image", e?.message || String(e));
    return { ok: false, message: e?.message || String(e) };
  }
}

// Send selected text to Ponder as a new exploration. The Gateway stores the
// selection on the capture; Ponder's ?capture handoff seeds a text exploration
// from it (no image needed).
async function ponderSelection(selection, tab) {
  const text = (selection || "").trim();
  if (!text) return { ok: false, reason: "no_selection" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”.");
    return { ok: false, reason: "not_connected" };
  }
  try {
    const resp = await gatewayPost("/api/extension/capture", {
      kind: "selection",
      destination: "ponder",
      captured_at: new Date().toISOString(),
      page: { url: tab?.url, title: tab?.title },
      selection: text,
    });
    flashBadge("✓", "#2fa84f");
    if (resp?.id) {
      const cfg = await getConfig();
      if (cfg?.port) {
        chrome.tabs.create({ url: `http://127.0.0.1:${cfg.port}/e/ponder/?capture=${resp.id}` });
      }
    }
    return { ok: true, id: resp?.id };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn't Ponder selection", e?.message || String(e));
    return { ok: false, message: e?.message || String(e) };
  }
}

// ── YouTube / page video ──────────────────────────────────────────────
// Export the tab's cookies for these domains as Netscape cookie text so the
// Egg Gateway's yt-dlp can reach age-gated / logged-in videos. The Egg
// Gateway can't read the user's Chrome cookies itself, so the Egg Extension
// hands them over.
async function exportCookiesNetscape(domains) {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const domain of domains) {
    let cookies = [];
    try { cookies = await chrome.cookies.getAll({ domain }); } catch (e) { continue; }
    for (const c of cookies) {
      const incSub = c.domain.startsWith(".") ? "TRUE" : "FALSE";
      const secure = c.secure ? "TRUE" : "FALSE";
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
      lines.push([c.domain, incSub, c.path || "/", secure, expiry, c.name, c.value].join("\t"));
    }
  }
  return lines.join("\n") + "\n";
}

// Download and/or transcribe the video at `url` via the Egg Gateway (yt-dlp +
// captions). Results are pushed back to the page as a toast.
async function handleVideoAction(action, url, tab) {
  const tabId = tab?.id;
  const say = (text) => { if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "video_result", text }).catch(() => {}); };
  if (!url) return { ok: false };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    say("Egg isn't connected — open the extension and click Connect.");
    return { ok: false, reason: "not_connected" };
  }
  let cookies = "";
  try { cookies = await exportCookiesNetscape(["youtube.com", "google.com"]); } catch (e) { /* public-only */ }
  try {
    if (action === "download" || action === "both") {
      const r = await gatewayPost("/api/extension/video/download", { url, cookies_text: cookies });
      say(r?.ok ? "Video saved to your Downloads folder." : ("Download failed: " + (r?.message || "unknown")));
    }
    if (action === "transcript" || action === "both") {
      const r = await gatewayPost("/api/extension/video/transcript", { url, cookies_text: cookies });
      if (r?.source === "captions") say("Transcript saved to Memorize" + (r?.title ? ": " + r.title : "") + ".");
      else if (r?.source === "error") say("Couldn't fetch the transcript — YouTube may be rate-limiting. Try again in a moment.");
      else say("This video has no transcript.");
    }
    flashBadge("✓", "#2fa84f");
    return { ok: true };
  } catch (e) {
    flashBadge("!", "#ef4444");
    say("Egg error: " + (e?.message || String(e)));
    return { ok: false, message: e?.message || String(e) };
  }
}

// Resolve when tab `tabId` finishes loading, or after `timeoutMs`.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    // It may already be complete before we attached the listener.
    chrome.tabs.get(tabId).then((t) => { if (t?.status === "complete") finish(); }).catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

// Memorize the page a link points to — not the page you're on. Per the core
// principle (fetch by loading the URL in a real browser and running the
// extractor), we open the link in a BACKGROUND tab, wait for it to load, run
// the same article extractor "Memorize page" uses, memorize the result, then
// close the tab. This handles JS-rendered and logged-in pages a server-side
// fetch can't.
async function memorizeLink(linkUrl) {
  if (!linkUrl) return { ok: false, reason: "no_link" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”.");
    return { ok: false, reason: "not_connected" };
  }
  let bg;
  try {
    bg = await chrome.tabs.create({ url: linkUrl, active: false });
    await waitForTabComplete(bg.id, 20000);
    // Let client-rendered article bodies settle before extracting.
    await new Promise((r) => setTimeout(r, 1200));
    const loaded = (await chrome.tabs.get(bg.id).catch(() => null)) || bg;
    const resp = await dispatch({ kind: "article", destination: "memorize", tab: loaded });
    flashBadge("✓", "#2fa84f");
    notify("Saved to Egg", (loaded?.title || "Linked page") + " — open Memorize to keep it.");
    return { ok: true, id: resp?.id };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn't memorize link", e?.message || String(e));
    return { ok: false, message: e?.message || String(e) };
  } finally {
    if (bg?.id) chrome.tabs.remove(bg.id).catch(() => {});
  }
}

// ── Profile extraction (People) ───────────────────────────────────────
// Runs the SHARED profile extractors (copied from the native browser's
// egg-extractors — same LinkedIn/X/Facebook logic) in the page, and returns
// the structured person data. Injection needs activeTab, granted by the
// command/menu that triggers it.

// Which platform is this URL, per the shared detector? (SW-side quick check
// so we only inject on real profiles.)
async function detectProfilePlatform(tab) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/profile/social_detect.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__eggSocial ? window.__eggSocial.detect(location.href) : null),
    });
    return result || null;
  } catch {
    return null;
  }
}

// Extract the profile on `tab`. Returns { platform, kind, username, name, data }
// or null. The extractor scrolls the page (~5s) to load lazy content, then
// delivers via the __eggDeliverProfile hook we set below.
async function extractProfileFromTab(tab) {
  if (!tab) return null;
  const sp = await detectProfilePlatform(tab);
  const file = sp && { linkedin: "linkedin_profile.js", twitter: "twitter_profile.js", facebook: "facebook_profile.js" }[sp.platform];
  if (!file) return null;

  // Set the delivery hook the shared extractor calls when done.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { window.__eggDeliverProfile = (d) => chrome.runtime.sendMessage({ type: "profile_extracted", data: d }); },
  });

  const dataPromise = new Promise((resolve) => {
    const listener = (msg, sender) => {
      if (msg?.type === "profile_extracted" && sender.tab?.id === tab.id) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg.data);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    setTimeout(() => { chrome.runtime.onMessage.removeListener(listener); resolve(null); }, 25000);
  });

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/profile/" + file] });
  const data = await dataPromise;
  return data ? { ...sp, data } : null;
}

function canonicalProfileUrl(platform, username) {
  if (!username) return null;
  if (platform === "linkedin") return "https://www.linkedin.com/in/" + username;
  if (platform === "twitter") return "https://x.com/" + username;
  if (platform === "facebook") return "https://www.facebook.com/" + username;
  return null;
}

// Extract the profile on `tab` (shared extractors) and ingest it into People
// via the Gateway, which dedups by (platform, username).
async function addToPeople(tab) {
  if (!tab) return { ok: false, reason: "no_tab" };
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    return { ok: false, reason: "not_connected" };
  }
  const prof = await extractProfileFromTab(tab);
  if (!prof) {
    flashBadge("!", "#ef4444");
    notify("Egg — no profile", "This page isn't a recognized profile, or it hasn't finished loading.");
    return { ok: false, reason: "no_profile" };
  }
  const d = prof.data || {};
  try {
    const resp = await gatewayPost("/api/extension/people", {
      platform: prof.platform,
      username: prof.username,
      profile_url: canonicalProfileUrl(prof.platform, prof.username),
      name: d.name || prof.name,
      headline: d.headline,
      bio: d.bio,
      location: d.location,
      avatar_url: d.avatar_url,
      work_history: d.work_history || [],
      education: d.education || [],
      _sections: d._sections,
      _scroll_height: d._scrollHeight,
    });
    flashBadge("✓", "#2fa84f");
    notify("Added to People", (d.name || prof.name || "Contact") + (resp?.created ? " — new contact" : " — updated"));
    return { ok: true, entity_id: resp?.entity_id, created: resp?.created };
  } catch (e) {
    flashBadge("!", "#ef4444");
    notify("Egg — couldn't add to People", e?.message || String(e));
    return { ok: false, message: e?.message || String(e) };
  }
}

// Ctrl+M opens the Egg menu — an in-page command palette listing every Egg
// action. A keyboard command (not a page keydown) so the actions inherit the
// activeTab grant that screenshot capture needs. Memorize is the default, so
// Ctrl+M then Enter memorizes — the old muscle memory, one extra key.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "memorize-page") return;
  await openEggMenu(await getActiveTab());
});

// The full Egg menu — opened by Ctrl+M and by right-click → "Send to Egg…".
// Context-aware: on a recognized social profile, "Add to People" leads and is
// the default (Enter), so Ctrl+M → Enter saves the person there; otherwise
// Memorize is the default.
async function openEggMenu(tab) {
  if (!tab) return;
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”.");
    return;
  }
  const sp = await detectProfilePlatform(tab);
  const items = [];
  if (sp) items.push({ action: "people", label: "Add " + (sp.name || "this person") + " to People", hint: "profile" });
  items.push({ action: "memorize", label: "Memorize this page", hint: sp ? "" : "Enter" });
  if (/youtube\.com\/watch|youtu\.be\//.test(tab.url || "")) {
    items.push({ action: "video_transcript", label: "Get video transcript", hint: "" });
  }
  items.push({ action: "screenshot", label: "Screenshot & crop", hint: "" });
  items.push({ action: "coach_game", label: "Coach a game", hint: "" });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageEggMenu, args: [items, "Egg"] });
  } catch {
    // Restricted page (chrome://) — can't show the menu; memorize directly.
    await runCapture({ kind: "article", tab });
  }
}

// The image menu — opened by right-click → "Send image to Egg…". The image URL
// is carried as each item's payload; the SW fetches the bytes via the Gateway
// (cross-origin reads are blocked in the extension). Ponder leads, since that's
// the capability this unlocks over the old silent-memorize behavior.
async function openImageMenu(tab, srcUrl) {
  if (!tab || !srcUrl) return;
  if (!(await isPaired())) {
    flashBadge("!", "#ef4444");
    notify("Egg — not connected", "Open the Egg extension and click “Connect this browser”.");
    return;
  }
  const items = [
    { action: "img_ponder", label: "Ponder this image", hint: "Enter", payload: srcUrl },
    { action: "img_studio", label: "Use in Studio", payload: srcUrl },
    { action: "img_memorize", label: "Memorize image", payload: srcUrl },
  ];
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageEggMenu, args: [items, "Egg — image"] });
  } catch {
    // Restricted page — fall back to sending the image URL straight to Ponder.
    await sendImage(srcUrl, "ponder", tab);
  }
}

// Runs IN THE PAGE (injected). A keyboard-driven command palette: the first
// item is pre-selected (Memorize), Enter fires it, ↑/↓ move, Esc/click-out
// closes. Chosen action is posted back to the SW as {egg_action}.
function pageEggMenu(items, title) {
  if (window.__eggMenuActive) return;
  window.__eggMenuActive = true;
  const done = () => { window.__eggMenuActive = false; };

  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;font:400 14px/1.4 system-ui,-apple-system,sans-serif";
  const card = document.createElement("div");
  card.style.cssText = "margin-top:14vh;background:#15151c;color:#fff;border:1px solid #2a2a34;border-radius:14px;min-width:320px;max-width:440px;box-shadow:0 16px 50px rgba(0,0,0,.55);overflow:hidden";
  const head = document.createElement("div");
  head.textContent = title || "Egg";
  head.style.cssText = "padding:12px 16px 6px;font-weight:700;font-size:12px;color:#a78bfa;letter-spacing:.04em";
  card.appendChild(head);
  const list = document.createElement("div");
  list.style.cssText = "padding:4px";
  card.appendChild(list);
  back.appendChild(card);
  document.documentElement.appendChild(back);

  let sel = 0;
  const rows = items.map((it, i) => {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border-radius:9px;cursor:pointer";
    const lab = document.createElement("span"); lab.textContent = it.label; lab.style.cssText = "font-weight:500";
    const hint = document.createElement("span"); hint.textContent = it.hint || ""; hint.style.cssText = "font-size:11px;color:#8a8a96;border:1px solid #34343f;border-radius:5px;padding:1px 6px";
    r.append(lab, hint);
    r.onmouseenter = () => { sel = i; paint(); };
    r.onclick = () => choose();
    list.appendChild(r);
    return r;
  });
  const paint = () => rows.forEach((r, i) => { r.style.background = i === sel ? "#2e2e3a" : "transparent"; });
  paint();

  const cleanup = () => { back.remove(); document.removeEventListener("keydown", onKey, true); done(); };
  const choose = () => {
    const a = items[sel];
    cleanup();
    // Wait for the browser to paint the menu-removed frame before running the
    // action — otherwise a screenshot (or the memorize flourish) captures the
    // menu that's technically already removed from the DOM.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: "egg_action", action: a.action, payload: a.payload });
    }));
  };
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
  }
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("click", (e) => { if (e.target === back) cleanup(); });
}

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
        case "egg_action": {
          // A pick from the Ctrl+M Egg menu. activeTab was granted by the
          // command that opened the menu, so capture actions work here.
          const tab = _sender?.tab || (await getActiveTab());
          if (msg.action === "memorize") sendResponse(await runCapture({ kind: "article", tab }));
          else if (msg.action === "screenshot") sendResponse(await startCrop(tab));
          else if (msg.action === "coach_game") sendResponse(await startCrop(tab, "game-coach"));
          else if (msg.action === "video_transcript") { handleVideoAction("transcript", tab?.url, tab); sendResponse({ ok: true }); }
          else if (msg.action === "people") sendResponse(await addToPeople(tab));
          else if (msg.action === "img_ponder") sendResponse(await sendImage(msg.payload, "ponder", tab));
          else if (msg.action === "img_studio") sendResponse(await sendImage(msg.payload, "studio", tab));
          else if (msg.action === "img_memorize") sendResponse(await sendImage(msg.payload, "memorize", tab));
          else sendResponse({ ok: false, reason: "unknown_action" });
          return;
        }
        case "video_action": {
          // Floating YouTube button asked to download/transcribe the video.
          const tab = _sender?.tab || (await getActiveTab());
          handleVideoAction(msg.action, msg.url, tab);
          sendResponse({ ok: true });
          return;
        }
        case "video_probe": {
          // Menu is checking whether a transcript exists for this video.
          if (!(await isPaired())) { sendResponse({ ok: false }); return; }
          let cookies = "";
          try { cookies = await exportCookiesNetscape(["youtube.com", "google.com"]); } catch (e) { /* public */ }
          try {
            const r = await gatewayPost("/api/extension/video/probe", { url: msg.url, cookies_text: cookies });
            sendResponse(r || { ok: false });
          } catch (e) {
            sendResponse({ ok: false });
          }
          return;
        }
        case "start_screenshot": {
          // Toolbar popup asked to start a crop on the active tab.
          sendResponse(await startCrop(await getActiveTab()));
          return;
        }
        case "shot_send": {
          // The page's cropper produced a cropped image and a chosen
          // destination. Attach the page's readable text and route it.
          const tab = _sender?.tab || (await getActiveTab());
          try {
            const extracted = tab ? await extractArticle(tab) : null;
            sendResponse(
              await sendShot(
                {
                  image: msg.image,
                  page: { url: tab?.url, title: tab?.title },
                  article: extracted?.article,
                  metadata: extracted?.metadata,
                },
                msg.destination || "memorize",
              ),
            );
          } catch (e) {
            sendResponse({ ok: false, message: e?.message || String(e) });
          }
          return;
        }
        case MSG.CAPTURE: {
          // Route through runCapture and return the result so the caller (the
          // content script's Ctrl+M handler) can show on-page feedback.
          const result = await runCapture({
            kind: msg.kind || "page",
            destination: msg.destination,
            tab: await getActiveTab(),
          });
          sendResponse(result || { ok: true });
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
