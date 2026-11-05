// @vitest-environment node
/** notificar-video con tipo «reel» (fase 6 de Instagram): tipo, sección, autorización y carga del push. */
import { describe, expect, it } from "vitest";
import { autorizarNotificacionReel, construirCargaReel, leerTipo, seccionDeTipo } from "../logica.ts";

const T = {
  id: "11111111-2222-4333-8444-555555555555",
  pieza_id: "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f",
  estado: "listo",
  error: null,
  creado_por: "u-panel",
  procesado_por: "u-render",
};

describe("notificar-video · reels", () => {
  it("lee el tipo «reel» y pide la sección marketing (los demás, la carta)", () => {
    expect(leerTipo({ tipo: "reel" })).toBe("reel");
    expect(seccionDeTipo("reel")).toBe("marketing");
    expect(seccionDeTipo("video")).toBe("gestor_carta");
    expect(seccionDeTipo("recorte")).toBe("gestor_carta");
  });

  it("solo avisa el trabajador o quien lo encargó, y con el trabajo terminado", () => {
    expect(autorizarNotificacionReel(T, "u-render")).toEqual({ ok: true });
    expect(autorizarNotificacionReel(T, "u-panel")).toEqual({ ok: true });
    expect(autorizarNotificacionReel(T, "otro")).toMatchObject({ ok: false, status: 403 });
    expect(autorizarNotificacionReel({ ...T, estado: "renderizando" }, "u-render")).toMatchObject({ ok: false, status: 409 });
  });

  it("la notificación abre la pestaña Reels con la pieza", () => {
    const c = construirCargaReel(T);
    expect(c).toMatchObject({ titulo: "Reel listo", estado: "listo", url: `/instagram?tab=reels&pieza=${T.pieza_id}`, tag: `reel-${T.pieza_id}` });
    const e = construirCargaReel({ ...T, estado: "error", error: "ffmpeg no está instalado" });
    expect(e.titulo).toMatch(/No se pudo/);
    expect(e.cuerpo).toContain("ffmpeg no está instalado");
  });
});
