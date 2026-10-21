# Couch Coach TV: interface system

Source of truth for the look is `docs/ux.md` ("Lamplight"). This file records the decisions made while polishing
the TV app for the demo, and the rules the code now follows, so later changes hold to them.

## Intent
- **Who:** someone on a couch 2-3 m from a 55" TV, hands full of a phone, sweaty, mid-set. D-pad remote, one glance at a time.
- **Task:** pick themselves, pair, then read three things at a glance (Reps, Form Score, what to fix) and hear the Coach.
- **Feel:** a warm evening lounge, not a gym dashboard. Plum-ink room, cream text, ONE lilac accent. Mint / amber / rose
  appear only to mean Form Score (and rose = Fault). If a colour is on screen it means something.
- **Signature:** the focus treatment (cream ring + lilac halo, the focused cell lifted above its neighbours) and the Form Score
  bar with its 60 / 85 ticks. Both are used on every screen.

## Depth, spacing, type
- **Depth strategy: surface-colour shift, no shadows.** bg `#1B1420` -> stage `#120D16` (darker, "spotlit floor") ->
  raised `#261C2D` (cards) -> overlay `#33263C` (Cue card, chips, pills) -> track `#3D2E48` (buttons on overlay). One hue, only lightness moves.
  Focus is the only glow. Borders only where a boundary must exist (Fault chip rose 2 px, dashed Add tile).
- **Spacing:** 4-base scale `0 4 8 12 16 24 32 48 64 96` (design px at 1920x1080), always through `s()`. Rhythm: 16 inside a
  group, 32 between groups, 48-64 between sections. Off-scale literals (40, 10) were removed from shared components.
  **Every StyleSheet literal goes through `s()`**: an unscaled `gap: 16` is 16 dp (32 design px on a 1080p Fire TV, 16 on web), which is
  why tv-* and web-* screenshots used to differ.
- **Safe zone:** 96 x 54 (5% overscan). Text and controls inside; backgrounds bleed. Focus glow may extend past it (it is not content).
- **Type:** Bricolage Grotesque for display/numbers, Figtree for text. Scale (design px): 220 / 96 / 64 / 44 / 34 / 30 / **26 (floor)**.
  Hierarchy comes from size + weight + colour together: value 700 `text`, label 700 26 tracked `textMuted`, meta 500 `textMuted`.
  26 (`bodyS`) is used only for long free text and one-line dense rows; nothing is smaller. `allowFontScaling` is off (layout is already `s()`-scaled).
- **Radius:** chip 14, button 22, card 32, stage 40, pill 999. Deliberately unequal.

## Focus and D-pad
- `Focusable` wraps every focusable. Scale 1.06 (cards) / 1.08 (buttons), 4 px cream ring, 3 px gap, 36 px halo as 3 concentric layers; ring/halo OPACITY animates.
- **The focused cell is lifted (`zIndex: 10`) above its siblings, and in the Members grid the focused row is lifted above the rows below.**
  The halo (up to 43 px) is wider than the 32 px gap; without the lift the next tile's background cut it off (visible in the old tv-01 and tv-13).
- Members grid is `alignInGrid`: Down/Up keeps the column instead of jumping to the last-focused tile of the next row.
- Select plays a 100 ms dip (0.96) and recovers in 150 ms. None under reduced motion.
- Order: Members left-right then top-bottom, "Add member" last, start on newest. Pair: New code, Change Member. Live: hidden until the first press. Recap: Done, Same Member again. Modals cycle their own root; Back closes.

## Worst-case rules (break-ui)
Every rule is a pure function in `lib/fit.ts` with tests in `lib/__tests__/fit.test.ts`.

| Data | Rule |
|---|---|
| Member name 12+ chars | Tile name steps 44 -> 36 and may take 2 lines; a 40-char unbreakable name ends in an ellipsis; full name stays in the a11y label |
| Name with emoji / non-Latin | Avatar initial is the first code point (`initialOf`), never half a surrogate pair |
| 8+ Members | 8-11 Members: compact tiles (384x184, avatar left), 3 rows of 4. 12+: newest 11 plus "Showing your 11 most recent Members". 7 or fewer: full tiles, 2 rows |
| Name in titles | Recap title: display up to 24 chars, then h1 on 2 lines. Pair label and HUD label: one line |
| Reps 0 / 99 / 100+ / 1000+ | Counter 220 for 1-2 digits, 170 for 3, 130 for 4+ (`repFontSize`), box height fixed at 240 so nothing moves |
| Form Score 0 / 100 | Number is `minWidth` 110 and `flexShrink: 0`; band label takes 2 lines; bar scaleX clamps 0..1 |
| 4+ Faults on the last Rep | Last Rep zone reserves 2 chip rows (stable layout for 0-2 Faults) and holds at most 3 rows: past 3 Faults it shows 2 chips plus "+N more" (full list in the a11y label). A long unknown Fault id ellipsizes inside the chip |
| Cue 200 / 300 / 300+ chars | Type steps 34 -> 30 -> 26. The card grows upward from the bottom (max 640 high, was 440) so Replay/Dismiss never leave the card. Clamp at 11 lines only past ~800 chars; screen readers get the whole text |
| Recap 6-10 Sets | One-line rows 46 high, 26 text, score keeps number AND band word |
| Recap 11+ Sets | Latest 9 plus "+N earlier Sets" (before this, anything past 5 was silently dropped) |
| Recap Coach's note | Type steps 34 -> 30 -> 26 at 150 / 260 chars; clamp at 10 lines |

## Components (measurements worth keeping)
- Button: 96 high (min), radius 22, side padding 48, label 30/700 one line. Primary accent fill + `onAccent`; secondary `overlay` (`track` when on an overlay).
- Member tile: 384x300 (compact 384x184), radius 32, `raised`. Avatar 96 (compact 72) `overlay`. Caption 26 `textMuted`.
- Fault chip: 56 high, radius 14, 2 px `scorePoor`, "!" icon + 28/700 text, max width 100% of the panel.
- Cue card: `overlay`, radius 32, padding 32, 72 px lilac badge. Bottom-aligned at the safe-area bottom; entrance + exit below.
- HUD panel: 432 wide, `raised`, padding 32, radius 32, five blocks in `space-between`: header 90, Reps 274, Form Score ~174, Last Rep 42 + 120 min, End session 96.

## Motion (all compositor: transform + opacity, native driver)
| Moment | Spec |
|---|---|
| Focus | scale 1.06/1.08 + ring/halo opacity, 150 ms ease-out cubic |
| Press (Select) | scale 1 -> 0.96 in 100 ms -> 1 in 150 ms; skipped when reduced |
| Rep bump | scale 1 -> 1.18 in 90 ms -> 1 in 130 ms + halo 0.5 -> 0 in 220 ms. Restarts on every Rep and is stopped on unmount |
| Cue card in | translateY 40 -> 0 + opacity, 320 ms `(0.16,1,0.3,1)`, ONCE per card (it used to replay on thinking -> Cue) |
| Cue card out | translateY 0 -> 16 + opacity 1 -> 0, 160 ms ease-out; card stays mounted 200 ms (`useRetainedValue`) and stops its audio at once |
| Thinking -> Cue | body cross-fade 160 ms, card does not move |
| Screen change | opacity 0 -> 1, 220 ms (`useFadeIn`). **Opacity only**: no translate or scale, so nothing that holds focusable nodes ever moves while it animates |
| Modal | scrim + card opacity, 160 ms |
| Loading tiles / waiting dot | one native opacity loop each (0.5 -> 1, 1.2 s; 1 -> 0.4, 1.6 s). Static under reduced motion |
| Score bar | scaleX 250 ms ease-out |
Reduced motion (`useReducedMotion`, one shared subscription): no scale, no translate, no loops; fades shrink to 120 ms; focus ring appears instantly.

**Skeleton budget:** the skeleton stays imperative (`setNativeProps`, rAF, >= 28 ms gap). The three fault-layer writes now only run while a Fault
is flashing (about 1.6 s per Rep) instead of three writes per frame forever. No new work was added to the frame loop. Reanimated was NOT added
(APK size, the deliberate drop); RN `Animated` with `useNativeDriver: true` covers everything above. The Pair screen's per-second countdown no longer
re-renders the QR (`memo`), and its pulsing dot no longer re-renders the row every 800 ms.

## Do / don't
- Do put new free-text surfaces through `textTier` + `numberOfLines`; do reserve space for the longest state, not the usual one.
- Don't animate layout (width/height/margin) or wrap focusable nodes in a moving/scaling parent.
- Don't add a second accent, a shadow, or text under 26.
