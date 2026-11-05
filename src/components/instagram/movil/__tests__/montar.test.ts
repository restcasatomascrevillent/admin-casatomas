/**
 * Cliente de «Montar con IA» (instagram-ia → montar_pieza) con un fetch
 * falso: cuerpo enviado, respuesta saneada, errores (cuota sin reintentos) y
 * el modo simulado.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

import { URL_IA } from "@/components/instagram/ia/api";
import type { FotoParaMontar, PeticionMontar } from "@/lib/instagram/montar";
import { crearMontarSimulado, mensajeErrorMontar, montarPieza, normalizarMontaje } from "../montar";
import { documentoDiapositiva } from "../documento";

const fotos: FotoParaMontar[] = [
  { id: "subida:a", url: "https://x/a.jpg", ancho: 1080, alto: 1350 },
  { id: "subida:b", url: "https://x/b.jpg", ancho: 1080, alto: 1350 },
];
const peticion: PeticionMontar = { accion: "montar_pieza", marca: "casa-tomas", fotos, indicacion: "  llegó la centolla ", tono: "cercano" };
const json = (c: unknown, estado = 200) => new Response(JSON.stringify(c), { status: estado, headers: { "content-type": "application/json" } });

describe("montarPieza", () => {
  it("manda la petición del contrato y sanea la respuesta", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) =>
      json({
        ok: true,
        formato: "carrusel",
        diapositivas: [
          { foto: "subida:b", plantilla: "ct-foto-titular", datos: { titular: "Hola" }, altText: "B" },
          { foto: "subida:b", plantilla: "ct-foto-titular", datos: {}, altText: "repetida" },
          { foto: "subida:zzz", plantilla: "ct-foto-titular", datos: {}, altText: "inventada" },
          { foto: "subida:a", plantilla: "ct-foto-titular", datos: { titular: "Adiós" }, altText: "A" },
        ],
        caption: "Texto",
        hashtags: ["Crevillent", "#centolla"],
        horaSugerida: "no es fecha",
        resumen: "He entendido: 2 fotos de centolla.",
        avisos: [],
      }),
    );
    const r = await montarPieza(peticion, { fetch: f as unknown as typeof fetch, token: "jwt" });
    expect(f.mock.calls[0][0]).toBe(URL_IA);
    const cuerpo = JSON.parse(String(f.mock.calls[0][1].body));
    expect(cuerpo).toMatchObject({ accion: "montar_pieza", marca: "casa-tomas", formato: "auto", indicacion: "llegó la centolla", tono: "cercano" });
    expect(cuerpo.fotos.map((x: FotoParaMontar) => x.id)).toEqual(["subida:a", "subida:b"]);
    expect(r.diapositivas.map((d) => d.foto)).toEqual(["subida:b", "subida:a"]);
    expect(r.hashtags).toEqual(["#Crevillent", "#centolla"]);
    expect(r.horaSugerida).toBeNull();
  });

  it("cuota agotada: error de tipo «cupo» y mensaje claro (sin reintentar)", async () => {
    const f = vi.fn(async () => json({ ok: false, error: "Cupo diario agotado" }, 429));
    await expect(montarPieza(peticion, { fetch: f as unknown as typeof fetch, token: "jwt" })).rejects.toMatchObject({ tipo: "cupo" });
    expect(f).toHaveBeenCalledTimes(1);
    try {
      await montarPieza(peticion, { fetch: f as unknown as typeof fetch, token: "jwt" });
    } catch (e) {
      expect(mensajeErrorMontar(e)).toMatch(/gastado la IA/);
    }
  });

  it("sin fotos ni siquiera llama", async () => {
    const f = vi.fn();
    await expect(montarPieza({ ...peticion, fotos: [] }, { fetch: f as unknown as typeof fetch, token: "jwt" })).rejects.toMatchObject({ tipo: "rechazada" });
    expect(f).not.toHaveBeenCalled();
  });

  it("si la IA no devuelve imágenes válidas, falla", () => {
    expect(() => normalizarMontaje({ diapositivas: [{ foto: "otra" }] }, fotos)).toThrow(/ninguna imagen/);
  });

  it("un post se queda con una imagen", () => {
    const r = normalizarMontaje({ formato: "post", diapositivas: [{ foto: "subida:a" }, { foto: "subida:b" }] }, fotos);
    expect(r.formato).toBe("post");
    expect(r.diapositivas).toHaveLength(1);
  });
});

describe("montaje simulado y vista previa", () => {
  it("1 foto → post; varias → carrusel; las plantillas existen y se pintan", async () => {
    const m = crearMontarSimulado();
    const uno = await m({ ...peticion, fotos: fotos.slice(0, 1) });
    expect(uno.formato).toBe("post");
    const dos = await m(peticion);
    expect(dos.formato).toBe("carrusel");
    expect(dos.resumen).toMatch(/2 fotos/);
    expect(m.llamadas).toHaveLength(2);
    const html = documentoDiapositiva("casa-tomas", dos.formato, dos.diapositivas[0], fotos[0]);
    expect(html).toContain("https://x/a.jpg");
    expect(html).toContain(String(dos.diapositivas[0].datos.titular));
  });

  it("plantilla de otra marca: sin documento (se enseña la foto sola)", async () => {
    const m = crearMontarSimulado();
    const r = await m(peticion);
    expect(documentoDiapositiva("touza", r.formato, r.diapositivas[0], fotos[0])).toBeNull();
  });
});
