/**
 * Tests para supabase/functions/resend-webhook/eventos.ts
 *
 * Cubre lo que pide el encargo ("mapeo de eventos, decisión de aviso"):
 * - Qué tipo de evento de Resend se traduce a qué estado_entrega (y cuáles
 *   se ignoran a propósito).
 * - Cuándo hay que avisar al personal y cuándo suprimir la dirección.
 * - La prioridad del aviso (mismo criterio que emails-reserva/reintentos.ts).
 * - El margen anti-aluvión de 30 minutos.
 * - El contenido del mensaje (que mencione al cliente, su contacto, y el
 *   porqué de cada caso).
 */
import { describe, it, expect } from "vitest";
import {
  mapearEventoAEstadoEntrega,
  debeAvisarPersonal,
  debeSuprimirDireccion,
  prioridadAvisoWebhook,
  debeCrearAvisoWebhook,
  construirMensajeAvisoWebhook,
  type DatosAvisoWebhook,
} from "../eventos.ts";

describe("mapearEventoAEstadoEntrega", () => {
  it("mapea los cuatro eventos que importan al encargo", () => {
    expect(mapearEventoAEstadoEntrega("delivered")).toBe("entregado");
    expect(mapearEventoAEstadoEntrega("bounced")).toBe("rebotado");
    expect(mapearEventoAEstadoEntrega("complained")).toBe("quejado");
    expect(mapearEventoAEstadoEntrega("suppressed")).toBe("suprimido");
  });

  it("devuelve null para eventos que no representan un estado de entrega a guardar", () => {
    for (const tipo of ["sent", "opened", "clicked", "delivery_delayed", "failed", "scheduled", "received", "algo_desconocido", ""]) {
      expect(mapearEventoAEstadoEntrega(tipo)).toBeNull();
    }
  });
});

describe("debeAvisarPersonal / debeSuprimirDireccion", () => {
  it("entregado no avisa ni suprime", () => {
    expect(debeAvisarPersonal("entregado")).toBe(false);
    expect(debeSuprimirDireccion("entregado")).toBe(false);
  });
  it("rebotado, quejado y suprimido avisan y suprimen", () => {
    for (const estado of ["rebotado", "quejado", "suprimido"] as const) {
      expect(debeAvisarPersonal(estado)).toBe(true);
      expect(debeSuprimirDireccion(estado)).toBe(true);
    }
  });
});

describe("prioridadAvisoWebhook", () => {
  it("alta para propuesta y confirmada -- el cliente se queda sin saberlo", () => {
    expect(prioridadAvisoWebhook("propuesta")).toBe("alta");
    expect(prioridadAvisoWebhook("confirmada")).toBe("alta");
  });
  it("normal para el resto, incluido un tipo que este módulo no reconozca", () => {
    for (const tipo of ["solicitud_recibida", "rechazada", "recordatorio", "algo_nuevo_no_documentado"]) {
      expect(prioridadAvisoWebhook(tipo)).toBe("normal");
    }
  });
});

describe("debeCrearAvisoWebhook (margen anti-aluvión, 30 min)", () => {
  it("true si nunca hubo aviso previo en este carril", () => {
    expect(debeCrearAvisoWebhook(null, new Date().toISOString())).toBe(true);
  });
  it("false si el último aviso de este carril fue hace menos de 30 minutos", () => {
    const ahora = new Date("2026-09-23T12:00:00Z").toISOString();
    const hace10min = new Date("2026-09-23T11:50:00Z").toISOString();
    expect(debeCrearAvisoWebhook(hace10min, ahora)).toBe(false);
  });
  it("true si el último aviso fue hace exactamente 30 minutos o más", () => {
    const ahora = new Date("2026-09-23T12:00:00Z").toISOString();
    const hace30minExactos = new Date("2026-09-23T11:30:00Z").toISOString();
    const hace31min = new Date("2026-09-23T11:29:00Z").toISOString();
    expect(debeCrearAvisoWebhook(hace30minExactos, ahora)).toBe(true);
    expect(debeCrearAvisoWebhook(hace31min, ahora)).toBe(true);
  });
});

describe("construirMensajeAvisoWebhook", () => {
  const base: DatosAvisoWebhook = {
    estado: "rebotado",
    tipoEmail: "propuesta",
    nombreCliente: "Ana",
    telefono: "600111222",
    email: "ana@example.com",
    fecha: "2026-09-25",
    hora: "21:00:00",
  };

  it("null para entregado -- no se avisa de una entrega correcta", () => {
    expect(construirMensajeAvisoWebhook({ ...base, estado: "entregado" })).toBeNull();
  });

  it("rebotado: menciona que no se reintentará solo y da nombre + contacto", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "rebotado" });
    expect(m).not.toBeNull();
    expect(m!.mensaje).toContain("no se reintentará");
    expect(m!.mensaje).toContain("Ana");
    expect(m!.mensaje).toContain("600111222");
  });

  it("quejado: menciona la reputación del dominio (motivo de no reescribir)", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "quejado" });
    expect(m!.mensaje.toLowerCase()).toContain("reputación");
    expect(m!.mensaje.toLowerCase()).toContain("spam");
  });

  it("suprimido: menciona que Resend ni lo intentó", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "suprimido" });
    expect(m!.titulo.toLowerCase()).toContain("no intentó");
  });

  it("usa el teléfono como contacto preferente sobre el email", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "rebotado" });
    expect(m!.mensaje).toContain("600111222");
    expect(m!.mensaje).not.toContain("ana@example.com");
  });

  it("cae a email si no hay teléfono, y a 'Cliente' si no hay nombre", () => {
    const m = construirMensajeAvisoWebhook({ ...base, telefono: null, nombreCliente: null, estado: "rebotado" });
    expect(m!.mensaje).toContain("ana@example.com");
    expect(m!.mensaje).toContain("Cliente");
  });

  it("incluye fecha y hora recortada a HH:MM cuando están disponibles", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "rebotado" });
    expect(m!.mensaje).toContain("2026-09-25 21:00");
  });

  it("no revienta si falta fecha/hora (recordatorio sin datos completos, por ejemplo)", () => {
    const m = construirMensajeAvisoWebhook({ ...base, estado: "rebotado", fecha: null, hora: null });
    expect(m).not.toBeNull();
  });
});
