/**
 * Fotos subidas desde el panel (tabla instagram_fotos) en el núcleo:
 * fila → Foto, catálogo combinado, validarPieza con { fotos } y URL por ruta.
 */
import { describe, expect, it } from "vitest";
import {
  EJEMPLOS,
  FOTOS,
  buscarFoto,
  combinarCatalogo,
  construirDocumento,
  fotoDesdeFila,
  fotosDe,
  rutaFotoSubida,
  urlFoto,
  validarPieza,
} from "../index";

const ID = "5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const FILA = { id: ID, marca: "casa-tomas", ruta: rutaFotoSubida("casa-tomas", ID), ancho: 1708, alto: 2560, tipo: "plato", descripcion: " Chuleta " };
const BASE = "https://x.supabase.co/storage/v1/object/public/instagram";

describe("fotoDesdeFila", () => {
  it("da la forma del catálogo, con la aptitud calculada y marcada como subida", () => {
    expect(fotoDesdeFila(FILA)).toEqual({
      id: ID,
      marca: "casa-tomas",
      ruta: `fotos/casa-tomas/subidas/${ID}.jpg`,
      ancho: 1708,
      alto: 2560,
      tipo: "plato",
      aptaPost: true,
      aptaStory: true,
      descripcion: "Chuleta",
      subida: true,
    });
    expect(fotoDesdeFila({ ...FILA, ancho: 800, alto: 600 })).toMatchObject({ aptaPost: false, aptaStory: false });
  });

  it("descarta filas raras (marca, tipo, medidas o ruta fuera de subidas/)", () => {
    expect(fotoDesdeFila({ ...FILA, marca: "otra" })).toBeNull();
    expect(fotoDesdeFila({ ...FILA, tipo: "postre" })).toBeNull();
    expect(fotoDesdeFila({ ...FILA, ancho: 0 })).toBeNull();
    expect(fotoDesdeFila({ ...FILA, ruta: "piezas/2026-11/x.jpg" })).toBeNull();
    expect(fotoDesdeFila({ ...FILA, ruta: `fotos/touza/subidas/${ID}.jpg` })).toBeNull();
  });
});

describe("catálogo combinado", () => {
  it("añade las subidas detrás de las estáticas sin repetir ids", () => {
    const subida = fotoDesdeFila(FILA)!;
    const cat = combinarCatalogo([subida, subida, { ...subida, id: FOTOS[0].id }]);
    expect(cat).toHaveLength(FOTOS.length + 1);
    expect(cat.at(-1)).toBe(subida);
    expect(buscarFoto(ID, cat)).toBe(subida);
    expect(buscarFoto(ID)).toBeUndefined();
    expect(fotosDe("casa-tomas", "story", cat).map((f) => f.id)).toContain(ID);
    expect(fotosDe("touza", undefined, cat).map((f) => f.id)).not.toContain(ID);
  });
});

describe("validarPieza con una foto subida", () => {
  const pieza = { ...EJEMPLOS.find((e) => e.id === "ct-foto-titular-post")!.json, foto: ID };

  it("sin pasar el catálogo, la foto subida no existe (comportamiento de siempre)", () => {
    const r = validarPieza(pieza);
    expect(r.ok).toBe(false);
    expect(r.problemas).toContain(`La foto «${ID}» no está en el catálogo de fotos`);
  });

  it("con { fotos } la acepta y aplica las mismas reglas (marca, tipo y tamaño)", () => {
    const subida = fotoDesdeFila(FILA)!;
    const r = validarPieza(pieza, { fotos: combinarCatalogo([subida]) });
    expect(r.ok).toBe(true);
    expect(r.datos?.foto).toBe(ID);

    const pequena = fotoDesdeFila({ ...FILA, ancho: 600, alto: 800 })!;
    const r2 = validarPieza(pieza, { fotos: combinarCatalogo([pequena]) });
    expect(r2.ok).toBe(false);
    expect(r2.problemas?.join(" ")).toMatch(/tendría que ampliarse/);

    const deTouza = fotoDesdeFila({ ...FILA, marca: "touza", ruta: rutaFotoSubida("touza", ID) })!;
    expect(validarPieza(pieza, { fotos: combinarCatalogo([deTouza]) }).problemas?.join(" ")).toMatch(/solo puede usar fotos de su marca/);
  });

  it("urlFoto y construirDocumento usan la RUTA de la foto subida", () => {
    const cat = combinarCatalogo([fotoDesdeFila(FILA)!]);
    expect(urlFoto(BASE, ID, cat)).toBe(`${BASE}/fotos/casa-tomas/subidas/${ID}.jpg`);
    expect(() => urlFoto(BASE, ID)).toThrow(/no está en el catálogo/);
    const r = validarPieza(pieza, { fotos: cat });
    const html = construirDocumento(r.datos!, { baseRecursos: "/instagram", baseFotos: BASE, fotos: cat });
    expect(html).toContain(`${BASE}/fotos/casa-tomas/subidas/${ID}.jpg`);
  });
});
