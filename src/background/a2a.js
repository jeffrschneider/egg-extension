// Ephemeral A2A visits — the site chip's second tier.
//
// A site can publish a Google A2A agent card instead of, or as well as, an
// AgentMesh declaration. That card is the site's own word: no key stands
// behind it and no record binds it to anyone, so the only thing it can
// honestly support is a one-off anonymous conversation with an endpoint the
// same site hosts. A visit, not a relationship. Nothing is minted, nothing is
// saved, and nobody ends up vouching for anybody.
//
// The call is made HERE, in the browser, with credentials omitted. It carries
// no identity, so it needs no Gateway: this is an ordinary HTTP POST, exactly
// the one the page itself could have made. Mesh conversations keep going
// through the Gateway, because those carry identity, tasks and receipts.
//
// Two dialects are in the wild and the card says which it is (site-detect.js
// picks it): cards with `supportedInterfaces` are A2A 1.0 (SendMessage,
// GetTask, ROLE_USER), cards with a top-level `url` are the older shape
// (message/send, tasks/get, role "user"). We speak the one they published.

const SEND_TIMEOUT_MS = 60000;
const POLL_BUDGET_MS = 90000;
const POLL_INTERVAL_MS = 2500;
/** An answer longer than this is a payload, not a reply; the panel is a chat. */
const MAX_ANSWER_CHARS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(endpoint, method, params, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      signal: ctl.signal,
      credentials: "omit",
      headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    });
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "the agent did not answer in time" : "could not reach the agent");
  } finally {
    clearTimeout(timer);
  }
  // A JSON-RPC error is delivered with a non-2xx status by some servers, so a
  // JSON body is worth reading whatever the status says.
  const isJson = (resp.headers.get("content-type") || "").includes("json");
  if (!resp.ok && !isJson) throw new Error(`the agent's server answered HTTP ${resp.status}`);
  let body;
  try { body = await resp.json(); } catch { throw new Error("the agent's answer was not readable"); }
  if (body?.error) throw new Error(body.error.message || "the agent refused the request");
  return body?.result;
}

/** A2A task states arrive in two spellings ("input-required" and
 *  "TASK_STATE_INPUT_REQUIRED"); normalize before comparing. */
function stateOf(task) {
  const raw = String(task?.status?.state ?? "").toLowerCase();
  return raw.replace(/^task_state_/, "").replace(/_/g, "-");
}

function textFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : p?.data !== undefined ? JSON.stringify(p.data) : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Everything a finished task has to say: its artifacts first, since that is
 *  where deliverables land, then whatever its final status message carried. */
function textFromTask(task) {
  const artifactText = (task?.artifacts ?? []).flatMap((a) => a?.parts ?? []);
  return textFromParts(artifactText) || textFromParts(task?.status?.message?.parts);
}

/** A2A carries an attachment as a FilePart naming a URI, which is exactly what
 *  a dragged image gives us. The 1.0 shape is what our own bridge emits; the
 *  older dialect discriminates its parts with `kind`. */
function fileParts(files, v1) {
  return (files ?? []).map((f) => {
    const file = {
      ...(f.name ? { name: f.name } : {}),
      ...(f.media_type ? { mimeType: f.media_type } : {}),
      uri: f.uri,
    };
    return v1 ? { file } : { kind: "file", file };
  });
}

/** One turn with a site-declared A2A agent. Returns its text, or throws with
 *  something a person can read. */
export async function visit(agent, text, files) {
  // The two dialects differ in more than the method name, and servers of the
  // older one validate strictly: agentcommunity.org rejects a message with no
  // `kind`. The 1.0 shape is the one our own bridge speaks and is left exactly
  // as the bridge sends it, discriminator included only where it is required.
  const v1 = agent.dialect !== "legacy";
  const attached = fileParts(files, v1);
  // A2A requires a non-empty parts array, so a message sent with an
  // attachment and no words still carries a text part; it is just empty.
  const message = v1
    ? { role: "ROLE_USER", parts: [{ text }, ...attached], messageId: crypto.randomUUID() }
    : {
        kind: "message",
        role: "user",
        messageId: crypto.randomUUID(),
        parts: [{ kind: "text", text }, ...attached],
      };

  const result = await rpc(
    agent.endpoint,
    v1 ? "SendMessage" : "message/send",
    { message, configuration: { blocking: true } },
    SEND_TIMEOUT_MS,
  );

  // 1.0 wraps the answer ({message} or {task}); the older shape returns it bare.
  let msg = result?.message ?? (Array.isArray(result?.parts) ? result : null);
  let task = result?.task ?? (result?.status ? result : null);
  if (msg) {
    const out = textFromParts(msg.parts);
    if (out) return out.slice(0, MAX_ANSWER_CHARS);
  }
  if (!task) throw new Error("the agent sent no readable answer");

  // `blocking` is a request, not a promise: a server may hand back a task that
  // is still running. Follow it for a bounded while, then say so plainly
  // rather than pretending the conversation is still open.
  const deadline = Date.now() + POLL_BUDGET_MS;
  for (;;) {
    const state = stateOf(task);
    if (state === "completed") {
      const out = textFromTask(task);
      if (!out) throw new Error("the agent finished without saying anything");
      return out.slice(0, MAX_ANSWER_CHARS);
    }
    if (state === "failed" || state === "canceled" || state === "rejected") {
      throw new Error(`the agent's task ${state}`);
    }
    if (state === "input-required" || state === "auth-required") {
      throw new Error(
        state === "auth-required"
          ? "this agent wants a signed-in caller, and a visit is anonymous"
          : "this agent asked for more input in a way a visit cannot answer yet",
      );
    }
    if (Date.now() > deadline) {
      throw new Error("the agent is still working; a visit does not follow up in the background");
    }
    await sleep(POLL_INTERVAL_MS);
    const polled = await rpc(
      agent.endpoint,
      v1 ? "GetTask" : "tasks/get",
      { id: task.id },
      SEND_TIMEOUT_MS,
    );
    task = polled?.task ?? polled;
    if (!task) throw new Error("the agent stopped answering about its own task");
  }
}
