import { describe, it, expect } from "vitest";
import {
  debeNotificarAltaPanel,
  errorEmail,
  errorTelefono,
  estadoInicialAltaPanel,
  MENSAJES_CONTACTO,
  validarContactoReserva,
} from "@/lib/reservas/altaPanel";

describe("altaPanel · estado inicial (decisión del dueño 2026-09-23)", () => {
  it("un alta del panel nace 'verificada' (el cliente recibe 'Confirma tu reserva')", () => {
    expect(estadoInicialAltaPanel(false)).toBe("verificada");
    expect(debeNotificarAltaPanel("verificada")).toBe(true);
  });

  it("cliente en lista negra: 'pendiente' y sin correo", () => {
    expect(estadoInicialAltaPanel(true)).toBe("pendiente");
    expect(debeNotificarAltaPanel("pendiente")).toBe(false);
  });

  it("nunca nace 'confirmada'", () => {
    expect([estadoInicialAltaPanel(false), estadoInicialAltaPanel(true)]).not.toContain("confirmada");
  });
});

describe("altaPanel · teléfono y email obligatorios", () => {
  it("teléfono vacío o corto", () => {
    expect(errorTelefono("")).toBe(MENSAJES_CONTACTO.telefonoObligatorio);
    expect(errorTelefono("   ")).toBe(MENSAJES_CONTACTO.telefonoObligatorio);
    expect(errorTelefono(undefined)).toBe(MENSAJES_CONTACTO.telefonoObligatorio);
    expect(errorTelefono("12345")).toBe(MENSAJES_CONTACTO.telefonoInvalido);
    expect(errorTelefono("+34 612 34 56 78")).toBeNull();
  });

  it("email vacío o mal formado", () => {
    expect(errorEmail("")).toBe(MENSAJES_CONTACTO.emailObligatorio);
    expect(errorEmail(null)).toBe(MENSAJES_CONTACTO.emailObligatorio);
    expect(errorEmail("ana@")).toBe(MENSAJES_CONTACTO.emailInvalido);
    expect(errorEmail("ana example.com")).toBe(MENSAJES_CONTACTO.emailInvalido);
    expect(errorEmail(" ana@example.com ")).toBeNull();
  });

  it("validarContactoReserva normaliza el teléfono como el bot y recorta el email", () => {
    const r = validarContactoReserva({ telefono: "0034 612-345-678", email: "  ana@example.com " });
    expect(r.contacto).toEqual({ telefono: "+34612345678", email: "ana@example.com" });
    expect(r.errores).toEqual({ telefono: null, email: null });
  });

  it("validarContactoReserva devuelve los dos errores a la vez", () => {
    const r = validarContactoReserva({ telefono: "", email: "x" });
    expect(r.contacto).toBeNull();
    expect(r.errores).toEqual({
      telefono: MENSAJES_CONTACTO.telefonoObligatorio,
      email: MENSAJES_CONTACTO.emailInvalido,
    });
  });
});
