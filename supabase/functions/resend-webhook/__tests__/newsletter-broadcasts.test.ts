/**
 * resend-webhook, fase 2 (Broadcasts): contact.updated / contact.deleted y
 * broadcast_id para las estadísticas (newsletter.ts).
 */
import { describe, it, expect } from "vitest";
import { decidirBajaNewsletter, decidirDesvinculoContacto, broadcastIdDe, idArchivoEvento } from "../newsletter.ts";

const contacto = (type: string, data: Record<string, unknown>) => ({
  type,
  created_at: "2026-10-11T23:47:56.678Z",
  data: {
    id: "e169aa45-1ecf-4183-9955-b1499d5701d3",
    segment_ids: ["78261eea-8f8b-4381-83c6-79fa7120f1cf"],
    created_at: "2026-10-10T15:11:54.110Z",
    updated_at: "2026-10-11T23:47:56.678Z",
    email: "Steve.Wozniak@gmail.com",
    first_name: "Steve",
    ...data,
  },
});

describe("contact.updated (página de baja de Resend)", () => {
  it("unsubscribed=true -> baja resend_baja_nativa por email normalizado", () => {
    expect(decidirBajaNewsletter(contacto("contact.updated", { unsubscribed: true }))).toEqual({
      email: "steve.wozniak@gmail.com",
      origen: "resend_baja_nativa",
      suscriptorId: null,
    });
  });
  it("unsubscribed=false NUNCA reactiva", () => {
    expect(decidirBajaNewsletter(contacto("contact.updated", { unsubscribed: false }))).toBeNull();
  });
  it("se archiva sin email_id (id sintético, sin el 500 de email_eventos.email_id NOT NULL)", () => {
    expect(idArchivoEvento(contacto("contact.updated", { unsubscribed: true }))).toBe("contact.updated:e169aa45-1ecf-4183-9955-b1499d5701d3");
  });
});

describe("contact.deleted", () => {
  it("no es una baja: solo desvincula el contacto", () => {
    const ev = contacto("contact.deleted", { unsubscribed: false });
    expect(decidirBajaNewsletter(ev)).toBeNull();
    expect(decidirDesvinculoContacto(ev)).toBe("e169aa45-1ecf-4183-9955-b1499d5701d3");
  });
  it("aunque viniera unsubscribed=true, borrar no da de baja (lo decide la tabla)", () => {
    expect(decidirBajaNewsletter(contacto("contact.deleted", { unsubscribed: true }))).toBeNull();
  });
  it("otros eventos no desvinculan", () => {
    expect(decidirDesvinculoContacto(contacto("contact.updated", { unsubscribed: true }))).toBeNull();
    expect(decidirDesvinculoContacto({ type: "contact.deleted", data: {} })).toBeNull();
  });
});

describe("eventos de correo de un Broadcast", () => {
  const entregado = {
    type: "email.delivered",
    data: { email_id: "56761188-7520-42d8-8898-ff6fc54ce618", broadcast_id: "8b146471-e88e-4322-86af-016cd36fd216", to: ["a@x.es"], tags: {} },
  };
  it("se guarda broadcast_id", () => {
    expect(broadcastIdDe(entregado)).toBe("8b146471-e88e-4322-86af-016cd36fd216");
    expect(broadcastIdDe({ type: "email.delivered", data: { email_id: "x" } })).toBeNull();
  });
  it("una queja de un Broadcast da de baja por email (sin etiqueta de suscriptor)", () => {
    expect(decidirBajaNewsletter({ ...entregado, type: "email.complained" })).toEqual({ email: "a@x.es", origen: "queja_spam", suscriptorId: null });
  });
});
