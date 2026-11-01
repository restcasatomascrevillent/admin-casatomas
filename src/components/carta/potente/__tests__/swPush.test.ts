// public/sw-push.js en un «self» de mentira: push → showNotification con la
// URL del plato en data.url (el clic lo atiende public/sw.js).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { base64UrlABytes } from "../pushVideo";
import { construirCarga, rutaPlato, suscripcionCaducada, autorizarNotificacion, leerTrabajoId } from "../../../../../supabase/functions/notificar-video/logica";

const CODIGO = readFileSync(path.resolve(__dirname, "../../../../../public/sw-push.js"), "utf8");
const ORIGEN = "https://admin-casatomas.vercel.app";

function cargarSW(ventanas: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }> = []) {
  const oyentes: Record<string, (e: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const self = {
    location: new URL(`${ORIGEN}/sw.js?v=1`),
    registration: { showNotification },
    addEventListener: (tipo: string, fn: (e: unknown) => void) => {
      oyentes[tipo] = fn;
    },
  };
  const clients = { matchAll: vi.fn(async () => ventanas), openWindow };
  new Function("self", "clients", CODIGO)(self, clients);
  return { oyentes, showNotification, openWindow, clients };
}

async function lanzar(oyente: (e: unknown) => void, evento: Record<string, unknown>) {
  let espera: Promise<unknown> = Promise.resolve();
  oyente({ ...evento, waitUntil: (p: Promise<unknown>) => (espera = p) });
  await espera;
}

describe("sw-push.js", () => {
  it("push: muestra «Vídeo listo: <plato>» con imagen y la URL del plato", async () => {
    const sw = cargarSW();
    const carga = construirCarga(
      { id: "t1", plato_id: "p1", estado: "listo", error: null, creado_por: "u1", procesado_por: "u2" },
      { nombre: "Arroz meloso", imagen_url: "https://x.supabase.co/storage/v1/object/public/platos/p1.jpg" },
    );
    await lanzar(sw.oyentes.push, { data: { json: () => carga } });
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Vídeo listo: Arroz meloso",
      expect.objectContaining({
        image: carga.imagen,
        tag: "video-p1",
        data: expect.objectContaining({ url: `${ORIGEN}${rutaPlato("p1")}`, plato_id: "p1" }),
      }),
    );
  });

  it("push sin JSON: usa el texto y un título por defecto", async () => {
    const sw = cargarSW();
    await lanzar(sw.oyentes.push, { data: { json: () => { throw new Error("no json"); }, text: () => "hola" } });
    expect(sw.showNotification).toHaveBeenCalledWith("Panel Casa Tomás", expect.objectContaining({ body: "hola" }));
  });

  it("push con URL de otro origen: abre la raíz del panel", async () => {
    const sw = cargarSW();
    await lanzar(sw.oyentes.push, { data: { json: () => ({ titulo: "x", url: "https://malo.example/robar" }) } });
    expect(sw.showNotification).toHaveBeenCalledWith("x", expect.objectContaining({ data: expect.objectContaining({ url: `${ORIGEN}/` }) }));
  });
});

describe("notificar-video (lógica)", () => {
  const t = { id: "t1", plato_id: "p1", estado: "listo", error: null, creado_por: "movil", procesado_por: "pc" };
  it("solo autoriza a quien procesó o creó, y con el trabajo terminado", () => {
    expect(autorizarNotificacion(t, "pc")).toEqual({ ok: true });
    expect(autorizarNotificacion(t, "movil")).toEqual({ ok: true });
    expect(autorizarNotificacion(t, "otro")).toMatchObject({ ok: false, status: 403 });
    expect(autorizarNotificacion({ ...t, estado: "procesando" }, "pc")).toMatchObject({ ok: false, status: 409 });
  });
  it("carga de error y suscripciones caducadas", () => {
    const c = construirCarga({ ...t, estado: "error", error: "Sin WebGPU" }, { nombre: "Chuletón", imagen_url: "https://x/i.jpg" });
    expect(c.titulo).toBe("No se pudo hacer el vídeo: Chuletón");
    expect(c.cuerpo).toMatch(/^Sin WebGPU/);
    expect(c.imagen).toBeUndefined();
    expect([404, 410, 500, undefined].map(suscripcionCaducada)).toEqual([true, true, false, false]);
  });
  it("valida el trabajo_id", () => {
    expect(leerTrabajoId({ trabajo_id: "8f14e45f-ceea-4e7a-9b3c-1234567890ab" })).toBe("8f14e45f-ceea-4e7a-9b3c-1234567890ab");
    expect(leerTrabajoId({ trabajo_id: "1; drop table" })).toBeNull();
    expect(leerTrabajoId(null)).toBeNull();
  });
});

describe("pushVideo", () => {
  it("convierte la clave VAPID base64url a bytes", () => {
    expect(Array.from(base64UrlABytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});
