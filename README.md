# HOLM — darkroom product editorial

A single-page product editorial for **HOLM**, a (fictional) hand-turned solid walnut valet tray.
One object floating in warm darkness, cream typography the only decoration. A [Fabricatr](https://fabricatr.com) portfolio piece.

It is a portfolio study of the visual system used on [oryzo.ai](https://oryzo.ai) (designed by Lusion),
rebuilt from the ground up around an original product, with original copy, and with the object rendered
live in WebGL instead of photographed.

## What it does

- **One continuous object.** A single Three.js scene renders the tray for the whole page. At the top it
  sits on a cutting mat with the tools of the craft, lit like a top-down photograph. As you scroll the mat
  and tools fall away and the tray floats alone in the void, changing angle for every section: 3/4 reveal,
  low side profile, close detail, then a small top-down catalogue plate.
- **Two typographic voices.** Everything is uppercase at weight 500. The 29px body copy at weight 400 is the
  only mixed-case text on the page.
- **One accent.** `#dc5000` appears on the "Built by" credit line and the studio link only. Never on a control.
- **Pill controls.** Outlined ghost pills switch the camera (Top / Side / Detail); the hero's video-thumbnail
  card is a turntable toggle. The single filled pill is the studio CTA.
- **No shadows, no chrome.** Depth comes from the two-step surface stack (`#100904` → `#382416`) and from the
  render itself. Dividers are 1px dashed hairlines.
- **Degrades honestly.** Without WebGL the page shows static plates rendered from the same scene. Reduced
  motion is respected (no idle drift, no easing lag, no spin).

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
