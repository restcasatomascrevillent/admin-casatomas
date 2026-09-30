/**
 * Tests de `src/lib/reservas/pendientesDeMesa.ts` — la lógica que decide qué
 * enseña la franja "Pendientes de mesa" de la pestaña Hoy.
 *
 * Aquí no se mockea nada: el módulo es puro y usa `ocupaEspacio` de verdad
 * (que a su vez es `ESTADOS_QUE_OCUPAN` + 'completada'), así que estos tests
 * también fijan qué estados cuentan como trabajo pendiente.
 */
import { describe, it, expect } from "vitest";
import {
  agruparPendientesDeMesa,
  contarPendientes,
  idsReservasConMesa,
  type ReservaPendienteMesa,
} from "@/lib/reservas/pendientesDeMesa";

const COMEDOR = "esp-comedor";
const SALON = "esp-salon";
const TERRAZA = "esp-terraza";

const SALAS = [
  { id: COMEDOR, nombre: "Comedor" },
  { id: SALON, nombre: "Salón" },
  { id: TERRAZA, nombre: "Terraza" },
];

const reserva = (over: Partial<ReservaPendienteMesa> & { id: string }): ReservaPendienteMesa => ({
  nombre: "Cliente",
  hora: "13:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: COMEDOR,
  ...over,
});

const sinMesa = new Set<string>();

describe("agruparPendientesDeMesa", () => {
  it("agrupa las reservas sin mesa por su sala", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "a", espacio_id: COMEDOR }),
        reserva({ id: "b", espacio_id: SALON }),
        reserva({ id: "c", espacio_id: COMEDOR }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toMatchObject({ espacioId: COMEDOR, nombreSala: "Comedor" });
    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["a", "c"]);
    expect(grupos[1]).toMatchObject({ espacioId: SALON, nombreSala: "Salón" });
    expect(grupos[1].reservas.map((r) => r.id)).toEqual(["b"]);
  });

  it("respeta el orden en que llegan las salas, no el de las reservas", () => {
    const grupos = agruparPendientesDeMesa(
      [reserva({ id: "a", espacio_id: TERRAZA }), reserva({ id: "b", espacio_id: COMEDOR })],
      sinMesa,
      SALAS,
    );

    expect(grupos.map((g) => g.espacioId)).toEqual([COMEDOR, TERRAZA]);
  });

  it("ordena por hora dentro de cada grupo", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "tarde", hora: "21:30" }),
        reserva({ id: "pronto", hora: "13:00" }),
        reserva({ id: "medio", hora: "14:15" }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["pronto", "medio", "tarde"]);
  });

  it("ordena igual aunque la hora venga con segundos (HH:MM:SS)", () => {
    const grupos = agruparPendientesDeMesa(
      [reserva({ id: "b", hora: "14:00:00" }), reserva({ id: "a", hora: "09:30:00" })],
      sinMesa,
      SALAS,
    );

    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("empata por nombre y por id para que dos renders pinten lo mismo", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "z", hora: "13:00", nombre: "Ana" }),
        reserva({ id: "a", hora: "13:00", nombre: "Ana" }),
        reserva({ id: "m", hora: "13:00", nombre: "Alba" }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["m", "a", "z"]);
  });

  it("deja el grupo «sin sala» SIEMPRE el último", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "huerfana", espacio_id: null }),
        reserva({ id: "a", espacio_id: TERRAZA }),
        reserva({ id: "b", espacio_id: COMEDOR }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos.map((g) => g.espacioId)).toEqual([COMEDOR, TERRAZA, null]);
    const ultimo = grupos[grupos.length - 1];
    expect(ultimo.nombreSala).toBeNull();
    expect(ultimo.reservas.map((r) => r.id)).toEqual(["huerfana"]);
  });

  it("no pierde las reservas de una sala que ya no está en la lista (queda sin nombre, antes que «sin sala»)", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "sin_sala", espacio_id: null }),
        reserva({ id: "borrada", espacio_id: "esp-que-ya-no-existe" }),
        reserva({ id: "normal", espacio_id: COMEDOR }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos.map((g) => g.espacioId)).toEqual([COMEDOR, "esp-que-ya-no-existe", null]);
    expect(grupos[1].nombreSala).toBeNull();
  });

  it("deja fuera las canceladas y los «No vino»", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "cancelada", estado: "cancelada" }),
        reserva({ id: "no_show", estado: "no_show" }),
        reserva({ id: "viva", estado: "confirmada" }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["viva"]);
  });

  it("cuenta los estados que ocupan sitio, incluido 'completada' (llegó y sigue sin mesa)", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "pendiente", estado: "pendiente" }),
        reserva({ id: "verificada", estado: "verificada" }),
        reserva({ id: "confirmada", estado: "confirmada" }),
        reserva({ id: "completada", estado: "completada" }),
      ],
      sinMesa,
      SALAS,
    );

    expect(grupos[0].reservas.map((r) => r.id).sort()).toEqual([
      "completada",
      "confirmada",
      "pendiente",
      "verificada",
    ]);
  });

  it("deja fuera las que ya tienen mesa", () => {
    const grupos = agruparPendientesDeMesa(
      [reserva({ id: "sentada" }), reserva({ id: "pendiente" })],
      new Set(["sentada"]),
      SALAS,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0].reservas.map((r) => r.id)).toEqual(["pendiente"]);
  });

  it("no devuelve grupos vacíos: la sala sin pendientes no aparece", () => {
    const grupos = agruparPendientesDeMesa([reserva({ id: "a", espacio_id: SALON })], sinMesa, SALAS);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].espacioId).toBe(SALON);
  });

  it("devuelve [] cuando todo está sentado (la franja entera desaparece)", () => {
    const grupos = agruparPendientesDeMesa(
      [reserva({ id: "a" }), reserva({ id: "b", espacio_id: SALON })],
      new Set(["a", "b"]),
      SALAS,
    );

    expect(grupos).toEqual([]);
  });

  it("devuelve [] sin reservas y sin salas", () => {
    expect(agruparPendientesDeMesa([], sinMesa, [])).toEqual([]);
  });

  it("no rompe si no hay salas: todo lo que tenga sala cae como sala sin nombre", () => {
    const grupos = agruparPendientesDeMesa([reserva({ id: "a" })], sinMesa, []);

    expect(grupos).toEqual([
      { espacioId: COMEDOR, nombreSala: null, reservas: [expect.objectContaining({ id: "a" })] },
    ]);
  });
});

describe("contarPendientes", () => {
  it("suma las reservas de todos los grupos", () => {
    const grupos = agruparPendientesDeMesa(
      [
        reserva({ id: "a" }),
        reserva({ id: "b", espacio_id: SALON }),
        reserva({ id: "c", espacio_id: null }),
      ],
      sinMesa,
      SALAS,
    );

    expect(contarPendientes(grupos)).toBe(3);
    expect(contarPendientes([])).toBe(0);
  });
});

describe("idsReservasConMesa", () => {
  it("saca los ids de reserva de las asignaciones, sin repetir", () => {
    const ids = idsReservasConMesa([
      { reserva_id: "r1" },
      { reserva_id: "r1" },
      { reserva_id: "r2" },
    ]);

    expect([...ids].sort()).toEqual(["r1", "r2"]);
  });

  it("aguanta filas vacías, nulas o sin reserva", () => {
    expect(idsReservasConMesa(undefined).size).toBe(0);
    expect(idsReservasConMesa([]).size).toBe(0);
    expect(idsReservasConMesa([{ reserva_id: null }, { reserva_id: "" }]).size).toBe(0);
  });
});
