import { setConfig, clearConfig, gatewayGet, browserInfo } from "./gateway.js";

// Parses a pairing string of the form "PORT-CODE" where PORT is the
// Gateway's HTTP port and CODE is the one-time code Egg displayed to
// the user.  The Gateway's port is dynamic per launch, so embedding
// it in the code avoids a separate discovery step.
function parsePairingInput(raw) {
  const trimmed = (raw || "").trim();
  const m = trimmed.match(/^(\d{2,6})-([A-Za-z0-9]+)$/);
  if (!m) return null;
  return { port: Number(m[1]), code: m[2] };
}

export async function pair(rawInput) {
  const parsed = parsePairingInput(rawInput);
  if (!parsed) {
    throw new Error('Pairing code must look like "54321-ABC123".');
  }
  const { port, code } = parsed;
  const url = `http://127.0.0.1:${port}/api/extension/pair`;
  // Tell the Gateway which browser this is, so it shows a real name
  // instead of a hand-typed label.
  const browser = await browserInfo();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, browser }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pairing rejected: ${text || res.statusText}`);
  }
  const data = await res.json();
  if (!data?.token) throw new Error("Pairing response had no token.");
  await setConfig({
    port,
    token: data.token,
    host: "127.0.0.1",
    pairedAt: Date.now(),
  });
  return { port };
}

export async function unpair() {
  // Best-effort: ask the Gateway to invalidate the token, but always
  // forget locally even if the Gateway is unreachable.
  try {
    await gatewayGet("/api/extension/unpair");
  } catch {
    /* ignore */
  }
  await clearConfig();
}
