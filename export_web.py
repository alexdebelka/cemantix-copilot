#!/usr/bin/env python3
"""Export a compressed model for the web UI: top-N words, int8-quantized.

Writes web/public/model/{words.txt,vecs.i8,meta.json} and validates that the
compressed model still converges when scores come from the full-precision model.
"""
import json
from pathlib import Path

import numpy as np

from solver import Solver, load_model

N, D = 50_000, 500
OUT = Path(__file__).parent / "web" / "public" / "model"


def compress(vecs):
    X = vecs[:N]
    scale = np.abs(X).max(axis=1, keepdims=True) / 127
    q = np.clip(np.round(X / scale), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def dequant(q, scale):
    Y = q.astype(np.float32) * scale
    return Y / np.linalg.norm(Y, axis=1, keepdims=True)


def validate(words, vecs, small):
    """Game answers with full-model cosines; solver ranks with compressed ones."""
    for target in ["fromage", "montagne", "colère", "vitesse", "sagesse", "bateau"]:
        s = Solver(words[:N], small)
        tvec = vecs[words.index(target)]
        for n in range(1, 301):
            g = s.suggest()
            assert g, "ran out of suggestions"
            if g == target:
                print(f"  {target!r} found in {n} guesses")
                break
            s.record(g, float(vecs[words.index(g)] @ tvec) * 100)
        else:
            raise AssertionError(f"{target!r} not found in 300 guesses")


if __name__ == "__main__":
    words, vecs = load_model()
    q, scale = compress(vecs)
    validate(words, vecs, dequant(q, scale))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "words.txt").write_text("\n".join(words[:N]), encoding="utf-8")
    (OUT / "vecs.i8").write_bytes(q.tobytes())
    (OUT / "scales.f32").write_bytes(scale.tobytes())
    (OUT / "meta.json").write_text(json.dumps({"n": N, "d": D}))
    print(f"exported {N} words x {D} dims -> {OUT} "
          f"({(OUT / 'vecs.i8').stat().st_size / 1e6:.1f} MB vectors)")
