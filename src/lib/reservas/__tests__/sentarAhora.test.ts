import { describe, expect, it } from "vitest";
import {
  esErrorCanal,
  filaSinReserva,
  horaActual,
  nombreSinReserva,
  opcionesParaSentar,
  ordenarParaSinReserva,
  type FilaMesaSala,
} from "../sentarAhora";

const SALAS = [
  { id: "c", nombre: "Comedor" },
  { id: "t", nombre: "Terraza" },
];

const mesa = (id: string, nombre: string, sala: string, extra: Partial<FilaMesaSala> = {}): FilaMesaSala => ({
  id, nombre, espacio_id: sala, capacidad: 4, forma: "rectangular", ancho: 110, alto: 70, pos_x: 0, pos_y: 0, ...extra,
});

describe("sin reserva (walk-in)", () => {
  it("nombre y fila: ya sentada, sin contacto", () => {
    expect(nombreSinReserva("", "21:05:00")).toBe("Sin reserva 21:05");
    expect(nombreSinReserva(" Paco ", "21:05:00")).toBe("Paco");
    const f = filaSinReserva({ fecha: "2026-10-09", hora: "21:05:00", personas: 3, espacioId: "c", canal: "presencial", ahora: new Date(0) });
    expect(f).toMatchObject({ estado: "completada", canal: "presencial", numero_comensales: 3, espacio_id: "c", email: null, telefono: null });
    expect(horaActual(new Date(2026, 9, 9, 9, 7))).toBe("09:07:00");
  });

  it("reconoce el CHECK de canal", () => {
    expect(esErrorCanal({ code: "23514", message: 'new row violates check constraint "reservas_canal_check"' })).toBe(true);
    expect(esErrorCanal({ code: "23514", message: "reservas_numero_comensales_check" })).toBe(false);
  });

  it("la mesa libre más justa de cualquier sala; la ocupada a esa hora no", () => {
    const mesas = [
      mesa("a", "4", "c", { piezas: 3, picos_base: 1, picos_max: 1, piezas_max: 3, ancho: 165 }),
      mesa("b", "7", "c"),
      mesa("c", "1", "t", { capacidad: 4, plazas_min: 2, plazas_max: 6, ancho: 65, alto: 65 }),
    ];
    const asignaciones = [{ mesa_id: "b", reserva_id: "r1", reservas: { hora: "21:00:00", nombre: "Ana" } }];
    const r = opcionesParaSentar({
      salas: SALAS, mesas, ajustesDia: [], asignaciones, excluidas: new Set(),
      reserva: { id: "", hora: "21:10:00", comensales: 3, espacioId: null },
    });
    expect(ordenarParaSinReserva(r.caben).map((m) => m.nombre)).toEqual(["1", "4"]);
    expect(r.propuesta).toBeNull();
  });

  it("si no cabe en ninguna, propone piezas", () => {
    const mesas = [
      mesa("a", "3", "c", { piezas: 2, picos_max: 1, piezas_max: 3, grupo_piezas: "g" }),
      mesa("b", "4", "c", { piezas: 3, picos_base: 1, picos_max: 1, piezas_max: 3, grupo_piezas: "g", ancho: 165, pos_y: 1.5 }),
    ];
    const asignaciones = [{ mesa_id: "b", reserva_id: "r1", reservas: { hora: "21:00:00", nombre: "Ana", numero_comensales: 4 } }];
    const r = opcionesParaSentar({
      salas: SALAS, mesas, ajustesDia: [], asignaciones, excluidas: new Set(),
      reserva: { id: "", hora: "21:10:00", comensales: 6, espacioId: null },
    });
    expect(r.caben).toEqual([]);
    expect(r.propuesta?.mesa.nombre).toBe("3");
    expect(r.propuesta?.propuesta.texto).toBe("Para sentar 6 en la 3: pasa una pieza de la 4 a la 3");
  });
});
