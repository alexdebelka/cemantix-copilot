"use client";

import { useEffect, useRef, useState } from "react";
import { createSolver, decodeModel, SUGGEST_CAP, type Solver } from "@/lib/solver";

const STORAGE_KEY = "cemantix-copilote";

// Thermal scale: score -100 (glacial) -> 100 (brûlant).
const STOPS: [number, [number, number, number]][] = [
  [-100, [47, 74, 115]],
  [0, [90, 116, 143]],
  [25, [193, 138, 46]],
  [60, [210, 98, 42]],
  [100, [192, 57, 43]],
];

function heat(score: number): string {
  score = Math.max(-100, Math.min(100, score));
  let [s0, c0] = STOPS[0];
  for (const [s1, c1] of STOPS.slice(1)) {
    if (score <= s1) {
      const t = (score - s0) / (s1 - s0);
      const mix = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
      return `rgb(${mix.join(",")})`;
    }
    [s0, c0] = [s1, c1];
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(",")})`;
}

const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const fmt = (s: number) =>
  s.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// NFC so macOS decomposed accents still match the vocab (mirrors the CLI)
const norm = (s: string) => s.trim().toLowerCase().normalize("NFC");

type Saved = { day: string; entries: [string, number][]; dead: string[] };
type Model = { words: string[]; vecs: Float32Array; d: number };

// day is fixed when the session starts: entries scored before midnight must
// not be restamped onto the next day's puzzle
function save(day: string, entries: [string, number][], dead: string[]) {
  const data: Saved = { day, entries, dead };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export default function Home() {
  const solverRef = useRef<Solver | null>(null);
  const modelRef = useRef<Model | null>(null);
  const indexRef = useRef<Map<string, number>>(new Map());
  const dayRef = useRef(today());
  const [phase, setPhase] = useState<"loading" | "ready" | "won" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [entries, setEntries] = useState<[string, number][]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualWord, setManualWord] = useState("");
  const [manualScore, setManualScore] = useState("");
  const [practice, setPractice] = useState<number | null>(null); // secret index
  const [setup, setSetup] = useState(false); // choosing a practice secret
  const [auto, setAuto] = useState(false); // practice: let the co-pilot play alone
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, wordsText, scalesBuf] = await Promise.all([
          fetch("model/meta.json").then((r) => r.json()),
          fetch("model/words.txt").then((r) => r.text()),
          fetch("model/scales.f32").then((r) => r.arrayBuffer()),
        ]);
        const res = await fetch("model/vecs.i8");
        // content-length may be the compressed size — collect chunks, don't
        // trust it for allocation
        const total = Number(res.headers.get("content-length")) || meta.n * meta.d;
        const reader = res.body!.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          setProgress(Math.min(got / total, 1));
        }
        const bytes = new Uint8Array(got);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
        if (cancelled) return;
        const { words, vecs } = decodeModel(
          wordsText,
          new Int8Array(bytes.buffer),
          new Float32Array(scalesBuf),
          meta.d,
        );
        modelRef.current = { words, vecs, d: meta.d };
        indexRef.current = new Map(words.map((w, i) => [w, i]));
        const solver = createSolver(words, vecs, meta.d);
        solverRef.current = solver;

        dayRef.current = today(); // download may have crossed midnight
        const raw = localStorage.getItem(STORAGE_KEY);
        const saved: Saved | null = raw ? JSON.parse(raw) : null;
        const restored: [string, number][] = [];
        if (saved && saved.day === today()) {
          for (const [w, s] of saved.entries) {
            solver.record(w, s);
            restored.push([w, s]);
          }
          for (const w of saved.dead) solver.reject(w);
        }
        setEntries(restored);
        const done = restored.find(([, s]) => s >= 100);
        if (done) {
          setSuggestion(done[0]);
          setPhase("won");
        } else {
          setSuggestion(solver.suggest());
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const best = entries.reduce((m, [, s]) => Math.max(m, s), -Infinity);
  const wordColor = Number.isFinite(best) ? heat(best) : "var(--ink)";

  function cosine(i: number, j: number) {
    const { vecs, d } = modelRef.current!;
    let s = 0;
    for (let k = 0; k < d; k++) s += vecs[i * d + k] * vecs[j * d + k];
    return s;
  }

  function practiceScore(word: string, secret: number): number | null {
    const i = indexRef.current.get(word);
    if (i === undefined) return null;
    if (i === secret) return 100;
    // two decimals, like the real game displays — no extra precision leaks in
    return Math.round(cosine(i, secret) * 10000) / 100;
  }

  function commit(word: string, score: number) {
    const solver = solverRef.current!;
    solver.record(word, score);
    // re-entering a word corrects its score instead of duplicating the row
    const next: [string, number][] = entries.some(([w]) => w === word)
      ? entries.map(([w, s]): [string, number] => (w === word ? [w, score] : [w, s]))
      : [...entries, [word, score]];
    setEntries(next);
    if (practice === null) save(dayRef.current, next, [...solver.dead]);
    if (score >= 100) {
      setSuggestion(word);
      setPhase("won");
    } else {
      setSuggestion(solver.suggest());
    }
  }

  function playSuggestion() {
    if (practice === null || !suggestion) return;
    const s = practiceScore(suggestion, practice);
    if (s !== null) commit(suggestion, s);
  }

  // Practice auto-play (opt-in): the co-pilot scores its own suggestion
  // against the hidden word, exactly as the real game would.
  useEffect(() => {
    if (practice === null || phase !== "ready" || !auto || !suggestion) return;
    const t = setTimeout(() => {
      const s = practiceScore(suggestion, practice);
      if (s !== null) commit(suggestion, s);
      else solverRef.current!.reject(suggestion);
    }, 650);
    return () => clearTimeout(t);
    // deps: typing in the input must not reset the timer; entries keeps the
    // commit closure fresh even if the same suggestion comes back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice, phase, auto, suggestion, entries]);

  function startPractice(chosen?: string) {
    const m = modelRef.current!;
    let secret: number;
    if (chosen) {
      const i = indexRef.current.get(chosen);
      if (i === undefined) {
        setNotice("mot inconnu du modèle");
        return;
      }
      if (i >= SUGGEST_CAP) {
        // the co-pilot only proposes common words — a rarer secret would
        // make the hunt unwinnable, which misrepresents the algorithm
        setNotice("mot trop rare — le co-pilote ne propose que des mots courants");
        return;
      }
      secret = i;
    } else {
      // common-ish words only; length >= 4 skips web-crawl junk like "kw"
      do {
        secret = 1000 + Math.floor(Math.random() * 9000);
      } while (m.words[secret].length < 4);
    }
    const solver = createSolver(m.words, m.vecs, m.d);
    solverRef.current = solver;
    setPractice(secret);
    setSetup(false);
    setAuto(!!chosen); // you know your own secret — watch the hunt
    setEntries([]);
    setInput("");
    setNotice(null);
    setManualOpen(false);
    setSuggestion(solver.suggest());
    setPhase("ready");
  }

  function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    startPractice(norm(input) || undefined);
  }

  function exitPractice() {
    if (practice !== null && phase !== "won") {
      alert(`Le mot secret était « ${modelRef.current!.words[practice]} »`);
    }
    location.reload(); // restores today's real session from localStorage
  }

  function submitScore(e: React.FormEvent) {
    e.preventDefault();
    if (practice !== null) {
      // your word if you typed one, otherwise play the suggestion
      const word = norm(input);
      if (!word) {
        playSuggestion();
        return;
      }
      const s = practiceScore(word, practice);
      if (s === null) setNotice("mot inconnu du modèle");
      else {
        setNotice(null);
        setInput("");
        commit(word, s);
      }
      return;
    }
    const score = parseFloat(input.replace(",", "."));
    if (!suggestion || Number.isNaN(score)) return;
    if (score < -100 || score > 100) {
      setNotice("température entre -100 et 100");
      return;
    }
    setNotice(null);
    setInput("");
    commit(suggestion, score);
  }

  function rejectWord() {
    const solver = solverRef.current!;
    if (!suggestion || practice !== null) return; // never persist practice state
    solver.reject(suggestion);
    save(dayRef.current, entries, [...solver.dead]);
    setSuggestion(solver.suggest());
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const word = norm(manualWord);
    const score = parseFloat(manualScore.replace(",", "."));
    if (!word || Number.isNaN(score)) return;
    if (score < -100 || score > 100) {
      setNotice("température entre -100 et 100");
      return;
    }
    setNotice(null);
    setManualWord("");
    setManualScore("");
    setManualOpen(false);
    commit(word, score);
  }

  function restart() {
    if (!confirm("Effacer la partie en cours ?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  const sorted = [...entries].sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      <header className="header">
        <span className="mono">
          cémantix · co-pilote{practice !== null && " · entraînement"}
        </span>
        <span className="mono">
          {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
        </span>
      </header>

      {phase === "loading" && (
        <div className="loading">
          <span className="mono">chargement du modèle · 25 Mo</span>
          <div className="progressTrack">
            <div className="progressFill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="loading">
          <span className="mono">le modèle n’a pas pu être chargé — rechargez la page</span>
        </div>
      )}

      {setup && phase !== "loading" && (
        <section className="hero">
          <span className="mono">entraînement</span>
          <h1 className="word">?</h1>
          <form className="scoreForm" onSubmit={submitSetup}>
            <input
              className="scoreInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="mot secret (vide = aléatoire)"
              aria-label="Mot secret que le co-pilote devra deviner"
              style={{ width: "16rem" }}
              autoFocus
            />
          </form>
          {notice && <p className="mono notice">{notice}</p>}
          <div className="actions">
            <button onClick={() => { setSetup(false); setInput(""); setNotice(null); }}>
              annuler
            </button>
          </div>
        </section>
      )}

      {!setup && (phase === "ready" || phase === "won") && (
        <>
          <section className="hero">
            <span className="mono">
              {phase === "won"
                ? `trouvé en ${entries.length} essais`
                : `essai nº ${entries.length + 1}`}
            </span>
            <h1 className="word" key={suggestion} style={{ color: wordColor }}>
              {suggestion}
            </h1>

            {phase === "ready" && (
              <>
                <form className="scoreForm" onSubmit={submitScore}>
                  <input
                    className="scoreInput"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={practice !== null ? "votre mot, ou entrée" : "0,00"}
                    inputMode={practice !== null ? "text" : "decimal"}
                    aria-label={
                      practice !== null
                        ? "Votre mot — ou entrée pour jouer la suggestion"
                        : "Température donnée par le jeu"
                    }
                    style={practice !== null ? { width: "12rem" } : undefined}
                    autoFocus
                  />
                </form>
                {notice && <p className="mono notice">{notice}</p>}
                <div className="actions">
                  {practice === null ? (
                    <>
                      <button onClick={rejectWord}>mot refusé</button>
                      <button onClick={() => setManualOpen(!manualOpen)}>
                        ajouter un mot
                      </button>
                      {entries.length > 0 && <button onClick={restart}>recommencer</button>}
                      <button onClick={() => { setSetup(true); setInput(""); setNotice(null); }}>
                        entraînement
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={playSuggestion}>jouer la suggestion</button>
                      <button onClick={() => setAuto(!auto)}>
                        {auto ? "pause" : "laisser jouer"}
                      </button>
                      <button onClick={exitPractice}>arrêter l’entraînement</button>
                    </>
                  )}
                </div>
                {manualOpen && practice === null && (
                  <form className="manualForm" onSubmit={submitManual}>
                    <input
                      value={manualWord}
                      onChange={(e) => setManualWord(e.target.value)}
                      placeholder="mot"
                      aria-label="Mot essayé"
                      autoFocus
                    />
                    <input
                      value={manualScore}
                      onChange={(e) => setManualScore(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      aria-label="Température"
                      style={{ width: "4.5rem" }}
                    />
                    <button type="submit">ok</button>
                  </form>
                )}
              </>
            )}
            {phase === "won" && (
              <div className="actions">
                {practice !== null ? (
                  <>
                    <button onClick={() => { setSetup(true); setInput(""); setNotice(null); }}>
                      rejouer l’entraînement
                    </button>
                    <button onClick={exitPractice}>retour au jeu du jour</button>
                  </>
                ) : (
                  <>
                    <button onClick={restart}>recommencer</button>
                    <button onClick={() => { setSetup(true); setInput(""); setNotice(null); }}>
                      entraînement
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          {sorted.length > 0 && (
            <ol className="list">
              {sorted.map(([w, s]) => (
                <li className="row" key={w}>
                  <div className="rowLine">
                    <span className="guessWord">{w}</span>
                    <span className="leader" />
                    <span className="temp" style={{ color: heat(s) }}>
                      {fmt(s)}°C
                    </span>
                  </div>
                  <div
                    className="bar"
                    style={{
                      width: `${Math.max(Math.min(s, 100), 1)}%`,
                      background: heat(s),
                    }}
                  />
                </li>
              ))}
            </ol>
          )}

          <details className="about">
            <summary className="mono">comment ça marche</summary>
            <p>
              Cémantix note chaque mot par sa proximité de sens avec le mot secret :
              la température est <em>100 × cosinus</em> entre vecteurs word2vec —
              et ce co-pilote embarque précisément le même modèle que le jeu
              (frWac, vérifié au centième de degré près).
            </p>
            <p>
              Chaque score que vous rapportez est donc une contrainte exacte sur la
              position du mot secret. Le co-pilote classe 50 000 mots courants par
              corrélation entre leur profil de similarité et vos scores, puis propose
              le meilleur candidat — en général 5 à 15 essais suffisent.
            </p>
            <p>
              Le mode <em>entraînement</em> joue en local, noté comme dans le
              vrai jeu : donnez votre propre mot secret et regardez le co-pilote
              le traquer, ou laissez-le en tirer un au hasard et devinez
              vous-même — entrée joue la suggestion, « laisser jouer » l’automatise.
              Tout se passe dans votre navigateur : aucune requête n’est envoyée
              au site du jeu.
            </p>
          </details>
        </>
      )}

      <footer className="footer">
        <span className="mono">
          les calculs restent dans votre navigateur ·{" "}
          <a href="https://cemantix.certitudes.org/" target="_blank" rel="noreferrer">
            jouer sur cémantix
          </a>
        </span>
      </footer>
    </div>
  );
}
