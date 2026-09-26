import { describe, it, expect } from "vitest";
import {
  historyInitialState,
  historyReducer,
  puedeDeshacer,
  puedeRehacer,
  DEFAULT_HISTORY_LIMIT,
  type HistoryState,
} from "../historyReducer";

describe("historyReducer — estado inicial", () => {
  it("arranca sin pasado ni futuro", () => {
    const state = historyInitialState("a");
    expect(state).toEqual({ past: [], present: "a", future: [] });
    expect(puedeDeshacer(state)).toBe(false);
    expect(puedeRehacer(state)).toBe(false);
  });
});

describe("historyReducer — COMMIT", () => {
  it("empuja el present actual a past y vacia future", () => {
    let state = historyInitialState("a");
    state = historyReducer(state, { type: "COMMIT", payload: "b" });
    expect(state).toEqual({ past: ["a"], present: "b", future: [] });
  });

  it("vacia future al confirmar un cambio nuevo tras un undo", () => {
    let state = historyInitialState("a");
    state = historyReducer(state, { type: "COMMIT", payload: "b" });
    state = historyReducer(state, { type: "UNDO" }); // present=a, future=[b]
    state = historyReducer(state, { type: "COMMIT", payload: "c" });
    expect(state).toEqual({ past: ["a"], present: "c", future: [] });
  });

  it("recorta past al limite indicado (descartando lo mas antiguo)", () => {
    let state: HistoryState<number> = historyInitialState(0);
    for (let i = 1; i <= 5; i++) {
      state = historyReducer(state, { type: "COMMIT", payload: i, limit: 3 });
    }
    // Tras confirmar 1,2,3,4,5 con limit=3: past solo guarda los 3 mas recientes antes del present actual (5).
    expect(state.present).toBe(5);
    expect(state.past).toEqual([2, 3, 4]);
  });

  it("usa DEFAULT_HISTORY_LIMIT (50) cuando no se pasa limit", () => {
    let state: HistoryState<number> = historyInitialState(0);
    for (let i = 1; i <= 60; i++) {
      state = historyReducer(state, { type: "COMMIT", payload: i });
    }
    expect(state.past).toHaveLength(DEFAULT_HISTORY_LIMIT);
    expect(state.past[0]).toBe(10); // se descartaron 0..9 (60 commits - 50 = 10 descartados)
    expect(state.present).toBe(60);
  });
});

describe("historyReducer — UNDO/REDO", () => {
  it("undo mueve present a future y restaura el ultimo past", () => {
    let state = historyInitialState("a");
    state = historyReducer(state, { type: "COMMIT", payload: "b" });
    state = historyReducer(state, { type: "COMMIT", payload: "c" });
    state = historyReducer(state, { type: "UNDO" });
    expect(state).toEqual({ past: ["a"], present: "b", future: ["c"] });
  });

  it("redo deshace el undo exactamente", () => {
    let state = historyInitialState("a");
    state = historyReducer(state, { type: "COMMIT", payload: "b" });
    state = historyReducer(state, { type: "COMMIT", payload: "c" });
    const trasCommits = state;
    state = historyReducer(state, { type: "UNDO" });
    state = historyReducer(state, { type: "REDO" });
    expect(state).toEqual(trasCommits);
  });

  it("undo es no-op si no hay pasado", () => {
    const state = historyInitialState("a");
    expect(historyReducer(state, { type: "UNDO" })).toBe(state);
  });

  it("redo es no-op si no hay futuro", () => {
    const state = historyInitialState("a");
    expect(historyReducer(state, { type: "REDO" })).toBe(state);
  });

  it("encadena varios undo/redo consecutivos", () => {
    let state = historyInitialState(0);
    [1, 2, 3, 4].forEach((n) => {
      state = historyReducer(state, { type: "COMMIT", payload: n });
    });
    // present=4, past=[0,1,2,3]
    state = historyReducer(state, { type: "UNDO" }); // present=3
    state = historyReducer(state, { type: "UNDO" }); // present=2
    expect(state.present).toBe(2);
    expect(puedeDeshacer(state)).toBe(true);
    expect(puedeRehacer(state)).toBe(true);
    state = historyReducer(state, { type: "REDO" }); // present=3
    state = historyReducer(state, { type: "REDO" }); // present=4
    expect(state.present).toBe(4);
    expect(puedeRehacer(state)).toBe(false);
  });
});

describe("historyReducer — RESET", () => {
  it("sustituye present sin dejar rastro en el historial (carga inicial no es deshacible)", () => {
    let state = historyInitialState("a");
    state = historyReducer(state, { type: "COMMIT", payload: "b" });
    state = historyReducer(state, { type: "RESET", payload: "cargado-de-bd" });
    expect(state).toEqual({ past: [], present: "cargado-de-bd", future: [] });
    expect(puedeDeshacer(state)).toBe(false);
    expect(puedeRehacer(state)).toBe(false);
  });
});
