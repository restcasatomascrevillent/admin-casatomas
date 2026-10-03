/**
 * enviar-newsletter en modo Broadcast (broadcast.ts) e historial (registro.ts).
 * Resend y Supabase falsos: nunca se llama a Resend real.
 */
import { describe, it, expect, vi } from "vitest";
import { enviarBroadcast, puedeEnviarBroadcast, type ClienteBroadcast, type FilaEnvio, type RegistroEnvios } from "../broadcast.ts";
import { crearRegistroEnvios } from "../registro.ts";
import type { ResumenSync } from "../../_shared/resend-marketing/sync.ts";
import type { ResultadoResend } from "../../_shared/resend-marketing/cliente.ts";

const ok = <T>(data: T): ResultadoResend<T> => ({ ok: true, status: 200, data });
const ko = (status: number, tipo: string, mensaje: string): ResultadoResend<never> => ({ ok: false, status, tipo, mensaje });

function resumen(extra: Partial<ResumenSync> = {}): ResumenSync {
  return {
    estado: "ok",
    segmentId: "seg-1",
    segmentoCreado: false,
    contactosResend: 120,
    contactosSegmento: 120,
    ajenos: 0,
    destinatarios: 120,
    altas: 0,
    actualizados: 0,
    anadidosSegmento: 0,
    quitadosSegmento: 0,
    borrados: 0,
    bajasResend: 0,
    errores: [],
    pendientes: 0,
    bloqueaEnvio: false,
    peticiones: 2,
    mensajeError: null,
    ...extra,
  };
}

describe("puedeEnviarBroadcast", () => {
  it("todo cuadrado -> se puede", () => {
    expect(puedeEnviarBroadcast(resumen(), 1000)).toEqual({ ok: true });
  });
  it("la sincronización falló -> 502 y no se envía", () => {
    const v = puedeEnviarBroadcast(resumen({ estado: "error", mensajeError: "401 restricted_api_key" }), 1000);
    expect(v).toMatchObject({ ok: false, status: 502 });
    expect(!v.ok && v.error).toMatch(/restricted_api_key/);
  });
  it("queda algún dado de baja por quitar de Resend -> 409 (podría llegarle)", () => {
    expect(puedeEnviarBroadcast(resumen({ estado: "parcial", bloqueaEnvio: true }), 1000)).toMatchObject({ ok: false, status: 409 });
    const v = puedeEnviarBroadcast(resumen({ estado: "parcial", bloqueaEnvio: true, pendientes: 40 }), 1000);
    expect(!v.ok && v.error).toMatch(/quedan 40 cambios/);
  });
  it("un alta fallida no impide enviar", () => {
    expect(puedeEnviarBroadcast(resumen({ estado: "parcial", errores: [{ suscriptorId: "s", accion: "crear", mensaje: "x" }] }), 1000)).toEqual({ ok: true });
  });
  it("por encima del límite de contactos -> 409 (Resend devolvería 403)", () => {
    expect(puedeEnviarBroadcast(resumen({ contactosResend: 1001 }), 1000)).toMatchObject({ ok: false, status: 409 });
    expect(puedeEnviarBroadcast(resumen({ contactosResend: 1000 }), 1000)).toEqual({ ok: true });
  });
  it("sin destinatarios -> 400", () => {
    expect(puedeEnviarBroadcast(resumen({ destinatarios: 0 }), 1000)).toMatchObject({ ok: false, status: 400 });
  });
});

function falsos(opts: { crear?: ResultadoResend<{ id: string }>; enviar?: ResultadoResend<{ id: string }>; estado?: ResultadoResend<{ id: string; status?: string }> } = {}) {
  const orden: string[] = [];
  const cuerpos: Parameters<ClienteBroadcast["crearBroadcast"]>[0][] = [];
  const cliente: ClienteBroadcast = {
    crearBroadcast: vi.fn(async (b) => (orden.push("crear"), cuerpos.push(b), opts.crear ?? ok({ id: "b-1" }))),
    enviarBroadcast: vi.fn(async () => (orden.push("enviar"), opts.enviar ?? ok({ id: "b-1" }))),
    obtenerBroadcast: vi.fn(async () => (orden.push("estado"), opts.estado ?? ok({ id: "b-1", status: "sent" }))),
  };
  const filas: FilaEnvio[] = [];
  const estados: string[] = [];
  const registro: RegistroEnvios = {
    insertar: vi.fn(async (f) => (orden.push("registrar"), filas.push(f), "envio-1")),
    actualizarEstado: vi.fn(async (_id, e) => void estados.push(e)),
  };
  return { cliente, registro, orden, cuerpos, filas, estados };
}

const datos = { tipo: "oferta" as const, titulo: "2x1 en <arroces>", mensaje: "Solo este finde", imagenUrl: null };
const llamar = (f: ReturnType<typeof falsos>) =>
  enviarBroadcast({
    cliente: f.cliente,
    registro: f.registro,
    datos,
    from: "Casa Tomás <novedades@send.miguelbenito.space>",
    segmentId: "seg-1",
    destinatarios: 120,
    usuarioId: "u1",
    ahora: () => new Date("2026-10-03T10:30:00Z"),
  });

describe("enviarBroadcast", () => {
  it("crea el borrador, lo apunta en el historial y DESPUÉS lo envía", async () => {
    const f = falsos();
    const r = await llamar(f);
    expect(r).toEqual({ ok: true, broadcastId: "b-1", envioId: "envio-1" });
    expect(f.orden).toEqual(["crear", "registrar", "enviar"]);
    expect(f.filas[0]).toMatchObject({ canal: "broadcast", resend_broadcast_id: "b-1", estado: "pendiente", total_destinatarios: 120, enviado_por: "u1" });
    expect(f.estados).toEqual(["completado"]);
  });

  it("el HTML lleva el enlace de baja de Resend en el pie obligatorio y el texto escapado", async () => {
    const f = falsos();
    await llamar(f);
    const b = f.cuerpos[0];
    expect(b.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(b.html).toContain('data-pie-baja="obligatorio"');
    expect(b.html).toContain("2x1 en &lt;arroces&gt;");
    expect(b.subject).toBe("🎉 2x1 en <arroces>");
    expect(b.segmentId).toBe("seg-1");
    expect(b.name).toBe("Newsletter oferta 2026-10-03 10:30 UTC");
  });

  it("si no se puede crear el Broadcast no se registra nada", async () => {
    const f = falsos({ crear: ko(403, "validation_error", "The example.com domain is not verified") });
    const r = await llamar(f);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(!r.ok && r.error).toMatch(/dominio verificado/);
    expect(f.orden).toEqual(["crear"]);
  });

  it("403 por cuota de contactos: mensaje claro y envío 'fallido'", async () => {
    const f = falsos({ enviar: ko(403, "validation_error", "You have reached your contacts quota. Please upgrade your plan to send more emails.") });
    const r = await llamar(f);
    expect(!r.ok && r.error).toMatch(/límite de contactos/);
    expect(f.estados).toEqual(["fallido"]);
  });

  it("respuesta dudosa (500) pero Resend dice que salió -> completado, sin reenviar", async () => {
    const f = falsos({ enviar: ko(500, "application_error", "boom"), estado: ok({ id: "b-1", status: "queued" }) });
    const r = await llamar(f);
    expect(r.ok).toBe(true);
    expect(f.orden).toEqual(["crear", "registrar", "enviar", "estado"]);
    expect(f.cliente.enviarBroadcast).toHaveBeenCalledTimes(1);
    expect(f.estados).toEqual(["completado"]);
  });

  it("respuesta dudosa y sigue en borrador -> fallido", async () => {
    const f = falsos({ enviar: ko(0, "network_error", "timeout"), estado: ok({ id: "b-1", status: "draft" }) });
    const r = await llamar(f);
    expect(r).toMatchObject({ ok: false, status: 502, broadcastId: "b-1" });
    expect(f.estados).toEqual(["fallido"]);
  });

  it("respuesta dudosa y no se puede saber -> avisa de mirarlo en Resend y deja 'pendiente'", async () => {
    const f = falsos({ enviar: ko(0, "network_error", "timeout"), estado: ko(0, "network_error", "timeout") });
    const r = await llamar(f);
    expect(!r.ok && r.error).toMatch(/No se sabe si el newsletter ha salido/);
    expect(f.estados).toEqual([]);
  });

  it("API key sin Full access: lo dice", async () => {
    const f = falsos({ crear: ko(401, "restricted_api_key", "This API key is restricted to only send emails") });
    const r = await llamar(f);
    expect(!r.ok && r.error).toMatch(/Full access/);
  });
});

describe("crearRegistroEnvios", () => {
  function db(respuestas: { data?: unknown; error: { code?: string; message?: string } | null }[]) {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    return {
      inserts,
      updates,
      from: () => ({
        insert: (fila: unknown) => (inserts.push(fila), { select: () => ({ single: async () => respuestas.shift() }) }),
        update: (c: unknown) => (updates.push(c), { eq: async () => ({ error: null }) }),
      }),
    };
  }
  const fila: FilaEnvio = { asunto: "A", mensaje: "M", total_destinatarios: 3, enviado_por: "u1", tipo_newsletter: "anuncio", estado: "completado", canal: "transaccional" };

  it("inserta con canal", async () => {
    const d = db([{ data: { id: "e1" }, error: null }]);
    expect(await crearRegistroEnvios(d, () => {}).insertar(fila)).toBe("e1");
    expect(d.inserts[0]).toMatchObject({ canal: "transaccional" });
  });

  it("sin la migración 20261003193000 (columna canal inexistente) reintenta sin canal si es transaccional", async () => {
    const d = db([{ error: { code: "PGRST204", message: "Could not find the 'canal' column" } }, { data: { id: "e2" }, error: null }]);
    expect(await crearRegistroEnvios(d, () => {}).insertar(fila)).toBe("e2");
    expect(d.inserts[1]).not.toHaveProperty("canal");
    expect(d.inserts[1]).not.toHaveProperty("resend_broadcast_id");
  });

  it("un Broadcast no se registra a medias sin la columna (devuelve null, no tumba)", async () => {
    const log = vi.fn();
    const d = db([{ error: { code: "42703", message: 'column "canal" does not exist' } }]);
    expect(await crearRegistroEnvios(d, log).insertar({ ...fila, canal: "broadcast", resend_broadcast_id: "b" })).toBeNull();
    expect(d.inserts).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it("actualiza el estado", async () => {
    const d = db([]);
    await crearRegistroEnvios(d, () => {}).actualizarEstado("e1", "fallido");
    expect(d.updates).toEqual([{ estado: "fallido" }]);
  });
});
