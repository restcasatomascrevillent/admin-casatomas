/**
 * Fotos de la carta en la biblioteca de Instagram: platos activos con foto de
 * la marca → Foto (tipo «plato», id «carta:<id>»), aptitud por medidas reales
 * (sin medidas no se bloquea), URL solo del bucket «platos» de NUESTRO
 * Supabase y validación de la pieza con un id «carta:…».
 */
import { describe, expect, it } from "vitest";
import {
  fotoDesdePlato,
  fotoPreparable,
  fotosDesdePlatos,
  idFotoCarta,
  platoIdDeFoto,
  rutaPlatoDeUrl,
  type FilaPlatoFoto,
} from "../fotos";
import { validarPieza, type OpcionesValidacion } from "../esquema";
import { plantillaPrueba } from "./fixtures/plantilla-prueba";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const url = (n: string) => `${SB}/storage/v1/object/public/platos/${n}.webp`;
const plato = (o: Partial<FilaPlatoFoto> = {}): FilaPlatoFoto => ({
  id: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  nombre: " Chuleta de vaca ",
  categoria: "Carnes",
  imagen_url: url("chuleta"),
  activado: true,
  restaurante: true,
  touza: false,
  ...o,
});

describe("ids de las fotos de la carta", () => {
  it("«carta:<id>» ida y vuelta; ids raros no valen", () => {
    expect(idFotoCarta("abc_1-2")).toBe("carta:abc_1-2");
    expect(platoIdDeFoto("carta:abc_1-2")).toBe("abc_1-2");
    for (const malo of ["carta:", "carta:a/b", "carta:a b", "carta:../x", "drive:1FotoDeDrive00000001", "abc", 42, null]) expect(platoIdDeFoto(malo)).toBeNull();
  });

  it("fotoPreparable distingue Drive y carta, y deja fuera el resto", () => {
    expect(fotoPreparable("drive:1FotoDeDrive00000001")).toEqual({ origen: "drive", id: "1FotoDeDrive00000001" });
    expect(fotoPreparable("carta:p1")).toEqual({ origen: "carta", id: "p1" });
    expect(fotoPreparable("ct-salon-1")).toBeNull();
    expect(fotoPreparable("carta:")).toBeNull();
  });
});

describe("fotosDesdePlatos (biblioteca con platos)", () => {
  it("solo platos activos, con foto y de la marca; tipo «plato» y descripción nombre · categoría", () => {
    const filas = [
      plato({ id: "ct1" }),
      plato({ id: "tz1", restaurante: false, touza: true, nombre: "Croquetas", categoria: null }),
      plato({ id: "ambos", restaurante: true, touza: true, nombre: "Pulpo", categoria: "Mar" }),
      plato({ id: "inactivo", activado: false }),
      plato({ id: "sinfoto", imagen_url: null }),
      plato({ id: "vacia", imagen_url: "  " }),
      plato({ id: "id raro" }),
      plato({ id: "ct1" }), // repetido
    ];
    const ct = fotosDesdePlatos(filas, "casa-tomas");
    expect(ct.map((f) => f.id)).toEqual(["carta:ct1", "carta:ambos"]);
    expect(ct[0]).toMatchObject({ marca: "casa-tomas", tipo: "plato", descripcion: "Chuleta de vaca · Carnes", platoId: "ct1", urlCarta: url("chuleta"), ruta: "" });
    const tz = fotosDesdePlatos(filas, "touza");
    expect(tz.map((f) => f.id)).toEqual(["carta:tz1", "carta:ambos"]);
    expect(tz[0].descripcion).toBe("Croquetas");
  });

  it("aptitud post/story con las medidas reales (misma regla que Drive); sin medidas, 0×0 y no apta todavía", () => {
    const filas = [plato({ id: "v" }), plato({ id: "h" }), plato({ id: "s" })];
    const [v, h, s] = fotosDesdePlatos(filas, "casa-tomas", { v: { ancho: 1080, alto: 1920 }, h: { ancho: 1920, alto: 1080 } });
    expect(v).toMatchObject({ ancho: 1080, alto: 1920, aptaPost: true, aptaStory: true });
    expect(h).toMatchObject({ aptaPost: false, aptaStory: false });
    expect(s).toMatchObject({ ancho: 0, alto: 0, aptaPost: false, aptaStory: false });
    expect(fotoDesdePlato(plato(), "casa-tomas", { ancho: 1.5, alto: -1 })).toMatchObject({ ancho: 0, alto: 0 });
  });
});

describe("rutaPlatoDeUrl", () => {
  it("acepta solo el bucket «platos» de NUESTRO Supabase", () => {
    expect(rutaPlatoDeUrl(url("platos/chuleta"), SB)).toBe("platos/chuleta.webp");
    for (const mala of [
      "https://evil.example.com/storage/v1/object/public/platos/a.webp",
      "https://haqmmdfdzzatdnrrcgez.supabase.co/storage/v1/object/public/platos/a.webp",
      `${SB}.evil.com/storage/v1/object/public/platos/a.webp`,
      `${SB.replace("https:", "http:")}/storage/v1/object/public/platos/a.webp`,
      `https://u:p@sfonaclosuafvlhutkon.supabase.co/storage/v1/object/public/platos/a.webp`,
      `${SB}/storage/v1/object/public/instagram/a.webp`,
      `${SB}/storage/v1/object/public/platos/../instagram/a.webp`,
      `${SB}/storage/v1/object/public/platos/%2e%2e/a.webp`,
      `${SB}/storage/v1/object/sign/platos/a.webp`,
      "http://169.254.169.254/latest/meta-data/",
      42,
    ]) {
      expect(rutaPlatoDeUrl(mala, SB), String(mala)).toBeNull();
    }
  });
});

describe("validarPieza con una foto de la carta", () => {
  const opciones: OpcionesValidacion = { buscarPlantilla: (id: string) => (id === "prueba-casa-tomas" ? plantillaPrueba("casa-tomas") : undefined) };
  const pieza = { marca: "casa-tomas", plantilla: "prueba-casa-tomas", formato: "post", foto: "carta:ct1", titular: "Chuleta" };

  it("acepta «carta:<id>» si está en el catálogo y cubre el formato", () => {
    const fotos = fotosDesdePlatos([plato({ id: "ct1" })], "casa-tomas", { ct1: { ancho: 1080, alto: 1350 } });
    const r = validarPieza(pieza, { ...opciones, fotos });
    expect(r.ok).toBe(true);
    expect(r.datos?.foto).toBe("carta:ct1");
  });

  it("rechaza la foto de la carta si no está en el catálogo, es pequeña o es de otra marca", () => {
    expect(validarPieza(pieza, { ...opciones, fotos: [] }).problemas?.join(" ")).toMatch(/«carta:ct1» no está en el catálogo/);
    const pequena = fotosDesdePlatos([plato({ id: "ct1" })], "casa-tomas", { ct1: { ancho: 500, alto: 500 } });
    expect(validarPieza(pieza, { ...opciones, fotos: pequena }).problemas?.join(" ")).toMatch(/tendría que ampliarse/);
    const deTouza = fotosDesdePlatos([plato({ id: "ct1", restaurante: false, touza: true })], "touza", { ct1: { ancho: 1080, alto: 1350 } });
    expect(validarPieza(pieza, { ...opciones, fotos: deTouza }).problemas?.join(" ")).toMatch(/solo puede usar fotos de su marca/);
  });
});
