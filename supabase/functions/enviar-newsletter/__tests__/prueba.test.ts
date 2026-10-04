/**
 * Envío de prueba por Resend Marketing (prueba.ts): solo a la dirección de
 * prueba, nunca a clientes. Resend falso.
 */
import { describe, it, expect, vi } from "vitest";
import { enviarPrueba, EMAIL_PRUEBA_POR_DEFECTO, NOMBRE_SEGMENTO_PRUEBAS, type ClientePrueba } from "../prueba.ts";
import type { ContactoResend, ResultadoResend } from "../../_shared/resend-marketing/cliente.ts";

const ok = <T>(data: T): ResultadoResend<T> => ({ ok: true, status: 200, data });
const ko = (status: number, mensaje = "x"): ResultadoResend<never> => ({ ok: false, status, tipo: "e", mensaje });

function cliente(opts: { segmentos?: { id: string; name: string }[]; miembros?: ContactoResend[]; existente?: ContactoResend | null } = {}) {
  const c: ClientePrueba = {
    listarSegmentos: vi.fn(async () => ok(opts.segmentos ?? [])),
    crearSegmento: vi.fn(async () => ok({ id: "seg-pruebas" })),
    listarContactosSegmento: vi.fn(async () => ok(opts.miembros ?? [])),
    obtenerContacto: vi.fn(async () => (opts.existente ? ok(opts.existente) : ko(404, "not found"))),
    crearContacto: vi.fn(async () => ok({ id: "c-prueba" })),
    anadirASegmento: vi.fn(async () => ok({})),
    crearBroadcast: vi.fn(async () => ok({ id: "b-prueba" })),
    enviarBroadcast: vi.fn(async () => ok({ id: "b-prueba" })),
    obtenerBroadcast: vi.fn(async () => ok({ id: "b-prueba", status: "sent" })),
  };
  return c;
}

const datos = { tipo: "anuncio" as const, titulo: "Hola", mensaje: "Texto", imagenUrl: null };

describe("enviarPrueba", () => {
  it("crea el Segment de pruebas con delivered@resend.dev y le manda el Broadcast [PRUEBA]", async () => {
    const c = cliente();
    const r = await enviarPrueba({ cliente: c, datos, from: "CT <n@send.miguelbenito.space>" });
    expect(r).toEqual({ ok: true, broadcastId: "b-prueba", destinatario: EMAIL_PRUEBA_POR_DEFECTO, segmentId: "seg-pruebas" });
    expect(c.crearSegmento).toHaveBeenCalledWith(NOMBRE_SEGMENTO_PRUEBAS);
    expect(c.crearContacto).toHaveBeenCalledWith("delivered@resend.dev", "Prueba", "seg-pruebas");
    const b = vi.mocked(c.crearBroadcast).mock.calls[0][0];
    expect(b.segmentId).toBe("seg-pruebas");
    expect(b.subject).toBe("[PRUEBA] Hola");
    expect(b.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
  });

  it("NUNCA envía si el Segment de pruebas tiene a alguien más", async () => {
    const c = cliente({
      segmentos: [{ id: "seg-p", name: NOMBRE_SEGMENTO_PRUEBAS }],
      miembros: [{ id: "c1", email: "delivered@resend.dev", unsubscribed: false }, { id: "c2", email: "cliente@gmail.com", unsubscribed: false }],
    });
    const r = await enviarPrueba({ cliente: c, datos, from: "x" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(c.crearBroadcast).not.toHaveBeenCalled();
  });

  it("NUNCA usa el Segment del newsletter como Segment de pruebas", async () => {
    const c = cliente();
    const r = await enviarPrueba({ cliente: c, datos, from: "x", segmentPruebaConfigurado: "seg-news", segmentNewsletterConfigurado: "seg-news" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(c.crearBroadcast).not.toHaveBeenCalled();
  });

  it("si la dirección de prueba ya existe en Resend, la mete en el Segment", async () => {
    const c = cliente({ existente: { id: "c7", email: "delivered@resend.dev", unsubscribed: false } });
    const r = await enviarPrueba({ cliente: c, datos, from: "x", segmentPruebaConfigurado: "seg-p" });
    expect(r.ok).toBe(true);
    expect(c.anadirASegmento).toHaveBeenCalledWith("c7", "seg-p");
    expect(c.crearContacto).not.toHaveBeenCalled();
  });

  it("dirección propia de prueba (NEWSLETTER_EMAIL_PRUEBA) ya en el Segment: no toca contactos", async () => {
    const c = cliente({ miembros: [{ id: "c8", email: "Yo@Casatomas.es", unsubscribed: false }] });
    const r = await enviarPrueba({ cliente: c, datos, from: "x", emailPrueba: "yo@casatomas.es", segmentPruebaConfigurado: "seg-p" });
    expect(r).toMatchObject({ ok: true, destinatario: "yo@casatomas.es" });
    expect(c.crearContacto).not.toHaveBeenCalled();
    expect(c.anadirASegmento).not.toHaveBeenCalled();
  });

  it("error de Resend al enviar -> 502 con el motivo", async () => {
    const c = cliente();
    vi.mocked(c.enviarBroadcast).mockResolvedValueOnce(ko(403, "The example.com domain is not verified"));
    const r = await enviarPrueba({ cliente: c, datos, from: "x" });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(!r.ok && r.error).toMatch(/not verified/);
  });
});
