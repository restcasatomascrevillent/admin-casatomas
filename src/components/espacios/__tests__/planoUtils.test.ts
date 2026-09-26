import { describe, it, expect } from "vitest";
import {
  transformarPunto,
  calcularPuntosAbsolutosPared,
  calcularGeometriaRect,
  planRepuntarAsignaciones,
  esMesaTemporal,
  esMesaGrupoNueva,
  esMesaNoPersistida,
  type Matrix2D,
} from "../planoUtils";

describe("transformarPunto", () => {
  it("aplica la identidad sin cambios", () => {
    const identidad: Matrix2D = [1, 0, 0, 1, 0, 0];
    expect(transformarPunto({ x: 10, y: 20 }, identidad)).toEqual({ x: 10, y: 20 });
  });

  it("aplica una traslación", () => {
    const traslacion: Matrix2D = [1, 0, 0, 1, 50, -30];
    expect(transformarPunto({ x: 10, y: 20 }, traslacion)).toEqual({ x: 60, y: -10 });
  });

  it("aplica escala", () => {
    const escala: Matrix2D = [2, 0, 0, 3, 0, 0];
    expect(transformarPunto({ x: 5, y: 5 }, escala)).toEqual({ x: 10, y: 15 });
  });

  it("aplica una rotación de 90 grados", () => {
    // cos(90)=0, sin(90)=1 -> matriz [0, 1, -1, 0, 0, 0]
    const rot90: Matrix2D = [0, 1, -1, 0, 0, 0];
    const resultado = transformarPunto({ x: 10, y: 0 }, rot90);
    expect(resultado.x).toBeCloseTo(0);
    expect(resultado.y).toBeCloseTo(10);
  });
});

describe("calcularPuntosAbsolutosPared", () => {
  it("traslada los dos extremos de la pared con la matriz del objeto", () => {
    const matriz: Matrix2D = [1, 0, 0, 1, 100, 200];
    const puntosLocales = { x1: -25, y1: 0, x2: 25, y2: 0 };
    expect(calcularPuntosAbsolutosPared(matriz, puntosLocales)).toEqual({
      x1: 75,
      y1: 200,
      x2: 125,
      y2: 200,
    });
  });

  it("preserva coordenada 0 (no la confunde con 'sin valor')", () => {
    const identidad: Matrix2D = [1, 0, 0, 1, 0, 0];
    const puntosLocales = { x1: 0, y1: 0, x2: 40, y2: 0 };
    expect(calcularPuntosAbsolutosPared(identidad, puntosLocales)).toEqual({
      x1: 0,
      y1: 0,
      x2: 40,
      y2: 0,
    });
  });
});

describe("calcularGeometriaRect", () => {
  it("hornea la escala en el ancho/alto", () => {
    const resultado = calcularGeometriaRect({ left: 10, top: 20, width: 100, height: 50, scaleX: 1.5, scaleY: 2, angle: 0 });
    expect(resultado).toEqual({ left: 10, top: 20, width: 150, height: 100, angle: 0 });
  });

  it("usa 1 como escala por defecto si no viene definida", () => {
    const resultado = calcularGeometriaRect({ left: 5, top: 5, width: 60, height: 12 });
    expect(resultado).toEqual({ left: 5, top: 5, width: 60, height: 12, angle: 0 });
  });

  it("no pierde left/top en 0 (bug de usar || en vez de ??)", () => {
    const resultado = calcularGeometriaRect({ left: 0, top: 0, width: 60, height: 12, scaleX: 1, scaleY: 1 });
    expect(resultado.left).toBe(0);
    expect(resultado.top).toBe(0);
  });
});

describe("planRepuntarAsignaciones", () => {
  it("actualiza las asignaciones que no chocan con destino", () => {
    const origen = [
      { id: "a1", reserva_id: "r1", mesa_id: "m-origen" },
      { id: "a2", reserva_id: "r2", mesa_id: "m-origen" },
    ];
    const { aActualizar, aEliminar } = planRepuntarAsignaciones(origen, new Set());
    expect(aActualizar.sort()).toEqual(["a1", "a2"]);
    expect(aEliminar).toEqual([]);
  });

  it("elimina (no actualiza) las que duplicarían el UNIQUE(reserva_id, mesa_id) en destino", () => {
    const origen = [
      { id: "a1", reserva_id: "r1", mesa_id: "m-origen" },
      { id: "a2", reserva_id: "r2", mesa_id: "m-origen" },
    ];
    // r1 ya está asignada a la mesa destino -> repuntar a1 violaría el UNIQUE
    const { aActualizar, aEliminar } = planRepuntarAsignaciones(origen, new Set(["r1"]));
    expect(aActualizar).toEqual(["a2"]);
    expect(aEliminar).toEqual(["a1"]);
  });

  it("con lista de origen vacía no hace nada", () => {
    const { aActualizar, aEliminar } = planRepuntarAsignaciones([], new Set(["r1"]));
    expect(aActualizar).toEqual([]);
    expect(aEliminar).toEqual([]);
  });
});

describe("identificadores de mesa no persistida", () => {
  it("reconoce mesas temporales (mesa-temp-)", () => {
    expect(esMesaTemporal("mesa-temp-12345-0")).toBe(true);
    expect(esMesaTemporal("mesa-grupo-12345")).toBe(false);
    expect(esMesaTemporal("a1b2c3d4-real-uuid")).toBe(false);
  });

  it("reconoce mesas de grupo nuevas (mesa-grupo-)", () => {
    expect(esMesaGrupoNueva("mesa-grupo-99999")).toBe(true);
    expect(esMesaGrupoNueva("mesa-temp-99999")).toBe(false);
  });

  it("esMesaNoPersistida cubre ambos casos", () => {
    expect(esMesaNoPersistida("mesa-temp-1")).toBe(true);
    expect(esMesaNoPersistida("mesa-grupo-1")).toBe(true);
    expect(esMesaNoPersistida("a1b2c3d4-real-uuid")).toBe(false);
  });
});
