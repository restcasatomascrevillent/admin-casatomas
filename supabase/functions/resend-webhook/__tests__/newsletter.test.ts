/**
 * Tests de supabase/functions/resend-webhook/newsletter.ts: qué eventos de
 * Resend dan de baja del newsletter, a quién y con qué origen.
 * Payloads con la forma de resend.com/docs/webhooks/emails/* y
 * resend.com/docs/webhooks/contacts/updated (consultado 2026-10-03).
 */
import { describe, it, expect } from "vitest";
import { decidirBajaNewsletter, leerEtiquetas, idArchivoEvento, destinatarioArchivo, normalizarEmail } from "../newsletter.ts";

const SID = "0b6c3c0e-1f0a-4f63-9a59-6a2c2f4b6c11";

const evento = (type: string, data: Record<string, unknown>) => ({ type, created_at: "2026-10-03T10:00:00Z", data });

describe("decidirBajaNewsletter", () => {
  it("queja de spam -> queja_spam, con el suscriptor de la etiqueta", () => {
    const d = decidirBajaNewsletter(
      evento("email.complained", {
        email_id: "e1",
        to: ["Cliente@Ejemplo.com"],
        tags: { categoria: "newsletter", suscriptor: SID },
      }),
    );
    expect(d).toEqual({ email: "cliente@ejemplo.com", origen: "queja_spam", suscriptorId: SID });
  });

  it("rebote (permanente) -> rebote_permanente", () => {
    const d = decidirBajaNewsletter(
      evento("email.bounced", { email_id: "e1", to: ["a@b.es"], bounce: { type: "Permanent", subType: "General" } }),
    );
    expect(d?.origen).toBe("rebote_permanente");
    expect(d?.suscriptorId).toBeNull();
  });

  it("un rebote marcado como Transient NO da de baja", () => {
    expect(decidirBajaNewsletter(evento("email.bounced", { to: ["a@b.es"], bounce: { type: "Transient" } }))).toBeNull();
  });

  it("supresión de Resend -> suprimido_resend", () => {
    const d = decidirBajaNewsletter(evento("email.suppressed", { to: ["a@b.es"], suppressed: { type: "OnAccountSuppressionList" } }));
    expect(d?.origen).toBe("suprimido_resend");
  });

  it("también da de baja si la queja es de un correo de reserva (sin etiquetas de newsletter)", () => {
    const d = decidirBajaNewsletter(evento("email.complained", { to: ["a@b.es"], tags: { category: "reserva" } }));
    expect(d).toEqual({ email: "a@b.es", origen: "queja_spam", suscriptorId: null });
  });

  it("ignora la etiqueta suscriptor si no es de categoría newsletter o no es un uuid", () => {
    expect(decidirBajaNewsletter(evento("email.complained", { to: ["a@b.es"], tags: { suscriptor: SID } }))?.suscriptorId).toBeNull();
    expect(
      decidirBajaNewsletter(evento("email.complained", { to: ["a@b.es"], tags: { categoria: "newsletter", suscriptor: "1 or 1=1" } }))
        ?.suscriptorId,
    ).toBeNull();
  });

  it("baja en la página de Resend (contact.updated unsubscribed=true) -> resend_baja_nativa", () => {
    const d = decidirBajaNewsletter(evento("contact.updated", { id: "c1", email: "A@B.es", unsubscribed: true }));
    expect(d).toEqual({ email: "a@b.es", origen: "resend_baja_nativa", suscriptorId: null });
  });

  it("NUNCA reactiva: contact.updated con unsubscribed=false no hace nada", () => {
    expect(decidirBajaNewsletter(evento("contact.updated", { id: "c1", email: "a@b.es", unsubscribed: false }))).toBeNull();
  });

  it("los eventos normales no dan de baja a nadie", () => {
    for (const t of ["email.sent", "email.delivered", "email.opened", "email.clicked", "email.delivery_delayed", "email.failed", "contact.created", "contact.deleted"]) {
      expect(decidirBajaNewsletter(evento(t, { to: ["a@b.es"], email: "a@b.es", unsubscribed: true }))).toBeNull();
    }
  });

  it("sin destinatario válido no hay baja", () => {
    expect(decidirBajaNewsletter(evento("email.complained", { to: [] }))).toBeNull();
    expect(decidirBajaNewsletter(evento("email.complained", { to: ["no-es-un-email"] }))).toBeNull();
    expect(decidirBajaNewsletter({ type: undefined, data: null })).toBeNull();
  });

  it("acepta destinatario con nombre", () => {
    expect(decidirBajaNewsletter(evento("email.suppressed", { to: ["Pepe <Pepe@Ejemplo.es>"] }))?.email).toBe("pepe@ejemplo.es");
  });
});

describe("leerEtiquetas", () => {
  it("objeto (webhook) y array (envío)", () => {
    expect(leerEtiquetas({ a: "1", b: 2 })).toEqual({ a: "1" });
    expect(leerEtiquetas([{ name: "a", value: "1" }, { name: "b" }])).toEqual({ a: "1" });
    expect(leerEtiquetas(null)).toEqual({});
  });
});

describe("archivo en email_eventos", () => {
  it("usa email_id cuando existe", () => {
    expect(idArchivoEvento(evento("email.sent", { email_id: "e1" }))).toBe("e1");
  });
  it("id sintético para contact.* (email_id es NOT NULL)", () => {
    expect(idArchivoEvento(evento("contact.updated", { id: "c1" }))).toBe("contact.updated:c1");
    expect(idArchivoEvento(evento("suppression.added", {}))).toBe("suppression.added:sin-id");
  });
  it("destinatario: to[0] o email", () => {
    expect(destinatarioArchivo(evento("email.sent", { to: ["a@b.es"] }))).toBe("a@b.es");
    expect(destinatarioArchivo(evento("contact.updated", { email: "c@d.es" }))).toBe("c@d.es");
    expect(destinatarioArchivo(evento("x", {}))).toBeNull();
  });
});

describe("normalizarEmail", () => {
  it("minúsculas y recorte", () => {
    expect(normalizarEmail("  A@B.ES ")).toBe("a@b.es");
    expect(normalizarEmail(3)).toBeNull();
  });
});
