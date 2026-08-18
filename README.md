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

The extension holds no agent list, no key and no verification logic. It asks
the Gateway (`/api/agents/roster`, `/api/mesh/site-agent`, `/api/mesh/request`,
`/api/agents/saved`) and renders the answer, so every client sees the same
truth. The panel is drawn in a closed shadow root: an extension gets no room
in the toolbar, and a claim about identity must not be something the page can
read, restyle, or forge.
