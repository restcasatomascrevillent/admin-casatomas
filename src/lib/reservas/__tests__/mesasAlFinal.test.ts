// Mesas «al final» (08/11/2026): en el Comedor, las 10, 11 y 12 se dejan para dejar paso. No es una
// exclusión: todos los repartos automáticos las ponen al final, como último recurso antes de «sin mesa».
import { describe, expect, it } from "vitest";
import { clasificarMesasParaSentar, type AsignacionConfirmar } from "../confirmarMesa";
import { elegirMesaReemplazo, proponerRecalculo, recolocarDesplazadas } from "../recalcularMesas";
import { organizarServicio, type ReservaOrg, type SalaOrg } from "../organizarServicio";
import { opcionesParaSentar, ordenarParaSinReserva, type FilaMesaSala } from "../sentarAhora";
import type { MesaOpcion } from "../hoyMovil";

const AL_FINAL = new Set(["m10", "m11", "m12"]);

// La 7 (6 plazas) es MENOS justa para 4 que las 10/11/12 (4 plazas): sin la regla, ganarían ellas.
const mesa = (id: string, nombre: string, plazas: number): MesaOpcion => ({
  id,
  nombre,
  espacioId: "c",
  salaNombre: "Comedor",
  plazas,
});
const OPCIONES = [mesa("m7", "7", 6), mesa("m10", "10", 4), mesa("m11", "11", 4), mesa("m12", "12", 4)];

const asig = (mesaId: string, reserva: string, hora: string, o: { estado?: string; pax?: number; fijada?: boolean } = {}): AsignacionConfirmar => ({
  mesa_id: mesaId,
  reserva_id: reserva,
  reservas: {
    nombre: reserva,
    hora,
    estado: o.estado ?? "confirmada",
    salida_at: null,
    numero_comensales: o.pax ?? 4,
    mesa_fijada: o.fijada ?? false,
  },
});

const grupo4 = { id: "g4", hora: "21:00:00", comensales: 4, salaId: "c" };

describe("elegirMesaReemplazo con mesas al final", () => {
  it("un grupo de 4 va a una mesa normal aunque la 10/11/12 sean más justas", () => {
    expect(elegirMesaReemplazo({ opciones: OPCIONES, asignaciones: [], reserva: grupo4 })?.id).toBe("m10");
    expect(elegirMesaReemplazo({ opciones: OPCIONES, asignaciones: [], reserva: grupo4, alFinal: AL_FINAL })?.id).toBe("m7");
  });

  it("si solo quedan la 10/11/12, va a una de ellas", () => {
    const ocupada7 = [asig("m7", "otra", "21:00:00", { estado: "completada" })];
    const elegida = elegirMesaReemplazo({ opciones: OPCIONES, asignaciones: ocupada7, reserva: grupo4, alFinal: AL_FINAL });
    expect(AL_FINAL.has(elegida?.id ?? "")).toBe(true);
  });

  it("al recolocar a quien pierde su mesa prevista, también", () => {
    const r = recolocarDesplazadas({
      desplazadas: [{ reservaId: "g4", nombre: "g4", hora: "21:00:00", mesaIdsAntes: ["m11"], mesaIdsQuedan: [] }],
      opciones: OPCIONES,
      asignaciones: [asig("m11", "g4", "21:00:00")],
      mesasElegidas: ["m11"],
      alFinal: AL_FINAL,
    });
    expect(r[0].recolocadaEn?.mesaId).toBe("m7");
  });
});

describe("Recalcular mesas con mesas al final", () => {
  it("la que choca pasa a la normal libre, no a la 10/11/12", () => {
    // Dos previstas en la 12 a la misma hora: se mueve la que llega más tarde.
    const asignaciones = [asig("m12", "a", "21:00:00"), asig("m12", "b", "21:15:00")];
    const p = proponerRecalculo({ opciones: OPCIONES, asignaciones, turno: "cena", alFinal: AL_FINAL });
    expect(p.movimientos.map((m) => `${m.reservaId}→${m.hacia.nombre}`)).toEqual(["b→7"]);
  });

  it("la que ya está en la 10 (asignada a mano) y no choca no se mueve", () => {
    const p = proponerRecalculo({ opciones: OPCIONES, asignaciones: [asig("m10", "a", "21:00:00")], turno: "cena", alFinal: AL_FINAL });
    expect(p.movimientos).toEqual([]);
  });
});

describe("selector «¿Dónde se sientan?» con mesas al final", () => {
  it("las libres normales primero; las 10/11/12 detrás y marcadas", () => {
    const s = clasificarMesasParaSentar({
      opciones: OPCIONES,
      asignaciones: [],
      reserva: { id: "g4", hora: "21:00:00", comensales: 4, espacioId: "c" },
      propias: [],
      alFinal: AL_FINAL,
    });
    expect(s.salas[0].mesas.map((m) => m.nombre)).toEqual(["7", "10", "11", "12"]);
    expect(s.salas[0].mesas.map((m) => !!m.alFinal)).toEqual([false, true, true, true]);
  });
});

// ─── Sentar sin reserva / propuesta de mesa ─────────────────────────────────

const fila = (id: string, nombre: string, capacidad: number): FilaMesaSala => ({
  id,
  nombre,
  espacio_id: "c",
  capacidad,
  forma: "circular",
  ancho: 150,
  alto: 150,
  pos_x: 0,
  pos_y: 0,
  piezas: null,
});
const FILAS = [fila("m7", "7", 6), fila("m10", "10", 4), fila("m11", "11", 4), fila("m12", "12", 4)];

describe("opcionesParaSentar con mesas al final", () => {
  it("propone primero la normal", () => {
    const r = opcionesParaSentar({
      salas: [{ id: "c", nombre: "Comedor" }],
      mesas: FILAS,
      ajustesDia: [],
      asignaciones: [],
      excluidas: new Set(),
      alFinal: AL_FINAL,
      reserva: { id: "", hora: "21:00:00", comensales: 4, espacioId: "c" },
    });
    expect(r.caben.map((m) => m.nombre)).toEqual(["7", "10", "11", "12"]);
    expect(ordenarParaSinReserva(r.caben, AL_FINAL)[0].nombre).toBe("7");
  });
});

// ─── Organizar ───────────────────────────────────────────────────────────────

const SALAS: SalaOrg[] = [{ id: "C", nombre: "Comedor", terraza: false }];
const redonda = (nombre: string, plazas: number): FilaMesaSala => ({
  id: `C${nombre}`, nombre, espacio_id: "C", capacidad: plazas, forma: "circular", ancho: 150, alto: 150, pos_x: 5, pos_y: 5, piezas: null,
});
const MESAS_ORG = [redonda("7", 6), redonda("10", 4), redonda("11", 4), redonda("12", 4)];
const ORG_AL_FINAL = new Set(["C10", "C11", "C12"]);
const res = (id: string, comensales: number, mesaIds: string[] = [], extra: Partial<ReservaOrg> = {}): ReservaOrg => ({
  id, nombre: id, hora: "21:00:00", comensales, estado: "confirmada", importante: false,
  espacioId: mesaIds.length ? "C" : null, mesaIds, ...extra,
});

describe("Organizar con mesas al final", () => {
  it("un grupo de 4 va a la 7, no a la 10/11/12", () => {
    const sin = organizarServicio({ salas: SALAS, mesas: MESAS_ORG, ajustes: [], reservas: [res("g4", 4)] });
    expect(sin.movimientos[0].hacia.mesaNombres).toEqual(["10"]);
    const con = organizarServicio({ salas: SALAS, mesas: MESAS_ORG, ajustes: [], reservas: [res("g4", 4)], alFinal: ORG_AL_FINAL });
    expect(con.movimientos[0].hacia.mesaNombres).toEqual(["7"]);
  });

  it("si la 7 ya está fijada para otra, va a una de la 10/11/12 (antes que sin mesa)", () => {
    const r = organizarServicio({
      salas: SALAS,
      mesas: MESAS_ORG,
      ajustes: [],
      reservas: [res("fija", 6, ["C7"], { fijada: true }), res("g4", 4)],
      alFinal: ORG_AL_FINAL,
    });
    expect(r.sinSitio).toEqual([]);
    expect(["10", "11", "12"]).toContain(r.movimientos.find((m) => m.reservaId === "g4")?.hacia.mesaNombres[0]);
  });

  it("la que ya está en la 10 se respeta (no se mueve a la 7)", () => {
    const r = organizarServicio({ salas: SALAS, mesas: MESAS_ORG, ajustes: [], reservas: [res("g4", 4, ["C10"])], alFinal: ORG_AL_FINAL });
    expect(r.movimientos).toEqual([]);
  });
});
