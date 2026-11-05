import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASES,
  BASES_REEL,
  CURVAS_MARCA,
  Easing,
  FPS_REEL,
  LIMITES_REEL,
  MOVIMIENTO,
  anadirEscena,
  calcularTiempos,
  crearReelDesdeBase,
  crearResolverFotos,
  cubicBezier,
  entradaMarca,
  instanteDeFotograma,
  moverEscena,
  pintarReelEnInstante,
  quitarEscena,
  rutasMuestras,
  validarReel,
  type ReelPieza,
} from "../index";

const html = (reel: ReelPieza, t: number, zonaSegura = false) => renderToStaticMarkup(pintarReelEnInstante(reel, t, { zonaSegura }));

afterEach(() => vi.restoreAllMocks());

describe("motor", () => {
  it("easing del reel-kit: extremos y forma", () => {
    for (const f of [Easing.easeOutCubic, Easing.easeInOutCubic, Easing.easeOutBack]) {
      expect(f(0)).toBeCloseTo(0, 10);
      expect(f(1)).toBeCloseTo(1, 10);
    }
    expect(Easing.easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    // easeOutBack se pasa de 1 (el «pop»)
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => Easing.easeOutBack(i / 100)))).toBeGreaterThan(1);
    expect(MOVIMIENTO.entrar(5, 1, 1)).toBe(1);
    expect(MOVIMIENTO.entrar(0, 1, 1)).toBe(0);
  });

  it("curvas de marca de motion.css (cubic-bezier)", () => {
    // ease estándar de CSS (.25,.1,.25,1) = la de Touza: en t = 0,5 vale ≈ 0,8024
    expect(CURVAS_MARCA.touza(0.5)).toBeCloseTo(0.8024, 3);
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
    expect(CURVAS_MARCA.suave(0)).toBe(0);
    expect(CURVAS_MARCA.suave(1)).toBe(1);
    expect(CURVAS_MARCA.rebote(0.6)).toBeGreaterThan(1); // se pasa (acento)
    expect(entradaMarca("casa-tomas", 0, 0)).toEqual({ opacidad: 0, desplazamientoY: 30, desenfoque: 0 });
    expect(entradaMarca("touza", 10, 0)).toEqual({ opacidad: 1, desplazamientoY: 0, desenfoque: 0 });
  });

  it("tiempos: cortes, total y fotogramas a 30 fps", () => {
    const t = calcularTiempos(BASES["del-mar"]);
    expect(t.tramos[0]).toEqual([0, 3]);
    expect(t.tramos[2]).toEqual([6, 9.5]);
    expect(t.inicioCierre).toBe(15.5);
    expect(t.total).toBe(20.5);
    expect(t.fotogramas).toBe(615); // la cifra de la propuesta
    expect(instanteDeFotograma(FPS_REEL)).toBe(1);
  });

  it("cambiar una duración mueve los cortes siguientes", () => {
    const r = crearReelDesdeBase("del-mar");
    r.escenas[0].duracion_s = 4;
    const t = calcularTiempos(r);
    expect(t.tramos[1]).toEqual([4, 7]);
    expect(t.total).toBe(21.5);
  });
});

describe("pintarReelEnInstante: determinista", () => {
  it.each(BASES_REEL)("base %s: mismo t → mismo HTML; distinto t → distinto", (base) => {
    const reel = crearReelDesdeBase(base);
    const total = calcularTiempos(reel).total;
    for (const t of [0, 0.5, 1.234, total / 2, total - 0.1, total]) {
      expect(html(reel, t)).toBe(html(reel, t));
    }
    expect(html(reel, 1)).not.toBe(html(reel, 2));
  });

  it("no usa Math.random, Date.now ni performance.now", () => {
    const r = vi.spyOn(Math, "random");
    const d = vi.spyOn(Date, "now");
    const p = vi.spyOn(performance, "now");
    const reel = crearReelDesdeBase("touza");
    for (let n = 0; n < calcularTiempos(reel).fotogramas; n += 7) html(reel, instanteDeFotograma(n));
    expect(r).not.toHaveBeenCalled();
    expect(d).not.toHaveBeenCalled();
    expect(p).not.toHaveBeenCalled();
  });

  it("no lleva animaciones ni transiciones CSS", () => {
    const reel = crearReelDesdeBase("bienvenido");
    const h = html(reel, 4.2);
    expect(h).not.toMatch(/transition:|animation:/);
  });

  it("t fuera de rango se limita a [0, total]", () => {
    const reel = crearReelDesdeBase("bodega");
    const total = calcularTiempos(reel).total;
    expect(html(reel, -3)).toBe(html(reel, 0));
    expect(html(reel, total + 10)).toBe(html(reel, total));
  });

  it("pinta rótulos, cierre, marco de Touza y zona segura cuando toca", () => {
    const ct = crearReelDesdeBase("del-mar");
    expect(html(ct, 1.5)).toContain("¿Cuál");
    expect(html(ct, 19)).toContain("Reservar mesa");
    expect(html(ct, 19)).toContain("966 10 78 87 · @casatomascrevillent");
    expect(html(ct, 19)).toContain("/instagram/logos/casa-tomas-logo-blanco.png");
    expect(html(ct, 19)).not.toContain("data-zona-segura");
    expect(html(ct, 19, true)).toContain("data-zona-segura");
    const tz = crearReelDesdeBase("touza");
    expect(html(tz, 3)).toContain("EST. 2023 · CREVILLENTE");
    expect(html(tz, 1)).toContain("TOUZA");
    expect(html(ct, 3)).not.toContain("EST. 2023");
  });

  it("la foto se resuelve con urlFoto; sin URL pinta un hueco", () => {
    const reel = crearReelDesdeBase("del-mar");
    expect(html(reel, 0.5)).toContain("/instagram/reels/muestras/gambas.jpg");
    reel.escenas[0].foto = "drive:abc";
    const sinUrl = renderToStaticMarkup(pintarReelEnInstante(reel, 0.5));
    expect(sinUrl).toContain("Sin foto · Gancho");
    const conUrl = renderToStaticMarkup(pintarReelEnInstante(reel, 0.5, { urlFoto: crearResolverFotos("/instagram", { "drive:abc": "https://x/tmp/1.jpg" }) }));
    expect(conUrl).toContain("https://x/tmp/1.jpg");
  });
});

describe("validarReel", () => {
  it.each(BASES_REEL)("la base %s valida", (base) => {
    const r = validarReel(crearReelDesdeBase(base, base === "libre" ? "touza" : undefined));
    expect(r.problemas).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("las bases usan fotos de muestra (aviso, no error) y existen en public/", () => {
    const r = validarReel(crearReelDesdeBase("brasa"));
    expect(r.avisos.some((a) => a.includes("MUESTRA"))).toBe(true);
    for (const ruta of rutasMuestras()) expect(existsSync(path.join("public/instagram", ruta)), ruta).toBe(true);
  });

  it("duración total entre 5 y 90 s", () => {
    const corto = crearReelDesdeBase("libre");
    corto.escenas = [{ ...corto.escenas[0], duracion_s: 1.5 }];
    corto.cierre.duracion_s = 3;
    const r1 = validarReel(corto);
    expect(r1.ok).toBe(false);
    expect(r1.problemas?.join()).toMatch(/dura 4,5 s.*entre 5 y 90 s/);

    let largo = crearReelDesdeBase("del-mar");
    while (largo.escenas.length < LIMITES_REEL.escenasMax) largo = anadirEscena(largo);
    largo.escenas = largo.escenas.map((e) => ({ ...e, duracion_s: 7 }));
    const r2 = validarReel(largo);
    expect(r2.ok).toBe(false);
    expect(r2.problemas?.join()).toMatch(/entre 5 y 90 s/);

    const justo = crearReelDesdeBase("libre");
    justo.escenas = [{ ...justo.escenas[0], duracion_s: 2 }];
    justo.cierre.duracion_s = 3;
    expect(validarReel(justo).ok).toBe(true);
  });

  it("límites por escena y por cierre", () => {
    const r = crearReelDesdeBase("del-mar");
    r.escenas[1].duracion_s = 12;
    r.cierre.duracion_s = 1;
    const v = validarReel(r);
    expect(v.ok).toBe(false);
    expect(v.problemas).toEqual(expect.arrayContaining([expect.stringContaining("escenas[1].duracion_s"), expect.stringContaining("cierre.duracion_s")]));
  });

  it("textos que se salen", () => {
    const r = crearReelDesdeBase("del-mar");
    r.escenas[2].rotulo = { estilo: "mask", titulo: "Bogavanteazulgallegoconsal", sub: "en caldoso" };
    r.escenas[3].rotulo = { estilo: "number", antetitulo: "Año", titulo: "123456" };
    r.escenas[4].rotulo = { estilo: "hook", titulo: "Uno dos tres cuatro cinco seis" };
    r.cierre.datos = "Calle San Vicente 14 de Crevillent · @casatomascrevillent";
    const v = validarReel(r);
    expect(v.ok).toBe(false);
    const todo = v.problemas!.join("\n");
    expect(todo).toMatch(/Escena 3 «Bogavante».*no cabe a lo ancho/);
    expect(todo).toMatch(/Escena 4 «Atún».*(se sale|no cabe)/);
    expect(todo).toMatch(/Escena 5 «Salazones».*6 palabras; máximo 5/);
    expect(todo).toMatch(/Cierre: el datos.*se sale/);
  });

  it("emojis, estilos sin título y campos desconocidos", () => {
    const r = crearReelDesdeBase("bodega") as unknown as Record<string, unknown> & ReelPieza;
    r.escenas[1].rotulo = { estilo: "label", antetitulo: "Tinto 🍷" };
    (r as Record<string, unknown>).musica = "x";
    const v = validarReel(r);
    expect(v.ok).toBe(false);
    expect(v.problemas!.join()).toContain("Campo desconocido «musica»");
    delete (r as Record<string, unknown>).musica;
    const v2 = validarReel(r);
    expect(v2.problemas!.join("\n")).toMatch(/emojis/);
    expect(v2.problemas!.join("\n")).toMatch(/necesita título/);
  });

  it("aviso si el rótulo no termina de entrar", () => {
    const r = crearReelDesdeBase("touza");
    r.escenas[2].duracion_s = 1.5;
    const v = validarReel(r);
    expect(v.avisos.join()).toMatch(/Escena 3 «Copa».*no termina de entrar/);
  });

  it("aviso de foto pequeña para el zoom", () => {
    const r = crearReelDesdeBase("del-mar");
    r.escenas[0].foto = "drive:pequena";
    const v = validarReel(r, { medidasFoto: (id) => (id === "drive:pequena" ? { ancho: 1080, alto: 1350 } : undefined) });
    expect(v.avisos.join()).toMatch(/1080×1350.*blanda/);
  });
});

describe("edición pura", () => {
  it("añadir, quitar y mover escenas sin mutar", () => {
    const r = crearReelDesdeBase("del-mar");
    const mas = anadirEscena(r, 0);
    expect(mas.escenas).toHaveLength(6);
    expect(mas.escenas[1].id).toBe("e6");
    expect(r.escenas).toHaveLength(5);
    const menos = quitarEscena(mas, 1);
    expect(menos.escenas.map((e) => e.id)).toEqual(r.escenas.map((e) => e.id));
    const movido = moverEscena(r, 0, 2);
    expect(movido.escenas.map((e) => e.id).slice(0, 3)).toEqual(["ostras", "bogavante", "gancho"]);
    let una = crearReelDesdeBase("libre");
    una = quitarEscena(una, 0);
    expect(quitarEscena(una, 0).escenas).toHaveLength(1);
  });
});
