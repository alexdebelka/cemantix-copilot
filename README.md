# Cémantix co-pilote

A solver co-pilot for [Cémantix](https://cemantix.certitudes.org/), the French
daily word game where guesses are scored by semantic similarity. It suggests
words; **you** type them into the game by hand and report the temperature back.
It never contacts the game's servers — all computation is local.

## How it works

Cémantix's temperature is `100 × cosine(guess, secret)` in a French word2vec
space. Each scored guess is therefore a constraint on where the secret lives.
The solver ranks the whole vocabulary by **Pearson correlation** between each
candidate's cosine profile over the guessed words and the observed scores —
correlation (rather than least-squares fit) makes it robust to the game using
a slightly different embedding model. It typically converges in 5–15 guesses
in simulation.

## Web app (`web/`)

A minimal Next.js interface that runs the solver **entirely in the browser**:
a compressed model (50 000 most common words, PCA to 256 dims, int8 ≈ 13 MB)
is fetched once as a static asset, so the app deploys as a pure static site.

```sh
cd web
npm install
npm run dev              # http://localhost:3000
node scripts/selftest.mjs  # offline convergence check of the JS solver
```

Deploy on Vercel: import the repo, set **Root Directory** to `web`. No server,
no environment variables.

## CLI (`solver.py`)

```sh
# one-time: download the frWac word2vec model (240 MB)
curl -L -o model.bin https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin

python3 solver.py --selftest   # offline convergence check
python3 solver.py              # play
```

For each suggested word, enter the temperature the game shows (e.g. `23.56`), or:

- `x` — the game rejected the word
- `w <word> <score>` — record a guess you tried yourself
- `top` — best guesses so far
- `q` — quit (progress auto-saves per day to `session.json`)

`export_web.py` regenerates the compressed browser model from `model.bin`
(and validates that compression didn't break convergence).

## Credits

Word vectors: [frWac word embeddings](https://fauconnier.github.io/) by
Jean-Philippe Fauconnier (CC-BY). Game: Cémantix by certitudes.org — play it
there, this tool is just a sidekick.
