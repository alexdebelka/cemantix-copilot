# Cemantix co-pilot

Suggests French words for [Cemantix](https://cemantix.certitudes.org/); you type them
into the game yourself and feed the score back. Never contacts the site.

```sh
# one-time: download the frWac word2vec model (240 MB)
curl -L -o model.bin https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin

# check the algorithm converges (offline simulation)
python3 solver.py --selftest

# play
python3 solver.py
```

During play, for each suggested word enter the temperature the game shows
(e.g. `23.56`), or:

- `x` — the game rejected the word
- `w <word> <score>` — record a guess you tried yourself
- `top` — best guesses so far
- `q` — quit (progress auto-saves per day to `session.json`)

How it works: the game's temperature is `100 × cosine(guess, secret)` in frWac
word2vec space. Each scored guess constrains where the secret can be; the solver
ranks the whole vocabulary by least-squares fit to all constraints and proposes
the best-fitting untried word.
