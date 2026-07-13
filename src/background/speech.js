// Speech bridge: the extension is a thin audio endpoint. It hands text/mic
// bytes to the Gateway, which does the STT/TTS (honoring the speech slots), and
// plays the returned audio. No speech engine runs in the extension itself.
import { gatewayPost } from "./gateway.js";

let _creating = null; // de-dupe concurrent createDocument calls

// MV3 service workers can't play audio; an offscreen document does. Create it
// lazily and reuse it for the worker's lifetime.
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (_creating) {
    await _creating;
    return;
  }
  _creating = chrome.offscreen
    .createDocument({
      url: chrome.runtime.getURL("src/offscreen/offscreen.html"),
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play text-to-speech audio from the Egg Gateway.",
    })
    .catch((e) => {
      // A concurrent create can race us; "single offscreen document" is benign.
      if (!String(e?.message || e).includes("single offscreen")) throw e;
    });
  await _creating;
  _creating = null;
}

async function playDataUrl(dataUrl) {
  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "play_audio", dataUrl });
  } catch (e) {
    console.warn("[Egg:speech] offscreen play message failed", e);
  }
}

// Speak `text` via the Gateway's TTS (honoring the live_tts slot), then play it.
export async function speak(text, { capability = "live_tts" } = {}) {
  const clean = (text || "").trim();
  if (!clean) return { ok: false, reason: "empty" };
  const input = clean.length > 4000 ? clean.slice(0, 4000) : clean; // keep it snappy
  const res = await gatewayPost("/api/extension/ai/tts", {
    text: input,
    capability,
    return_audio: true,
  });
  if (!res || !res.audio_b64) throw new Error("The Gateway returned no audio.");
  await playDataUrl(`data:${res.mime || "audio/wav"};base64,${res.audio_b64}`);
  return { ok: true };
}

export async function stopSpeaking() {
  const has = await chrome.offscreen.hasDocument?.();
  if (!has) return;
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop_audio" });
  } catch {
    /* offscreen gone — nothing to stop */
  }
}

// Transcribe recorded audio (base64) via the Gateway's STT (live_stt slot).
export async function transcribe(audioB64, { capability = "live_stt" } = {}) {
  const res = await gatewayPost("/api/extension/ai/transcribe", {
    audio_b64: audioB64,
    capability,
  });
  return res?.transcript || "";
}
