// Bloqueos solo de la web (reglas.ts, migración 20261122100000): servicio
// bloqueado desde el panel, «hoy 12:30-16:00 solo por teléfono» y menú del día.
import { describe, it, expect } from "vitest";
import {
  turnoDeHoraWeb,
  turnosBloqueadosDesdeFilas,
  esMismoDiaSoloTelefono,
  rechazoServicioBloqueado,
  rechazoMismoDiaTelefono,
  rechazoMenuDelDia,
  leerMenuDelDia,
  motivoHoraNoOfrecidaWeb,
  MISMO_DIA_TELEFONO_DESDE,
  MISMO_DIA_TELEFONO_HASTA,
} from "../reglas.ts";

const HOY = "2026-11-10"; // martes
const MANANA = "2026-11-11"; // miércoles

describe("turnoDeHoraWeb (mismo corte que el trigger: < 17:00 = comida)", () => {
  it("separa comida y cena a las 17:00", () => {
    expect(turnoDeHoraWeb("16:59")).toBe("comida");
    expect(turnoDeHoraWeb("17:00")).toBe("cena");
    expect(turnoDeHoraWeb("13:30:00")).toBe("comida");
    expect(turnoDeHoraWeb("21:00")).toBe("cena");
  });
});

describe("turnosBloqueadosDesdeFilas", () => {
  it("se queda con los turnos válidos, sin repetir", () => {
    expect(turnosBloqueadosDesdeFilas([{ turno: "cena" }, { turno: "cena" }, { turno: "x" }])).toEqual(["cena"]);
    expect(turnosBloqueadosDesdeFilas(null)).toEqual([]);
  });
});

describe("rechazoServicioBloqueado", () => {
  it("rechaza una hora del turno bloqueado con SERVICIO_BLOQUEADO (422)", () => {
    const r = rechazoServicioBloqueado("21:00", ["cena"]);
    expect(r?.status).toBe(422);
    expect(r?.cuerpo).toMatchObject({ ok: false, motivo: "SERVICIO_BLOQUEADO", error: "SERVICIO_BLOQUEADO" });
    expect(r?.cuerpo.mensaje).toMatch(/ya no admite reservas online/);
  });
  it("deja pasar el otro turno y los días sin bloqueo", () => {
    expect(rechazoServicioBloqueado("14:00", ["cena"])).toBeNull();
    expect(rechazoServicioBloqueado("21:00", [])).toBeNull();
  });
});

describe("mismo día 12:30-16:00 solo por teléfono", () => {
  it("las constantes son 12:30 y 16:00", () => {
    expect([MISMO_DIA_TELEFONO_DESDE, MISMO_DIA_TELEFONO_HASTA]).toEqual(["12:30", "16:00"]);
  });
  it("hoy, extremos incluidos", () => {
    expect(esMismoDiaSoloTelefono(HOY, "12:30", HOY)).toBe(true);
    expect(esMismoDiaSoloTelefono(HOY, "14:00", HOY)).toBe(true);
    expect(esMismoDiaSoloTelefono(HOY, "16:00", HOY)).toBe(true);
    expect(esMismoDiaSoloTelefono(HOY, "16:00:00", HOY)).toBe(true);
  });
  it("fuera de la franja u otro día, no", () => {
    expect(esMismoDiaSoloTelefono(HOY, "12:29", HOY)).toBe(false);
    expect(esMismoDiaSoloTelefono(HOY, "16:01", HOY)).toBe(false);
    expect(esMismoDiaSoloTelefono(HOY, "21:00", HOY)).toBe(false);
    expect(esMismoDiaSoloTelefono(MANANA, "14:00", HOY)).toBe(false);
  });
  it("rechazo con MISMO_DIA_TELEFONO y su mensaje", () => {
    const r = rechazoMismoDiaTelefono(HOY, "13:00", HOY);
    expect(r?.status).toBe(422);
    expect(r?.cuerpo).toMatchObject({ motivo: "MISMO_DIA_TELEFONO", error: "MISMO_DIA_TELEFONO", mensaje: "Para comer hoy hay que reservar por teléfono." });
    expect(rechazoMismoDiaTelefono(MANANA, "13:00", HOY)).toBeNull();
  });
});

describe("motivoHoraNoOfrecidaWeb (disponibilidad)", () => {
  it("bloqueo de servicio primero, luego mismo día", () => {
    expect(motivoHoraNoOfrecidaWeb(HOY, "14:00", HOY, ["comida"])).toBe("SERVICIO_BLOQUEADO");
    expect(motivoHoraNoOfrecidaWeb(HOY, "14:00", HOY, [])).toBe("MISMO_DIA_TELEFONO");
    expect(motivoHoraNoOfrecidaWeb(MANANA, "14:00", HOY, ["cena"])).toBeNull();
  });
});

describe("menú del día", () => {
  it("solo `true` cuenta como sí", () => {
    expect(leerMenuDelDia({ menu_del_dia: true })).toBe(true);
    expect(leerMenuDelDia({ menu_del_dia: "true" })).toBe(false);
    expect(leerMenuDelDia({})).toBe(false);
    expect(leerMenuDelDia(null)).toBe(false);
  });
  it("sin menú no se valida nada", () => {
    expect(rechazoMenuDelDia(false, "2026-11-15", "21:00", "Salón")).toBeNull();
  });
  it("martes, miércoles y jueves a mediodía, sin sala o en Comedor/Terraza", () => {
    expect(rechazoMenuDelDia(true, "2026-11-10", "14:00", null)).toBeNull(); // martes
    expect(rechazoMenuDelDia(true, "2026-11-11", "13:30", "Comedor")).toBeNull(); // miércoles
    expect(rechazoMenuDelDia(true, "2026-11-12", "14:00", " terraza ")).toBeNull(); // jueves
  });
  it("otro día, cena u otra sala: MENU_DIA_NO_DISPONIBLE", () => {
    for (const [fecha, hora, sala] of [
      ["2026-11-13", "14:00", null], // viernes
      ["2026-11-09", "14:00", null], // lunes
      ["2026-11-10", "21:00", null], // cena
      ["2026-11-10", "14:00", "Salón"],
    ] as const) {
      const r = rechazoMenuDelDia(true, fecha, hora, sala);
      expect(r?.status).toBe(422);
      expect(r?.cuerpo.error).toBe("MENU_DIA_NO_DISPONIBLE");
      expect(r?.cuerpo.mensaje.length).toBeGreaterThan(10);
    }
  });
});
