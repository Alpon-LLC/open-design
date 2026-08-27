---
name: hand-drawn-diagrams
description: |
  Generate hand-drawn Excalidraw diagrams from a prompt — animated SVG, hosted edit link, and PNG export. Works with Claude Code, Codex, Gemini CLI, and any agent supporting standard skill paths.
triggers:
  - "excalidraw"
  - "hand drawn diagram"
  - "sketch diagram"
  - "whiteboard diagram"
od:
  mode: prototype
  category: diagrams
  upstream: "https://github.com/muthuishere/hand-drawn-diagrams"
---

Follow the instructions in `./workflow.md`.

## Workflow

1. **Route** — Read `./steps/step-01-route.md`. Pick one diagram type from the routing table (`references/activation-routing.xml`) based on user intent (teach, brainstorm, UX flow, funnel, technical explainer, medical, creative, or page mockup).
2. **Draw** — Read `./steps/step-02-draw.md`. Design the diagram using the shared shape grammar (`references/fundamental-shapes.md`), then write the `.excalidraw` JSON file with a non-empty elements array to `/tmp/hand-drawn-diagrams/<slug>/`.
3. **Validate & Deliver** — Read `./steps/step-03-validate.md`. Run `scripts/validate_excalidraw.py`, then `scripts/open_diagram.py` to generate a hosted edit URL and open it in the browser. Offer animation and PNG as follow-ups.

## Key Rules

- Hand-drawn style, same sketch font, monochrome by default
- Labels: 1–5 words per shape; max 3 short bullets per container
- Write `.excalidraw` files to `/tmp/`, not the user's workspace (unless they ask)
- Always validate before generating URLs — never share an empty diagram
- Rendering priority: Chrome DevTools MCP (fast) → Playwright (fallback)

## References

- `references/index.md` — full reference index
- `references/activation-routing.xml` — route selection rules and delivery modes
- `references/fundamental-shapes.md` — core shape language

## Optional: Chrome DevTools MCP

For fast PNG and animated SVG rendering, install `chrome-devtools-mcp` (uses a real browser, no Playwright needed). See `INSTALL.md` for setup. Without it, rendering falls back to Playwright.
