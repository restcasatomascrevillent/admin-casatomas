import { describe, expect, it } from "vitest";
import { formatoSalida, problemasArchivos, proporcion } from "../formatos";
import { ESTILOS, ESTILOS_IDS, factoresFoto, filtrosVideo, limitarTratamiento, previaCss, sumarTratamientos, TRATAMIENTO_NEUTRO } from "../estilos";
import { duracionMontaje, limpiarTexto, normalizarHashtags, normalizarPlan, planBasico, type ContextoPlan } from "../plan";
import { estiloRecorteCss, rectanguloRecorte } from "../geometria";

const ctx = (extra: Partial<ContextoPlan> = {}): ContextoPlan => ({
  archivos: [
    { id: "f1", tipo: "foto" },
    { id: "f2", tipo: "foto" },
    { id: "v1", tipo: "video", duracion_s: 6 },
  ],
  formato: formatoSalida("instagram", "carrusel"),
  estilo: "elegante",
  permitirCreativo: false,
  ...extra,
});

describe("formatos", () => {
  it("medidas por canal y tipo", () => {
    expect(proporcion(formatoSalida("instagram", "publicacion"))).toBe("4:5");
    expect(proporcion(formatoSalida("instagram", "reel"))).toBe("9:16");
    expect(proporcion(formatoSalida("facebook", "carrusel"))).toBe("1:1");
    expect(formatoSalida("instagram", "story", true).medio).toBe("video");
    expect(formatoSalida("instagram", "story", false).medio).toBe("foto");
  });

  it("explica por qué unos archivos no valen para un formato", () => {
    expect(problemasArchivos(formatoSalida("instagram", "carrusel"), [{ tipo: "foto" }])).toContain("Un carrusel necesita al menos 2 fotos");
    expect(problemasArchivos(formatoSalida("instagram", "animada"), [{ tipo: "video" }]).join()).toMatch(/solo admite fotos/);
    expect(problemasArchivos(formatoSalida("facebook", "reel", true), [{ tipo: "video" }, { tipo: "foto" }])).toEqual([]);
  });
});

describe("estilos", () => {
  it("hay 6 estilos, cada uno con tratamiento, composición por marca y ritmo", () => {
    expect(ESTILOS_IDS).toHaveLength(6);
    for (const id of ESTILOS_IDS) {
      expect(ESTILOS[id].composicion["casa-tomas"].logo).toMatch(/\.png$/);
      expect(ESTILOS[id].composicion.touza.logo).toMatch(/touza/);
      expect(ESTILOS[id].ritmo.segundosPorPlano).toBeGreaterThan(1);
    }
    // Los estilos son de verdad distintos: tratamientos y vistas previas diferentes.
    const previas = new Set(ESTILOS_IDS.map((id) => previaCss(ESTILOS[id].tratamiento["casa-tomas"]).filter));
    expect(previas.size).toBe(6);
  });

  it("los tratamientos se limitan y se suman sin pasarse", () => {
    expect(limitarTratamiento({ exposicion: 5, vineta: -1 })).toMatchObject({ exposicion: 1, vineta: 0 });
    expect(sumarTratamientos({ exposicion: 0.8 }, { exposicion: 0.8 }).exposicion).toBe(1);
    const f = factoresFoto({ ...TRATAMIENTO_NEUTRO, temperatura: 1 });
    expect(f.rojo).toBeGreaterThan(1);
    expect(f.azul).toBeLessThan(1);
    expect(filtrosVideo({ ...TRATAMIENTO_NEUTRO, vineta: 0.5, nitidez: 0.4 }).join(",")).toMatch(/vignette.*/);
  });
});

describe("normalizarPlan (fidelidad y límites del motor)", () => {
  it("quita lo creativo si no está permitido y lo deja si lo está", () => {
    const bruto = { piezas: [{ tipo: "foto", archivo: "f1", creativo: "fondo-marca" }, { tipo: "foto", archivo: "f2" }] };
    const sin = normalizarPlan(bruto, ctx());
    expect(sin.piezas[0]).toMatchObject({ creativo: "ninguno" });
    expect(sin.avisos.join()).toMatch(/no están permitidas/);
    expect(normalizarPlan(bruto, ctx({ permitirCreativo: true })).piezas[0]).toMatchObject({ creativo: "fondo-marca" });
  });

  it("la corrección es suave, el encuadre se limita y los rótulos se recortan", () => {
    const p = normalizarPlan(
      { piezas: [{ tipo: "foto", archivo: "f1", correccion: { exposicion: 3, contraste: -2 }, encuadre: { x: 2, y: -1, zoom: 9 }, rotulos: { titulo: "Uno dos tres cuatro cinco seis siete ocho nueve", posicion: "rara" } }, { tipo: "foto", archivo: "f2" }] },
      ctx(),
    );
    const f = p.piezas[0];
    expect(f.tipo === "foto" && f.correccion).toMatchObject({ exposicion: 0.6, contraste: -0.6 });
    expect(f.tipo === "foto" && f.encuadre).toEqual({ x: 1, y: 0, zoom: 3 });
    expect(f.tipo === "foto" && f.rotulos).toEqual({ titulo: "Uno dos tres cuatro cinco seis siete", posicion: "auto" });
  });

  it("quita piezas de archivos que no existen y completa el carrusel con las fotos que faltan", () => {
    const p = normalizarPlan({ piezas: [{ tipo: "foto", archivo: "inventado" }, { tipo: "foto", archivo: "f2" }] }, ctx());
    expect(p.piezas.map((x) => x.tipo === "foto" && x.archivo)).toEqual(["f2", "f1"]);
    expect(p.avisos.join()).toMatch(/no está en el trabajo/);
  });

  it("vídeo: tomas dentro del clip, duración dentro del formato y subtítulos solo con voz", () => {
    const c = ctx({ formato: formatoSalida("instagram", "reel", true), conVoz: [] });
    const p = normalizarPlan({ piezas: [{ tipo: "video", tomas: [{ archivo: "v1", inicio: 1, fin: 30 }, { archivo: "f1", inicio: 0, fin: 50 }], subtitulos: true, transicion: "zoom", duracionTransicion: 9 }] }, c);
    const v = p.piezas[0];
    expect(v.tipo).toBe("video");
    if (v.tipo !== "video") return;
    expect(v.tomas[0]).toMatchObject({ inicio: 1, fin: 6 });
    expect(v.tomas[1]).toMatchObject({ inicio: 0, fin: 12, movimiento: "acercar" });
    expect(v.subtitulos).toBe(false);
    expect(v.duracionTransicion).toBeLessThanOrEqual(1.2);
    expect(duracionMontaje(v)).toBeCloseTo(5 + 12 - v.duracionTransicion, 2);
  });

  it("textos: sin emoji ni controles, hashtags normalizados y sin repetir", () => {
    expect(limpiarTexto("Hola 🍷\u0007 mundo", 50)).toBe("Hola mundo");
    expect(normalizarHashtags(["#Arroz", "arroz", "#a-b", "  #Crevillent "], 5)).toEqual(["#Arroz", "#ab", "#Crevillent"]);
  });

  it("plan básico sin IA: una pieza por foto o el montaje con los clips", () => {
    expect(planBasico(ctx()).piezas).toHaveLength(2);
    const v = planBasico(ctx({ formato: formatoSalida("instagram", "reel", true) })).piezas[0];
    expect(v.tipo === "video" && v.tomas).toHaveLength(3);
  });
});

describe("geometría del encuadre", () => {
  it("el recorte respeta la proporción, el zoom y no se sale", () => {
    const r = rectanguloRecorte(4000, 3000, 1080, 1350, { x: 0.5, y: 0.5, zoom: 1 });
    expect(r.height).toBe(3000);
    expect(Math.abs(r.width / r.height - 0.8)).toBeLessThan(0.01);
    const z = rectanguloRecorte(4000, 3000, 1080, 1350, { x: 1, y: 1, zoom: 2 });
    expect(z.left + z.width).toBeLessThanOrEqual(4000);
    expect(z.top + z.height).toBeLessThanOrEqual(3000);
    expect(z.width).toBeLessThan(r.width);
    const css = estiloRecorteCss(4000, 3000, 200, 250, { x: 0.5, y: 0.5, zoom: 1 });
    expect(css.height).toBeCloseTo(250, 0);
  });
});
