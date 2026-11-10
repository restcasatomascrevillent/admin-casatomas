import { describe, it, expect } from "vitest";
import { turnoYaCerrado } from "../vistaHoy";

describe("turnoYaCerrado", () => {
  const a = (h: number, m = 0) => new Date(2026, 10, 10, h, m);
  it("la comida se cierra cuando empieza la cena; la cena nunca en el día", () => {
    expect(turnoYaCerrado("comida", a(14, 30))).toBe(false);
    expect(turnoYaCerrado("comida", a(21))).toBe(true);
    expect(turnoYaCerrado("cena", a(13))).toBe(false);
    expect(turnoYaCerrado("cena", a(23, 30))).toBe(false);
  });
});
