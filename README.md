# Egg Extension

The Egg browser extension: one build for Chrome and for Egg, talking to the
local Egg Gateway over its paired HTTP API.

It was extracted from the `eggbrowser` repository on 2026-08-18, with its
history, because the browser app is frozen and the extension is one of the
three places new functionality is allowed to live (the Gateway, an egglet, or
here).

## Layout

- `manifest.json` -- MV3.
- `src/background/` -- the service worker and its modules: pairing with the
  Gateway, captures, feeds, signals, the pull-based command channel, and the
  agents roster.
- `src/content/` -- what runs in the page: the Ctrl+M Egg menu, extraction,
  feed detection, and the agents panel.
- `src/popup/`, `src/options/` -- the action popup and settings page.

## Loading it

Chrome: `chrome://extensions`, enable Developer mode, "Load unpacked", pick
this folder. Then connect it to your Gateway from the popup.

## Agents

The site-agent chip (EXT-11) is detected by the extension itself: the site's
own `/.well-known/agentmesh` file, the anchor-domain match, and one public
registrar lookup per declared handle (`src/background/site-detect.js`, a
rule-for-rule port of the Gateway's `site_agents.rs`). Nothing in that chain
needs pairing, so the chip works in a browser with no Gateway connected.

A site may declare several agents. Every entry is checked on its own — its own
anchor match, its own resolution — and at most four are presented, so a
verified first entry cannot carry an unverified one in behind it. There is
still one chip: it opens the site's first agent, and the others sit in a strip
inside the panel, each with its own thread.

A site may also, or instead, publish a Google A2A agent card, which is the
convention actually in the wild. Both files are fetched every time and
everything found is surfaced. The tiers are not equal and the panel says so:
ours is anchored here and resolved at the registrar to a key, while a card is
the site's own word and nothing more. The chip's dot is filled for a checked
identity and hollow for a declared one. A card is only presented when it names
a JSON-RPC endpoint on the same site over https that accepts anonymous callers
(`tests/gates.test.mjs` covers those rules), which stops a page from serving
somebody else's card to borrow their credibility.

Talking to a card is an ephemeral visit, not a relationship: the request goes
out from the extension itself (`src/background/a2a.js`), anonymous and with no
Gateway involved, because it carries no identity for the Gateway to lend it.
Nothing is minted, nothing is saved, and nobody ends up vouching for anybody.

Everything that needs an identity — the roster and the conversations — still
comes from the Gateway (`/api/extension/agents/roster`,
`/api/extension/mesh/request`, `/api/extension/agents/saved`); the extension
holds no keys. The panel is drawn in a closed shadow root: an extension gets
no room in the toolbar, and a claim about identity must not be something the
page can read, restyle, or forge.
