/**
 * Contrato de prepararYPublicar con la API simulada: progreso «Preparando
 * imágenes n/N → Publicando…», reintentos del render (y no de la
 * publicación), caché de imágenes al reintentar y validaciones previas.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

import { ErrorInstagram } from "@/components/marketing/instagram/api";
import type { FotoParaMontar } from "@/lib/instagram/montar";
import { crearApiPublicacionSimulada, ErrorPublicarMovil, prepararYPublicar, problemasPieza, type CacheRender, type PiezaMovil, type ProgresoPublicar } from "../publicar";

const sinEspera = { dormir: async () => {}, esperarConexion: async () => {}, enLinea: () => true };

function pieza(n: number, extra: Partial<PiezaMovil> = {}): PiezaMovil {
  const fotos: FotoParaMontar[] = Array.from({ length: n }, (_, i) => ({ id: `subida:${i}`, url: `https://x.supabase.co/storage/v1/object/public/instagram/tmp/${i}.jpg`, ancho: 1080, alto: 1350 }));
  return {
    marca: "casa-tomas",
    formato: n === 1 ? "post" : "carrusel",
    fotos,
    diapositivas: fotos.map((f, i) => ({ foto: f.id, plantilla: "ct-foto-titular", datos: { titular: `T${i}` }, altText: `Alt ${i}` })),
    caption: "Llegó la centolla #Crevillent",
    ...extra,
  };
}

describe("prepararYPublicar", () => {
  it("carrusel de 6: prepara las 6 en orden y publica con un texto alternativo por imagen", async () => {
    const api = crearApiPublicacionSimulada();
    const progreso: ProgresoPublicar[] = [];
    const r = await prepararYPublicar(pieza(6), { cuando: { tipo: "ahora" }, api, onProgreso: (p) => progreso.push(p), grupo: "g1" });
    expect(r.estado).toBe("publicada");
    expect(r.permalink).toMatch(/instagram\.com\/p\//);
    expect(api.renders.map((x) => x.indice)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(api.renders.every((x) => x.total === 6 && x.grupo === "g1")).toBe(true);
    expect(api.publicadas[0].piezaIds).toHaveLength(6);
    expect(api.publicadas[0].altTexts).toEqual(["Alt 0", "Alt 1", "Alt 2", "Alt 3", "Alt 4", "Alt 5"]);
    expect(progreso[0]).toEqual({ fase: "preparando", hechas: 0, total: 6 });
    expect(progreso).toContainEqual({ fase: "preparando", hechas: 3, total: 6 });
    expect(progreso.at(-1)).toEqual({ fase: "publicando" });
  });

  it("1 foto → post; programar usa la API de programar", async () => {
    const api = crearApiPublicacionSimulada();
    const instante = new Date(Date.now() + 24 * 3600 * 1000);
    const r = await prepararYPublicar(pieza(1), { cuando: { tipo: "programar", instante }, api });
    expect(r.estado).toBe("programada");
    expect(r.programadaPara).toBe(instante.toISOString());
    expect(api.programadas[0].formato).toBe("post");
    expect(api.publicadas).toHaveLength(0);
  });

  it("reintenta el render si falla la red", async () => {
    const api = crearApiPublicacionSimulada({ fallarRender: (n) => (n === 2 ? new ErrorInstagram("Sin conexión", "red") : null) });
    const progreso: ProgresoPublicar[] = [];
    await prepararYPublicar(pieza(3), { cuando: { tipo: "ahora" }, api, reintento: sinEspera, onProgreso: (p) => progreso.push(p) });
    expect(api.renders).toHaveLength(3);
    expect(progreso).toContainEqual({ fase: "reintentando", sinConexion: false });
  });

  it("no reintenta una imagen que no pasa la validación (422)", async () => {
    const api = crearApiPublicacionSimulada({ fallarRender: () => new ErrorInstagram("El titular no cabe", "validacion", 422) });
    await expect(prepararYPublicar(pieza(2), { cuando: { tipo: "ahora" }, api, reintento: sinEspera })).rejects.toMatchObject({ tipo: "render" });
  });

  it("si publicar falla NO se repite solo; al reintentar, las imágenes salen de la caché", async () => {
    const api = crearApiPublicacionSimulada({ fallarPublicar: (n) => (n === 1 ? new ErrorInstagram("Sin conexión", "red") : null) });
    const cache: CacheRender = new Map();
    await expect(prepararYPublicar(pieza(4), { cuando: { tipo: "ahora" }, api, cache, reintento: sinEspera })).rejects.toBeInstanceOf(ErrorPublicarMovil);
    expect(api.publicadas).toHaveLength(0);
    expect(api.renders).toHaveLength(4);
    const r = await prepararYPublicar(pieza(4), { cuando: { tipo: "ahora" }, api, cache, reintento: sinEspera });
    expect(r.estado).toBe("publicada");
    expect(api.renders).toHaveLength(4); // ninguna imagen repetida
  });

  it("valida antes de llamar a nada", async () => {
    const api = crearApiPublicacionSimulada();
    await expect(prepararYPublicar(pieza(2, { caption: "" }), { cuando: { tipo: "ahora" }, api })).rejects.toMatchObject({ tipo: "validacion" });
    await expect(prepararYPublicar(pieza(1), { cuando: { tipo: "programar", instante: new Date(Date.now() + 60_000) }, api })).rejects.toMatchObject({ tipo: "validacion" });
    expect(api.renders).toHaveLength(0);
    expect(problemasPieza(pieza(2, { formato: "post" }))).toContain("Un post lleva una sola imagen.");
    expect(problemasPieza(pieza(1, { caption: `x ${Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ")}` }))[0]).toMatch(/30 hashtags/);
    const p = pieza(2);
    expect(problemasPieza({ ...p, fotos: p.fotos.slice(0, 1) })).toContain("Una imagen usa una foto que ya no está.");
  });
});
