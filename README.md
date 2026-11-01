# Stranger Reels — The Conformity Gate

Daily 20–30 second vertical reels (9:16) for a faceless channel that explains the Stranger Things
"Conformity Gate" fan theory. One reel a day, made and uploaded by GitHub Actions.

Each reel = 3 shots. For every reel the pipeline:

1. **Script** — takes the next unposted reel from `data/reels/` (Episode 1 = 6 hand-written reels).
   When those run out, Gemini writes the next one from `series/plan.md`, using only the facts in
   `series/facts.md` and labelling fan claims as theories.
2. **Voice** — Gemini TTS (deep narrator, voice `Charon`) in one request; offline Kokoro voice as fallback.
3. **Visuals** — one 8-second Gemini video clip (Veo, 9:16) per shot, from the prompt plus the
   shared style block in `series/style.md`. A failed clip becomes a Gemini image with a slow zoom.
4. **Edit** — ffmpeg: colour grade, film grain, vignette, burned-in captions (active word in yellow),
   hook text, per-shot overlay text, green **CONFIRMED** / red **FAN THEORY** badges, a synth drone
   and a sub hit on every cut.
5. **Upload** — YouTube Short, private now and public at 6:00 PM PKT (`schedule` mode), marked as
   AI-generated, not made for kids.

## Setup

1. **Secrets** (Settings → Secrets and variables → Actions → *Secrets*):
   - `GEMINI_API_KEY` — from aistudio.google.com. Video generation needs a billing-enabled key.
   - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` — same kind as the
     Sunny pipeline. For a different channel, run `npm run auth:youtube` locally and sign in with
     that channel.
2. **Test without keys:** Actions → *Daily Conformity Gate reel* → Run workflow → `test`.
   Download the reel from the run's artifacts.
3. **Test with Gemini:** run `gemini-test` (no upload) and check the artifact.
4. **Go live:** run `full` once, or just leave the daily schedule on.

### Optional variables (Settings → Variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `VISUALS` | `video` | `video`, `image` (cheaper) or `procedural` |
| `GEMINI_VIDEO_MODEL` | `veo-3.1-fast-generate-preview` | Change if Google renames the model |
| `GEMINI_VOICE` | `Charon` | Any Gemini TTS voice |
| `UPLOAD_MODE` | `schedule` | `schedule`, `private` or `public` |
| `PUBLISH_TIME` | `18:00` | Pakistan time |

## Local

```bash
npm ci
pip install kokoro-onnx soundfile numpy pillow   # offline voice + test visuals
cp .env.example .env                              # fill keys
npm run reel:test -- --reel=ep1-r1                # keyless test render → out/<date>-ep1-r1/reel.mp4
npm run reel -- --no-upload                       # real Gemini render, no upload
```

## Adding reels

Drop a JSON file in `data/reels/` (copy an existing one). `badge` is `CONFIRMED`, `THEORY` or `NONE`.
Add any new confirmed fact to `series/facts.md` with its source first.

## Copyright and honesty rules

- Visual prompts describe original scenes only: no actors, characters, logos or recreated Netflix shots.
- Music and effects are generated locally; no show soundtrack.
- Fan theories are always said and shown as theories.
- Independent fan channel, not affiliated with Netflix.
