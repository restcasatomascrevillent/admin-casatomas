import { describe, expect, it } from "vitest";
import { participantesCsv, recuentoPorVino, sortearGanador, type VotoVino } from "@/hooks/useEncuestaVinos";

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
});
