import { describe, it, expect } from "vitest";
import { errorTelefono, errorTelefonoOpcional, MENSAJES_CONTACTO } from "@/lib/reservas/altaPanel";
import { errorTelefonoEdicion } from "@/lib/reservas/edicionReserva";
import { formatearTelefonoReserva } from "@/lib/reservas/telefono";
import { admiteMenuDelDia } from "@/lib/reservas/menuDelDia";

describe("teléfono opcional en el panel", () => {
  it("vacío o en blanco no es error; si se rellena, se valida", () => {
    expect(errorTelefonoOpcional("")).toBeNull();
    expect(errorTelefonoOpcional("   ")).toBeNull();
    expect(errorTelefonoOpcional(undefined)).toBeNull();
    expect(errorTelefonoOpcional("123")).toBe(MENSAJES_CONTACTO.telefonoInvalido);
    expect(errorTelefonoOpcional("612345678")).toBeNull();
  });
  it("el obligatorio (solicitudes del bot) no cambia", () => {
    expect(errorTelefono("")).toBe(MENSAJES_CONTACTO.telefonoObligatorio);
  });
  it("al editar se puede quitar el teléfono y se guarda null", () => {
    expect(errorTelefonoEdicion("", "+34612345678")).toBeNull();
    expect(formatearTelefonoReserva("")).toBeNull();
    expect(errorTelefonoEdicion("12", "+34612345678")).toBe(MENSAJES_CONTACTO.telefonoInvalido);
  });
});

describe("admiteMenuDelDia", () => {
  const dia = (d: string) => new Date(`${d}T12:00:00`);
  it("martes a jueves antes de las 17:00", () => {
    expect(admiteMenuDelDia(dia("2026-11-10"), "13:30")).toBe(true); // martes
    expect(admiteMenuDelDia(dia("2026-11-12"), "16:59:00")).toBe(true); // jueves
  });
  it("no los demás días ni a partir de las 17:00", () => {
    expect(admiteMenuDelDia(dia("2026-11-09"), "13:30")).toBe(false); // lunes
    expect(admiteMenuDelDia(dia("2026-11-13"), "13:30")).toBe(false); // viernes
    expect(admiteMenuDelDia(dia("2026-11-10"), "17:00")).toBe(false);
    expect(admiteMenuDelDia(undefined, "13:30")).toBe(false);
    expect(admiteMenuDelDia(dia("2026-11-10"), "")).toBe(false);
  });
});
