import { describe, expect, it } from "vitest";
import {
  capacidadDeAforo,
  esErrorSalaPrivadaOcupada,
  estaFueraDeAforo,
  idsSalasPrivadasActivas,
  reservasQueConsumenAforo,
  esMensajeSalaPrivadaOcupada,
  esSalaPrivada,
  mensajeSalaPrivadaOcupada,
  nombreSalaDelError,
  salaPrivadaOcupadaPor,
  textoSalaPrivadaOcupada,
} from "../salaPrivada";

// El mensaje exacto que lanza el trigger (20261003130000_sala_privada_ocupa_turno.sql).
const MENSAJE_BD = "Sala privada ocupada: «Reservado» ya tiene una reserva el 04/10/2026 en el turno de cena.";

describe("esSalaPrivada", () => {
  it("lee caracteristicas.privada = true (y el 'true' que devuelve ->> del trigger)", () => {
    expect(esSalaPrivada({ caracteristicas: { marca: "casa_tomas", privada: true } })).toBe(true);
    expect(esSalaPrivada({ caracteristicas: { privada: "true" } })).toBe(true);
    expect(esSalaPrivada({ privada: true })).toBe(true);
  });

  it("solo el valor verdadero cuenta: sin flag, false, 1 o vacío no son privadas", () => {
    expect(esSalaPrivada({ caracteristicas: { marca: "casa_tomas" } })).toBe(false);
    expect(esSalaPrivada({ caracteristicas: { privada: false } })).toBe(false);
    expect(esSalaPrivada({ caracteristicas: { privada: 1 } })).toBe(false);
    expect(esSalaPrivada({ caracteristicas: null })).toBe(false);
    expect(esSalaPrivada({})).toBe(false);
    expect(esSalaPrivada(null)).toBe(false);
    expect(esSalaPrivada(undefined)).toBe(false);
  });

  it("una sala desactivada no cuenta (igual que en el trigger)", () => {
    expect(esSalaPrivada({ activa: false, caracteristicas: { privada: true } })).toBe(false);
    expect(esSalaPrivada({ activa: true, caracteristicas: { privada: true } })).toBe(true);
    expect(esSalaPrivada({ activa: null, caracteristicas: { privada: true } })).toBe(true);
  });
});

describe("error de la BD", () => {
  it("reconoce el 23514 «Sala privada ocupada» y NO el de aforo ni otros 23514", () => {
    expect(esErrorSalaPrivadaOcupada({ code: "23514", message: MENSAJE_BD })).toBe(true);
    expect(esErrorSalaPrivadaOcupada({ code: "23514", message: "Aforo superado para el turno. Capacidad total: 170" })).toBe(false);
    expect(esErrorSalaPrivadaOcupada({ code: "23514", message: 'violates check constraint "reservas_marca_valida"' })).toBe(false);
    // Mismo texto con otro código: no es el del trigger.
    expect(esErrorSalaPrivadaOcupada({ code: "42501", message: MENSAJE_BD })).toBe(false);
    expect(esErrorSalaPrivadaOcupada(null)).toBe(false);
    expect(esErrorSalaPrivadaOcupada(new Error("boom"))).toBe(false);
  });

  it("el mensaje de la BD no contiene «Aforo» (los traductores de aforo no lo pisan)", () => {
    expect(MENSAJE_BD).not.toMatch(/aforo/i);
  });

  it("reconoce el texto suelto (el `mensaje` de un RPC)", () => {
    expect(esMensajeSalaPrivadaOcupada(MENSAJE_BD)).toBe(true);
    expect(esMensajeSalaPrivadaOcupada("Aforo superado")).toBe(false);
    expect(esMensajeSalaPrivadaOcupada(null)).toBe(false);
  });

  it("saca el nombre de la sala del mensaje", () => {
    expect(nombreSalaDelError(MENSAJE_BD)).toBe("Reservado");
    expect(nombreSalaDelError("Sala privada ocupada")).toBeNull();
    expect(nombreSalaDelError(undefined)).toBeNull();
  });

  it("escribe la frase para el personal, con o sin nombre", () => {
    expect(mensajeSalaPrivadaOcupada({ code: "23514", message: MENSAJE_BD })).toBe(
      "La sala privada «Reservado» ya está reservada en ese turno: una reserva se queda la sala entera. Elige otro turno u otro día, o cancela la otra reserva.",
    );
    expect(textoSalaPrivadaOcupada()).toMatch(/^La sala privada ya está reservada en ese turno/);
    expect(textoSalaPrivadaOcupada("  ")).toMatch(/^La sala privada ya está reservada/);
  });
});

describe("salaPrivadaOcupadaPor", () => {
  const res = (o: Partial<{ id: string; hora: string; estado: string; espacio_id: string | null }> = {}) => ({
    id: "a",
    hora: "21:00:00",
    estado: "confirmada",
    espacio_id: "reservado",
    ...o,
  });

  it("encuentra a quien ya tiene la sala en ese turno", () => {
    expect(salaPrivadaOcupadaPor([res()], "reservado", "22:00:00")?.id).toBe("a");
  });

  it("la propia reserva que se mueve no cuenta", () => {
    expect(salaPrivadaOcupadaPor([res()], "reservado", "21:00:00", "a")).toBeNull();
  });

  it("otro turno (corte a las 17:00), otra sala o sin sala: libre", () => {
    expect(salaPrivadaOcupadaPor([res({ hora: "14:00:00" })], "reservado", "21:00:00")).toBeNull();
    expect(salaPrivadaOcupadaPor([res({ hora: "16:59:00" })], "reservado", "17:00:00")).toBeNull();
    expect(salaPrivadaOcupadaPor([res({ espacio_id: "comedor" })], "reservado", "21:00:00")).toBeNull();
    expect(salaPrivadaOcupadaPor([res({ espacio_id: null })], "reservado", "21:00:00")).toBeNull();
  });

  it("canceladas y «No vino» liberan la sala; una que ya llegó (completada) la sigue ocupando", () => {
    expect(salaPrivadaOcupadaPor([res({ estado: "cancelada" })], "reservado", "21:00:00")).toBeNull();
    expect(salaPrivadaOcupadaPor([res({ estado: "no_show" })], "reservado", "21:00:00")).toBeNull();
    expect(salaPrivadaOcupadaPor([res({ estado: "completada" })], "reservado", "21:00:00")?.id).toBe("a");
    expect(salaPrivadaOcupadaPor([res({ estado: "pendiente" })], "reservado", "21:00:00")?.id).toBe("a");
  });
});

// ----------------------------------------------------------------------------
// FUERA DE AFORO (decisión del dueño, 2026-10-03; migración 20261003150000)
// ----------------------------------------------------------------------------
describe("fuera de aforo: la sala privada no suma capacidad ni consume aforo", () => {
  const SALAS = [
    { id: "comedor", nombre: "Comedor", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
    { id: "salon", nombre: "Salón", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
    { id: "terraza", nombre: "Terraza", capacidad_maxima: 50, caracteristicas: { marca: "casa_tomas" } },
    { id: "reservado", nombre: "Reservado", capacidad_maxima: 20, caracteristicas: { marca: "casa_tomas", privada: true } },
  ];

  it("capacidadDeAforo: Casa Tomás = 150 (170 con el Reservado)", () => {
    expect(capacidadDeAforo(SALAS)).toBe(150);
    expect(capacidadDeAforo(SALAS.map((s) => ({ ...s, caracteristicas: { marca: "casa_tomas" } })))).toBe(170);
  });

  it("una sala privada desactivada no suma ni resta (no está activa)", () => {
    expect(capacidadDeAforo([...SALAS, { id: "x", nombre: "X", capacidad_maxima: 99, activa: false }])).toBe(150);
  });

  it("idsSalasPrivadasActivas y estaFueraDeAforo", () => {
    expect(idsSalasPrivadasActivas(SALAS)).toEqual(["reservado"]);
    expect(idsSalasPrivadasActivas([{ id: "r", activa: false, caracteristicas: { privada: true } }])).toEqual([]);
    expect(idsSalasPrivadasActivas(null)).toEqual([]);
    expect(estaFueraDeAforo({ espacio_id: "reservado" }, ["reservado"])).toBe(true);
    expect(estaFueraDeAforo({ espacio_id: "reservado" }, new Set(["reservado"]))).toBe(true);
    expect(estaFueraDeAforo({ espacio_id: "comedor" }, ["reservado"])).toBe(false);
    expect(estaFueraDeAforo({ espacio_id: null }, ["reservado"])).toBe(false);
    expect(estaFueraDeAforo(null, ["reservado"])).toBe(false);
  });

  it("reservasQueConsumenAforo quita solo las de salas privadas", () => {
    const rs = [{ espacio_id: "reservado" }, { espacio_id: "comedor" }, { espacio_id: null }];
    expect(reservasQueConsumenAforo(rs, ["reservado"])).toEqual([{ espacio_id: "comedor" }, { espacio_id: null }]);
    expect(reservasQueConsumenAforo(rs, [])).toHaveLength(3);
    expect(reservasQueConsumenAforo(rs, undefined)).toHaveLength(3);
  });
});
