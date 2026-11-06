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
  driveIdDeFoto,
  fotoDesdeDrive,
  fotoDesdeFila,
  idFotoDrive,
  rutaTmpDeUrl,
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

describe("fotos de Google Drive", () => {
  const DRIVE = "1FotoDeDrive0000000000001";
  const base = { driveId: DRIVE, nombre: "a.jpg", ancho: 1708, alto: 2560, tipo: "coctel", descripcion: " Mojito ", filaId: null, creada: null, problema: null };

  it("id «drive:<id>» y vuelta, solo con ids válidos", () => {
    expect(idFotoDrive(DRIVE)).toBe(`drive:${DRIVE}`);
    expect(driveIdDeFoto(`drive:${DRIVE}`)).toBe(DRIVE);
    expect(driveIdDeFoto("drive:../x")).toBeNull();
    expect(driveIdDeFoto("ct-salon-1")).toBeNull();
  });

  it("fotoDesdeDrive: aptitud por medidas, tipo null si no tiene fila, sin medidas o con problema no es apta", () => {
    expect(fotoDesdeDrive(base, "touza", "tmp/x.jpg")).toMatchObject({ id: `drive:${DRIVE}`, marca: "touza", ruta: "tmp/x.jpg", tipo: "coctel", aptaPost: true, aptaStory: true, descripcion: "Mojito", driveId: DRIVE });
    expect(fotoDesdeDrive({ ...base, tipo: null }, "touza")?.tipo).toBeNull();
    expect(fotoDesdeDrive({ ...base, tipo: "postre" }, "touza")?.tipo).toBeNull();
    expect(fotoDesdeDrive({ ...base, ancho: null, alto: null }, "touza")).toMatchObject({ ancho: 0, alto: 0, aptaPost: false, aptaStory: false });
    expect(fotoDesdeDrive({ ...base, problema: "HEIC" }, "touza")).toMatchObject({ aptaPost: false, aptaStory: false });
    expect(fotoDesdeDrive({ ...base, driveId: "x" }, "touza")).toBeNull();
  });

  it("validarPieza: una foto de Drive sin tipo vale para cualquier plantilla", () => {
    const pieza = { ...EJEMPLOS.find((e) => e.id === "ct-foto-titular-post")!.json, foto: `drive:${DRIVE}` };
    const foto = fotoDesdeDrive({ ...base, tipo: null }, "casa-tomas", "tmp/x.jpg")!;
    expect(validarPieza(pieza, { fotos: [foto] }).ok).toBe(true);
    const deCoctel = fotoDesdeDrive(base, "casa-tomas", "tmp/x.jpg")!;
    expect(validarPieza(pieza, { fotos: [deCoctel] }).problemas?.join(" ")).toMatch(/solo admite/);
  });

  it("rutaTmpDeUrl solo acepta tmp/<uuid> del bucket instagram del MISMO Supabase", () => {
    const SBX = "https://sfonaclosuafvlhutkon.supabase.co";
    const T = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(rutaTmpDeUrl(`${SBX}/storage/v1/object/public/instagram/tmp/${T}.jpg?v=1`, SBX)).toBe(`tmp/${T}.jpg`);
    expect(rutaTmpDeUrl(`${SBX}/storage/v1/object/public/instagram/tmp/${T}.png`, `${SBX}/`)).toBe(`tmp/${T}.png`);
    expect(rutaTmpDeUrl(`http://127.0.0.1:54321/storage/v1/object/public/instagram/tmp/${T}.jpg`, "http://127.0.0.1:54321")).toBe(`tmp/${T}.jpg`);
    for (const mala of [`https://otro.supabase.co/storage/v1/object/public/instagram/tmp/${T}.jpg`, `${SBX}/storage/v1/object/public/instagram/fotos/a.jpg`, "javascript:alert(1)", ""]) {
      expect(rutaTmpDeUrl(mala, SBX)).toBeNull();
    }
  });
});
