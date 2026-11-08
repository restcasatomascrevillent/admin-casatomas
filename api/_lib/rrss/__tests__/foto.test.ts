// @vitest-environment node
/**
 * Motor de fotos con sharp REAL: comprueba que el archivo exportado lleva las
 * modificaciones pedidas (medidas del formato, luz, color, rótulos y logo) y
 * que el original no se toca. Con RRSS_GUARDAR=<carpeta> deja los JPEG para
 * mirarlos.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { editarFoto, recetaFoto, colorSvg } from "../foto";
import { ESTILOS_IDS, type EstiloId } from "../../../../src/lib/rrss/estilos";
import { formatoSalida } from "../../../../src/lib/rrss/formatos";
import { piezaFotoNeutra, type PiezaFoto } from "../../../../src/lib/rrss/plan";

const MUESTRAS = path.resolve(__dirname, "../../../../public/instagram/reels/muestras");
const guardar = process.env.RRSS_GUARDAR;
const foto = (n: string) => readFileSync(path.join(MUESTRAS, n));

/** Diferencia media por píxel (0-255) entre dos imágenes del mismo tamaño en una zona. */
async function diferencia(a: Buffer, b: Buffer, r: { left: number; top: number; width: number; height: number }) {
  const [x, y] = await Promise.all([sharp(a).extract(r).raw().toBuffer(), sharp(b).extract(r).raw().toBuffer()]);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
}

async function media(buf: Buffer, r?: { left: number; top: number; width: number; height: number }) {
  const img = r ? sharp(buf).extract(r) : sharp(buf);
  const st = await img.stats();
  return st.channels.slice(0, 3).map((c) => c.mean);
}

function pieza(extra: Partial<PiezaFoto> = {}): PiezaFoto {
  return { ...piezaFotoNeutra("a"), ...extra };
}

describe("editarFoto", () => {
  it("encuadra al formato de cada canal y devuelve un JPEG de esas medidas", async () => {
    for (const [canal, tipo, w, h] of [["instagram", "publicacion", 1080, 1350], ["instagram", "story", 1080, 1920], ["facebook", "carrusel", 1080, 1080]] as const) {
      const r = await editarFoto(foto("arroz.jpg"), recetaFoto(pieza(), "casa-tomas", "minimalista", formatoSalida(canal, tipo)));
      const m = await sharp(r.jpeg).metadata();
      expect([m.format, m.width, m.height]).toEqual(["jpeg", w, h]);
      expect(m.exif).toBeUndefined();
    }
  });

  it("la corrección de luz y color cambia de verdad los píxeles", async () => {
    const f = formatoSalida("instagram", "publicacion");
    const neutra = await editarFoto(foto("sala.jpg"), { ...recetaFoto(pieza(), "casa-tomas", "minimalista", f), tratamiento: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, negros: 0, vineta: 0, nitidez: 0 } });
    const clara = await editarFoto(foto("sala.jpg"), { ...recetaFoto(pieza(), "casa-tomas", "minimalista", f), tratamiento: { exposicion: 0.8, contraste: 0, saturacion: 0, temperatura: 0, negros: 0, vineta: 0, nitidez: 0 } });
    const calida = await editarFoto(foto("sala.jpg"), { ...recetaFoto(pieza(), "casa-tomas", "minimalista", f), tratamiento: { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 1, negros: 0, vineta: 0, nitidez: 0 } });
    const [rn, gn, bn] = await media(neutra.jpeg);
    const [rc, gc, bc] = await media(clara.jpeg);
    const [rt, , bt] = await media(calida.jpeg);
    expect(rc + gc + bc).toBeGreaterThan((rn + gn + bn) * 1.1);
    expect(rt - bt).toBeGreaterThan(rn - bn + 8);
  });

  it("el zoom y el centro del encuadre cambian el recorte", async () => {
    const f = formatoSalida("instagram", "publicacion");
    const a = await editarFoto(foto("chuleton.jpg"), recetaFoto(pieza({ encuadre: { x: 0.5, y: 0.5, zoom: 1 } }), "casa-tomas", "minimalista", f));
    const b = await editarFoto(foto("chuleton.jpg"), recetaFoto(pieza({ encuadre: { x: 0.3, y: 0.4, zoom: 2 } }), "casa-tomas", "minimalista", f));
    expect(b.recorte.width).toBeLessThan(a.recorte.width);
    expect(b.recorte.left).not.toBe(a.recorte.left);
  });

  it("los rótulos, la píldora del CTA y el logo quedan pintados en la imagen", async () => {
    const f = formatoSalida("instagram", "publicacion");
    const sin = await editarFoto(foto("gambas.jpg"), recetaFoto(pieza(), "casa-tomas", "moderno", f));
    const con = await editarFoto(
      foto("gambas.jpg"),
      recetaFoto(pieza({ rotulos: { antetitulo: "Del mar", titulo: "Gamba roja a la plancha", cta: "Reserva tu mesa", posicion: "abajo" }, logo: true }), "casa-tomas", "moderno", f),
    );
    // Abajo a la izquierda va el bloque pizarra con el titular: tiene que cambiar mucho.
    expect(await diferencia(sin.jpeg, con.jpeg, { left: 72, top: 1000, width: 500, height: 250 })).toBeGreaterThan(25);
    // Logo arriba a la derecha.
    expect(await diferencia(sin.jpeg, con.jpeg, { left: 1080 - 72 - 151, top: 72, width: 151, height: 60 })).toBeGreaterThan(8);
    // Y fuera de los rótulos y del logo la foto es la misma.
    expect(await diferencia(sin.jpeg, con.jpeg, { left: 300, top: 300, width: 400, height: 300 })).toBeLessThan(2);
  });

  it("no toca el original", async () => {
    const original = foto("ostras.jpg");
    const copia = Buffer.from(original);
    await editarFoto(original, recetaFoto(pieza({ rotulos: { titulo: "Ostras", posicion: "auto" } }), "touza", "elegante", formatoSalida("instagram", "story")));
    expect(original.equals(copia)).toBe(true);
  });

  it("la transformación creativa solo se aplica con máscara; sin ella avisa y deja la escena", async () => {
    const f = formatoSalida("instagram", "publicacion");
    const sinMascara = await editarFoto(foto("vino-ritus.jpg"), recetaFoto(pieza({ creativo: "fondo-marca" }), "casa-tomas", "minimalista", f));
    expect(sinMascara.avisos.join(" ")).toMatch(/no está disponible/);
    // Máscara de prueba: el centro es el producto.
    const mascara = async () =>
      sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#000" } })
        .composite([{ input: await sharp({ create: { width: 400, height: 900, channels: 3, background: "#fff" } }).png().toBuffer(), left: 340, top: 225 }])
        .greyscale()
        .png()
        .toBuffer();
    const con = await editarFoto(foto("vino-ritus.jpg"), recetaFoto(pieza({ creativo: "fondo-marca" }), "casa-tomas", "minimalista", f), { mascara });
    // La esquina pasa a ser el papel de la marca (muy claro).
    const [r, g, b] = await media(con.jpeg, { left: 0, top: 0, width: 200, height: 200 });
    expect(Math.min(r, g, b)).toBeGreaterThan(190);
  });

  it("los 6 estilos producen imágenes distintas entre sí", async () => {
    const f = formatoSalida("instagram", "publicacion");
    const medias: number[][] = [];
    for (const e of ESTILOS_IDS) {
      const r = await editarFoto(
        foto("arroz.jpg"),
        recetaFoto(pieza({ rotulos: { antetitulo: "Temporada", titulo: "Arroz del señorito", subtitulo: "Con producto de la lonja de Santa Pola", cta: "Reserva", posicion: "auto" }, logo: true }), "casa-tomas", e as EstiloId, f),
      );
      medias.push(await media(r.jpeg));
      if (guardar) {
        mkdirSync(guardar, { recursive: true });
        writeFileSync(path.join(guardar, `estilo-${e}.jpg`), r.jpeg);
      }
    }
    const distintas = new Set(medias.map((m) => m.map((x) => Math.round(x)).join(",")));
    expect(distintas.size).toBe(ESTILOS_IDS.length);
  }, 60_000);

  it("colorSvg entiende rgba y hex", () => {
    expect(colorSvg("rgba(10,20,30,0.5)")).toEqual({ color: "rgb(10,20,30)", opacidad: 0.5 });
    expect(colorSvg("#394147")).toEqual({ color: "#394147", opacidad: 1 });
  });
});
