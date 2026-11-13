# Brag Plan: Example Company — Delivery & tour planning

## What is this app?
A Next.js 16 / Supabase app that runs a delivery and cleaning round: it plans and
optimises the day's route, turns the packing list into a checklist (including
photo import via OCR), and tracks the crew's hours — built as an offline-capable PWA.

## The angle
One morning, one tour, one app. The video follows a single workday inside the real
UI: the route gets planned, the van gets packed, the hours get logged. No feature
grid, no marketing promises — the product doing its thing.

## Hook (first 2-3 seconds)
"Every tour starts with a plan." — big type on the app's light background, a blue
route line starts drawing behind it. Then the line snaps into the map card.

## Key moments (the middle)
- The route polyline drawing itself across the map panel while stop pins pop in one by one.
- Pack mode: checklist rows getting ticked off (60 × Micromops, 24 × Mops, 12 × Buckets).
- Photo import: a photographed packing list becomes three ready rows — "3 items added".
- The clock-in button flipping to a running timer, then the week's hours bar filling.

## Outro / punchline
`Example Company` wordmark, then "Objects, routes and tours." and three chips:
Offline-ready · Photo import · Time tracking.

## User flow worth showing
Entry → key action → result, in three beats:
1. **Plan** — tour planning screen, route + stops.
2. **Pack** — pack mode checklist, plus photo import turning a photo into items.
3. **Log** — clock in, timer runs, hours land in the week.

## Tone
- Preset: polished
- Creative direction: quiet product film for people who start at 6 a.m.
- Interpretation: fewer, longer holds; snappy entrances but calm pacing; no jokes,
  no hype words, no stock-photo energy.

## Format: landscape — 1920x1080
## Duration: 21s

## Visual identity (from the project)
- Background: `#f8fafc` (globals.css `--background`)
- Card: `#ffffff`, border `#e2e8f0`
- Text: `#0f172a` (foreground), muted `#64748b`
- Accent: `#1d4ed8` (themeColor / primary)
- Success: `#14a37f` (`--success`)
- Display font: system UI sans (app uses Tailwind `font-sans`, no webfont)
- Body font: system UI sans; numbers in tabular figures
- Strongest visual element: the white card-on-light-canvas look with hairline
  borders and the blue route line

## Share copy (draft)
The whole round in one app: plan the tour, pack it from a photo, log the hours.
Objects, routes and tours — for Example Company.

## Audio direction
- Role: warm bed with a few motion-matched accents
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM)
- Music treatment: start at 0, 0.45 volume, duck under nothing (no voice), fade out over the last 1.2s
- Music cue guidance: bundled track has a beat grid at 0.5s steps (detected with
  `npx hyperframes beats`, 320 beats @120 BPM); use 8.0s and 13.0s for scene changes,
  18.0s for the outro landing
- Audio-reactive treatment: subtle — the route line's glow and the timer badge
  breathe with the bed; no waveform bars
- SFX posture: sparse, motion-matched: one click for the checklist ticks, one
  shutter-ish hit for the photo import, one soft hit for the clock-in
- Audio-coupled moments: checklist tick per row, photo-import result pill, clock-in press
- Restraint rule: no whooshes on every cut, no riser before the outro

## Storyboard

### Scene 1 — Hook — 3.0s
Light canvas, faint grid. Headline "Every tour starts with a plan." rises in two
lines. Behind it, a blue route line draws from left to right and a small label
"Tour planning" fades in bottom-left.
Sequential/interaction: none
Audio intent: calm, immediate
Audio-coupled idea: route line draw starts on the first beat
Music: warm bed in
Transition mood: clean → Scene 2

### Scene 2 — Plan the tour — 5.0s
The tour planning screen: map card with the route polyline finishing, numbered
stop pins popping in left to right; right column lists four stops (Meyer Office,
North Clinic, Stairwell 12, Riverside Shop) with times; footer stats
"38 km · 4 h 12 min · 12 stops".
Sequential/interaction: yes — four stop rows arrive one by one, pinned to the beat grid
Audio intent: forward motion
Audio-coupled idea: pin pops / row arrivals tick with the beat
Music: bed continues
Transition mood: clean wipe → Scene 3

### Scene 3 — Pack it — 5.0s
Pack mode card: "Meyer Office" checklist, three rows tick themselves off
(60 × Micromops, 24 × Mops, 12 × Buckets). A photo-import panel slides in on the
right: a photographed list, then the result pill "3 items added".
Sequential/interaction: yes — three checklist rows tick in sequence, then the
photo panel appears and resolves into the pill
Audio intent: satisfying, tactile
Audio-coupled idea: one click per tick, one shutter-ish hit for the photo import
Music: bed continues
Transition mood: soft cut → Scene 4

### Scene 4 — Log the hours — 4.5s
Time tracking card: "Clock in" button presses, flips to "Clock out", the timer
starts at 00:00:00 and counts; below, "My clock-ins · Today 07:58" and a small bar
chart filling to "38 h 12 min this week".
Sequential/interaction: yes — button press, timer ticks, bars grow
Audio intent: steady, confident
Audio-coupled idea: soft hit on the press, quiet tick with the timer's first seconds
Music: bed continues
Transition mood: clean → Scene 5

### Scene 5 — Outro — 3.5s
Canvas clears to the same light background. Wordmark "Example Company", then
"Objects, routes and tours." and three chips: Offline-ready · Photo import ·
Time tracking.
Sequential/interaction: yes — chips arrive one by one
Audio intent: resolve
Audio-coupled idea: final logo landing on a strong beat, last chip on the fade
Music: fade out over 1.2s
Transition mood: end

**Music mood for this video:** upbeat but restrained business bed
**Audio summary:** one continuous warm bed that steps forward at each scene
change and fades out under the wordmark.
