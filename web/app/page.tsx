"use client";

import { useEffect, useRef, useState } from "react";
import { createSolver, decodeModel, type Solver } from "@/lib/solver";

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

type Saved = { day: string; entries: [string, number][]; dead: string[] };

function save(entries: [string, number][], dead: string[]) {
  const data: Saved = { day: today(), entries, dead };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export default function Home() {
  const solverRef = useRef<Solver | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "won" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [entries, setEntries] = useState<[string, number][]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualWord, setManualWord] = useState("");
  const [manualScore, setManualScore] = useState("");

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
        const total = Number(res.headers.get("content-length")) || meta.n * meta.d;
        const reader = res.body!.getReader();
        const bytes = new Uint8Array(total);
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes.set(value, got);
          got += value.length;
          setProgress(got / total);
        }
        if (cancelled) return;
        const { words, vecs } = decodeModel(
          wordsText,
          new Int8Array(bytes.buffer),
          new Float32Array(scalesBuf),
          meta.d,
        );
        const solver = createSolver(words, vecs, meta.d);
        solverRef.current = solver;

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

  function commit(word: string, score: number) {
    const solver = solverRef.current!;
    solver.record(word, score);
    const next: [string, number][] = [...entries, [word, score]];
    setEntries(next);
    save(next, [...solver.dead]);
    if (score >= 100) {
      setSuggestion(word);
      setPhase("won");
    } else {
      setSuggestion(solver.suggest());
    }
  }

  function submitScore(e: React.FormEvent) {
    e.preventDefault();
    const score = parseFloat(input.replace(",", "."));
    if (!suggestion || Number.isNaN(score)) return;
    setInput("");
    commit(suggestion, score);
  }

  function rejectWord() {
    const solver = solverRef.current!;
    if (!suggestion) return;
    solver.reject(suggestion);
    save(entries, [...solver.dead]);
    setSuggestion(solver.suggest());
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const word = manualWord.trim().toLowerCase();
    const score = parseFloat(manualScore.replace(",", "."));
    if (!word || Number.isNaN(score)) return;
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
        <span className="mono">cémantix · co-pilote</span>
        <span className="mono">
          {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
        </span>
      </header>

      {phase === "loading" && (
        <div className="loading">
          <span className="mono">chargement du modèle · 13 Mo</span>
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

      {(phase === "ready" || phase === "won") && (
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
                    placeholder="0,00"
                    inputMode="decimal"
                    aria-label="Température donnée par le jeu"
                    autoFocus
                  />
                </form>
                <div className="actions">
                  <button onClick={rejectWord}>mot refusé</button>
                  <button onClick={() => setManualOpen(!manualOpen)}>ajouter un mot</button>
                  {entries.length > 0 && <button onClick={restart}>recommencer</button>}
                </div>
                {manualOpen && (
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
                <button onClick={restart}>recommencer</button>
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
