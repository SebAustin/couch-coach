# Couch Coach UX spec (TV + phone)

Terms follow `CONTEXT.md`: Member, Session, Pairing Code, Set, Rep, Fault, Form Score, Cue, Coach, Recap. Never write "user", "workout plan", "error" or "tip" in UI copy. Data comes from `packages/protocol` (`Member`, `SessionResponse.expiresAt`, `PhoneEvent`, `CoachMessage`).

## 1. Visual direction: "Lamplight"
A warm evening-lounge look, not a cold gray dashboard. Deep plum-ink room, cream text, ONE lilac brand accent. Warm hues (mint, amber, rose) are reserved for Form Score meaning only, so a color on screen always means something. A static lamp glow sits in the top-left of every screen, and the skeleton stage is a darker "spotlit floor". Display type is chunky and friendly, and numbers are huge.

### Tokens (`tokens.ts`; the phone mirrors them as CSS vars `--cc-<name>`)
All values are px at 1920x1080 design size. TV code uses `s(px) = px * windowWidth / 1920` so it works whatever the dp density. Contrast is measured against `bg`, and every text/background pair listed here is >= 4.5:1.
```ts
export const color = {
  bg: '#1B1420', stage: '#120D16', raised: '#261C2D', overlay: '#33263C', track: '#3D2E48',
  line: '#4A3A55',            // decorative divider only, never the sole boundary of a control
  text: '#FFF4E8',            // 16.2:1 on bg
  textDim: '#CDBFD6',         // 10.3:1 bg, 8.5:1 raised
  textMuted: '#A898B4',       // 6.7:1 bg, 6.1:1 raised, 5.3:1 overlay (captions, hints; never smaller than 26)
  accent: '#B9A2FF',          // 8.3:1 on bg; buttons, QR frame, active
  onAccent: '#1B1420',        // 8.3:1 on accent
  accentSoft: '#D9CCFF',      // skeleton bones, 12:1 on stage
  focusRing: '#FFF4E8', focusGlow: 'rgba(185,162,255,0.55)',
  scoreGood: '#5BE3A0',       // 11.1:1 bg   score >= 85  "Strong form"
  scoreOk: '#FFC247',         // 11.1:1 bg   60-84        "Decent form"
  scorePoor: '#FF5C7A',       // 6.1:1 bg, 4.8:1 overlay   < 60  "Form slipping"; also Fault color
  onScore: '#1B1420',         // >= 6.1:1 on all three score colors
  lampGlow: 'rgba(185,162,255,0.12)', // radial-gradient(1100px at 8% 0%, lampGlow, transparent)
} as const;
export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const; // 4-base, rhythm: 16 inside, 32 between, 64 sections
export const radius = { chip: 14, button: 22, card: 32, stage: 40, pill: 999 } as const; // deliberately unequal
export const safe = { x: 96, y: 54 } as const;          // 5% overscan: all text/controls inside; only backgrounds bleed
export const motion = { focus: 150, bump: 220, enter: 320, ease: 'cubic-bezier(0.16,1,0.3,1)' } as const;
export const shadow = { card: '0 12px 32px rgba(0,0,0,.45)' } as const; // focus glow is NOT a shadow, see Focus
```
Score thresholds (`scoreBand(n)`): `>=85 good`, `60-84 ok`, `<60 poor`. They sit on top of Fault weights (one `shallow_depth` = 70 = ok; two Faults = poor).

### Type (Google Fonts; use `@expo-google-fonts/*` on TV, `@fontsource/*` or `<link>` on phone; fallback `system-ui, sans-serif`)
- Display: **Bricolage Grotesque** 700/800. Text: **Figtree** 500/700. Use `fontVariant: ['tabular-nums']` on every number.
- TV scale: `repCounter 220/800`, `display 96/800`, `h1 64/700`, `h2 44/700`, `bodyL 34/500` (Cue text), `body 30/500`, `label 26/700 +4% tracking, uppercase` (Figtree). **No text under 26.** Line-height 1.25 for display, 1.4 for body.
- Phone scale (390x844 baseline, read from 2-3 m during a Set): `repCounter 180`, `h1 40`, `body 20`, `label 16 min`. All targets >= 56 high.

### Focus (D-pad), applied to every focusable on TV
On focus, over 150 ms ease-out: `transform: scale(1.06)` for cards and `1.08` for buttons and chips, a 4 px `focusRing` outline with a 3 px `bg`-colored gap, and a `focusGlow` halo of 36 px blur behind. The ring and halo are separate absolutely-positioned layers whose **opacity** animates 0 to 1 (no shadow/border animation). The gap keeps the ring >= 3:1 against accent buttons. Unfocused is flat, with `shadow.card` on cards. The focused element must never be clipped: leave `space[4]` margin around focusables inside scroll containers. Reuse the sample's focus component in `packages/shared-ui` and restyle it with these tokens.

## 2. TV screens (1920x1080)
Flow: `Members -> Pair -> Live -> Recap -> Members`. Back always goes up one level, and from Members it exits the app (system default).

### 2.1 Members (start)
```
 safe x=96..1824, y=54..1026
 [lamp glow]   Couch Coach                                    (label, textMuted)
 Who's working out?                                           (display 96)
 Pick a Member and the Coach picks up where you left off.     (bodyL, textDim)

 +---------------+ +---------------+ +---------------+ +- - - - - - - -+
 |  (M) 96px     | |  (J)          | |  (A)          | |      +        |
 |  Maya         | |  Jon          | |  Alex         | |  Add member   |
 |  Last seen    | |  Last seen    | |  New here     | |               |
 |  yesterday    | |  3 days ago   | |               | |               |
 +---------------+ +---------------+ +---------------+ +- - - - - - - -+
 tiles 384x300, gap 32, 4 per row, wraps to a second row (8 Members max shown, then horizontal scroll)
```
- Tile: `raised`, `radius.card`. Avatar = initial in a circle (`overlay` bg, `text`, display 56), so it is never color-only. "Add member" tile has a 3 px dashed `textMuted` border and a "+" glyph.
- **Focus order:** left to right, then top to bottom, "Add member" last. Initial focus is the Member with the newest `lastSeenAt`, else "Add member". Select on a Member calls `POST /session {memberId}` and opens Pair. Select on Add opens the modal below.
- **Add member modal** (scrim `rgba(18,13,22,.8)`, card 960 wide): "Add a Member", a text field "Name" (max 40; opens the system keyboard; helper "Use the keyboard, or press the mic on your remote"), and buttons **Save** (primary) and **Cancel**. Focus order: field, Save, Cancel. Back = Cancel. Empty name keeps Save disabled with the hint "Enter a name to continue". `POST /members` failing shows "Couldn't save. Try again." under the field.
- **Loading:** 4 skeleton tiles (opacity 0.5 to 1 loop, 1.2 s; static under reduced motion) with the status text "Loading Members...".
- **Empty (no Member yet):** title "Let's meet your first Member", sub "Add a name so the Coach can remember you.", one big focused "Add member" tile (primary style).
- **Error (API down):** replace the grid with a card: "Can't reach Couch Coach" / "Check that the TV is online. We'll keep trying." and a focused **Try again** button (auto-retry every 10 s, status line "Trying again...").

### 2.2 Pair
```
 Pairing for Maya                                               (label)
 Scan to join                                                   (display 96)
 +------------------+     1  Point your phone's camera at this code.
 | white card 560   |     2  Tap the link and allow camera access.
 |  QR 448x448      |     3  Prop your phone upright, 2-3 m away, so your whole
 |  (32 quiet zone) |        body fits in the frame.                      (bodyL, 3 rows, 32 gap)
 +------------------+     o Waiting for your phone...                   (pulsing dot + text)
 Code expires in 1:48                 [ New code ]  [ Change Member ]
 [=======-----] bar (scaleX)
```
- The QR card is `#FFFFFF` with ink modules (>= 21:1; never tint it). The QR encodes `SessionResponse.phoneUrl`. Step numerals are 56 px circles in `accent` with `onAccent` text.
- **Expiry:** countdown from `expiresAt`, "Code expires in m:ss". Under 60 s the text becomes `scoreOk` with the prefix "Hurry: ". At 0 the QR dims to 15% and shows the overlay "Code expired" with focus moved to **New code**.
- **Focus order:** New code, Change Member (left to right). Initial focus is New code. Select on New code calls `POST /session` again, and Select on Change Member goes back to Members.
- **Phone joined** (`hello` event): status becomes a mint check "Phone connected", holds 800 ms, then goes to Live.
- **Loading:** the QR card shows a shimmer-free placeholder and "Creating your Pairing Code...".
- **Error:** the card shows "Couldn't create a code" / "Check your connection and try again." with a focused **Try again**.
- **Back:** goes to Members (the unused Session is abandoned).

### 2.3 Live
Stage = full-bleed left region x 0..1344, y 0..1080 (**70% of the screen**), fill `stage` plus lamp glow. The HUD column is x 1392..1824 (432 wide) on `raised`, `radius.card`, padding 32. All HUD text stays inside the safe area.
```
 +--------------------------------------------+ +---------------------------+
 | (o) Phone connected              (96,54)   | | MAYA                      |
 |                                            | | Squat           Set 2     |  h2
 |        [camera-frame corner brackets]      | | REPS                      |
 |               ( )  head                    | |        7                  |  repCounter 220
 |              /|\   skeleton, mirrored,     | | FORM SCORE                |
 |              / \   fit-contain 9:16        | |  84  Decent form          |  display 96 + bodyL
 |                                            | |  [=====|====o-|--]  bar   |
 |  +--------------------------------------+  | | LAST REP                  |
 |  | Coach Cue card (see below, bottom)   |  | |  [!] Knees caving         |  chips
 |  +--------------------------------------+  | | [ End session ]  (focus)  |
 +--------------------------------------------+ +---------------------------+
```
- **Skeleton box:** mirrored horizontally (`x' = 1 - x`) like a mirror. The box is 9:16 (the phone is propped in portrait), fit-contain inside x 96..1296, y 54..1026, centered, with 24 px corner brackets in `textMuted`. The HUD never overlaps it.
- **Connection pill** (top-left of the stage, bodyish 26/700): dot + text + icon. States: "Phone connected" (mint dot), "Reconnecting..." (amber, spinner glyph), "Phone lost" (rose, X glyph).
- **Exercise header:** Member name (label), Exercise name (h2) and "Set n". Exercise labels: "Squat", "Jumping jack".
- **Rep counter:** `repCounter` size, `text` color, `aria-live` off (see a11y). **Form Score:** the number is the running Set Form Score (mean of Reps), colored by band, with the band label beside it ("Strong form", "Decent form", "Form slipping") and a bar (`track` background, fill scaleX 0..1, origin left, ticks at 60 and 85). Before the first Rep: "--" and "Do your first Rep".
- **Fault chips** (last Rep only; wrap; chip = pill-ish `radius.chip`, height 56, `scorePoor` 2 px border on `overlay`, a "!" triangle icon + text in `text` 28/700): "Shallow depth", "Knees caving", "Torso lean", "Heels rising", "Arms not overhead", "Feet not wide". Empty text: "No Faults on your last Rep" with a mint check. Chips hold until the next Rep.
- **End session button:** the only focusable on Live (secondary, bottom of the HUD). It is NOT focused by default. Any D-pad press focuses it. Select opens the confirm dialog "End this Session?" with **Keep going** (default) and **End session**. Back opens the same dialog, but if a Cue card is up, Back dismisses the card first.
- **Idle (before the first Set):** the stage shows the live skeleton as soon as frames arrive, plus a centered pill "Ready when you are. Pick an Exercise on your phone."
- **No pose / low visibility** (all landmarks < 0.5 for 2 s): pill "We can't see you. Step back so your whole body is in the frame."
- **Coach thinking** (`CoachMessage thinking`): a Cue card appears in its thinking state: "Coach is thinking" plus 3 dots (opacity stagger) and the Set recap line "Set 2: 8 Reps, Form Score 84".
- **Cue card** (`cue`): x 96..1296, bottom-aligned at y 1026, auto height (max 440), `overlay`, `radius.card`, padding 32. Left: a 72 px Coach badge (lilac circle, speaker glyph). Content: label "COACH", Cue text in `bodyL` (drop to `body` 30 if > 280 chars), and an audio row: equalizer glyph + "Playing" / "Replay" / "Audio unavailable". The card is the caption of the spoken audio, so it must stay on screen after the audio ends until the next Set starts or the Member dismisses it. While it is visible the skeleton drops to 35% opacity (a Set is over). Buttons **Replay** and **Dismiss** on the card are reached with any D-pad press (Replay first). No `audioUrl`: hide the audio row.
- **Coach error / timeout (> 12 s with no Cue):** the card becomes "The Coach is quiet this time. Your Reps are saved." and auto-hides after 8 s.
- **Phone silent > 5 s** (no PoseBatch): the skeleton freezes at 35% opacity. A centered card says "Lost your phone" / "Keep your phone on and in the app. Reconnecting..." and the pill goes rose. Reconnection clears it in 300 ms. After 30 s, add the buttons **New code** (focused) and **End session**.
- **Live API/network down** (events socket closed): the same card, but "Lost connection to Couch Coach."
- **Back:** see End session. In Live it never exits directly.

### 2.4 Recap (the Session end)
Shown after End session (from the TV or via the phone `control end_session`). There is no recap endpoint (Sonnet recap is cut), so the TV builds the Recap from the Sets it saw plus the last Cue text under "Coach's note".
```
 Nice work, Maya                                                (display 96)
 3 Sets  -  24 Reps  -  Form Score 78    (3 stat blocks, display 64 + label)
 +-----------------------------------------+ +----------------------------+
 | Set 1  Squat           8 Reps   84      | | COACH'S NOTE               |
 | Set 2  Squat           8 Reps   72  [!] | | "Your knees caved on the   |
 | Set 3  Jumping jack    8 Reps   88      | |  last 3 Reps. Next time... |
 |   rows 88 high, Form Score pill + band  | |  (last Cue, bodyL)         |
 +-----------------------------------------+ +----------------------------+
                                  [ Done ]   [ Same Member again ]
```
- Each Set row shows Exercise, Reps, Form Score (number + band word, so not color only) and the top Fault as text ("Knees caving x3"). Rows are not focusable.
- **Focus order:** Done (primary, initial), Same Member again (secondary). Done goes to Members. Same Member again creates a new Session for that Member and goes to Pair. Back = Done.
- **Empty (ended with 0 Sets):** "No Sets this time" / "Start a Session whenever you're ready." with only **Done**.
- **No Cue received:** the Coach panel reads "The Coach didn't have a note this time."

## 3. Skeleton styling (TV, SVG imperatively updated; never re-render React per frame)
- Draw bones as 33-landmark `POSE_CONNECTIONS` minus the face. Replace the face with one head circle (r 36, 8 px `accentSoft` outline, centered on the nose, landmark 0). Drop the hand/foot-index clutter except the foot index (31/32) for `heels_rising`.
- **Bones:** `accentSoft`, 14 px, round caps. **Joints:** r 14 `text` fill with a 4 px `stage` outline (r 16 on shoulders, hips, knees). At 3 m on a 55" TV, 14 px is about 9 mm, readable without being a blob.
- **Fault limbs** (shown for ~1.2 s after the `rep` event, then a 400 ms opacity fade): bone 20 px in `scorePoor` plus a 36 px halo at 35% opacity. The faulty joint gets an extra 6 px outer ring (shape cue as well as color). Chip text names the Fault.

| Fault id | Highlight (MediaPipe indices) |
|---|---|
| `shallow_depth` | thighs 23-25, 24-26; hips 23, 24 |
| `knees_caving` | knees 25, 26; thighs 23-25, 24-26 |
| `torso_lean` | torso 11-23, 12-24 |
| `heels_rising` | 27-31, 28-32; heels 29, 30 |
| `arms_not_overhead` | 11-13, 13-15, 12-14, 14-16; wrists 15, 16 |
| `feet_not_wide` | shins 25-27, 26-28; ankles 27, 28 |
- **Visibility:** if either end has `visibility < 0.5`, draw the bone/joint at 25% opacity. Never snap or hide abruptly (150 ms opacity).
- **Smoothing:** poses arrive at ~15 fps. Apply an EMA per landmark (alpha 0.5; alpha 0.7 on wrists and ankles) and a render loop at 60 fps with `requestAnimationFrame` that lerps from the previous to the latest smoothed pose over 66 ms. Update path `d` / circle `cx cy` via refs or `setNativeProps`. No trails, no shadows.

## 4. Phone screens (web, portrait 390x844, one-handed)
Same tokens, dark. Bottom 40% is the thumb zone. Every primary action is a full-width button, 72 high, `radius.button`, `accent` fill. Keep the screen awake (Wake Lock) during a Session. The phone is read from 2-3 m during a Set, so Set-screen text is huge.
1. **Camera permission prime** (first load of `?s=&t=`): "Couch Coach needs your camera" / "Your video never leaves this phone. Only body points are sent to the TV." Button **Allow camera**.
2. **Permission denied:** title "Camera is off", body "Couch Coach can't see you without it. Open your browser's site settings, allow Camera, then come back." Buttons **Try again** (re-request) and **How to allow it** (an inline accordion with 2-line steps for iOS Safari and Android Chrome). The Session stays open so the TV keeps waiting.
3. **Paired:** a mint check, "Paired with the TV" / "Maya's Session". A tip row: "Prop your phone upright, 2-3 m away, with your whole body in frame." Button **Choose Exercise**. Status chip "Connected" (top).
4. **Exercise picker:** two big stacked cards (each 120 high; icon, name, a one-line hint): "Squat" / "Feet shoulder-width, sit back and down." and "Jumping jack" / "Arms overhead, feet wide." Selecting a card marks it (check + `accent` border) and enables **Start Set**.
5. **Set screen:** the camera preview fills the screen (mirrored), with a faint skeleton overlay (6 px bones, `accentSoft`, joints r 6). Top bar: Exercise name + "Set n". Center-top: Rep count at 180 px with the Form Score band word below. **End set** is the primary action: a bottom bar 25% of the height (about 200), full width, `accent`, label "End set" (28 px/800). Secondary (small, top-right, 56x56): **Pause** (`control pause`). The Set also ends itself after 8 s without movement: show the banner "No movement. Ending Set in 3, 2, 1" with an **Undo** (**Keep going**) button.
6. **After the Set (Cue display):** "Coach is thinking..." (3-dot opacity loop), then the Cue text at 24 px in a card (the audio plays on the TV; label "Coach says"). Buttons: **Next Set** (primary; back to picker) and **Finish Session** (secondary text button).
7. **Problem states:** link invalid or expired: "This Pairing Code expired" / "Scan the new code on your TV." Offline: top banner "Offline. Reconnecting..." and the Set controls stay usable. TV gone (no events for 10 s): "Lost the TV" with **Reconnect**.

## 5. Motion (transform/opacity only; never animate width/height/top/margin)
| Moment | Spec |
|---|---|
| Focus | scale 1.06/1.08 + ring/glow opacity, 150 ms ease-out |
| Rep counter bump | `scale 1 -> 1.18` in 90 ms, `-> 1` in 130 ms (`motion.ease`); a halo layer flashes opacity 0.5 to 0. A new Rep restarts it. |
| Cue card entrance | `translateY 40 -> 0` + `opacity 0 -> 1`, 320 ms ease; the stage drops to 35% opacity at the same time |
| Thinking dots | opacity 0.3 to 1, 1.2 s loop, staggered 150 ms |
| Score bar | `scaleX` transition 250 ms |
| Audio glyph | 3 bars, `scaleY` loop, only while audio plays |
**Reduced motion** (TV: `AccessibilityInfo.isReduceMotionEnabled`; web: `prefers-reduced-motion`): no scale on focus (the ring and glow stay, instant), no bump (the number just changes, plus a 120 ms halo opacity flash), the Cue card fades 120 ms with no translate, dots and loaders show static "...", the equalizer is static, and skeletons drop the interpolation (draw the latest pose).

## 6. Accessibility (WCAG 2.1 AA)
- **Contrast:** all text >= 4.5:1 (table in 1; muted text on overlay is the lowest at 5.3:1). UI boundaries and focus ring >= 3:1. QR is ink on white.
- **No color-only signals:** a score has number + band word; Faults have chips with text + "!" icon, plus a thicker line and a ring on the joint; connection has icon + text; expiry has text.
- **Coach audio is captioned:** the Cue card is the caption. It stays until dismissed or the next Set, and it needs no audio to be useful. Audio failure never blocks the flow.
- **Keyboard / D-pad:** every action is reachable with D-pad + Select + Back. There is no focus trap except the modal (cycles Save, Cancel; Back closes) and the confirm dialog. Focus order follows reading order (left to right, top to bottom). Return focus to the invoking control when a dialog closes. Never auto-move focus except where this spec says so (Pair expiry, error Try again).
- **Screen reader (TalkBack / VoiceOver / web):** give buttons `accessibilityRole="button"` with labels, e.g. "Maya, last seen yesterday" and "Add member". The Cue card is `accessibilityLiveRegion="polite"` / `role="status"` and announces the text once. The rep counter is NOT live (it would spam). Announce "Set ended, 8 Reps, Form Score 84" once when the Set ends. The QR has the label "Pairing Code. Scan with your phone's camera." and the skeleton is `accessibilityElementsHidden`/`aria-hidden` (decorative; the HUD carries the data).
- **Targets:** phone >= 56x56 (primary 72 high), TV focusables >= 96 high for buttons and tiles, and chips are read-only.
- **Text:** min 26 on TV, 16 on phone. Respect the system font scale on the phone up to 200% without clipping (use min-heights, not fixed heights).
- **Seizure/motion safety:** nothing flashes more than 3 times per second (the rep halo is a single 220 ms event).

## 7. Open design risks (for the orchestrator)
1. **Frame aspect:** the protocol has no frame width/height. The skeleton assumes a portrait 9:16 camera frame (phone upright). Request that the phone lock to 720x1280 or add `aspect` to `hello`.
2. **TV-originated end:** the "End session" button on the TV needs to tell the phone. `PhoneEvent.control` is phone-published only; either allow the TV to publish a `control end_session` on `/events`, or have the phone treat a closed TV as the end.
3. **Recap:** the Coach note is the last Cue, because there is no recap endpoint. If a recap arrives later, it fills the same panel.
4. **TV text entry:** the on-screen keyboard is slow. If time is short, seed the Members list with one name and use the cut order in PLAN.md.
5. **Fonts offline:** if the font load fails, the fallback system fonts keep the sizes (no layout depends on glyph widths except the rep counter, which has a 3-digit max width of 390).
