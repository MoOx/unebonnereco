# unebonnereco

Every cultural recommendation made on the French podcast **Un Bon Moment avec Kyan
Khojandi et NAVO**, catalogued and linked to the exact second it was said.

At the end of each episode the hosts and their guests recommend films, series, books,
shows, music. This finds them automatically in the YouTube episodes, works out what
each one actually is, and publishes the lot as a browsable site where one tap plays
the moment the recommendation was made.

**Live: <https://moox.github.io/unebonnereco/>**

## What is in it

| | |
| --- | --- |
| Episodes processed | 85 of the 117 in the playlist |
| Recommendations | 462 |
| Guests | 126 |
| With a verified reference page | 172 (37%) |
| With cover art | 221 (48%) |
| Timed to the sentence | 456 (99%) |

The 32 episodes not processed are private, deleted, or not episodes at all — the
playlist also holds trailers and short games.

## How it works

No server and no database: the pipeline runs on a laptop, writes JSON into `data/`,
and the site is a static export that reads it. Everything it depends on is free.

```bash
node src/steps/01-fetch.ts 117    # 1. episodes + subtitles      ~15 min, network only
node src/steps/02-transcript.ts   # 2. timecoded transcripts     seconds
node src/steps/03-target.ts       # 3. find the reco section     seconds
node src/steps/03b-whisper.ts     # 4. re-transcribe it  ⚠ HEAVY  ~2-3 h, resumable
node src/steps/04-extract.ts      # 5. extract recommendations   ~20 min, network only
node src/steps/05-enrich.ts       # 6. identify works + links    ~45 min, network only
node src/steps/06-posters.ts      # 7. cover art                 ~10 min, network only
```

npm aliases exist for each: `npm run fetch`, `transcript`, `target`, `whisper`,
`extract`, `enrich`.

**Re-running any step is safe** — each skips work already done, so you can stop and
resume freely. Episodes that cannot be processed are recorded in
`work/*-failures.json` and the run carries on.

| If you want to… | Do this |
| --- | --- |
| Try it on 3 episodes first | `node src/steps/01-fetch.ts 3`, then the rest unchanged |
| Run Whisper at full speed | `node src/steps/03b-whisper.ts --full-speed` |
| Retry what failed | just re-run the step |
| Re-time clips after changing the rule | `node src/steps/04-extract.ts --replace` — no model call |
| Work offline, without Claude | add `--backend ollama` to steps 5 and 6 |

### Why each step exists

**Targeting before transcribing.** The recommendations come at the end, announced by a
ritual phrase. A regex over the last 40% of the YouTube captions finds it in 84 of 91
episodes, which cuts what has to be transcribed to about 15 minutes per episode
instead of 90.

**Whisper over YouTube captions.** The automatic captions mangle exactly what we are
extracting: "Nathan Fedler" for Nathan Fielder, "Can Folet" for Ken Follett. Whisper
gets them right, and only the targeted section is re-transcribed — 8 MB downloaded per
episode instead of 70.

**Two models, two jobs.** A local model (Ollama) can extract, but does not know the
cultural catalogue and invents titles confidently — so on that path the pipeline
searches Wikipedia first and only asks it to *choose* among real candidates. Claude
Code, on a personal subscription, knows the catalogue and can check a link before
claiming one, so it is asked directly. qwen3:14b is the best local option that fits in
16 GB; qwen3:8b misses too much, and a 20B model swaps and takes ten times longer.

**Every link is verified.** A model asked for a canonical URL guesses the slug and is
wrong about a third of the time. Each link is fetched before publishing and demoted to
a search URL when it 404s.

## Contributing a correction

The catalogue is machine-made and wrong in places. Corrections go in
**[`data/overrides.json`](data/overrides.json)**, keyed by recommendation id:

```json
{
  "-lc9eAEFlUk-01": {
    "recommendedBy": "Orelsan",
    "attributionCued": true,
    "note": "the name was not spoken, the pipeline guessed"
  }
}
```

Only list the fields you are correcting. **The pipeline never writes this file**, so
edits survive every re-run — unlike edits to `recommendations.json`, which is rebuilt
from scratch whenever an episode is added. Open a pull request and the site rebuilds
itself once it is merged.

The two things most worth correcting:

- **Who recommended it.** Whisper emits no speaker labels, so 81% of attributions are
  the model's inference from the flow of conversation. Those are shown as
  "probablement X" rather than stated as fact.
- **What the work actually is.** 290 entries have no reference page — mostly shows,
  YouTube channels and music, for which no public API has a record. A listener knows
  them; no amount of model quality will.

## Deployment

Pushing to `main` builds and publishes automatically
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). The build needs no
secret: it reads `data/` out of the repository. Enable it once under
**Settings → Pages → Source: GitHub Actions**.

## Requirements

```bash
brew install yt-dlp ffmpeg whisper-cpp
mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

Node 22+ runs the pipeline directly — it executes `.ts` files natively, so there is no
build step and no runtime dependency. Tested on Node 26.

Optional: `brew install ollama && ollama pull qwen3:14b` for the offline backend, and a
TMDB read token in `.env.local` as `TMDB_READ_TOKEN` for film and series artwork
(never committed; the published site only sees the resulting URLs).

## Layout

```text
src/types.ts    domain types — the contract between pipeline and site
src/lib/        subprocess, HTTP cache, quote location, catalogue lookups
src/backends/   claude-code and ollama, behind one interface
src/steps/      the pipeline, one file per step
app/            routes: the feed, /reco/<id>, /invite/<name>
ui/             components and data access shared by the routes
data/           published catalogue + human corrections
work/           intermediates — not versioned, regenerable
```

Design decisions that are not obvious are documented where they bite, in the file that
depends on them, rather than in a separate document.

## Where it stands

The pipeline is done and the site works. What is weak, honestly:

- **37% of entries have a verified reference page.** Half the catalogue is music,
  shows and YouTube channels, for which no public API has a record. This is
  structural, not a tuning problem — no model fixes it.
- **81% of attributions are inferred**, because the transcript carries no speaker
  labels. Roughly one in four of those is probably wrong.
- **No Open Graph tags**, so a shared link shows no preview.

## A note on rights

This republishes short quotes — about 125 characters each — plus links and timecodes,
and points back to the original videos. Full transcripts are deliberately not
published: they stay in `work/`, which is not versioned. The intent is to send people
to the show, not to substitute for it.
