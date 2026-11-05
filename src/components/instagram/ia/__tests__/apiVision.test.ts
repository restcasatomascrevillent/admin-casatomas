/**
 * El panel manda a instagram-ia la URL de la foto ya preparada (fotoUrl) y
 * lee lo que la IA ha visto: vino, foto y aviso de rótulos con propuesta.
 */
import { describe, expect, it, vi } from "vitest";
import { montarPieza, sugerirTexto } from "../api";

describe("api de la IA: la foto", () => {
  it("manda fotoUrl y lee vino, foto y rótulos", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          modelo: "gpt-5.6-luna",
          vino: { id: "v1", nombre: "Domaine de la Combe" },
          foto: { tipo: "vino", queSeVe: "Una botella.", textoLegible: "Domaine de la Combe", altText: "Botella sobre fondo gris." },
          rotulos: { aviso: "Los rótulos de la pieza son los del ejemplo.", propuestos: { titular: "Un Ródano para el chuletón", cita: 3 } },
          variantes: [],
          descartadas: [],
          avisos: [],
        }),
        { status: 200 },
      ),
    );
    const url = "https://x.supabase.co/storage/v1/object/public/instagram/tmp/0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b.jpg";
    const r = await sugerirTexto(
      { marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular", foto: "drive:abc", fotoUrl: url },
      { tono: "cercano" },
      { fetch: f as unknown as typeof fetch, token: "jwt" },
    );
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toMatchObject({ foto: "drive:abc", fotoUrl: url });
    expect(r.vino).toEqual({ id: "v1", nombre: "Domaine de la Combe" });
    expect(r.foto).toMatchObject({ tipo: "vino", altText: "Botella sobre fondo gris." });
    expect(r.rotulos).toEqual({ aviso: "Los rótulos de la pieza son los del ejemplo.", propuestos: { titular: "Un Ródano para el chuletón" } });
  });

  it("sin foto preparada no manda fotoUrl", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ ok: true, variantes: [] }), { status: 200 }));
    const r = await sugerirTexto({ marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular", fotoUrl: null }, { tono: "cercano" }, { fetch: f as unknown as typeof fetch, token: "jwt" });
    expect(JSON.parse(String(f.mock.calls[0][1].body)).fotoUrl).toBeUndefined();
    expect(r.rotulos).toBeNull();
    expect(r.vino).toBeNull();
  });
});

describe("api de la IA: montar con IA", () => {
  it("manda montar_pieza con las fotos y lee la publicación montada", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          ok: true,
          formato: "carrusel",
          diapositivas: [{ foto: "drive:b", plantilla: "ct-foto-titular", datos: { titular: "Centolla" }, altText: "Centolla." }],
          caption: "Texto.",
          hashtags: ["#Marisco"],
          horaSugerida: "2026-11-07T13:00",
          resumen: "2 fotos de marisco.",
          avisos: [],
          sugerenciaId: null,
          modelo: "gpt-5.6-luna",
          descartadas: [],
        }),
        { status: 200 },
      ),
    );
    const fotos = [{ id: "drive:a", url: "https://x/a.jpg" }, { id: "drive:b", url: "https://x/b.jpg" }];
    const r = await montarPieza({ marca: "casa-tomas", fotos, formato: "auto", indicacion: "  para el finde " }, { fetch: f as unknown as typeof fetch, token: "jwt" });
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual({ accion: "montar_pieza", marca: "casa-tomas", fotos, formato: "auto", indicacion: "para el finde" });
    expect(r).toMatchObject({ formato: "carrusel", diapositivas: [{ foto: "drive:b", datos: { titular: "Centolla" } }], horaSugerida: "2026-11-07T13:00" });
  });
});
