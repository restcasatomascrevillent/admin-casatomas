// Núcleo de Instagram sin navegador: registro, tokens, recursos, catálogo,
// construirDocumento y que el código para Playwright es autocontenido.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUCKET_INSTAGRAM,
  CODIGO_COMPROBAR_MAQUETACION,
  CODIGO_ESPERAR_RECURSOS,
  EJEMPLOS,
  FORMATOS,
  FOTOS,
  FUENTES,
  MARCAS_IDS,
  MARGEN,
  PLANTILLAS,
  baseFotosPublica,
  baseRecursosPanel,
  rutaLogo,
  comprobarMaquetacion,
  construirDocumento,
  esAptaPara,
  generarCss,
  obtenerPlantilla,
  plantillasDe,
  problemasDePlantilla,
  rutasLogos,
  urlFoto,
  urlLogo,
  validarPieza,
  type DatosPieza,
} from "..";

const FOTOS_BASE = "https://xyz.supabase.co/storage/v1/object/public/instagram";
const BASE = "https://panel.example.com/instagram";
const BASES = { baseRecursos: BASE, baseFotos: FOTOS_BASE };

function datosDe(id: string): DatosPieza {
  const e = EJEMPLOS.find((x) => x.id === id);
  if (!e) throw new Error(`no hay ejemplo ${id}`);
  const r = validarPieza(e.json);
  if (!r.ok) throw new Error(r.problemas.join("\n"));
  return r.datos;
}

describe("registro estático de plantillas", () => {
  it("tiene las 4 plantillas del prototipo y todas cumplen el contrato", () => {
    expect(PLANTILLAS.map((p) => p.id)).toEqual(["ct-foto-titular", "ct-tipografica", "tz-foto-titular", "tz-tipografica"]);
    for (const p of PLANTILLAS) expect(problemasDePlantilla(p), p.id).toEqual([]);
  });
  it("obtenerPlantilla y plantillasDe", () => {
    expect(obtenerPlantilla("ct-tipografica")?.titularOpcional).toBe(true);
    expect(obtenerPlantilla("no-existe")).toBeUndefined();
    expect(plantillasDe("touza").map((p) => p.id)).toEqual(["tz-foto-titular", "tz-tipografica"]);
    expect(plantillasDe("casa-tomas", "story").map((p) => p.id)).toEqual(["ct-foto-titular"]);
  });
  it("ct-tipografica admite cita (≤ 70 caracteres) y deja el titular opcional", () => {
    const p = obtenerPlantilla("ct-tipografica")!;
    expect(p.admitidos).toContain("cita");
    expect(p.limites?.cita).toBe(70);
  });
});

describe("recursos y catálogo", () => {
  it("dos bases: fuentes y logos en el panel, fotos en el bucket", () => {
    expect(BUCKET_INSTAGRAM).toBe("instagram");
    expect(baseFotosPublica("https://xyz.supabase.co/")).toBe(FOTOS_BASE);
    expect(baseRecursosPanel()).toBe("/instagram");
    expect(baseRecursosPanel("https://panel.example.com/")).toBe(BASE);
    expect(urlFoto(FOTOS_BASE, "ct-salon-1")).toBe(`${FOTOS_BASE}/fotos/casa-tomas/salon-1.jpg`);
    expect(urlLogo(BASE, "touza", "cruz-tau", "oro")).toBe(`${BASE}/logos/touza-cruz-tau-oro.png`);
    expect(() => urlLogo(BASE, "touza", "medallon", "oro")).toThrow(/No hay logo/);
    expect(() => urlFoto(FOTOS_BASE, "no-existe")).toThrow(/catálogo/);
    expect(rutasLogos()).toHaveLength(11);
  });
  it("public/instagram tiene todas las fuentes (con su OFL) y todos los logos", () => {
    const raiz = path.resolve(process.cwd(), "public", "instagram");
    const familias = new Set<string>();
    for (const marca of MARCAS_IDS) {
      for (const f of FUENTES[marca]) {
        expect(fs.existsSync(path.join(raiz, "fuentes", ...f.fichero.split("/"))), f.fichero).toBe(true);
        familias.add(f.fichero.split("/")[0]);
      }
    }
    for (const fam of familias) expect(fs.existsSync(path.join(raiz, "fuentes", fam, "OFL.txt")), `${fam}/OFL.txt`).toBe(true);
    for (const r of rutasLogos()) expect(fs.existsSync(path.join(raiz, ...r.split("/"))), r).toBe(true);
    expect(rutaLogo("casa-tomas", "medallon", "oro")).toBe("logos/casa-tomas-medallon-oro.png");
  });
  it("catálogo: ids únicos, rutas en fotos/<marca>/*.jpg y esAptaPara = regla de la validación", () => {
    expect(new Set(FOTOS.map((f) => f.id)).size).toBe(FOTOS.length);
    for (const f of FOTOS) {
      expect(f.ruta).toMatch(new RegExp(`^fotos/${f.marca}/[a-z0-9-]+\\.jpg$`));
      for (const formato of ["post", "story"] as const) {
        const json = { marca: f.marca, plantilla: f.marca === "touza" ? "tz-foto-titular" : "ct-foto-titular", formato, foto: f.id, titular: "Hola" };
        const r = validarPieza(json);
        const porTamano = r.ok || !r.problemas.some((p) => p.includes("ampliarse"));
        expect(esAptaPara(f, formato), `${f.id} ${formato}`).toBe(porTamano);
      }
    }
  });
});

describe("tokens y CSS", () => {
  it("las @font-face apuntan a <base>/fuentes/ y hay una por fichero", () => {
    for (const marca of MARCAS_IDS) {
      const css = generarCss(marca, { baseRecursos: `${BASE}/` });
      expect(css.match(/@font-face/g)).toHaveLength(FUENTES[marca].length);
      for (const f of FUENTES[marca]) expect(css).toContain(`url("${BASE}/fuentes/${f.fichero}")`);
      expect(css).toContain("--color-fondo:");
    }
  });
  it("las medidas repetidas en comprobarMaquetacion coinciden con tokens", () => {
    // Sin espacios: el transformador (SWC/esbuild) puede reformatear el código.
    const fuente = comprobarMaquetacion.toString().replace(/\s+/g, "");
    expect(fuente).toContain(`post:{ancho:${FORMATOS.post.ancho},alto:${FORMATOS.post.alto},arriba:0,abajo:0}`);
    const z = FORMATOS.story.zonaSegura;
    expect(fuente).toContain(`story:{ancho:${FORMATOS.story.ancho},alto:${FORMATOS.story.alto},arriba:${z.arriba},abajo:${z.abajo}}`);
    expect(fuente).toContain(`MARGEN_PX=${MARGEN}`);
  });
  it("el código para Playwright es una expresión JS válida", () => {
    expect(() => new Function(`return ${CODIGO_COMPROBAR_MAQUETACION};`)).not.toThrow();
    expect(() => new Function(`return ${CODIGO_ESPERAR_RECURSOS};`)).not.toThrow();
  });
});

describe("construirDocumento", () => {
  it("documento completo con CSS de marca, reset, lienzo exacto y data-campo", () => {
    const html = construirDocumento(datosDe("tz-foto-titular-story"), BASES);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(`url("${BASE}/fuentes/cormorant-garamond/`);
    expect(html).toContain(".lienzo.formato-story { width: var(--story-ancho); height: var(--story-alto); }");
    expect(html).toContain("body { width: 1080px; height: 1920px; overflow: hidden; }");
    expect(html).toContain('<main class="lienzo formato-story" data-marca="touza" data-plantilla="tz-foto-titular">');
    expect(html).toContain(`src="${FOTOS_BASE}/fotos/touza/touza-5.jpg"`);
    for (const campo of ["antetitulo", "titular", "cta", "pie"]) expect(html).toContain(`data-campo="${campo}"`);
  });
  it("la cita del lema va en data-campo=cita y sin titular no se pinta", () => {
    const html = construirDocumento(datosDe("ct-tipografica-lema"), BASES);
    expect(html).toContain('data-campo="cita"');
    expect(html).toContain("Nunca é longo o camiño que conduce á casa dun amigo.");
    expect(html).not.toContain('data-campo="titular"');
    expect(html).toContain(`${BASE}/logos/casa-tomas-medallon-oro.png`);
  });
  it("escapa el texto", () => {
    const d = { ...datosDe("ct-tipografica-post"), titular: `<b>"x" & 'y'</b>` };
    const html = construirDocumento(d, BASES);
    expect(html).toContain("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
  it("lanza con plantilla, marca o formato que no casan", () => {
    const d = datosDe("ct-tipografica-post");
    expect(() => construirDocumento({ ...d, plantilla: "nada" }, BASES)).toThrow(/no existe/);
    expect(() => construirDocumento({ ...d, marca: "touza" }, BASES)).toThrow(/es de casa-tomas/);
    expect(() => construirDocumento({ ...d, formato: "story" }, BASES)).toThrow(/no tiene formato story/);
  });
  it("todos los ejemplos validan y construyen", () => {
    expect(EJEMPLOS).toHaveLength(12);
    for (const e of EJEMPLOS) {
      const r = validarPieza(e.json);
      expect(r.ok ? [] : r.problemas, e.id).toEqual([]);
      if (r.ok) expect(construirDocumento(r.datos, BASES)).toContain(`data-plantilla="${e.json.plantilla}"`);
    }
  });
});
