export const SEEDS: string[];

export interface Solver {
  words: string[];
  has(word: string): boolean;
  scores: Map<string, number>;
  dead: Set<string>;
  record(word: string, score: number): void;
  reject(word: string): void;
  suggest(): string | null;
}

export function createSolver(words: string[], vecs: Float32Array, d: number): Solver;

export function decodeModel(
  wordsText: string,
  vecsI8: Int8Array,
  scalesF32: Float32Array,
  d: number,
): { words: string[]; vecs: Float32Array };
