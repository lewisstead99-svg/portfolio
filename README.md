# HOLM — darkroom product editorial

A single-page product editorial for **HOLM**, a (fictional) hand-turned solid walnut valet tray.
One object floating in warm darkness, cream typography the only decoration. A [Fabricatr](https://fabricatr.com) portfolio piece.

It is a portfolio study of the visual system used on [oryzo.ai](https://oryzo.ai) (designed by Lusion),
rebuilt from the ground up around an original product, with original copy, and with the object rendered
live in WebGL instead of photographed.

## What it does

The page follows the beat structure of the reference site, section for section, with original content:

| # | Beat | What happens |
|---|------|--------------|
| 00 | Hero | Top-down "photograph": the tray on a cutting mat with pencils, craft knife, brass ruler and paperclip. Wordmark upper-left, copy over the photo, info card, turntable card, scroll cue, right-edge progress bar. |
| 01 | Intro | The mat falls away, scattered letters drift past, the tray tumbles through the void and rests at 3/4 between heading and body. |
| 02 | Statement | "Made by hand." types itself in, ember model tag, top-down tray with dashed callouts, view pills. |
| 03 | Gallery | A giant "it's furniture." rolls across the screen behind a window, then a carousel of six plates slides through. |
| 04 | Features | Pinned split: frosted panel with icon, label, copy and heading; the tray re-angles for each beat (lip, underside, top) with a dimension, a gauge and a serif formula. |
| 05 | Letters | HOLM at full width, the O drawn as the plan circle with ember control points. |
| 06 | Flip | "Numbered by hand." with a pill that turns the tray over to its maker's stamp. |
| 07 | Macro | The camera drops to grain level across the rim; a friction-coefficient card. |
| 08 | Longevity | The light interlude: a cream ground, a giant word, a three-panel strip. |
| 09 | Reviews | Rating header, three quotes with ember highlights, two plate tiles. |
| 10 | Always on | Two plate tiles and a display line. |
| 11 | Drawing | Specs, a small catalogue plate, and a dimensioned technical drawing with a hatched section. |
| 12 | Contact | Underline-only email field, ember "Built by" credit, the single filled pill, colophon. |

- **One continuous object.** A single Three.js scene renders the tray for the whole page. Sections either
  read the scroll position through keyframes or ask for a named camera preset; the page resolves which one
  wins (product pills, then feature beats, then the section's own preset).
- **Two typographic voices.** Uppercase weight 500 for the interface, mixed case weight 400 for copy, plus
  the occasional mixed-case display line as the reference does.
- **One accent.** `#dc5000` on the credit line, the model tag, the drawing's control points and the
  highlighted phrases in reviews. Never on a control.
- **No shadows, no chrome.** Depth comes from the two-step surface stack (`#100904` → `#382416`) and from
  the render itself. Dividers are 1px dashed hairlines.
- **Degrades honestly.** Without WebGL the page shows static plates rendered from the same scene. Reduced
  motion is respected (no idle drift, no easing lag, no spin, no typing).

## Stack

Plain HTML, CSS and ES modules. No build step, no framework, no external requests at runtime.

| Piece | Where |
|---|---|
| Markup | `index.html` |
| Design tokens + styles | `assets/css/styles.css` (tokens on `:root`), `assets/css/fonts.css` |
| Scroll → scene driver, controls | `assets/js/main.js` |
| WebGL scene (the tray, the mat, the tools, the camera choreography) | `assets/js/scene.js` |
| Three.js r170 (vendored, MIT) | `assets/js/vendor/` |
| Inter variable font (vendored, OFL) — stand-in for Halyard Display | `assets/fonts/` |
| Screenshot harness (headless Chromium) | `tools/screenshot.mjs` |
| Plate renderers (fallbacks, social card, gallery plates) | `tools/plates.mjs`, `tools/gallery-plates.mjs`, `tools/plate.html` |

## Run it

Any static server works. ES modules need HTTP, not `file://`.

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

## Screenshots

```sh
node tools/screenshot.mjs --url /index.html --out shots --mode page --at 0,0.2,0.4,0.6,0.8,1
node tools/screenshot.mjs --url /index.html --out shots-mobile --mode page --width 390 --height 844 --at 0,0.5,1
```

Requires Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or set
`PLAYWRIGHT_PATH` to an existing install).

## Deploy

It is a static folder. GitHub Pages (serve from the branch root), Netlify, Vercel or any bucket will do.
All paths are relative, so it works from a sub-path such as `/portfolio/`.

## Design system in one screen

| Token | Value | Role |
|---|---|---|
| Warm Cream | `#ffedd7` | All text, borders, icon strokes |
| Walnut Shadow | `#100904` | Canvas. The void |
| Bark Brown | `#382416` | The one filled surface |
| Cork Border | `#40372e` | Hairline dashed dividers, card outlines |
| Driftwood | `#6c5f51` | Placeholder text, secondary structure |
| Ember | `#dc5000` | Credit line and studio link only |

Type scale: 51 / 41 / 29 / 24 / 18 / 14 / 12 / 10 px (minor third from 16). Display and heading sit at
line-height 0.9 so uppercase blocks stack as solid form. Radii: 12px cards, 22.5px ghost pills, 36px the
filled pill, 0 for inputs and links.

## Credits

Visual system study after ORYZO by Lusion. Three.js by mrdoob and contributors (MIT). Inter by Rasmus
Andersson (SIL OFL 1.1). Everything else — product, copy, geometry, materials, choreography — original.
