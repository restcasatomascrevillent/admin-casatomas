/**
 * newsletter-sync-resend: acción, autenticación (cron vs panel) y respuestas (peticion.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { autenticar, compararTiempoConstante, construirEstado, leerAccion, respuestaSincronizacion } from "../peticion.ts";
import type { PasadaResend } from "../../_shared/resend-marketing/repositorio.ts";

const cab = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("leerAccion", () => {
  it("GET = estado; POST sin cuerpo o sin accion = sincronizar (lo que manda el cron)", () => {
    expect(leerAccion("GET", null)).toBe("estado");
    expect(leerAccion("POST", null)).toBe("sincronizar");
    expect(leerAccion("POST", {})).toBe("sincronizar");
    expect(leerAccion("POST", { accion: "estado" })).toBe("estado");
    expect(leerAccion("POST", { accion: "sincronizar" })).toBe("sincronizar");
  });
  it("acciones desconocidas -> null", () => {
    expect(leerAccion("POST", { accion: "borrar_todo" })).toBeNull();
    expect(leerAccion("POST", "texto")).toBeNull();
  });
});

describe("compararTiempoConstante", () => {
  it("compara bien", () => {
    expect(compararTiempoConstante("abc", "abc")).toBe(true);
    expect(compararTiempoConstante("abc", "abd")).toBe(false);
    expect(compararTiempoConstante("abc", "abcd")).toBe(false);
    expect(compararTiempoConstante("", "x")).toBe(false);
  });
});

describe("autenticar", () => {
  const usuarioOk = vi.fn(async () => ({ ok: true as const, userId: "u1" }));

  it("cron con el secreto correcto", async () => {
    const r = await autenticar(cab({ "x-webhook-secret": "s3cr3t" }), "sincronizar", { secretoCron: "s3cr3t", comprobarUsuario: usuarioOk });
    expect(r).toEqual({ ok: true, origen: "cron", usuarioId: null });
  });

  it("cron con secreto incorrecto -> 401, sin mirar el JWT", async () => {
    const comprobar = vi.fn();
    const r = await autenticar(cab({ "x-webhook-secret": "malo", authorization: "Bearer x" }), "sincronizar", { secretoCron: "s3cr3t", comprobarUsuario: comprobar });
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(comprobar).not.toHaveBeenCalled();
  });

  it("FALLA CERRADO: cabecera de cron sin NEWSLETTER_SYNC_CRON_SECRET configurado -> 500", async () => {
    const r = await autenticar(cab({ "x-webhook-secret": "" }), "sincronizar", { secretoCron: "", comprobarUsuario: usuarioOk });
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it("sin ninguna cabecera -> 401", async () => {
    expect(await autenticar(cab({}), "estado", { secretoCron: "s", comprobarUsuario: usuarioOk })).toMatchObject({ ok: false, status: 401 });
  });

  it("panel: sincronizar pide «Editar» (06/11/2026, no basta «Ver»); estado, solo «Ver»", async () => {
    const comprobar = vi.fn(async () => ({ ok: true as const, userId: "u7" }));
    expect(await autenticar(cab({ authorization: "Bearer jwt" }), "sincronizar", { secretoCron: "s", comprobarUsuario: comprobar })).toEqual({
      ok: true,
      origen: "panel",
      usuarioId: "u7",
    });
    expect(comprobar).toHaveBeenLastCalledWith("editar");
    await autenticar(cab({ authorization: "Bearer jwt" }), "estado", { secretoCron: "s", comprobarUsuario: comprobar });
    expect(comprobar).toHaveBeenLastCalledWith("leer");
  });

  it("panel sin permiso de Marketing -> 403", async () => {
    const r = await autenticar(cab({ authorization: "Bearer jwt" }), "sincronizar", {
      secretoCron: "s",
      comprobarUsuario: async () => ({ ok: false, status: 403, error: "No tienes permiso para sincronizar el newsletter" }),
    });
    expect(r).toEqual({ ok: false, status: 403, error: "No tienes permiso para sincronizar el newsletter" });
  });
});

const pasada = (extra: Partial<PasadaResend> = {}): PasadaResend => ({
  id: "p1",
  origen: "cron",
  estado: "ok",
  iniciada_at: "2026-10-03T05:30:00Z",
  terminada_at: "2026-10-03T05:30:20Z",
  segment_id: "seg-db",
  contactos_resend: 850,
  contactos_segmento: 840,
  contactos_ajenos: 10,
  destinatarios: 840,
  altas: 3,
  actualizados: 0,
  borrados: 1,
  bajas_resend: 0,
  errores: 0,
  pendientes: 0,
  mensaje_error: null,
  ...extra,
});

describe("construirEstado", () => {
  it("cuota y Segment salen de la última pasada terminada; el secret manda sobre la BD", () => {
    const e = construirEstado({ canal: "broadcast", apiKey: true, segmentIdEnv: "", cronSecret: false, limite: 1000, ultima: pasada(), ultimaTerminada: pasada() });
    expect(e).toMatchObject({ canal: "broadcast", contactos_resend: 850, nivel_cuota: "aviso", configurado: { api_key: true, segment_id: "seg-db", cron_secret: false } });
    expect(construirEstado({ canal: "transaccional", apiKey: false, segmentIdEnv: "seg-env", cronSecret: true, limite: 1000, ultima: null, ultimaTerminada: pasada() }).configurado.segment_id).toBe("seg-env");
  });
  it("sin pasadas todavía", () => {
    expect(construirEstado({ canal: "transaccional", apiKey: false, segmentIdEnv: null, cronSecret: false, limite: 1000, ultima: null, ultimaTerminada: null })).toMatchObject({
      contactos_resend: null,
      nivel_cuota: "ok",
      configurado: { segment_id: null },
    });
  });
});

describe("respuestaSincronizacion", () => {
  it("resume sin emails y limita los errores", () => {
    const errores = Array.from({ length: 30 }, (_, i) => ({ suscriptorId: `s${i}`, accion: "crear", mensaje: "422" }));
    const r = respuestaSincronizacion(
      {
        estado: "parcial",
        segmentId: "seg",
        segmentoCreado: true,
        contactosResend: 1000,
        contactosSegmento: 990,
        ajenos: 10,
        destinatarios: 990,
        altas: 5,
        actualizados: 1,
        anadidosSegmento: 0,
        quitadosSegmento: 0,
        borrados: 2,
        bajasResend: 1,
        errores,
        pendientes: 0,
        bloqueaEnvio: false,
        peticiones: 20,
        mensajeError: null,
      },
      "p1",
      1000,
    );
    expect(r).toMatchObject({ success: true, estado: "parcial", nivel_cuota: "lleno", segmento_creado: true, total_errores: 30 });
    expect(r.errores).toHaveLength(20);
    expect(r.error).toBeUndefined();
  });
});
