// @vitest-environment node
/** notificar-video con tipo «encargo» (encargos de Instagram): cuerpo, autorización y carga del push. */
import { describe, expect, it } from "vitest";
import {
  ACCIONES_PUSH_ENCARGO,
  autorizarNotificacionEncargo,
  construirCargaEncargo,
  leerEventoId,
  leerTipo,
  referenciaEncargo,
  SECCIONES_ENCARGO,
  VIDA_AVISO_ENCARGO_MS,
} from "../logica.ts";

const AHORA = Date.parse("2026-11-10T10:00:00Z");
const EV = {
  id: "11111111-2222-4333-8444-555555555555",
  encargo_id: "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f",
  actor: "u-agencia",
  lado: "agencia",
  accion: "entregar",
  a_estado: "para_revisar",
  comentario: "Versión 2: más luz",
  created_at: "2026-11-10T09:58:00Z",
};

describe("notificar-video · encargos", () => {
  it("lee el tipo «encargo» y el evento_id (o trabajo_id)", () => {
    expect(leerTipo({ tipo: "encargo" })).toBe("encargo");
    expect(leerTipo({ tipo: "otro" })).toBeNull();
    expect(leerEventoId({ evento_id: EV.id })).toBe(EV.id);
    expect(leerEventoId({ trabajo_id: EV.id })).toBe(EV.id);
    expect(leerEventoId({ evento_id: "no-es-uuid" })).toBeNull();
    expect(SECCIONES_ENCARGO).toEqual(["marketing", "instagram_agencia"]);
  });

  it("solo avisa el autor del cambio, en los 15 minutos siguientes y de acciones que se avisan", () => {
    expect(autorizarNotificacionEncargo(EV, "u-agencia", AHORA)).toEqual({ ok: true });
    expect(autorizarNotificacionEncargo(EV, "u-restaurante", AHORA)).toMatchObject({ ok: false, status: 403 });
    expect(autorizarNotificacionEncargo({ ...EV, actor: null }, "u-agencia", AHORA)).toMatchObject({ ok: false, status: 403 });
    const viejo = new Date(AHORA - VIDA_AVISO_ENCARGO_MS - 1000).toISOString();
    expect(autorizarNotificacionEncargo({ ...EV, created_at: viejo }, "u-agencia", AHORA)).toMatchObject({ ok: false, status: 409 });
    expect(autorizarNotificacionEncargo({ ...EV, accion: "generando" }, "u-agencia", AHORA)).toMatchObject({ ok: false, status: 409 });
    for (const a of ["enviar", "aceptar", "rechazar", "entregar", "pedir_cambios", "aprobar", "cancelar", "comentar"]) {
      expect(ACCIONES_PUSH_ENCARGO).toContain(a);
    }
  });

  it("la notificación abre el encargo en la pestaña Encargos", () => {
    const c = construirCargaEncargo(EV, { id: EV.encargo_id, numero: 7, titulo: "Reel del mar" });
    expect(c).toMatchObject({
      titulo: "Encargo listo para revisar",
      url: `/instagram?tab=encargos&encargo=${EV.encargo_id}`,
      tag: `encargo-${EV.encargo_id}`,
      trabajo_id: EV.id,
      plato_id: EV.encargo_id,
      estado: "listo",
    });
    expect(c.cuerpo).toBe("ENC-0007 · Reel del mar: Versión 2: más luz");
    expect(construirCargaEncargo({ ...EV, accion: "rechazar", comentario: null }, null)).toMatchObject({
      titulo: "Oficiosos no puede hacer el encargo",
      cuerpo: "Encargo · sin título",
      estado: "error",
    });
    expect(construirCargaEncargo({ ...EV, comentario: "x".repeat(400) }, null).cuerpo.length).toBeLessThanOrEqual(180);
    expect(referenciaEncargo(12)).toBe("ENC-0012");
  });
});
