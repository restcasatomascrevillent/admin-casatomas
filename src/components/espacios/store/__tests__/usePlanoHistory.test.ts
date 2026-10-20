import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlanoHistory, type PlanoSnapshot } from "../usePlanoHistory";

function snap(elementosIds: string[]): PlanoSnapshot {
  return { elementos: elementosIds.map((id) => ({ id })), mesasCanvas: [] };
}

describe("usePlanoHistory", () => {
  it("empieza con el snapshot inicial y sin poder deshacer/rehacer", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["a"])));
    expect(result.current.present).toEqual(snap(["a"]));
    expect(result.current.puedeDeshacer).toBe(false);
    expect(result.current.puedeRehacer).toBe(false);
  });

  it("commit habilita deshacer y actualiza present", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["a"])));
    act(() => result.current.commit(snap(["a", "b"])));
    expect(result.current.present).toEqual(snap(["a", "b"]));
    expect(result.current.puedeDeshacer).toBe(true);
    expect(result.current.puedeRehacer).toBe(false);
  });

  it("undo restaura el snapshot anterior y habilita redo", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["a"])));
    act(() => result.current.commit(snap(["a", "b"])));
    act(() => result.current.undo());
    expect(result.current.present).toEqual(snap(["a"]));
    expect(result.current.puedeDeshacer).toBe(false);
    expect(result.current.puedeRehacer).toBe(true);
  });

  it("redo tras undo vuelve a dejar el mismo snapshot", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["a"])));
    act(() => result.current.commit(snap(["a", "b"])));
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.present).toEqual(snap(["a", "b"]));
    expect(result.current.puedeRehacer).toBe(false);
  });

  it("reset sustituye el snapshot sin dejarlo deshacible", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["a"])));
    act(() => result.current.commit(snap(["a", "b"])));
    act(() => result.current.reset(snap(["cargado-de-bd"])));
    expect(result.current.present).toEqual(snap(["cargado-de-bd"]));
    expect(result.current.puedeDeshacer).toBe(false);
    expect(result.current.puedeRehacer).toBe(false);
  });

  it("respeta el limite de historial pasado como segundo argumento", () => {
    const { result } = renderHook(() => usePlanoHistory(snap(["0"]), 2));
    act(() => result.current.commit(snap(["1"])));
    act(() => result.current.commit(snap(["2"])));
    act(() => result.current.commit(snap(["3"])));
    // limit=2: solo se puede deshacer 2 veces.
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.puedeDeshacer).toBe(false);
    expect(result.current.present).toEqual(snap(["1"]));
  });
});
