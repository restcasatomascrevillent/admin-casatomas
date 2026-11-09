import { describe, expect, it } from "vitest";
import {
  clasificarEntidad,
  confirmaEnTexto,
  esEntidadParker,
  leerPuntos,
  limpiarPuntuacionesEtiqueta,
  nombreComparable,
  textoDeHtml,
  trasComprobar,
  urlPublica,
  validarResultado,
} from "../parker";

const HOY = "2026-11-08";
const PEDIDO = { nombre: "Aalto 2021", bodega: "Aalto", anada: 2021, sin_anada: false };
const BUENO = {
  encontrada: true,
  motivo: null,
  vino_evaluado: "Aalto 2021",
  anada_evaluada: 2021,
  sin_anada: false,
  puntos_texto: "94",
  puntos_min: 94,
  puntos_max: 94,
  provisional: false,
  entidad: "Robert Parker Wine Advocate",
  critico: "Luis Gutiérrez",
  fecha_valoracion: "2024-06",
  fuente_nombre: "Vin Chicago",
  fuente_url: "https://www.vinchicago.com/aalto-2021",
  cita: "Robert Parker's Wine Advocate 94 points — Aalto 2021",
  discrepancias: [],
  notas: null,
};
const HOSTS = new Set(["vinchicago.com"]);

describe("entidad", () => {
  it("solo Robert Parker / Wine Advocate", () => {
    expect(esEntidadParker("Robert Parker Wine Advocate")).toBe(true);
    expect(esEntidadParker("RP")).toBe(true);
    expect(esEntidadParker("The Wine Advocate")).toBe(true);
    expect(esEntidadParker("Guía Peñín")).toBe(false);
    expect(esEntidadParker("James Suckling")).toBe(false);
    expect(esEntidadParker("Decanter")).toBe(false);
    expect(esEntidadParker("Vinous (Antonio Galloni)")).toBe(false);
    expect(esEntidadParker("")).toBe(false);
  });

  it("clasifica las de la etiqueta sin dar nada por Parker si no se lee", () => {
    expect(clasificarEntidad("Robert Parker")).toBe("parker");
    expect(clasificarEntidad("Peñín")).toBe("otra");
    expect(clasificarEntidad(null)).toBe("desconocida");
    expect(limpiarPuntuacionesEtiqueta([
      { texto: "92 PEÑÍN", puntos: 92, entidad: "Guía Peñín", anada: 2020 },
      { texto: "95 points", puntos: 95, entidad: null, anada: null },
      { texto: "Gold", puntos: null, entidad: "Decanter", anada: null },
      { texto: "", puntos: 90, entidad: "RP", anada: null },
      { texto: "0", puntos: 0, entidad: "RP", anada: 1800 },
    ])).toEqual([
      { texto: "92 PEÑÍN", puntos: 92, entidad: "Guía Peñín", entidad_tipo: "otra", anada: 2020 },
      { texto: "95 points", puntos: 95, entidad: null, entidad_tipo: "desconocida", anada: null },
      { texto: "Gold", puntos: null, entidad: "Decanter", entidad_tipo: "otra", anada: null },
      { texto: "0", puntos: null, entidad: "RP", entidad_tipo: "parker", anada: null },
    ]);
  });
});

describe("leerPuntos", () => {
  it("no convierte intervalos en una cifra", () => {
    expect(leerPuntos("93-95")).toEqual({ puntos_texto: "93-95", puntos_min: 93, puntos_max: 95, provisional: false });
    expect(leerPuntos("(93–95)")).toEqual({ puntos_texto: "(93-95)", puntos_min: 93, puntos_max: 95, provisional: true });
    expect(leerPuntos("94+")).toEqual({ puntos_texto: "94+", puntos_min: 94, puntos_max: 94, provisional: false });
    expect(leerPuntos(null, 95, 97)).toEqual({ puntos_texto: "95-97", puntos_min: 95, puntos_max: 97, provisional: false });
  });
  it("rechaza ceros y escalas imposibles", () => {
    expect(leerPuntos("0")).toBeNull();
    expect(leerPuntos("101")).toBeNull();
    expect(leerPuntos("96-94")).toBeNull();
    expect(leerPuntos("noventa")).toBeNull();
  });
});

describe("urlPublica", () => {
  it("solo http(s) de hosts públicos", () => {
    expect(urlPublica("https://www.robertparker.com/wines/x")?.hostname).toBe("www.robertparker.com");
    expect(urlPublica("javascript:alert(1)")).toBeNull();
    expect(urlPublica("http://127.0.0.1/admin")).toBeNull();
    expect(urlPublica("http://localhost:3000")).toBeNull();
    expect(urlPublica("https://user:pw@tienda.es/x")).toBeNull();
  });
});

describe("nombreComparable", () => {
  it("quita formato, año y tildes", () => {
    expect(nombreComparable("Pícaro del Águila (Magnum) 2023")).toBe("picaro del aguila");
    expect(nombreComparable("Pícaro del Águila")).toBe("picaro del aguila");
  });
});

describe("validarResultado", () => {
  it("lo bueno queda en revisión hasta comprobar la página", () => {
    const r = validarResultado(BUENO, PEDIDO, HOSTS, HOY);
    expect(r).toMatchObject({ estado: "revision", motivo: null, puntos_texto: "94", anada: 2021, fuente_tipo: "secundaria", fecha_consulta: HOY });
  });

  it("robertparker.com es fuente original", () => {
    const r = validarResultado({ ...BUENO, fuente_url: "https://www.robertparker.com/wines/abc" }, PEDIDO, new Set(["robertparker.com"]), HOY);
    expect(r.fuente_tipo).toBe("original");
  });

  it("otra añada: no se guarda la cifra", () => {
    const r = validarResultado({ ...BUENO, anada_evaluada: 2020 }, PEDIDO, HOSTS, HOY);
    expect(r).toMatchObject({ estado: "no_localizada", motivo: "no_localizada", puntos_min: null });
    expect(r.notas).toMatch(/añada 2020, no de la 2021/);
  });

  it("otra entidad: descartada", () => {
    const r = validarResultado({ ...BUENO, entidad: "Guía Peñín" }, PEDIDO, HOSTS, HOY);
    expect(r).toMatchObject({ estado: "no_localizada", puntos_min: null });
  });

  it("URL de un sitio no consultado: revisión", () => {
    const r = validarResultado({ ...BUENO, fuente_url: "https://otra-tienda.es/aalto" }, PEDIDO, HOSTS, HOY);
    expect(r.estado).toBe("revision");
    expect(r.notas).toMatch(/no es de un sitio consultado/);
    expect(trasComprobar(r, { ok: true, faltan: [] }).estado).toBe("revision");
  });

  it("fuentes contradictorias: revisión con motivo", () => {
    const r = validarResultado({
      ...BUENO,
      discrepancias: [
        { fuente_nombre: "Decántalo", fuente_url: "https://www.decantalo.com/x", puntos_texto: "93", nota: null },
        { fuente_nombre: "Igual", fuente_url: null, puntos_texto: "94", nota: null },
      ],
    }, PEDIDO, HOSTS, HOY);
    expect(r).toMatchObject({ estado: "revision", motivo: "fuentes_contradictorias" });
    expect(r.discrepancias).toHaveLength(1);
  });

  it("no encontrada conserva el motivo", () => {
    expect(validarResultado({ encontrada: false, motivo: "fuente_inaccesible", notas: "muro de pago" }, PEDIDO, HOSTS, HOY))
      .toMatchObject({ estado: "no_localizada", motivo: "fuente_inaccesible", notas: "muro de pago" });
    expect(validarResultado(null, PEDIDO, HOSTS, HOY)).toMatchObject({ estado: "fallida", motivo: "busqueda_fallida" });
  });

  it("NV: exige que la nota sea del NV pedido", () => {
    const nv = { nombre: "Krug Grande Cuvée 170ème Édition", anada: null, sin_anada: true };
    expect(validarResultado({ ...BUENO, sin_anada: true, anada_evaluada: null }, nv, HOSTS, HOY).estado).toBe("revision");
    expect(validarResultado({ ...BUENO, sin_anada: false, anada_evaluada: 2008 }, nv, HOSTS, HOY).estado).toBe("no_localizada");
  });
});

describe("comprobación en la página", () => {
  const pagina = textoDeHtml(`<html><script>var x=94</script><h1>Aalto 2021</h1>
    <p>Ribera del Duero. <b>Robert Parker's Wine Advocate</b>: 94 points. Reviewed by Luis Gutiérrez.</p></html>`);

  it("verifica si la nota está junto a Parker, con la añada y el nombre", () => {
    const r = validarResultado(BUENO, PEDIDO, HOSTS, HOY);
    const c = confirmaEnTexto(pagina, r, PEDIDO.nombre);
    expect(c).toEqual({ ok: true, faltan: [] });
    expect(trasComprobar(r, c)).toMatchObject({ estado: "verificada", comprobado_en_pagina: true });
  });

  it("si la página no lo muestra o no abre, revisión con el motivo", () => {
    const r = validarResultado(BUENO, PEDIDO, HOSTS, HOY);
    const otra = confirmaEnTexto("Aalto 2020. Robert Parker 93 points. Suckling 94", r, PEDIDO.nombre);
    expect(otra.ok).toBe(false);
    expect(otra.faltan).toEqual(expect.arrayContaining(["la puntuación junto a Parker / Wine Advocate", "la añada 2021"]));
    expect(trasComprobar(r, otra)).toMatchObject({ estado: "revision", comprobado_en_pagina: false });
    expect(trasComprobar(r, null).notas).toMatch(/No se pudo abrir la página/);
  });

  it("intervalo: los dos extremos junto a Parker", () => {
    const r = validarResultado({ ...BUENO, puntos_texto: "(93-95)", puntos_min: 93, puntos_max: 95 }, PEDIDO, HOSTS, HOY);
    expect(r.provisional).toBe(true);
    expect(confirmaEnTexto("Aalto 2021 barrel sample. Wine Advocate (93-95)", r, "Aalto").ok).toBe(true);
    expect(confirmaEnTexto("Aalto 2021 Wine Advocate 93. Otra cosa ".padEnd(400, ".") + " 95", r, "Aalto").ok).toBe(false);
  });
});
