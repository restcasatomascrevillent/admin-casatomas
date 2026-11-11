import { describe, expect, it } from "vitest";
import { etiquetaDiaReservas, sumarDias, turnoPorDefecto } from "@/lib/reservas/vistaHoy";

// Reservas con días y turno automático (11/11/2026, petición del dueño).
describe("Reservas: días y turno por defecto", () => {
  it("sale «Comida» y desde las 18:00 «Cena»", () => {
    expect(turnoPorDefecto(new Date(2026, 10, 11, 12, 0))).toBe("comida");
    expect(turnoPorDefecto(new Date(2026, 10, 11, 17, 59))).toBe("comida");
    expect(turnoPorDefecto(new Date(2026, 10, 11, 18, 0))).toBe("cena");
  });

  it("pasa días también entre meses", () => {
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-12-01", -1)).toBe("2026-11-30");
  });

  it("dice Hoy, Mañana o Ayer junto a la fecha", () => {
    expect(etiquetaDiaReservas("2026-11-11", "2026-11-11")).toMatch(/^Hoy · miércoles 11 nov/);
    expect(etiquetaDiaReservas("2026-11-12", "2026-11-11")).toMatch(/^Mañana · jueves 12/);
    expect(etiquetaDiaReservas("2026-11-10", "2026-11-11")).toMatch(/^Ayer · martes 10/);
    expect(etiquetaDiaReservas("2026-11-14", "2026-11-11")).toMatch(/^Sábado 14/);
  });
});
