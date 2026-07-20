#!/usr/bin/env python3
"""Cemantix co-pilot: suggests words, you play them by hand and feed back scores.

Never talks to the game site. Usage:
    python3 solver.py            # play (needs model.bin, see README)
    python3 solver.py --selftest # offline convergence check
"""
import json
import random
import sys
import unicodedata
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
MODEL_BIN = HERE / "model.bin"
CACHE = HERE / "model_cache.npz"
SESSION = HERE / "session.json"

SEEDS = ["vie", "temps", "monde", "eau", "maison", "animal", "musique",
         "guerre", "science", "amour", "travail", "nature",
         "idée", "force", "argent", "corps", "terre", "ville",
         "enfant", "histoire", "machine", "couleur", "voyage", "loi"]

# Vocab is frequency-sorted; only suggest common words (rare ones are junk
# the game rejects anyway). Manual `w` guesses may use the full vocab.
SUGGEST_CAP = 20_000
POOL = 2_000     # candidates must be magnitude-plausible (top by covariance)
WARM = 15        # keep seeding diverse regions until something scores this hot


def load_word2vec_bin(path):
    """Parse the classic word2vec binary format with plain numpy."""
    with open(path, "rb") as f:
        n_words, dim = map(int, f.readline().split())
        vecs = np.empty((n_words, dim), dtype=np.float32)
        words = []
        for i in range(n_words):
            chars = bytearray()
            while (b := f.read(1)) not in (b" ", b""):
                if b != b"\n":
                    chars += b
            words.append(chars.decode("utf-8", errors="replace"))
            vecs[i] = np.frombuffer(f.read(4 * dim), dtype=np.float32)
    return words, vecs


def game_word(w):
    """Keep only words plausible in Cemantix: lowercase alphabetic, accents ok."""
    return 2 <= len(w) <= 25 and w.isalpha() and w == w.lower()


def load_model():
    if CACHE.exists():
        data = np.load(CACHE, allow_pickle=False)
        return list(data["words"]), data["vecs"]
    if not MODEL_BIN.exists():
        sys.exit("model.bin missing — run:\n  curl -L -o model.bin "
                 "https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin")
    print("First run: parsing model.bin (takes ~20s, cached afterwards)...")
    words, vecs = load_word2vec_bin(MODEL_BIN)
    keep = [i for i, w in enumerate(words) if game_word(w)]
    words = [words[i] for i in keep]
    vecs = vecs[keep]
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)  # unit vectors: dot = cosine
    np.savez(CACHE, words=np.array(words), vecs=vecs)
    return words, vecs


class Solver:
    def __init__(self, words, vecs):
        self.words = words
        self.vecs = vecs
        self.index = {w: i for i, w in enumerate(words)}
        self.scores = {}   # word -> temperature (100 * cosine with target)
        self.dead = set()  # rejected by the game or not suggestable
        self.seeds = random.sample(SEEDS, len(SEEDS))  # vary runs on restart

    def record(self, word, score):
        self.scores[word] = score

    def suggest(self):
        tried = set(self.scores) | self.dead
        known = [(w, s) for w, s in self.scores.items() if w in self.index]
        best = max(self.scores.values(), default=-1e9)
        if len(known) < 4 or best < WARM:  # cold: sample diverse regions
            for seed in self.seeds:
                if seed not in tried and seed in self.index:
                    return seed
        if not known:
            # ponytail: seeds exhausted with nothing scored — walk the vocab
            return next((w for w in self.words if w not in tried), None)
        # Rank by correlation between a candidate's cosine profile over the
        # guessed words and the observed scores (robust to the game using a
        # different embedding model), but only among magnitude-plausible
        # candidates (top covariance) — pure correlation rewards junk words
        # whose profile merely *patterns* right.
        U = self.vecs[[self.index[w] for w, _ in known]]
        c = np.array([s for _, s in known], dtype=np.float32)
        P = self.vecs @ U.T
        cc = c - c.mean()
        cov = P @ cc
        Pc = P - P.mean(axis=1, keepdims=True)
        r = cov / (np.linalg.norm(Pc, axis=1) * np.linalg.norm(cc) + 1e-9)
        pool = set(np.argsort(-cov)[:POOL])
        order = np.argsort(-r)
        for i in order:
            if i in pool and i < SUGGEST_CAP and self.words[i] not in tried:
                return self.words[i]
        for i in order:  # pool exhausted — fall back to plain correlation
            if self.words[i] not in tried:
                return self.words[i]
        return None

    def top(self, n=10):
        return sorted(self.scores.items(), key=lambda kv: -kv[1])[:n]


def selftest():
    words, vecs = load_model()
    for target in ["fromage", "montagne", "colère", "vitesse"]:
        s = Solver(words, vecs)
        tvec = vecs[s.index[target]]
        for n in range(1, 301):
            guess = s.suggest()
            assert guess, "ran out of suggestions"
            if guess == target:
                print(f"  {target!r} found in {n} guesses")
                break
            s.record(guess, float(vecs[s.index[guess]] @ tvec) * 100)
        else:
            raise AssertionError(f"{target!r} not found in 300 guesses")
    print("selftest OK")


def load_session():
    key = str(date.today())
    if SESSION.exists():
        data = json.loads(SESSION.read_text())
        if data.get("day") == key:
            return data
    return {"day": key, "scores": {}, "dead": []}


def play():
    words, vecs = load_model()
    s = Solver(words, vecs)
    sess = load_session()
    s.scores = sess["scores"]
    s.dead = set(sess["dead"])
    if s.scores:
        print(f"Resuming today's session ({len(s.scores)} guesses so far).")

    def save():
        sess.update(scores=s.scores, dead=sorted(s.dead))
        SESSION.write_text(json.dumps(sess, ensure_ascii=False))

    print("Type the game's score for each suggestion (e.g. 23.56).")
    print("Commands: x = word rejected, w <word> <score> = record manual guess, "
          "top = best so far, q = quit.\n")
    while True:
        guess = s.suggest()
        if guess is None:
            print("Out of candidates — try manual guesses with `w <word> <score>`.")
            guess = ""
        else:
            print(f"try: {guess}")
        raw = input("> ").strip()
        if raw == "q":
            save()
            return
        if raw == "top":
            for w, sc in s.top():
                print(f"  {sc:7.2f}  {w}")
            continue
        if raw == "x":
            s.dead.add(guess)
            save()
            continue
        if raw.startswith("w "):
            try:
                _, word, score = raw.split()
                raw_word, score = word, float(score)
            except ValueError:
                print("usage: w <word> <score>")
                continue
            s.record(unicodedata.normalize("NFC", raw_word), score)
            if guess:
                s.dead.add(guess)  # suggestion shown but user answered something else
            save()
            continue
        try:
            score = float(raw.replace(",", "."))
        except ValueError:
            print("Enter a number, or one of: x, w <word> <score>, top, q.")
            continue
        s.record(guess, score)
        save()
        if score >= 100:
            print(f"\n🎉 Found it: {guess!r} in {len(s.scores)} guesses!")
            return


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        play()
