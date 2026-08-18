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
registrar lookup (`src/background/site-detect.js`, a rule-for-rule port of
the Gateway's `site_agents.rs`). Nothing in that chain needs pairing, so the
chip works in a browser with no Gateway connected.

Everything that needs an identity — the roster and the conversations — still
comes from the Gateway (`/api/extension/agents/roster`,
`/api/extension/mesh/request`, `/api/extension/agents/saved`); the extension
holds no keys. The panel is drawn in a closed shadow root: an extension gets
no room in the toolbar, and a claim about identity must not be something the
page can read, restyle, or forge.
