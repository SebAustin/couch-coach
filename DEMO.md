# Couch Coach: demo video plan (2:45, real Fire TV + iPhone)

Draft only. Nothing here has been filmed, uploaded or published. The owner films, edits and uploads (YouTube, public).

Hackathon video rules this plan satisfies: under 3 minutes (target 2:45, 15 s of margin), public on YouTube, in English, shows the app running on a **real Fire TV**, no third-party trademarks, no copyrighted music. The best material comes first, because judges may stop at 3:00 or earlier.

Numbers spoken in the video must match `SUBMISSION.md` section 0. The narration below uses only "about two seconds" for the Cue and no other metric. If you add a number, take it from that table.

## What the video has to prove

1. It runs on a real Fire TV (remote in hand, app launched from the Fire TV home screen).
2. It is a computer-vision fitness app that uses a camera (the live skeleton mirrors the person).
3. It is multi-modal (phone camera, phone as controller, remote D-pad, spoken Coach).
4. The Coach remembers (the spoken Cue refers to the previous session).
5. The AWS architecture is real, and the open-source library exists.

## 0. Setup (read before filming)

### Gear

- The Fire TV with the sideloaded APK installed, on the same network as the phone or any internet. Phone and TV pair through the cloud, not the local network.
- The iPhone, charged and plugged in, on a stand or tripod, **upright** (portrait).
- A second camera on a tripod for the wide shot (any phone or camera). The wide shot, with the TV and the person in one frame, is the proof of "real Fire TV" and the hook. If you only have the iPhone, film the wide shots first with another phone borrowed or with the iPhone on a timer, then do the pose takes.
- The Fire TV remote.
- Optional: an HDMI capture card for clean TV close-ups. `adb shell screenrecord` may also work for TV close-ups, but it is `[unverified]` on your device and can be blocked or capped at 3 minutes; film the screen as a fallback.
- A quiet room. No music at all (see Audio).

### iPhone settings

- Settings > Display & Brightness > **Auto-Lock: Never** (restore it afterwards). The phone must stay awake for the whole set; the page also requests a Wake Lock, but do not rely on it.
- Turn on a Focus mode (Do Not Disturb) so no notification lands in the screen recording.
- Brightness up. Hold nothing else open in Safari; close other tabs.
- **Screen-record the phone too**: Control Center > Screen Recording, start it *before* you open the pairing link, stop it after the recap. The microphone stays off (the narration is added later).
- Place the phone **upright**, **2 to 3 m** from you, with your **whole body in frame, head to feet**. If the "Step back" banner shows on the phone, you are too close or cropped.

### Framing and exercise placement

- **Squats:** stand at about **45 degrees** to the phone (not side-on, not straight on). Feet shoulder-width, sit back and down. This gives the squat heuristics the knee angle, hip height and torso lean (`pose-reps` README, "Camera placement and limits").
- **Jumping jacks:** stand **facing the phone** (frontal view).
- Plain background, good front light, shoes visible (the heel check needs heels and toes seen).
- Let the app see you standing still for one to two seconds before the first rep.
- Do a dry run first and confirm the phone counts correctly. Over-counting on an upright iPhone was a real bug (landscape frame returned by Safari); the app now retries with a 9:16 frame, but confirm it on your phone before filming.

### TV settings

- Fire TV Settings > Display & Sounds > Screen Saver > off (or longest), so it does not dim mid-take.
- TV volume at a level the camera microphone or capture will pick up for the Coach's voice.
- Off camera, press **Menu** on the remote once while on Live to open the debug overlay and note the **draw fps and receive latency** for the submission (SUBMISSION section 0 has no on-device numbers yet). Close it before filming.

### Pre-create one Member with history (needed for the memory moment)

The Coach compares this set with the Member's **most recent set of the same exercise** from their last five sets. It can only "remember" if that earlier set exists.

1. On the TV, **Add member** and type a name (the on-screen keyboard is slow; use a short name). Use a clean name, not a test name.
2. Run a **rehearsal Session** with that Member, ideally the day before (a same-day session also works: the Coach will say "earlier today"). Do **squats**, and make one thing clearly wrong, for example let your knees drift inward on most reps. End the set so the Cue is generated, then Finish. The set is saved to DynamoDB when the Coach call completes. History is kept 90 days.
3. Read the rehearsal Cue and the Recap. Note which fault the Coach called out. Film the real take on the **same exercise**, performing that same thing **better** (knees out). The trend is computed in code: it counts as "improved" when the share of reps with that fault drops by at least 15 points. Only an improved trend lets the Coach celebrate progress; a worse or same trend makes it avoid any progress claim.
4. If the main fault on your rehearsal set is not the one you meant (a heel-rise false positive was seen in earlier live tests on squats), repeat the rehearsal until the fault matches your story. Do not film a memory callback that the data does not support.
5. The Coach uses the Member's name only on set 1, 4, 7, and so on. Make the filmed set your **first set of the Session** if you want the name in the Cue.

### Clean up the Members screen

The Members list is shared and currently contains test Members created during development (Smoke, Debug, E2E Replay and possibly more). There is **no delete** in the app. Options: (a) accept them (the UX spec focuses the most recently seen Member first, so your Member should be the one highlighted), (b) remove the test items from DynamoDB yourself (an AWS write; yours to approve), or (c) crop the shot to your Member's tile.

### Do not show on camera

- Any terminal, the AppSync API key, the AWS console with account details, your email.
- Brand logos: put the iPhone in a plain case or keep its back to the camera; keep Safari's chrome out of the frame where you can (crop in the edit). Naming the services in the narration is fine; do not show their logos.

## 1. Shot list and narration (2:45)

Two cameras are assumed: **W** = wide shot (TV and person together), **TV** = TV screen close-up or capture, **P** = iPhone screen recording, **R** = remote close-up. Times are the target cut, not the order of filming.

| Time | Beat | Picture | Narration (spoken) | On-screen text |
|---|---|---|---|---|
| 0:00 to 0:10 | **HOOK** | **W**: the person mid-squat in the foreground, the TV behind showing the live skeleton mirroring them, rep counter ticking up. Hard cut, no logo card, no intro. | "That's my living room. My phone is the camera, and my Fire TV is drawing my skeleton live." (18 words) | none, or a small "Couch Coach" lower-third at 0:08 |
| 0:10 to 0:25 | **What it is** | **R/W**: a thumb on the Fire TV home screen, selecting Couch Coach from the apps row (real-hardware proof). Cut to the app's "Who's working out?" screen. | "Couch Coach turns a Fire TV into a fitness coach that watches your form. A TV has no camera, so your phone becomes one, and an AI coach on AWS remembers how you did last time." (36 words) | "Fire TV + phone + AWS" |
| 0:25 to 0:50 | **Beat 1: pair by QR** | **TV**: D-pad to the pre-created Member, Select; the QR screen. **P**: scan, allow camera, "Paired". **TV**: "Phone connected". | "Pick a member with the remote. The TV shows a QR code. I scan it, allow the camera, and we are paired. No account, no app to install. The phone runs pose estimation on the device, so only body points leave it, never video." (44 words) | "Pose estimation runs on the phone. No video leaves it." |
| 0:50 to 1:25 | **Beat 2: reps** | **P**: choose Squat, Start set. **W** and **TV**: real squats at 45 degrees; skeleton, rep counter and Form Score update. Optional 5 s cutaway: a few jumping jacks facing the phone. | "I pick squats on the phone and start the set. The TV mirrors me live, counts each rep and updates my form score. Counting and form scoring come from pose-reps, an open-source library we wrote." (35 words) then, **if a fault chip appears on camera**: "When my knees drift in, the limb lights up and the TV names the fault." (15 words). If none appears, skip that sentence. | "Reps and Form Score: pose-reps (MIT)" |
| 1:25 to 1:55 | **Beat 3: the point** | **P**: tap **End set**. **TV**: "Coach is thinking", then the Cue card; the voice plays. Hold the Cue card on screen for the full read. | "Now I end the set. A Lambda function loads my earlier sets from DynamoDB, asks Amazon Bedrock for a Cue, and Amazon Polly speaks it." (25 words). **Silence while the Cue plays** (about 8 s; the caption is on the card). Then, only if the Cue refers to last time: "It remembered my last session. That is the point: the coach knows me." (13 words) | Caption the Cue text (lower third, same words) |
| 1:55 to 2:10 | **Recap** | **R** then **TV**: press End session on the remote, confirm; the Recap with sets, reps, Form Score and the Coach's note. | "End the session and the TV shows the recap: sets, reps, form score, and the coach's note. Same member again, and next time it remembers this one too." (28 words) | none |
| 2:10 to 2:30 | **Architecture and AWS (20 s)** | A simple diagram card (see below), built from your own graphics. | "Under the hood: pose points travel over AWS AppSync Events to the TV. One API Gateway and Lambda call asks Amazon Bedrock, with history from DynamoDB. Polly speaks it. CloudFront serves the phone page. One CDK stack." (37 words) | Diagram with service names (no logos) |
| 2:30 to 2:45 | **Open source and close** | The `pose-reps` GitHub page (README, MIT, tags). End card: repo URLs. | "The counting lives in pose-reps: MIT, zero dependencies, tests, CI, and a regression test from a real phone recording. Couch Coach. Built for Fire TV, on AWS." (27 words) | "github.com/SebAustin/couch-coach" and "github.com/SebAustin/pose-reps" |

Narration totals about 280 spoken words including the two optional sentences, plus the Coach's own Cue (about 8 s). Every beat averages under 115 words per minute, so it fits 2:45 at a relaxed pace. Leave breathing room; do not speed up the voice to fit.

### The "this is the point" moment

1:25 to 1:55. The viewer hears a Coach speak a Cue that refers to what they did last time, on a TV. Everything before it sets that up, everything after it is evidence. If the Cue does not reference the past session on your take, retake (see Fallbacks). Do not narrate "it remembered" over a Cue that does not say so.

An example of the *kind* of Cue the trend logic allows (not scripted, and the model writes its own words): a short two-sentence note that says the main fault from last time showed up on fewer reps today. Cues are at most two sentences and 35 words.

### Architecture card (20 s, build in any design tool)

```
Phone (Safari)                      Fire TV (Fire OS)
 camera -> MediaPipe -> pose-reps       Members | QR | Live skeleton | Recap
        | landmarks only                        ^
        v                                       |
   AWS AppSync Events -------------------------+
        |
   End set -> API Gateway -> Lambda "coach"
                 |-> DynamoDB (Member history = memory)
                 |-> Amazon Bedrock (Claude Haiku 4.5) -> the Cue text
                 |-> Amazon Polly -> S3 -> the voice
                 '-> AppSync Events -> TV
   CloudFront + S3 serve the phone page. One AWS CDK stack.
```

## 2. Full narration (teleprompter copy)

Read at a relaxed pace. Pauses marked `[...]`.

> That's my living room. My phone is the camera, and my Fire TV is drawing my skeleton live. `[cut]`
>
> Couch Coach turns a Fire TV into a fitness coach that watches your form. A TV has no camera, so your phone becomes one, and an AI coach on AWS remembers how you did last time. `[...]`
>
> Pick a member with the remote. The TV shows a QR code. I scan it, allow the camera, and we are paired. No account, no app to install. The phone runs pose estimation on the device, so only body points leave it, never video. `[...]`
>
> I pick squats on the phone and start the set. The TV mirrors me live, counts each rep and updates my form score. Counting and form scoring come from pose-reps, an open-source library we wrote. `[only if a fault shows: When my knees drift in, the limb lights up and the TV names the fault.]` `[...]`
>
> Now I end the set. A Lambda function loads my earlier sets from DynamoDB, asks Amazon Bedrock for a Cue, and Amazon Polly speaks it. `[silence: the Cue plays]` `[only if the Cue refers to last time: It remembered my last session. That is the point: the coach knows me.]` `[...]`
>
> End the session and the TV shows the recap: sets, reps, form score, and the coach's note. Same member again, and next time it remembers this one too. `[...]`
>
> Under the hood: pose points travel over AWS AppSync Events to the TV. One API Gateway and Lambda call asks Amazon Bedrock, with history from DynamoDB. Polly speaks it. CloudFront serves the phone page. One CDK stack. `[...]`
>
> The counting lives in pose-reps: MIT, zero dependencies, tests, CI, and a regression test from a real phone recording. Couch Coach. Built for Fire TV, on AWS.

Accuracy check against the build: the TV shows a Recap built from the sets it saw plus the last Cue as "Coach's note" (there is no recap endpoint). "Same member again" is a real button on the Recap. "Zero dependencies" means zero runtime dependencies (pose-reps README).

## 3. Audio

- **No music.** No library tracks, no streaming-service clips, no "royalty-free" tracks you have not checked. The room sound, the Coach's voice (Amazon Polly) and your narration are the audio. If the cut feels bare, leave it bare; do not add a track.
- Record the narration separately, close to the microphone, after the picture is locked. Lower or mute it while the Cue plays so the Coach's voice is clear.
- Burn in English captions (also helps muted autoplay). The Cue card on the TV already captions the Coach.

## 4. Fallbacks if something fails live

Retake rather than fake. Do **not** splice synthetic data into the final cut as if it were a real phone. If you must use `apps/tv/scripts/publish-synthetic.mjs` for a shot, caption it on screen as "simulated input".

| Failure | What you will see | What to do |
|---|---|---|
| Phone does not count or the skeleton is missing | the phone shows the "Step back" banner, or the TV says "We can't see you" | Move back until head to feet fit, stand still for 2 seconds, retake. Check the phone is upright and Auto-Lock is Never |
| QR will not scan | nothing happens on the phone | Raise TV brightness and move closer; press **New code** on the TV and rescan |
| TV says "Lost your phone" | the pill turns red, skeleton freezes | The app reconnects on its own; wait a few seconds. If it stays, press **New code** and re-pair, then retake the section |
| No Cue after End set | after about 12 s the TV says "The Coach is quiet this time. Your Reps are saved." | Retake the end of the set. If it repeats, check the stack: the coach has a daily ceiling of 300 calls and 3 reserved concurrent executions; Bedrock availability; CloudWatch alarms |
| Cue plays but does not mention last time | a generic Cue | Retake the set. Check that the Member has a same-exercise earlier set and that the main fault improved by at least 15 points. Re-run the rehearsal if needed. If it never references the past, cut the "It remembered" line and say instead: "The coach writes each cue from my last sessions", only if the Recap and data support it |
| No sound on the TV | the Cue card shows "Audio unavailable" or no audio plays | The card is the caption, so the take is still usable if you captioned it. For a better take, check TV volume and retake |
| Wi-Fi dropped mid-take | reconnecting pill on both ends | Wait for recovery; if the take is broken, retake |
| App crashes or will not open | back to the Fire TV home | Relaunch from the apps row. Logs: `adb logcat -s ReactNativeJS:V AndroidRuntime:E` |

If the real Fire TV cannot be made to work on the day, **do not submit a video that implies it did**. Say so plainly on camera ("recorded on the Android TV emulator") and flag it in the Devpost description. That is a worse submission, not a disqualification you want to risk.

## 5. Edit and export

- Length: under 3:00 on the YouTube page. Target 2:45.
- Resolution 1080p or higher. Landscape.
- Add the English captions file or burn in captions.
- Put a one-line title card only after the hook, never before it.
- Keep a 1:1 file of the raw phone screen recording; useful for the gallery and for a retake.
- Hand the shot list to `ai-video-producer` only if you want help assembling the cut. It needs your raw footage; it cannot invent shots of the real device.

## 6. YouTube metadata (draft, not published)

**Title (under 100 characters):**

```
Couch Coach: a Fire TV fitness coach that watches your form (phone camera + AWS)
```

**Description:**

```
Couch Coach turns a Fire TV into a living-room fitness coach. Your phone is the camera (pose estimation runs on the phone, only body points leave it). The Fire TV draws your live skeleton, counts reps, scores your form, and an AI coach on AWS (Amazon Bedrock + Amazon Polly) speaks feedback after each set and remembers how you did last time.

Built for Build, Ship, Shape: Amazon Developer Hackathon. Track: Fire TV. Mini challenges: AWS Builder, Open Source.

Code: https://github.com/SebAustin/couch-coach
Open-source rep counter: https://github.com/SebAustin/pose-reps (MIT)

Chapters
0:00 Live skeleton on the Fire TV
0:10 What it is
0:25 Pair by QR
0:50 Reps and form score
1:25 The coach remembers
1:55 Recap
2:10 Architecture on AWS
2:30 Open source
```

Update the chapter times to the final cut before publishing.

## 7. Day-of order

1. Charge everything; set Auto-Lock Never; Focus mode on; Screen Saver off.
2. Rehearsal Session (if not done yesterday); confirm the Cue references the intended fault.
3. Dry run of the whole flow once without recording.
4. Read the debug overlay once, off camera, and note the numbers. Close it.
5. Film in this order: hook (wide), pairing, reps, End set and Cue, recap, remote and Fire TV home shot, pose-reps page, architecture card.
6. Review the footage on a TV or laptop for the Cue audio and the Cue text legibility before you strike the setup.
7. Edit, caption, export, upload as Public, test the URL logged out, then paste `VIDEO_URL` into `SUBMISSION.md`.
