// Cemantix co-pilot solver. Pure JS so `node scripts/selftest.mjs` can run it.
//
// Each scored guess gives cos(secret, guess) up to the game's calibration.
// Candidates are ranked by Pearson correlation between their cosine profile
// over the guessed words and the observed scores — robust to the game using
// a slightly different embedding model than ours.

export const SEEDS = [
  "vie", "temps", "monde", "eau", "maison", "animal", "musique",
  "guerre", "science", "amour", "travail", "nature",
  "idée", "force", "argent", "corps", "terre", "ville",
  "enfant", "histoire", "machine", "couleur", "voyage", "loi",
];

const SUGGEST_CAP = 20000; // vocab is frequency-sorted; only suggest common words
const POOL = 2000; // candidates must be magnitude-plausible (top by covariance)
const WARM = 15; // keep seeding diverse regions until something scores this hot

export function createSolver(words, vecs, d) {
  const n = words.length;
  const index = new Map(words.map((w, i) => [w, i]));
  const cols = []; // one Float32Array(n) of cosines per in-vocab scored guess
  const colScores = [];
  const scored = new Map(); // word -> score, insertion-ordered
  const dead = new Set();

  function cosineColumn(i) {
    const col = new Float32Array(n);
    const base = i * d;
    for (let j = 0; j < n; j++) {
      let s = 0;
      const bj = j * d;
      for (let k = 0; k < d; k++) s += vecs[bj + k] * vecs[base + k];
      col[j] = s;
    }
    return col;
  }

  return {
    words,
    has: (w) => index.has(w),
    scores: scored,
    dead,

    record(word, score) {
      if (scored.has(word)) return;
      scored.set(word, score);
      const i = index.get(word);
      if (i !== undefined) {
        cols.push(cosineColumn(i));
        colScores.push(score);
      }
    },

    reject(word) {
      dead.add(word);
    },

    suggest() {
      const tried = (w) => scored.has(w) || dead.has(w);
      const bestScore = Math.max(-Infinity, ...scored.values());
      if (cols.length < 4 || bestScore < WARM) {
        // cold: sample diverse regions instead of fitting noise
        for (const s of SEEDS) if (!tried(s) && index.has(s)) return s;
      }
      if (cols.length === 0) {
        for (const w of words) if (!tried(w)) return w;
        return null;
      }
      // Rank by correlation between a candidate's cosine profile over the
      // guessed words and the observed scores, restricted to magnitude-
      // plausible candidates (top covariance) — pure correlation rewards
      // junk words whose profile merely *patterns* right.
      const k = cols.length;
      const cMean = colScores.reduce((a, b) => a + b, 0) / k;
      const cc = colScores.map((s) => s - cMean);
      const ccNorm = Math.hypot(...cc) + 1e-9;
      const cov = new Float32Array(n);
      const r = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        let sum = 0;
        let sumSq = 0;
        let num = 0;
        for (let i = 0; i < k; i++) {
          const p = cols[i][j];
          sum += p;
          sumSq += p * p;
          num += p * cc[i]; // Σcc = 0, so centering P is not needed here
        }
        cov[j] = num;
        const pVar = sumSq - (sum * sum) / k;
        r[j] = num / (Math.sqrt(Math.max(pVar, 1e-12)) * ccNorm);
      }
      const covThreshold = [...cov].sort((a, b) => b - a)[Math.min(POOL, n) - 1];
      let best = -1;
      let bestR = -Infinity;
      let fallback = -1;
      let fallbackR = -Infinity;
      for (let j = 0; j < n; j++) {
        if (tried(words[j])) continue;
        if (r[j] > fallbackR) {
          fallbackR = r[j];
          fallback = j;
        }
        if (j < SUGGEST_CAP && cov[j] >= covThreshold && r[j] > bestR) {
          bestR = r[j];
          best = j;
        }
      }
      const pick = best >= 0 ? best : fallback; // pool exhausted -> plain corr
      return pick >= 0 ? words[pick] : null;
    },
  };
}

// Decode the exported model: int8 vectors + per-row scale -> unit Float32 rows.
export function decodeModel(wordsText, vecsI8, scalesF32, d) {
  const words = wordsText.trim().split("\n");
  const n = words.length;
  const vecs = new Float32Array(n * d);
  for (let j = 0; j < n; j++) {
    const scale = scalesF32[j];
    let norm = 0;
    for (let k = 0; k < d; k++) {
      const v = vecsI8[j * d + k] * scale;
      vecs[j * d + k] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < d; k++) vecs[j * d + k] /= norm;
  }
  return { words, vecs };
}
