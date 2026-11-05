// @vitest-environment node
/**
 * Validadores de la IA de textos de Instagram (_shared/instagram/validar-ia.ts):
 * emoji, límites de Instagram, precios inventados, platos que no existen,
 * «sin gluten» y alérgenos falsos, TOUZA sin «reservar», datos personales y
 * rótulos dentro de los límites de la plantilla.
 */
import { describe, expect, it } from "vitest";
import {
  anonimizar,
  erroresAlergenos,
  erroresDatosPersonales,
  erroresPlatos,
  erroresPrecio,
  formatearPrecio,
  mencionaReservar,
  normalizarHashtags,
  parseAlergenosOficiales,
  preciosDelTexto,
  quitarEmoji,
  revisarRotulos,
  revisarVarianteTexto,
  tieneEmoji,
  touzaEnMayusculas,
  type ContextoValidacion,
  type PlatoContexto,
} from "../../_shared/instagram/validar-ia.ts";
import { plantillaIA } from "../plantillas.ts";

const PULPO: PlatoContexto = {
  id: "pulpo-feira",
  nombre: "Pulpo a la gallega",
  descripcion: "Pulpo cocido con cachelos, aceite y pimentón.",
  categoria: "Del mar",
  precio_eur: 22.5,
  unidad: "ración",
  alergenos_oficiales: ["moluscos"],
  sin_gluten_disponible: false,
};
const CARTA = ["Pulpo a la gallega", "Chuletón de vaca gallega", "Croquetas de jamón", "Tarta de queso"];
const CTX: ContextoValidacion = {
  marca: "casa-tomas",
  plato: PULPO,
  nombresCarta: CARTA,
  ctas: ["Reservar mesa", "Ver carta"],
};
const CTX_TOUZA: ContextoValidacion = { marca: "touza", plato: null, nombresCarta: [], ctas: ["Ver carta", "Nuestra Carta"] };

const variante = (extra: Record<string, unknown> = {}) => ({
  gancho: "Vuelve el pulpo de siempre.",
  caption: "Vuelve el pulpo de siempre.\n\nPulpo a la gallega, como en casa. Te esperamos.",
  hashtags: ["#CasaTomás", "#Crevillent", "#CocinaGallega", "#Pulpo", "#ProductoGallego"],
  alt_text: "Plato de pulpo en rodajas con pimentón sobre patatas cocidas, en una mesa de madera.",
  platos_citados: ["Pulpo a la gallega"],
  ...extra,
});

describe("emoji", () => {
  it("se detectan y se quitan sin dejar espacios dobles", () => {
    expect(tieneEmoji("Hola 🐙 qué tal")).toBe(true);
    expect(tieneEmoji("Hola #1 qué tal")).toBe(false);
    expect(quitarEmoji("Hola 🐙  qué tal 👍🏽")).toBe("Hola qué tal");
    expect(quitarEmoji("Bandera 🇪🇸 y ❤️ fin")).toBe("Bandera y fin");
  });

  it("una variante con emoji se corrige y avisa", () => {
    const r = revisarVarianteTexto(variante({ caption: "Vuelve el pulpo 🐙 de siempre. Pulpo a la gallega." }), CTX);
    expect(r.ok).toBe(true);
    expect(r.valor.caption).toBe("Vuelve el pulpo de siempre. Pulpo a la gallega.");
    expect(r.correcciones.join(" ")).toMatch(/emoji/);
  });
});

describe("precios", () => {
  it("formato de la marca", () => {
    expect(formatearPrecio(22.5)).toBe("22,5 €");
    expect(formatearPrecio(55)).toBe("55 €");
    expect(formatearPrecio(9.95)).toBe("9,95 €");
  });

  it("lee precios con euro delante o detrás", () => {
    expect(preciosDelTexto("A 22,5 € la ración, o €18 la media, 30 euros el kilo")).toEqual([22.5, 18, 30]);
  });

  it("un precio inventado bloquea la variante; el de la carta no", () => {
    expect(erroresPrecio("Pulpo a 19 €", PULPO)).toHaveLength(1);
    expect(erroresPrecio("Pulpo a 22,50 €", PULPO)).toEqual([]);
    expect(erroresPrecio("Por 22,5 €", null)).toHaveLength(1);
    expect(erroresPrecio("Muy pocos euros", PULPO)).toHaveLength(1);
    const r = revisarVarianteTexto(variante({ caption: "Pulpo a la gallega por solo 15 €. Te esperamos." }), CTX);
    expect(r.ok).toBe(false);
    expect(r.errores.join(" ")).toMatch(/Precio que no viene de la carta \(15 €\)/);
  });
});

describe("alérgenos", () => {
  it("«sin gluten» falso se bloquea", () => {
    expect(erroresAlergenos("Nuestro pulpo, sin gluten.", { ...PULPO, alergenos_oficiales: null })).not.toEqual([]);
    const r = revisarVarianteTexto(variante({ caption: "Pulpo a la gallega, apto para celíacos y sin gluten." }), {
      ...CTX,
      plato: { ...PULPO, alergenos_oficiales: null },
    });
    expect(r.ok).toBe(false);
    expect(r.errores.join(" ")).toMatch(/gluten|celíacos/);
  });

  it("«sin gluten» vale si sin_gluten_disponible o si los oficiales no llevan gluten", () => {
    expect(erroresAlergenos("Pulpo sin gluten", { ...PULPO, sin_gluten_disponible: true, alergenos_oficiales: null })).toEqual([]);
    expect(erroresAlergenos("Pulpo sin gluten, apto para celíacos", PULPO)).toEqual([]);
    expect(erroresAlergenos("Croquetas sin gluten", { ...PULPO, alergenos_oficiales: ["gluten", "lacteos"] })).not.toEqual([]);
  });

  it("sin plato en el contexto no se puede afirmar nada", () => {
    expect(erroresAlergenos("Sin gluten y sin lactosa", null)).not.toEqual([]);
  });

  it("«sin <alérgeno>» según los oficiales; «sin alérgenos» y «vegano» nunca", () => {
    expect(erroresAlergenos("Sin lactosa", PULPO)).toEqual([]);
    expect(erroresAlergenos("Sin marisco", PULPO)).not.toEqual([]); // lleva moluscos
    expect(erroresAlergenos("Plato sin alérgenos", PULPO)).not.toEqual([]);
    expect(erroresAlergenos("Opción vegana", PULPO)).not.toEqual([]);
    expect(erroresAlergenos("Contiene moluscos", PULPO)).toEqual([]);
    expect(erroresAlergenos("Contiene huevo", PULPO)).not.toEqual([]);
  });

  it("no confunde «sin» corriente con alérgenos", () => {
    expect(erroresAlergenos("Sin prisa, sin duda, no te vayas sin probar el pulpo", PULPO)).toEqual([]);
  });

  it("hashtags de dieta que no respalda la carta", () => {
    expect(erroresAlergenos("Pulpo", { ...PULPO, alergenos_oficiales: null }, ["#SinGluten"])).not.toEqual([]);
    expect(erroresAlergenos("Pulpo", PULPO, ["#Vegano"])).not.toEqual([]);
    expect(erroresAlergenos("Pulpo", PULPO, ["#SinGluten"])).toEqual([]);
  });

  it("alérgenos legibles para el modelo", () => {
    expect(parseAlergenosOficiales(["Moluscos", "frutos_cascara"])).toEqual(["moluscos", "frutos de cáscara"]);
    expect(parseAlergenosOficiales(null)).toBeNull();
  });
});

describe("platos", () => {
  it("los citados tienen que estar en la carta", () => {
    expect(erroresPlatos("", ["Pulpo a la gallega", "croquetas de jamón"], { nombresCarta: CARTA })).toEqual([]);
    expect(erroresPlatos("", ["Bogavante a la plancha"], { nombresCarta: CARTA })).toHaveLength(1);
  });

  it("nombrar un plato conocido que no está en la carta bloquea", () => {
    expect(erroresPlatos("Hoy tenemos percebes y pulpo", [], { nombresCarta: CARTA })).toEqual(["Habla de «percebes», que no está en la carta."]);
    expect(erroresPlatos("Croqueta, chuletones y pulpo", [], { nombresCarta: CARTA })).toEqual([]);
    const r = revisarVarianteTexto(variante({ caption: "Esta semana, bogavante y pulpo a la gallega." }), CTX);
    expect(r.ok).toBe(false);
  });
});

describe("TOUZA nunca «reservar»", () => {
  it("se detecta en texto y en hashtags, sin falsos positivos entre palabras", () => {
    expect(mencionaReservar("Reserva tu mesa")).toBe(true);
    expect(mencionaReservar("En El Reservado")).toBe(true);
    expect(mencionaReservar("Siempre servimos lo mejor")).toBe(false);
    expect(mencionaReservar("Ven", ["#ReservaYa"])).toBe(true);
  });

  it("una variante de TOUZA con «reservar» se descarta; en Casa Tomás no", () => {
    const v = { gancho: "Alquimia.", caption: "Alquimia en cada copa. Reserva tu noche.", hashtags: ["#TOUZA"], alt_text: "Copa de cóctel ámbar en la barra.", platos_citados: [] };
    expect(revisarVarianteTexto(v, CTX_TOUZA).ok).toBe(false);
    expect(revisarVarianteTexto({ ...v, caption: "Alquimia en cada copa. Ven a verla." }, CTX_TOUZA).ok).toBe(true);
    expect(revisarVarianteTexto(variante({ caption: "Pulpo a la gallega. Reserva mesa." }), CTX).ok).toBe(true);
  });

  it("«Touza» pasa a «TOUZA», salvo el pueblo «A Touza»", () => {
    expect(touzaEnMayusculas("Touza abre. Tomás vino de A Touza.")).toBe("TOUZA abre. Tomás vino de A Touza.");
  });
});

describe("datos personales", () => {
  it("correos, teléfonos, DNI y menciones ajenas", () => {
    expect(erroresDatosPersonales("Escribe a maria@gmail.com")).toHaveLength(1);
    expect(erroresDatosPersonales("Llama al 612 345 678")).toHaveLength(1);
    expect(erroresDatosPersonales("Llama al +34 966 78 20 00")).toHaveLength(1);
    expect(erroresDatosPersonales("DNI 12345678Z")).toHaveLength(1);
    expect(erroresDatosPersonales("Gracias @pepito_perez")).toHaveLength(1);
    expect(erroresDatosPersonales("Síguenos en @touzabar desde 1998")).toEqual([]);
  });

  it("las indicaciones se anonimizan antes de enviarlas", () => {
    expect(anonimizar("Para Ana, ana@x.es, 612345678")).toBe("Para Ana, [correo], [teléfono]");
  });
});

describe("límites de Instagram y hashtags", () => {
  it("normaliza hashtags y deja como mucho 12", () => {
    expect(normalizarHashtags(["CasaTomás", "#casatomas", "#Cocina Gallega", "#🐙", "#123"])).toEqual(["#CasaTomás", "#CocinaGallega"]);
    const muchos = Array.from({ length: 20 }, (_, i) => `#Etiqueta${i}`);
    const r = revisarVarianteTexto(variante({ hashtags: muchos }), CTX);
    expect(r.valor.hashtags).toHaveLength(12);
    expect(r.correcciones.join(" ")).toMatch(/12 hashtags/);
  });

  it("más de 2200 caracteres, 30 hashtags o 20 menciones descartan la variante", () => {
    expect(revisarVarianteTexto(variante({ caption: `Pulpo a la gallega. ${"Casa. ".repeat(400)}` }), CTX).ok).toBe(false);
    const hashtagsEnTexto = Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ");
    expect(revisarVarianteTexto(variante({ caption: `Pulpo a la gallega ${hashtagsEnTexto}` }), CTX).ok).toBe(false);
    const menciones = Array.from({ length: 21 }, () => "@casatomascrevillent").join(" ");
    expect(revisarVarianteTexto(variante({ caption: `Pulpo a la gallega ${menciones}` }), CTX).ok).toBe(false);
  });

  it("el texto alternativo largo se recorta a 1000", () => {
    const r = revisarVarianteTexto(variante({ alt_text: "Plato de pulpo. ".repeat(100) }), CTX);
    expect(r.ok).toBe(true);
    expect([...r.valor.altText].length).toBeLessThanOrEqual(1000);
  });

  it("una variante limpia pasa sin cambios", () => {
    const r = revisarVarianteTexto(variante(), CTX);
    expect(r).toMatchObject({ ok: true, errores: [], correcciones: [] });
    expect(r.valor.platosCitados).toEqual(["Pulpo a la gallega"]);
  });
});

describe("rótulos", () => {
  const ct = plantillaIA("ct-foto-titular")!;

  it("quita campos que la plantilla no usa y la CTA fuera de la lista", () => {
    const r = revisarRotulos({ antetitulo: "Del mar", titular: "El pulpo de casa", cita: "No va", cta: "Pide ya", pie: "" }, ct, CTX);
    expect(r.ok).toBe(true);
    expect(r.valor).toEqual({ antetitulo: "Del mar", titular: "El pulpo de casa" });
    expect(r.correcciones.join(" ")).toMatch(/Pide ya/);
    expect(revisarRotulos({ titular: "El pulpo de casa", cta: "ver carta" }, ct, CTX).valor.cta).toBe("Ver carta");
  });

  it("titular de más de 6 palabras o pasado de caracteres se descarta", () => {
    expect(revisarRotulos({ titular: "Uno dos tres cuatro cinco seis siete" }, ct, CTX).ok).toBe(false);
    expect(revisarRotulos({ titular: "Pulpo", antetitulo: "x".repeat(41) }, ct, CTX).ok).toBe(false);
    expect(revisarRotulos({ titular: "" }, ct, CTX).ok).toBe(false);
  });

  it("cita sin titular solo en la plantilla que lo permite", () => {
    const tipo = plantillaIA("ct-tipografica")!;
    expect(revisarRotulos({ cita: "Nunca é longo o camiño" }, tipo, CTX).ok).toBe(true);
  });

  it("TOUZA: «reservar», precio inventado o «sin gluten» se descartan", () => {
    const tz = plantillaIA("tz-foto-titular")!;
    expect(revisarRotulos({ titular: "Alquimia nocturna", cta: "Reservar ahora" }, tz, CTX_TOUZA).valor.cta).toBeUndefined();
    expect(revisarRotulos({ titular: "Reserva tu noche" }, tz, CTX_TOUZA).ok).toBe(false);
    expect(revisarRotulos({ titular: "Cócteles a 9 €" }, tz, CTX_TOUZA).ok).toBe(false);
    expect(revisarRotulos({ titular: "Cócteles sin gluten" }, tz, CTX_TOUZA).ok).toBe(false);
    expect(revisarRotulos({ titular: "Touza de noche" }, tz, CTX_TOUZA).valor.titular).toBe("TOUZA de noche");
  });
});
