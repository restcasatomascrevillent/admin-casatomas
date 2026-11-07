import { describe, expect, it } from "vitest";
import {
  decidirSentarPrevista,
  estadoParaConfirmar,
  clasificarMesasParaSentar,
  textoDesplazamiento,
  type AsignacionConfirmar,
} from "../confirmarMesa";
import { elegirMesaReemplazo, mesasOcupadasAhora, proponerRecalculo, recolocarDesplazadas } from "../recalcularMesas";
import type { MesaOpcion } from "../hoyMovil";

const asig = (
  mesa: string,
  reserva: string,
  hora: string,
  o: { estado?: string; nombre?: string; pax?: number; fijada?: boolean; salida?: string | null } = {},
): AsignacionConfirmar => ({
  mesa_id: mesa,
  reserva_id: reserva,
  reservas: {
    nombre: o.nombre ?? reserva,
    hora,
    estado: o.estado ?? "confirmada",
    salida_at: o.salida ?? null,
    numero_comensales: o.pax ?? 2,
    mesa_fijada: o.fijada ?? false,
  },
});

const mesa = (id: string, nombre: string, espacioId: string, plazas: number): MesaOpcion => ({
  id,
  nombre,
  espacioId,
  salaNombre: espacioId === "c" ? "Comedor" : "Terraza",
  plazas,
});

const opciones = [
  mesa("m7", "7", "c", 4),
  mesa("m8", "8", "c", 2),
  mesa("m9", "9", "c", 4),
  mesa("m10", "10", "c", 6),
  mesa("t1", "T1", "t", 4),
];

describe("mesa fijada en confirmarMesa", () => {
  const ana = { id: "ana", hora: "21:00:00" };

  it("una mesa prevista para una reserva FIJADA sale como «fijada» (no prevista)", () => {
    const lista = [asig("m7", "g", "21:30:00", { nombre: "García", fijada: true })];
    expect(estadoParaConfirmar(lista, "m7", ana)).toEqual({ tipo: "fijada", reservaId: "g", nombre: "García", hora: "21:30:00" });
  });

  it("sentado manda sobre fijada", () => {
    const lista = [asig("m7", "g", "21:30:00", { fijada: true }), asig("m7", "p", "20:30:00", { estado: "completada" })];
    expect(estadoParaConfirmar(lista, "m7", ana).tipo).toBe("ocupada");
  });

  it("«Sentar · Mesa 7» con su mesa fijada para otra: elegir otra", () => {
    const lista = [asig("m7", "ana", "21:00:00"), asig("m7", "g", "21:30:00", { fijada: true })];
    expect(decidirSentarPrevista(lista, ana)).toEqual({ tipo: "elegir" });
  });

  it("en el selector las fijadas van detrás de las previstas", () => {
    const lista = [asig("m7", "g", "21:30:00", { fijada: true }), asig("m9", "h", "21:15:00")];
    const s = clasificarMesasParaSentar({
      opciones,
      asignaciones: lista,
      reserva: { id: "ana", hora: "21:00:00", comensales: 4, espacioId: "c" },
      propias: [],
    });
    expect(s.salas[0].mesas.map((m) => `${m.nombre}:${m.estado.tipo}`)).toEqual(["10:libre", "9:prevista", "7:fijada"]);
  });

  it("el aviso dice a qué mesa pasa la otra reserva, o que no hay ninguna libre", () => {
    const base = { reservaId: "g", nombre: "García", hora: "21:30:00", mesaIdsAntes: ["m7"] };
    expect(textoDesplazamiento("7", [{ ...base, mesaIdsQuedan: ["m9"], recolocadaEn: { mesaId: "m9", mesaNombre: "9" } }])).toBe(
      "La mesa 7 estaba prevista para García (21:30). García pasa a la mesa 9.",
    );
    expect(textoDesplazamiento("7", [{ ...base, mesaIdsQuedan: [], recolocadaEn: null }])).toBe(
      "La mesa 7 estaba prevista para García (21:30). García se queda sin mesa: no hay ninguna libre.",
    );
  });
});

describe("elegirMesaReemplazo", () => {
  const garcia = { id: "g", hora: "21:30:00", comensales: 4, salaId: "c" };

  it("la más justa de su sala, libre en su franja", () => {
    expect(elegirMesaReemplazo({ opciones, asignaciones: [], reserva: garcia })?.id).toBe("m7");
    expect(elegirMesaReemplazo({ opciones, asignaciones: [], reserva: garcia, evitar: new Set(["m7"]) })?.id).toBe("m9");
  });

  it("no choca con previstas, fijadas, sentadas ahora ni excluidas", () => {
    const lista = [
      asig("m7", "x", "21:00:00"),
      asig("m9", "y", "20:00:00", { estado: "completada" }), // sentada desde las 20:00 y sin liberar
    ];
    expect(elegirMesaReemplazo({ opciones, asignaciones: lista, reserva: garcia })?.id).toBe("m10");
    expect(elegirMesaReemplazo({ opciones, asignaciones: lista, reserva: garcia, excluidas: new Set(["m10"]) })).toBeNull();
  });

  it("solo de su sala; sin sala, cualquiera", () => {
    const soloTerraza = opciones.filter((m) => m.espacioId === "t");
    expect(elegirMesaReemplazo({ opciones: soloTerraza, asignaciones: [], reserva: garcia })).toBeNull();
    expect(elegirMesaReemplazo({ opciones: soloTerraza, asignaciones: [], reserva: { ...garcia, salaId: null } })?.id).toBe("t1");
  });

  it("una mesa liberada o de comida no cuenta como ocupada en la cena", () => {
    const lista = [
      asig("m7", "x", "20:00:00", { estado: "completada", salida: "2026-11-07T21:00:00Z" }),
      asig("m9", "y", "13:30:00", { estado: "completada" }),
    ];
    expect([...mesasOcupadasAhora(lista, "21:30:00")]).toEqual([]);
    expect(elegirMesaReemplazo({ opciones, asignaciones: lista, reserva: garcia })?.id).toBe("m7");
  });
});

describe("recolocarDesplazadas", () => {
  it("a quien pierde su única mesa le busca otra libre de su sala", () => {
    const lista = [asig("m7", "g", "21:30:00", { nombre: "García", pax: 4 })];
    const e = estadoParaConfirmar(lista, "m7", { id: "ana", hora: "21:00:00" });
    if (e.tipo !== "prevista") throw new Error("debería ser prevista");
    const [d] = recolocarDesplazadas({ desplazadas: e.desplazadas, opciones, asignaciones: lista, mesasElegidas: ["m7"] });
    expect(d).toMatchObject({ reservaId: "g", mesaIdsAntes: ["m7"], mesaIdsQuedan: ["m9"], recolocadaEn: { mesaId: "m9", mesaNombre: "9" } });
  });

  it("sin ninguna libre: se queda sin mesa (null)", () => {
    const lista = [asig("m7", "g", "21:30:00", { pax: 4 })];
    const e = estadoParaConfirmar(lista, "m7", { id: "ana", hora: "21:00:00" });
    if (e.tipo !== "prevista") throw new Error("debería ser prevista");
    const [d] = recolocarDesplazadas({
      desplazadas: e.desplazadas,
      opciones,
      asignaciones: lista,
      mesasElegidas: ["m7"],
      excluidas: new Set(["m9", "m10"]),
    });
    expect(d.recolocadaEn).toBeNull();
    expect(d.mesaIdsQuedan).toEqual([]);
  });

  it("si iba en dos mesas juntas y le queda una, no se recoloca", () => {
    const lista = [asig("m7", "g", "21:30:00"), asig("m8", "g", "21:30:00")];
    const e = estadoParaConfirmar(lista, "m7", { id: "ana", hora: "21:00:00" });
    if (e.tipo !== "prevista") throw new Error("debería ser prevista");
    const [d] = recolocarDesplazadas({ desplazadas: e.desplazadas, opciones, asignaciones: lista, mesasElegidas: ["m7"] });
    expect(d.mesaIdsQuedan).toEqual(["m8"]);
    expect(d.recolocadaEn).toBeUndefined();
  });

  it("dos desplazadas no acaban en la misma mesa", () => {
    const lista = [asig("m7", "g", "21:30:00", { pax: 4 }), asig("m7", "h", "21:30:00", { pax: 4 })];
    const ds = recolocarDesplazadas({
      desplazadas: [
        { reservaId: "g", nombre: "g", hora: "21:30:00", mesaIdsAntes: ["m7"], mesaIdsQuedan: [] },
        { reservaId: "h", nombre: "h", hora: "21:30:00", mesaIdsAntes: ["m7"], mesaIdsQuedan: [] },
      ],
      opciones,
      asignaciones: lista,
      mesasElegidas: ["m7"],
    });
    expect(ds.map((d) => d.mesaIdsQuedan[0])).toEqual(["m9", "m10"]);
  });
});

describe("proponerRecalculo", () => {
  it("mueve la por llegar cuya mesa está ocupada ahora; no toca fijadas ni sentadas", () => {
    const lista = [
      asig("m7", "p", "20:00:00", { estado: "completada", nombre: "Pérez" }), // sigue sentado
      asig("m7", "g", "22:30:00", { nombre: "García", pax: 4 }), // su mesa prevista está ocupada ahora
      asig("m9", "f", "22:30:00", { nombre: "Fijo", fijada: true }),
      asig("m8", "l", "21:00:00", { nombre: "López" }), // sin conflicto
    ];
    const r = proponerRecalculo({ opciones, asignaciones: lista, turno: "cena" });
    expect(r.movimientos.map((m) => [m.reservaId, m.hacia.id])).toEqual([["g", "m10"]]);
    expect(r.resumen).toBe("Se moverá 1 reserva: García 7→10.");
    expect(r.sinSitio).toEqual([]);
  });

  it("una fijada aunque su mesa esté ocupada ahora no se mueve", () => {
    const lista = [
      asig("m7", "p", "20:00:00", { estado: "completada" }),
      asig("m7", "f", "22:30:00", { fijada: true }),
    ];
    expect(proponerRecalculo({ opciones, asignaciones: lista, turno: "cena" }).movimientos).toEqual([]);
  });

  it("dos previstas que chocan en la misma mesa: se mueve la que llega más tarde", () => {
    const lista = [asig("m9", "a", "21:00:00", { nombre: "Ana" }), asig("m9", "b", "21:30:00", { nombre: "Blas" })];
    const r = proponerRecalculo({ opciones, asignaciones: lista, turno: "cena" });
    // Blas son 2: la más justa es la 8 (2 plazas).
    expect(r.movimientos.map((m) => `${m.reservaId}:${m.hacia.nombre}`)).toEqual(["b:8"]);
  });

  it("solo el turno pedido, y sin sitio se queda donde está", () => {
    const lista = [asig("m7", "p", "13:00:00", { estado: "completada" }), asig("m7", "g", "14:30:00", { pax: 6 })];
    expect(proponerRecalculo({ opciones, asignaciones: lista, turno: "cena" }).movimientos).toEqual([]);
    const r = proponerRecalculo({ opciones, asignaciones: lista, turno: "comida", excluidas: new Set(["m10"]) });
    expect(r.movimientos).toEqual([]);
    expect(r.sinSitio.map((s) => s.reservaId)).toEqual(["g"]);
    expect(r.resumen).toBe("No hace falta mover ninguna reserva.");
  });
});
