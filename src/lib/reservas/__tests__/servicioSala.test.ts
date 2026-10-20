/**
 * Tests para src/lib/reservas/servicioSala.ts — modo servicio (Fase 4, MVP).
 *
 * Cubre: `reservaRelevanteDeMesa` (prioridad "sentada" > "próxima pendiente")
 * y `estadoMesaServicio` (los cinco estados: libre, reservada, retrasada,
 * ocupada, por_liberar), con los defaults del producto.
 */
import { describe, it, expect } from "vitest";
import {
  CONFIG_SERVICIO_SALA_POR_DEFECTO,
  configServicioSalaDesde,
  estadoMesaServicio,
  reservaRelevanteDeMesa,
  type AsignacionMesaServicio,
  type ConfigServicioSala,
  type ReservaMesaServicio,
} from "@/lib/reservas/servicioSala";

const reserva = (over: Partial<ReservaMesaServicio> = {}): ReservaMesaServicio => ({
  id: "r1",
  nombre: "Ana",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: "salon",
  llegada_at: null,
  salida_at: null,
  ...over,
});

const asignacion = (mesa_id: string, reserva_id: string): AsignacionMesaServicio => ({ mesa_id, reserva_id });

describe("reservaRelevanteDeMesa", () => {
  it("sin asignaciones para la mesa: null", () => {
    expect(reservaRelevanteDeMesa("m1", [], [reserva()], "cena")).toBeNull();
  });

  it("una reserva confirmada asignada: la devuelve", () => {
    const r = reserva({ id: "r1" });
    expect(reservaRelevanteDeMesa("m1", [asignacion("m1", "r1")], [r], "cena")).toBe(r);
  });

  it("ignora asignaciones de otro turno", () => {
    const r = reserva({ id: "r1", hora: "13:00:00" }); // comida
    expect(reservaRelevanteDeMesa("m1", [asignacion("m1", "r1")], [r], "cena")).toBeNull();
  });

  it("ignora reservas canceladas y no_show", () => {
    const cancelada = reserva({ id: "r1", estado: "cancelada" });
    const noShow = reserva({ id: "r2", estado: "no_show" });
    const asigs = [asignacion("m1", "r1"), asignacion("m1", "r2")];
    expect(reservaRelevanteDeMesa("m1", asigs, [cancelada, noShow], "cena")).toBeNull();
  });

  it("una completada YA liberada (salida_at puesto) no ocupa: null", () => {
    const liberada = reserva({ id: "r1", estado: "completada", llegada_at: "2026-09-26T20:00:00Z", salida_at: "2026-09-26T22:00:00Z" });
    expect(reservaRelevanteDeMesa("m1", [asignacion("m1", "r1")], [liberada], "cena")).toBeNull();
  });

  it("prioriza la sentada sobre una pendiente de llegar de la misma mesa", () => {
    const sentada = reserva({ id: "r1", hora: "20:00:00", estado: "completada", llegada_at: "2026-09-26T20:05:00Z" });
    const pendiente = reserva({ id: "r2", hora: "22:00:00", estado: "confirmada" });
    const asigs = [asignacion("m1", "r1"), asignacion("m1", "r2")];
    expect(reservaRelevanteDeMesa("m1", asigs, [sentada, pendiente], "cena")).toBe(sentada);
  });

  it("sin sentada, elige la pendiente de hora más temprana", () => {
    const tarde = reserva({ id: "r1", hora: "22:00:00" });
    const temprano = reserva({ id: "r2", hora: "20:00:00" });
    const asigs = [asignacion("m1", "r1"), asignacion("m1", "r2")];
    expect(reservaRelevanteDeMesa("m1", asigs, [tarde, temprano], "cena")).toBe(temprano);
  });
});

describe("estadoMesaServicio", () => {
  const config: ConfigServicioSala = CONFIG_SERVICIO_SALA_POR_DEFECTO; // 105/120/15

  it("libre: sin asignación", () => {
    const r = estadoMesaServicio("m1", [], [], "cena", new Date("2026-09-26T20:00:00"));
    expect(r).toEqual({ estado: "libre", reserva: null, minutos: null });
  });

  it("reservada: no ha llegado y todavía no ha pasado la gracia", () => {
    const res = reserva({ hora: "20:00:00", estado: "confirmada" });
    const ahora = new Date("2026-09-26T20:10:00"); // +10 min, gracia 15
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("reservada");
    expect(out.minutos).toBe(10);
    expect(out.reserva).toBe(res);
  });

  it("retrasada: no ha llegado y ya ha pasado la gracia (borde: exactamente el umbral)", () => {
    const res = reserva({ hora: "20:00:00", estado: "verificada" });
    const ahora = new Date("2026-09-26T20:15:00"); // +15 min == gracia
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("retrasada");
    expect(out.minutos).toBe(15);
  });

  it("ocupada: llegó y no ha pasado la estancia de cena (120 min)", () => {
    const res = reserva({ estado: "completada", llegada_at: "2026-09-26T20:00:00" });
    const ahora = new Date("2026-09-26T21:30:00"); // +90 min
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("ocupada");
    expect(out.minutos).toBe(90);
  });

  it("por_liberar: llegó y ya ha pasado la estancia (borde: exactamente el umbral)", () => {
    const res = reserva({ estado: "completada", llegada_at: "2026-09-26T20:00:00" });
    const ahora = new Date("2026-09-26T22:00:00"); // +120 min == estancia cena
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("por_liberar");
    expect(out.minutos).toBe(120);
  });

  it("usa la estancia de COMIDA (105 min) cuando el turno es comida", () => {
    const res = reserva({ hora: "13:00:00", estado: "completada", llegada_at: "2026-09-26T13:00:00" });
    const ahora = new Date("2026-09-26T14:50:00"); // +110 min >= 105
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "comida", ahora, config);
    expect(out.estado).toBe("por_liberar");
  });

  it("liberada (salida_at puesto): la mesa vuelve a libre", () => {
    const res = reserva({ estado: "completada", llegada_at: "2026-09-26T20:00:00", salida_at: "2026-09-26T21:00:00" });
    const ahora = new Date("2026-09-26T21:30:00");
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("libre");
    expect(out.reserva).toBeNull();
  });

  it("llegó pero sin llegada_at (migración no aplicada / dato histórico): ocupada sin minutos", () => {
    const res = reserva({ estado: "completada", llegada_at: null });
    const ahora = new Date("2026-09-26T21:30:00");
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, config);
    expect(out.estado).toBe("ocupada");
    expect(out.minutos).toBeNull();
  });

  it("respeta una config personalizada distinta de los defaults", () => {
    const custom: ConfigServicioSala = { estanciaComidaMinutos: 60, estanciaCenaMinutos: 60, retrasoGraciaMinutos: 5 };
    const res = reserva({ hora: "20:00:00", estado: "confirmada" });
    const ahora = new Date("2026-09-26T20:06:00"); // +6 min >= gracia 5
    const out = estadoMesaServicio("m1", [asignacion("m1", "r1")], [res], "cena", ahora, custom);
    expect(out.estado).toBe("retrasada");
  });
});

describe("configServicioSalaDesde", () => {
  it("sin fila (config no cargada): defaults del producto", () => {
    expect(configServicioSalaDesde(null)).toEqual(CONFIG_SERVICIO_SALA_POR_DEFECTO);
    expect(configServicioSalaDesde(undefined)).toEqual(CONFIG_SERVICIO_SALA_POR_DEFECTO);
  });

  it("columnas nuevas ausentes (migración sin aplicar): defaults", () => {
    expect(configServicioSalaDesde({})).toEqual(CONFIG_SERVICIO_SALA_POR_DEFECTO);
  });

  it("valores nulos: defaults (no NaN, no null)", () => {
    expect(
      configServicioSalaDesde({
        estancia_comida_minutos: null,
        estancia_cena_minutos: null,
        retraso_gracia_minutos: null,
      }),
    ).toEqual(CONFIG_SERVICIO_SALA_POR_DEFECTO);
  });

  it("respeta los valores guardados por el dueño", () => {
    expect(
      configServicioSalaDesde({
        estancia_comida_minutos: 90,
        estancia_cena_minutos: 150,
        retraso_gracia_minutos: 20,
      }),
    ).toEqual({ estanciaComidaMinutos: 90, estanciaCenaMinutos: 150, retrasoGraciaMinutos: 20 });
  });

  it("valor negativo o no numérico: cae al default de ese campo", () => {
    expect(
      configServicioSalaDesde({ estancia_comida_minutos: -5, estancia_cena_minutos: NaN as unknown as number }),
    ).toEqual({
      estanciaComidaMinutos: CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaComidaMinutos,
      estanciaCenaMinutos: CONFIG_SERVICIO_SALA_POR_DEFECTO.estanciaCenaMinutos,
      retrasoGraciaMinutos: CONFIG_SERVICIO_SALA_POR_DEFECTO.retrasoGraciaMinutos,
    });
  });
});
