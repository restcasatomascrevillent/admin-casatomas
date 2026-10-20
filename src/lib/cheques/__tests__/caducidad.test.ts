import { describe, expect, it } from "vitest";
import { calcularCaducidad, estadoCaducidad, hoyMadrid } from "../caducidad";

describe("Caducidad por días de calendario en España", () => {
  it("un año conserva el aniversario y ajusta el 29 de febrero", () => {
    expect(calcularCaducidad(12, new Date("2026-10-08T12:00:00Z"))).toBe("2027-10-08");
    expect(calcularCaducidad(12, new Date("2024-02-29T12:00:00Z"))).toBe("2025-02-28");
    expect(calcularCaducidad(1, new Date("2026-01-31T12:00:00Z"))).toBe("2026-02-28");
  });
  it("cambia de día con el horario de Madrid", () => {
    expect(hoyMadrid(new Date("2026-10-08T22:00:00Z"))).toBe("2026-10-09");
    expect(hoyMadrid(new Date("2026-01-08T23:00:00Z"))).toBe("2026-01-09");
  });
  it("permite el último día y caduca al siguiente, sin días negativos", () => {
    expect(estadoCaducidad("2026-10-08", "2026-10-07").texto).toBe("Queda 1 día");
    expect(estadoCaducidad("2026-10-08", "2026-10-08")).toEqual({ caducado: false, dias: 0, texto: "Caduca hoy" });
    expect(estadoCaducidad("2026-10-08", "2026-10-09")).toEqual({ caducado: true, dias: 0, texto: "Caducado" });
    expect(estadoCaducidad("2026-03-30", "2026-03-28").dias).toBe(2);
  });
});
