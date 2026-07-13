// Offscreen audio player. The MV3 service worker can't play audio, so it hands
// TTS bytes (a data: URL) here and we play them. One <audio> at a time — a new
// clip stops the previous, so re-triggering "Read aloud" interrupts cleanly.
let current = null;

function stop() {
  if (current) {
    try {
      current.pause();
      current.src = "";
    } catch (e) {
      /* already gone */
    }
    current = null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return; // not for us
  if (msg.type === "play_audio") {
    stop();
    try {
      const audio = new Audio(msg.dataUrl);
      current = audio;
      audio.onended = () => {
        if (current === audio) current = null;
      };
      audio.onerror = () => {
        console.warn("[Egg:offscreen] audio error", audio.error);
        if (current === audio) current = null;
      };
      audio.play().catch((e) => console.warn("[Egg:offscreen] play failed", e));
      sendResponse({ ok: true });
    } catch (e) {
      console.warn("[Egg:offscreen] play_audio failed", e);
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
    return true;
  }
  if (msg.type === "stop_audio") {
    stop();
    sendResponse({ ok: true });
    return true;
  }
});
