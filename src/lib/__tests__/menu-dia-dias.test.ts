// El menú del día solo se sirve de martes a jueves: el panel avisa al guardar
// otro día (QA de salida a producción, 01/11/2026).
import { afterEach, describe, expect, it } from "vitest";
import { diaSemanaDeFecha, seSirveMenuDelDia } from "@/lib/menu-dia";

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  process.env.TZ = TZ_ORIGINAL;
});

// Semana del lunes 2 al domingo 8 de noviembre de 2026.
const SEMANA = [
  ["2026-11-02", 1, false],
  ["2026-11-03", 2, true],
  ["2026-11-04", 3, true],
  ["2026-11-05", 4, true],
  ["2026-11-06", 5, false],
  ["2026-11-07", 6, false],
  ["2026-11-08", 0, false],
] as const;

describe("seSirveMenuDelDia", () => {
  it.each(SEMANA)("%s (día %i) → %s", (fecha, dia, seSirve) => {
    expect(diaSemanaDeFecha(fecha)).toBe(dia);
    expect(seSirveMenuDelDia(fecha)).toBe(seSirve);
  });

  it("no depende de la zona horaria (Europe/Madrid, Pacific/Kiritimati, America/Los_Angeles)", () => {
    for (const tz of ["Europe/Madrid", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      for (const [fecha, dia] of SEMANA) expect(diaSemanaDeFecha(fecha)).toBe(dia);
    }
    // Cambio de hora en Madrid (25/10/2026, domingo; 29/03/2026, domingo).
    expect(diaSemanaDeFecha("2026-10-25")).toBe(0);
    expect(diaSemanaDeFecha("2026-03-29")).toBe(0);
  });

  it("una fecha vacía o no válida no avisa", () => {
    expect(diaSemanaDeFecha("")).toBeNull();
    expect(diaSemanaDeFecha("2026-02-30")).toBeNull();
    expect(seSirveMenuDelDia("")).toBe(true);
    expect(seSirveMenuDelDia("no es fecha")).toBe(true);
  });
});
