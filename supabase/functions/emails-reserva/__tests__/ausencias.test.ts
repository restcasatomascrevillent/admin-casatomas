/**
 * Tests para supabase/functions/emails-reserva/ausencias.ts
 *
 * Capa pura: detección de ausencia sin avisar + resumen de historial para
 * la sugerencia de lista negra. Lo crítico:
 * - Solo reservas 'confirmada' cuentan (una 'pendiente' o 'cancelada' nunca
 *   es una ausencia).
 * - El margen de gracia se respeta: no se marca ausencia antes de tiempo.
 * - El resumen de historial distingue no-shows de cancelaciones/completadas
 *   (una cancelación no convierte a alguien en reincidente).
 */
import { describe, it, expect } from "vitest";
import { esAusenciaSinAvisar, resumirHistorialCliente, type ReservaHistorialCliente } from "../ausencias.ts";

describe("esAusenciaSinAvisar", () => {
  const instanteReserva = "2026-03-16T20:00:00.000Z"; // instante UTC ya resuelto por tiempo.ts

  it("es falso si todavía no ha pasado el margen de gracia (2h59 después)", () => {
    expect(esAusenciaSinAvisar("confirmada", instanteReserva, "2026-03-16T22:59:00.000Z", 3)).toBe(false);
  });

  it("es verdadero justo al cumplirse el margen de gracia (3h exactas)", () => {
    expect(esAusenciaSinAvisar("confirmada", instanteReserva, "2026-03-16T23:00:00.000Z", 3)).toBe(true);
  });

  it("es verdadero bastante después del margen de gracia", () => {
    expect(esAusenciaSinAvisar("confirmada", instanteReserva, "2026-03-17T10:00:00.000Z", 3)).toBe(true);
  });

  it("es falso si la reserva no está 'confirmada' (ej. ya cancelada, ya completada, o pendiente)", () => {
    for (const estado of ["pendiente", "verificada", "cancelada", "completada", "no_show"]) {
      expect(esAusenciaSinAvisar(estado, instanteReserva, "2026-03-20T00:00:00.000Z", 3)).toBe(false);
    }
  });

  it("respeta un margen de gracia distinto del por defecto", () => {
    expect(esAusenciaSinAvisar("confirmada", instanteReserva, "2026-03-16T21:00:00.000Z", 1)).toBe(true);
    expect(esAusenciaSinAvisar("confirmada", instanteReserva, "2026-03-16T20:30:00.000Z", 1)).toBe(false);
  });
});

function historialFila(estado: string, fecha = "2026-01-01"): ReservaHistorialCliente {
  return { estado, fecha };
}

describe("resumirHistorialCliente", () => {
  it("cuenta correctamente no-shows, completadas y canceladas por separado", () => {
    const historial = resumirHistorialCliente([
      historialFila("no_show"),
      historialFila("no_show"),
      historialFila("completada"),
      historialFila("cancelada"),
      historialFila("cancelada"),
      historialFila("cancelada"),
    ]);
    expect(historial).toEqual({
      total_reservas_previas: 6,
      no_shows_previos: 2,
      completadas_previas: 1,
      canceladas_previas: 3,
      es_primera_falta: false,
    });
  });

  it("es_primera_falta es verdadero si no hay no-shows previos, aunque haya cancelaciones", () => {
    const historial = resumirHistorialCliente([historialFila("cancelada"), historialFila("completada")]);
    expect(historial.es_primera_falta).toBe(true);
  });

  it("historial vacío -> todo a cero y primera falta", () => {
    expect(resumirHistorialCliente([])).toEqual({
      total_reservas_previas: 0,
      no_shows_previos: 0,
      completadas_previas: 0,
      canceladas_previas: 0,
      es_primera_falta: true,
    });
  });
});
