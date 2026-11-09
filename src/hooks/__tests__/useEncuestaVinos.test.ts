import { describe, expect, it } from "vitest";
import { fechaCorta, hoyEnMadrid, participantesCsv, recuentoPorVino, sortearGanador, validarPremioFecha, type VotoVino } from "@/hooks/useEncuestaVinos";

const voto = (nombre: string, vino: string, extra: Partial<VotoVino> = {}): VotoVino => ({
  id: nombre, vino_id: vino, vino_nombre: vino, nombre, contacto: `${nombre}@x.es`, idioma: "es",
  created_at: "2026-11-04T10:00:00Z", ...extra,
});

describe("votación del vino favorito (panel)", () => {
  it("cuenta los votos por vino, de más a menos", () => {
    const votos = [voto("a", "Mauro"), voto("b", "Alión"), voto("c", "Mauro"), voto("d", "Clio")];
    expect(recuentoPorVino(votos)).toEqual([
      { vino: "Mauro", votos: 2 },
      { vino: "Alión", votos: 1 },
      { vino: "Clio", votos: 1 },
    ]);
  });
  it("sortea entre todos los participantes", () => {
    const votos = [voto("a", "Mauro"), voto("b", "Alión"), voto("c", "Clio")];
    expect(sortearGanador(votos, () => 0)).toBe(votos[0]);
    expect(sortearGanador(votos, () => 0.5)).toBe(votos[1]);
    expect(sortearGanador(votos, () => 0.9999)).toBe(votos[2]);
    expect(sortearGanador([], () => 0.5)).toBeNull();
  });
  it("la lista CSV escapa comillas y lleva cabecera", () => {
    const csv = participantesCsv([voto('Ana "la de Elche"', "Mauro")]);
    const [cabecera, fila] = csv.split("\n");
    expect(cabecera).toBe("Fecha;Nombre;Contacto;Vino;Idioma");
    expect(fila).toContain('"Ana ""la de Elche"""');
    expect(fila).toContain('"Mauro"');
  });
  it("hoy se cuenta en hora de Madrid, no en UTC", () => {
    // 23:30 UTC del 30/06 ya es 01:30 del 1/07 en Madrid (verano); en invierno, 00:30 del 1/01.
    expect(hoyEnMadrid(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(hoyEnMadrid(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(hoyEnMadrid(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
  });
  it("da formato dd/mm/aaaa a la fecha de cierre", () => {
    expect(fechaCorta("2026-12-05")).toBe("05/12/2026");
  });
  it("valida el premio (3 a 200 sin espacios de los extremos) y el último día (hoy o después)", () => {
    const hoy = "2026-11-20";
    expect(validarPremioFecha("Una cena", "2026-11-20", hoy)).toBeNull();
    expect(validarPremioFecha("  abc  ", "2026-12-01", hoy)).toBeNull();
    expect(validarPremioFecha("x".repeat(200), "2026-12-01", hoy)).toBeNull();
    expect(validarPremioFecha("  ab ", "2026-12-01", hoy)).toMatch(/premio/i);
    expect(validarPremioFecha("   ", "2026-12-01", hoy)).toMatch(/premio/i);
    expect(validarPremioFecha("x".repeat(201), "2026-12-01", hoy)).toMatch(/200/);
    expect(validarPremioFecha("Una cena", "", hoy)).toMatch(/último día/i);
    expect(validarPremioFecha("Una cena", "2026-13-45", hoy)).toMatch(/último día/i);
    expect(validarPremioFecha("Una cena", "2026-11-19", hoy)).toMatch(/anterior a hoy/);
  });
});
