// Offline convergence check for the JS solver against the exported model.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSolver, decodeModel } from "../lib/solver.js";

const dir = fileURLToPath(new URL("../public/model/", import.meta.url));
const { d } = JSON.parse(readFileSync(dir + "meta.json", "utf8"));
const { words, vecs } = decodeModel(
  readFileSync(dir + "words.txt", "utf8"),
  new Int8Array(readFileSync(dir + "vecs.i8").buffer),
  new Float32Array(readFileSync(dir + "scales.f32").buffer),
  d,
);

const cosine = (a, b) => {
  let s = 0;
  for (let k = 0; k < d; k++) s += vecs[a * d + k] * vecs[b * d + k];
  return s;
};

for (const target of ["fromage", "montagne", "colère", "vitesse", "bateau"]) {
  const s = createSolver(words, vecs, d);
  const t = words.indexOf(target);
  let found = null;
  for (let i = 1; i <= 60 && !found; i++) {
    const g = s.suggest();
    if (g === target) found = i;
    else s.record(g, cosine(words.indexOf(g), t) * 100);
  }
  if (!found) throw new Error(`${target} not found in 60 guesses`);
  console.log(`  ${target} found in ${found} guesses`);
}
console.log("selftest OK");
