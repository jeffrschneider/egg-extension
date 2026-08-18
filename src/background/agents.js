// Agents — the roster and the conversation, served by the Gateway.
//
// There is one kind of counterpart, a mesh agent, and the Gateway knows the
// ones that need an operator behind them: the ones it runs itself, the
// runtimes attached to it, agents kept from elsewhere, paired devices, and
// contacts' agents. This module is the thin client for that. The one thing
// detected here in the extension instead is the agent a SITE declares about
// itself (EXT-11, see site-detect.js) — that is public discovery plus a
// public registrar lookup, so it deliberately works with no Gateway paired.
//
// Content scripts never hold the Gateway token; they message the service
// worker, which owns the pairing (see gateway.js).
import { gatewayGet, gatewayPost, gatewayFetch, isPaired } from "./gateway.js";

/** Host of a tab URL, or null for anything that cannot declare an agent. */
export function hostOf(url) {
  try {
    const u = new URL(url || "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname || null;
  } catch {
    return null;
  }
}

/** The whole roster. `host` pins that site's declared agent to the top. */
export async function roster(host) {
  const qs = new URLSearchParams();
  if (host) qs.set("host", host);
  // Contacts' agents cost one registry lookup each; the panel is a deliberate
  // list, so it pays for them.
  qs.set("contacts", "1");
  const r = await gatewayGet(`/api/extension/agents/roster?${qs}`);
  return Array.isArray(r?.agents) ? r.agents : [];
}

/** One turn with an agent. `pageUrl` is EXT-11 page context and is sent ONLY
 *  for a conversation opened from that site's own chip: it is always a URL on
 *  the site's own host, so it tells the site nothing its server does not
 *  already know. Nothing else about the page travels -- not the title, not the
 *  text -- because only the message field is fenced against injection at the
 *  far end, and prose outside that fence is an injection channel. */
export async function ask(agentId, message, pageUrl) {
  const input = { message };
  if (pageUrl) input.page = { url: pageUrl };
  const r = await gatewayPost("/api/extension/mesh/request", {
    agent_id: agentId,
    skill: "chat",
    input,
  });
  if (r && r.ok === false) throw new Error(r.error || "the agent did not answer");
  const p = r?.payload ?? {};
  const out = p.output;
  const text =
    typeof out === "string" ? out
      : typeof out?.text === "string" ? out.text
        : typeof p.text === "string" ? p.text
          : null;
  if (text === null) throw new Error(p?.error?.message || "the agent sent no readable answer");
  return text;
}

/** Keep an agent met elsewhere, with how it was verified at that moment. */
export async function save(agent) {
  await gatewayPost("/api/extension/agents/saved", {
    agent_id: agent.agent_id,
    name: agent.handle || agent.name,
    handle: agent.handle ?? null,
    note: agent.description ?? null,
    verified: agent.verified ?? null,
  });
}

/** Forget a saved agent. */
export async function forget(agentId) {
  await gatewayFetch(`/api/extension/agents/saved/${encodeURIComponent(agentId)}`, { method: "DELETE" });
}

/** Handle one "egg_agents" message from a content script. Returns the reply
 *  object; every failure comes back as { error } rather than throwing, so the
 *  panel can say what went wrong instead of hanging. */
export async function handle(msg) {
  if (!(await isPaired())) {
    return { error: "This browser is not connected to your Egg Gateway yet." };
  }
  try {
    switch (msg.op) {
      case "roster":
        return { agents: await roster(msg.host) };
      case "ask":
        return { text: await ask(msg.agentId, msg.message, msg.pageUrl) };
      case "save":
        await save(msg.agent);
        return { ok: true };
      case "forget":
        await forget(msg.agentId);
        return { ok: true };
      default:
        return { error: `unknown agents op: ${msg.op}` };
    }
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
