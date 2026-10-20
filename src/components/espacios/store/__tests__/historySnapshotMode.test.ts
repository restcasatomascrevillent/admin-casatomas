import { describe, it, expect } from "vitest";
import { decidirModoSnapshot } from "../historySnapshotMode";

const base = {
  isHydrating: false,
  suppressed: false,
  isApplyingHistory: false,
  modoSolicitado: "commit" as const,
};

describe("decidirModoSnapshot", () => {
  it("commitea en el caso normal (usuario edita, nada suprimido)", () => {
    expect(decidirModoSnapshot(base)).toBe("commit");
  });

  it("resetea cuando el llamador lo pidió explícitamente (acción no deshacible)", () => {
    expect(decidirModoSnapshot({ ...base, modoSolicitado: "reset" })).toBe("reset");
  });

  it("ignora durante la hidratación inicial, aunque se pidiera reset", () => {
    expect(decidirModoSnapshot({ ...base, isHydrating: true })).toBe("skip");
    expect(decidirModoSnapshot({ ...base, isHydrating: true, modoSolicitado: "reset" })).toBe("skip");
  });

  it("ignora mientras el guardado está en curso (handleSave)", () => {
    expect(decidirModoSnapshot({ ...base, suppressed: true })).toBe("skip");
  });

  it("ignora el cambio de estado que es la propia aplicación de un undo/redo", () => {
    expect(decidirModoSnapshot({ ...base, isApplyingHistory: true })).toBe("skip");
    expect(decidirModoSnapshot({ ...base, isApplyingHistory: true, modoSolicitado: "reset" })).toBe("skip");
  });

  it("hidratación y guardado tienen prioridad sobre cualquier combinación", () => {
    expect(
      decidirModoSnapshot({
        isHydrating: true,
        suppressed: true,
        isApplyingHistory: true,
        modoSolicitado: "reset",
      })
    ).toBe("skip");
  });
});
