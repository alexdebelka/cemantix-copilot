# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A solver co-pilot for Cémantix (French daily semantic-similarity word game). It only suggests words — the user plays them by hand and reports scores back. It never contacts the game's servers.

The game's temperature is `100 × cosine(guess, secret)` in the `frWac_no_postag_phrase_500_cbow_cut10` word2vec space (verified exact against real scores). The solver ranks candidates by **Pearson correlation** between each candidate's cosine profile over the guessed words and the observed scores — correlation instead of least-squares so it stays robust if the game ever changes models. Candidates are restricted to a magnitude-plausible pool (top-covariance) because pure correlation rewards junk words that merely *pattern* right.

## Two implementations, kept in sync

The same algorithm exists twice — any change to solver logic (seeds, SUGGEST_CAP, POOL, ranking) should be mirrored:

- **`solver.py`** — CLI. Loads full model (100k words) from `model.bin` (2.2 GB, gitignored, see README for download URL), caches parsed vectors in `model_cache.npz`.
- **`web/lib/solver.js`** — pure JS, no framework deps, so `node scripts/selftest.mjs` can run it outside Next.js. Used by the browser UI in `web/app/page.tsx`, which fetches a compressed model (top 50k words, int8-quantized) from `web/public/model/` as static assets.

`export_web.py` produces the compressed browser model from the full one and validates that it still converges when scores come from the full-precision model. Run it after changing compression or vocab filtering; its output in `web/public/model/` is committed.

## Commands

```sh
# Python CLI (needs model.bin or model_cache.npz)
python3 solver.py              # play (session auto-saves per day to session.json)
python3 solver.py --selftest   # offline convergence check
python3 solver.py --practice   # local game clone, identical scoring

# regenerate the browser model after solver/compression changes
python3 export_web.py

# Web app
cd web
npm run dev                    # http://localhost:3000
npm run build
node scripts/selftest.mjs      # offline convergence check of the JS solver
```

There are no test frameworks — the selftests (Python and JS) are the checks: they assert the solver finds known targets within a guess budget. Run the relevant one after touching solver logic.

## Conventions

- Vocab is frequency-sorted; suggestions are capped to common words (`SUGGEST_CAP = 20000`), practice secrets require ≥4 letters — both to skip web-crawl junk tokens the game rejects.
- Practice-mode scores are rounded to 2 decimals to match what the real game shows.
- Web deploy target is Vercel as a pure static site (Root Directory = `web`, no server, no env vars).
