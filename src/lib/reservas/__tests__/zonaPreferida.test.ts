import { describe, expect, it } from "vitest";
import {
  avisoZonaSala,
  esSalaExterior,
  normalizarZona,
  opcionesSalaDeZona,
  ordenarSalasPorZona,
  salaAlElegirZona,
  salaCasaConZona,
  salaUnicaDeZona,
  textoZona,
} from "../zonaPreferida";
import { calcularCambiosEdicion, valoresFormularioDesdeReserva, type ReservaEditable } from "../edicionReserva";

const SALAS = [
  { id: "salon", nombre: "Salón" },
  { id: "comedor", nombre: "Comedor", caracteristicas: { marca: "casa_tomas" } },
  { id: "terraza", nombre: "Terraza", caracteristicas: { exterior: true, calefaccion: true } },
  { id: "reservado", nombre: "Reservado", privada: true },
];

describe("zonaPreferida", () => {
  it("normaliza y rotula: solo dentro y fuera", () => {
    expect(normalizarZona("fuera")).toBe("fuera");
    expect(normalizarZona("indiferente")).toBeNull();
    expect(normalizarZona(null)).toBeNull();
    expect(textoZona("dentro")).toBe("Dentro");
    expect(textoZona("fuera")).toBe("Fuera");
    expect(textoZona(null)).toBeNull();
  });

  it("qué es de fuera: caracteristicas.exterior; sin la clave, por el nombre", () => {
    expect(esSalaExterior({ nombre: "Terraza", caracteristicas: { exterior: true } })).toBe(true);
    expect(esSalaExterior({ nombre: "Terraza" })).toBe(true);
    expect(esSalaExterior({ nombre: "Terraza", caracteristicas: { exterior: false } })).toBe(false);
    expect(esSalaExterior({ nombre: "Patio", caracteristicas: { exterior: "true" } })).toBe(true);
    expect(esSalaExterior({ nombre: "Comedor", caracteristicas: { marca: "casa_tomas" } })).toBe(false);
    expect(esSalaExterior({ nombre: "Terraza", exterior: false })).toBe(false);
  });

  it("filtrado de salas: dentro → Salón, Comedor y (al final) el Reservado; fuera → Terraza", () => {
    expect(opcionesSalaDeZona(SALAS, "dentro", null).map((o) => o.sala.id)).toEqual(["salon", "comedor", "reservado"]);
    expect(opcionesSalaDeZona(SALAS, "fuera", null).map((o) => o.sala.id)).toEqual(["terraza"]);
    expect(salaCasaConZona(SALAS[2], "dentro")).toBe(false);
    expect(salaCasaConZona(SALAS[2], null)).toBe(true);
  });

  it("menú del día + dentro: Salón deshabilitado con el motivo; queda solo el Comedor", () => {
    const op = opcionesSalaDeZona(SALAS, "dentro", "menu_del_dia");
    expect(op.find((o) => o.sala.id === "salon")).toMatchObject({ habilitada: false, motivo: "El menú del día es en Comedor o Terraza" });
    expect(op.find((o) => o.sala.id === "comedor")!.habilitada).toBe(true);
    expect(salaUnicaDeZona(SALAS, "dentro", "menu_del_dia")!.id).toBe("comedor");
    expect(salaUnicaDeZona(SALAS, "dentro", "carta")).toBeNull();
    expect(salaUnicaDeZona(SALAS, "fuera", "menu_del_dia")!.id).toBe("terraza");
  });

  it("al elegir zona: conserva la sala si casa; si no, la única que vale o ninguna", () => {
    expect(salaAlElegirZona(SALAS, "dentro", null, "salon")).toBe("salon");
    expect(salaAlElegirZona(SALAS, "dentro", null, "terraza")).toBeNull();
    expect(salaAlElegirZona(SALAS, "fuera", null, "comedor")).toBe("terraza");
    expect(salaAlElegirZona(SALAS, "dentro", "menu_del_dia", "salon")).toBe("comedor");
    expect(salaAlElegirZona(SALAS, null, null, "comedor")).toBe("comedor");
  });

  it("aviso si la sala no casa y orden del desplegable con las de la zona primero", () => {
    expect(avisoZonaSala(SALAS[1], "fuera")).toBe("Has dicho fuera y Comedor es de dentro.");
    expect(avisoZonaSala(SALAS[2], "fuera")).toBeNull();
    expect(avisoZonaSala(SALAS[1], null)).toBeNull();
    expect(ordenarSalasPorZona(SALAS, "fuera").map((s) => s.id)).toEqual(["terraza", "salon", "comedor", "reservado"]);
  });
});

describe("edición: zona_preferida en el payload", () => {
  const original: ReservaEditable = {
    id: "r1",
    nombre: "Ana",
    telefono: "+34612345678",
    email: null,
    fecha: "2026-11-21",
    hora: "21:00:00",
    numero_comensales: 2,
    estado: "confirmada",
    notas_cliente: null,
    espacio_id: null,
    zona_preferida: null,
  } as ReservaEditable;

  it("arranca con la zona guardada (null si no hay o si es rara)", () => {
    expect(valoresFormularioDesdeReserva(original).zona_preferida).toBeNull();
    expect(valoresFormularioDesdeReserva({ ...original, zona_preferida: "fuera" }).zona_preferida).toBe("fuera");
    expect(valoresFormularioDesdeReserva({ ...original, zona_preferida: "patio" }).zona_preferida).toBeNull();
  });

  it("solo escribe zona_preferida si cambia; quitarla escribe null", () => {
    const base = valoresFormularioDesdeReserva(original);
    expect(calcularCambiosEdicion(original, { ...base, zona_preferida: null })).toEqual({});
    expect(calcularCambiosEdicion(original, { ...base, zona_preferida: "fuera" })).toEqual({ zona_preferida: "fuera" });
    const conZona = { ...original, zona_preferida: "dentro" };
    expect(calcularCambiosEdicion(conZona, { ...base, zona_preferida: null })).toEqual({ zona_preferida: null });
  });
});
