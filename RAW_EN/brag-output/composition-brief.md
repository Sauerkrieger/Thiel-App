# Hyperframes Composition Brief: Example Company (RAW_EN)

## Objective
Create a short launch-style brag video for the English RAW template of the
delivery & tour planning app.

## Output
- Composition directory: `RAW_EN/brag-output/composition/`
- Rendered video: `RAW_EN/brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21 seconds (15–25s window)

## Source Material
- Project root: `RAW_EN/`
- Primary files read: `src/app/layout.tsx`, `src/app/globals.css`,
  `src/components/app-shell.tsx`, `src/components/planning/pack-view.tsx`,
  `src/components/time-tracking/clock-widget.tsx`,
  `src/components/objects/photo-import-dialog.tsx`, `README.md`
- Product name: Example Company (default `NEXT_PUBLIC_COMPANY_NAME`)
- Tagline / strongest claim: "Delivery & tour planning app for Example Company –
  objects, routes and tours." (from `layout.tsx` metadata)
- Key UI or visual moment to recreate: the white card-on-light-canvas app UI with
  the blue route line, the pack-mode checklist, and the clock-in widget
- Copy that must appear verbatim (real UI labels):
  - "Tour planning", "Objects", "Time tracking", "Pack mode", "Clock in",
    "Clock out", "My clock-ins", "Items added"
- Fictional stand-ins (no real customer data): Meyer Office, North Clinic,
  Stairwell 12, Riverside Shop; items Micromops / Mops / Buckets

## Creative Direction
- Tone preset: polished
- Creative direction: quiet product film for people who start at 6 a.m.
- Interpretation: long-ish holds, snappy entrances, calm confident pacing,
  no hype vocabulary, no gradients-galore
- Angle: one morning, one tour, one app — plan, pack, log
- Hook: "Every tour starts with a plan."
- Outro / punchline: "Objects, routes and tours."
- Avoid:
  - Generic SaaS language ("streamline", "supercharge")
  - Abstract filler visuals, particle systems, waveform bars
  - Dark neon redesign — the app is light and blue

## Visual Identity
- Background: `#f8fafc`
- Card: `#ffffff`
- Text: `#0f172a`; muted `#64748b` / `#475569`
- Border: `#e2e8f0`
- Accent: `#1d4ed8`; success `#14a37f`
- Display font: system UI sans (`-apple-system, "Segoe UI", Roboto, sans-serif`),
  tight tracking; numbers tabular
- Body font: same stack
- Visual references from the project: hairline-bordered white cards, rounded
  16px corners, blue primary buttons, muted small labels, tabular numbers

## Storyboard
Use `RAW_EN/brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 3.0s — "Every tour starts with a plan." + route line drawing
2. Plan the tour — 5.0s — map card with polyline + 4 stop rows arriving one by one,
   stats "38 km · 4 h 12 min · 12 stops"
3. Pack it — 5.0s — pack-mode checklist ticking off 3 rows, photo-import panel
   resolving to "3 items added"
4. Log the hours — 4.5s — Clock in → Clock out, running timer, week bar
5. Outro — 3.5s — wordmark + "Objects, routes and tours." + 3 chips

## Audio
- Audio role: warm bed with sparse, motion-matched accents
- Audio arc: bed enters at 0, steps at each scene change, fades out under the wordmark
- Music: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
  (120 BPM, beat grid at 0.5s)
- Music treatment: volume 0.45, fade in 0.4s, fade out 1.2s starting at 19.8s
- Music cue guidance: use the 0.5s beat grid — scene starts at 3.0 / 8.0 / 13.0 /
  17.5s are already on the grid; lock the outro wordmark to 18.0s
- Audio-reactive treatment: subtle — route-line glow and timer badge breathe with
  the bed (implemented as a static, seek-safe glow pulse rather than per-frame audio data)
- Audio-coupled moments:
  - checklist rows — one click per tick
  - photo import — one shutter-ish hit, then the result pill
  - clock-in press — one soft hit
- SFX selection guidance: UI click for ticks, short light interface hit for the
  press, card/paper-ish sound for the photo import
- Exact SFX choice: chosen from the bundled `assets/sfx/ui` and `assets/sfx/interface`
  sets after the animation timing was fixed
- Audio files: music copied to `composition/assets/music/`, SFX copied to
  `composition/assets/sfx/`

## Hyperframes Instructions
- Show at least one real UI element: the tour planning card, the pack checklist and
  the clock-in widget are recreations built from the real components' labels,
  colours and structure.
- Keep all text readable in the final render; `check` is the gate.
- Keep the video within 15–25 seconds.
- Include the music/SFX layer.
- Run `npx hyperframes check` before render; render to `../brag.mp4`.
- Keep creation and rendering local.
