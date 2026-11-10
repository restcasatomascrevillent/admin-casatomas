/**
 * Tests de supabase/functions/enviar-newsletter/plantillas.ts
 *
 * Lo que pide el encargo (2026-10-03, "que en la newsletter se ponga automático
 * el darse de baja"):
 * - TODO correo lleva el pie de baja con el enlace personal, en los tres tipos.
 * - El personal no puede quitarlo: lo que escribe se escapa (no puede meter
 *   HTML/CSS que esconda el pie) y sin enlace no se renderiza nada.
 * - Cabeceras List-Unsubscribe / List-Unsubscribe-Post (RFC 8058).
 * - Validación del cuerpo y del límite de la cuota transaccional.
 */
import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  urlImagenSegura,
  validarPayload,
  asuntoNewsletter,
  cabecerasBaja,
  pieBaja,
  tieneEnlaceBaja,
  renderNewsletter,
  limiteTransaccional,
  LIMITE_TRANSACCIONAL_POR_DEFECTO,
  LIMITE_TITULO,
  MARCA_PIE_BAJA,
  TIPOS_NEWSLETTER,
  type DatosNewsletter,
} from "../plantillas.ts";

const ENLACE = "https://restaurantecasatomascrevillente.es/newsletter/baja?sid=0b6c3c0e-1f0a-4f63-9a59-6a2c2f4b6c11&via=body&sig=abc_DEF-123";

const base = (tipo: DatosNewsletter["tipo"], extra: Partial<DatosNewsletter> = {}): DatosNewsletter => ({
  tipo,
  titulo: "Jornadas del arroz",
  mensaje: "Del 10 al 20 de octubre.\nReserva ya.",
  ...extra,
});

describe("escapeHtml", () => {
  it("escapa los cinco caracteres peligrosos", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("pie de baja obligatorio", () => {
  it.each(TIPOS_NEWSLETTER)("el tipo %s lleva el pie con el enlace personal", (tipo) => {
    const html = renderNewsletter(base(tipo), ENLACE);
    expect(html).toContain(MARCA_PIE_BAJA);
    expect(html).toContain(`href="${escapeHtml(ENLACE)}"`);
    expect(html).toContain("Darse de baja");
    expect(tieneEnlaceBaja(html, ENLACE)).toBe(true);
    // Un solo pie, no duplicado.
    expect(html.split(MARCA_PIE_BAJA).length - 1).toBe(1);
  });

  it("sin enlace de baja no se renderiza el correo", () => {
    expect(() => renderNewsletter(base("anuncio"), "")).toThrow(/enlace de baja/);
    expect(() => pieBaja("", "#000")).toThrow();
  });

  it("el & de la query del enlace va escapado en el atributo (HTML válido)", () => {
    const html = renderNewsletter(base("oferta"), ENLACE);
    expect(html).toContain("&amp;via=body&amp;sig=abc_DEF-123");
  });

  it("tieneEnlaceBaja detecta un HTML sin pie o con otro enlace", () => {
    expect(tieneEnlaceBaja("<p>hola</p>", ENLACE)).toBe(false);
    const html = renderNewsletter(base("anuncio"), ENLACE);
    expect(tieneEnlaceBaja(html, ENLACE + "x")).toBe(false);
    expect(tieneEnlaceBaja(html, "")).toBe(false);
  });
});

describe("el personal no puede inyectar HTML ni esconder el pie", () => {
  const ataque = `<style>.footer{display:none}[data-pie-baja]{display:none}</style><script>alert(1)</script>`;

  it.each(TIPOS_NEWSLETTER)("título y mensaje se escapan en %s", (tipo) => {
    const html = renderNewsletter(base(tipo, { titulo: ataque, mensaje: ataque }), ENLACE);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<style>.footer");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(tieneEnlaceBaja(html, ENLACE)).toBe(true);
  });

  it("una imagen que no es https se descarta (javascript:, data:, http:, comillas)", () => {
    for (const mala of ["javascript:alert(1)", "data:image/png;base64,AAA", "http://ejemplo.com/a.jpg", `https://x.com/a.jpg" onerror="alert(1)`]) {
      const html = renderNewsletter(base("nuevo_menu", { imagenUrl: mala }), ENLACE);
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("data:image");
      expect(html).not.toContain('onerror="');
    }
  });

  it("una imagen https se incluye escapada", () => {
    const url = "https://jeamoczmbfsnwkfjxcyo.supabase.co/storage/v1/object/public/galeria/plato.jpg";
    const html = renderNewsletter(base("oferta", { imagenUrl: url }), ENLACE);
    expect(html).toContain(`src="${url}"`);
  });
});

describe("urlImagenSegura", () => {
  it("solo acepta https", () => {
    expect(urlImagenSegura("https://a.b/c.png")).toBe("https://a.b/c.png");
    expect(urlImagenSegura("http://a.b/c.png")).toBeNull();
    expect(urlImagenSegura("no es url")).toBeNull();
    expect(urlImagenSegura(undefined)).toBeNull();
    expect(urlImagenSegura("https://a.b/" + "x".repeat(3000))).toBeNull();
  });
});

describe("validarPayload", () => {
  it("acepta un cuerpo correcto y recorta espacios", () => {
    const r = validarPayload({ tipo: "anuncio", titulo: "  Hola ", mensaje: " Texto " });
    expect(r).toEqual({ ok: true, datos: { tipo: "anuncio", titulo: "Hola", mensaje: "Texto", imagenUrl: null } });
  });

  it("rechaza tipo desconocido, campos vacíos y textos demasiado largos", () => {
    expect(validarPayload(null).ok).toBe(false);
    expect(validarPayload({ tipo: "spam", titulo: "a", mensaje: "b" }).ok).toBe(false);
    expect(validarPayload({ tipo: "anuncio", titulo: "  ", mensaje: "b" }).ok).toBe(false);
    expect(validarPayload({ tipo: "anuncio", titulo: "a".repeat(LIMITE_TITULO + 1), mensaje: "b" }).ok).toBe(false);
  });

  it("rechaza una imagen que no es https, y acepta que no haya imagen", () => {
    expect(validarPayload({ tipo: "oferta", titulo: "a", mensaje: "b", imagen_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validarPayload({ tipo: "oferta", titulo: "a", mensaje: "b", imagen_url: "" }).ok).toBe(true);
    expect(validarPayload({ tipo: "oferta", titulo: "a", mensaje: "b" }).ok).toBe(true);
  });
});

describe("asunto y cabeceras", () => {
  it("el asunto no admite saltos de línea", () => {
    expect(asuntoNewsletter("anuncio", "Hola\r\nBcc: x@y.z")).toBe("Hola Bcc: x@y.z");
    expect(asuntoNewsletter("nuevo_menu", "Menú")).toBe("🍽️ Menú");
    expect(asuntoNewsletter("oferta", "2x1")).toBe("🎉 2x1");
  });

  it("List-Unsubscribe + List-Unsubscribe-Post (RFC 8058)", () => {
    const url = "https://x.supabase.co/functions/v1/newsletter-baja?sid=1&via=header&sig=s";
    expect(cabecerasBaja(url)).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(() => cabecerasBaja("")).toThrow();
  });
});

describe("limiteTransaccional", () => {
  it("por defecto 80; '0' lo desactiva; basura vuelve al defecto", () => {
    expect(limiteTransaccional(undefined)).toBe(LIMITE_TRANSACCIONAL_POR_DEFECTO);
    expect(limiteTransaccional("")).toBe(LIMITE_TRANSACCIONAL_POR_DEFECTO);
    expect(limiteTransaccional("0")).toBeNull();
    expect(limiteTransaccional("250")).toBe(250);
    expect(limiteTransaccional("-3")).toBe(LIMITE_TRANSACCIONAL_POR_DEFECTO);
    expect(limiteTransaccional("abc")).toBe(LIMITE_TRANSACCIONAL_POR_DEFECTO);
  });
});

// ============================================================================
// Plantillas por bloques (10/11/2026): estética nueva, plantillas nuevas y
// diseño por bloques (lo que edita el panel y propone «Crear con IA»).
// ============================================================================
import {
  PLANTILLAS_BASE,
  validarBloques,
  textoPlanoDeBloques,
  bloquesDeMensaje,
  urlBotonSegura,
  esEnlacePropio,
  MAX_BLOQUES,
  URL_RESERVAR,
  type Bloque,
} from "../../_shared/newsletter/bloques.ts";
import { URL_LOGO } from "../plantillas.ts";

const BLOQUES_TODOS: Bloque[] = [
  { tipo: "texto", texto: "Primer párrafo.\n\nSegundo párrafo." },
  { tipo: "imagen", url: "https://x.supabase.co/storage/v1/object/public/platos/a.jpg", alt: "Arroz", pie: "Arroz del señorito" },
  { tipo: "destacado", titulo: "Plazas limitadas", texto: "Reserva pronto" },
  { tipo: "platos", titulo: "El menú", platos: [{ nombre: "Gamba roja", descripcion: "A la plancha", precio: "18 €" }, { nombre: "Tarta" }] },
  { tipo: "evento", fecha: "14 de febrero", hora: "21:00" },
  { tipo: "boton", texto: "Reservar mesa", url: URL_RESERVAR },
  { tipo: "cita", texto: "Cocina de siempre", autor: "Tomás" },
  { tipo: "separador" },
  { tipo: "firma", texto: "Un abrazo" },
];

describe("plantillas de partida", () => {
  it("hay plantillas nuevas además de las tres de siempre", () => {
    const tipos = PLANTILLAS_BASE.map((p) => p.tipo);
    expect(tipos.slice(0, 3)).toEqual(["anuncio", "nuevo_menu", "oferta"]);
    for (const t of ["menu_temporada", "evento", "novedades_carta", "cheques_regalo"]) expect(tipos).toContain(t);
    expect(TIPOS_NEWSLETTER).toEqual(tipos);
  });

  it.each(PLANTILLAS_BASE.filter((p) => p.tipo !== "personalizada").map((p) => [p.tipo, p] as const))(
    "%s: sus bloques son válidos y se pinta con el pie de baja",
    (_t, p) => {
      expect(validarBloques(p.bloques).ok).toBe(true);
      const html = renderNewsletter({ tipo: p.tipo, titulo: p.titulo, mensaje: "x", bloques: p.bloques }, ENLACE);
      expect(tieneEnlaceBaja(html, ENLACE)).toBe(true);
      expect(html).toContain(escapeHtml(p.insignia));
      expect(html).toContain(escapeHtml(p.preheader));
    },
  );
});

describe("estética y clientes de correo", () => {
  const html = renderNewsletter({ tipo: "evento", titulo: "Noche especial", mensaje: "x", bloques: BLOQUES_TODOS, preheader: "Plazas limitadas", insignia: "Fecha especial" }, ENLACE);

  it("maquetado con tablas, 600 px, Outlook y modo oscuro", () => {
    expect(html).toContain('<html lang="es"');
    expect(html).toMatch(/role="presentation" width="600"/);
    expect(html).toContain("max-width:600px");
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("@media only screen and (max-width:620px)");
  });

  it("logo de la web con texto alternativo, colores de la marca y fuentes de la web", () => {
    expect(html).toContain(`src="${URL_LOGO}"`);
    expect(html).toContain('alt="Casa Tomás · restaurante"');
    expect(html).toContain("#363E45");
    expect(html).toContain("#B8936A");
    expect(html).toContain("Libre Baskerville");
  });

  it("pinta todos los bloques con su contenido", () => {
    expect(html).toContain("Primer párrafo.</p>");
    expect(html).toContain('alt="Arroz"');
    expect(html).toContain("Arroz del señorito");
    expect(html).toContain("Plazas limitadas");
    expect(html).toContain("Gamba roja");
    expect(html).toContain("18 €");
    expect(html).toContain("14 de febrero");
    expect(html).toContain(`href="${URL_RESERVAR}"`);
    expect(html).toContain("Cocina de siempre");
    expect(html).toContain("Un abrazo");
    // Preheader oculto y etiqueta.
    expect(html).toMatch(/display:none[^>]*>Plazas limitadas/);
    expect(html).toContain("Fecha especial");
  });

  it("todo texto de los bloques va escapado", () => {
    const ataque = `<style>[data-pie-baja]{display:none}</style><img src=x onerror=alert(1)>`;
    const malos: Bloque[] = [
      { tipo: "texto", texto: ataque },
      { tipo: "destacado", titulo: ataque, texto: ataque },
      { tipo: "platos", titulo: ataque, platos: [{ nombre: ataque, descripcion: ataque, precio: ataque }] },
      { tipo: "evento", fecha: ataque, lugar: ataque },
      { tipo: "cita", texto: ataque, autor: ataque },
      { tipo: "firma", texto: ataque },
      { tipo: "boton", texto: ataque, url: URL_RESERVAR },
      { tipo: "imagen", url: "https://a.b/c.jpg", alt: `" onerror="alert(1)`, pie: ataque },
    ];
    const h = renderNewsletter({ tipo: "personalizada", titulo: ataque, mensaje: "x", bloques: malos, insignia: ataque, preheader: ataque }, ENLACE);
    expect(h).not.toContain("<style>[data-pie-baja]");
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain('onerror="alert');
    expect(tieneEnlaceBaja(h, ENLACE)).toBe(true);
  });

  it("un envío «de siempre» (sin bloques) conserva título, mensaje, foto y botón", () => {
    const h = renderNewsletter(base("oferta", { imagenUrl: "https://a.b/oferta.jpg" }), ENLACE);
    expect(h).toContain("Jornadas del arroz");
    expect(h).toContain("Del 10 al 20 de octubre.<br>Reserva ya.");
    expect(h).toContain('src="https://a.b/oferta.jpg"');
    expect(h).toContain("Aprovechar la oferta");
    expect(bloquesDeMensaje("anuncio", "Hola", null).map((b) => b.tipo)).toEqual(["texto", "firma"]);
    expect(bloquesDeMensaje("nuevo_menu", "Hola", "https://a.b/c.jpg").map((b) => b.tipo)).toEqual(["imagen", "destacado", "boton"]);
  });
});

describe("validarBloques", () => {
  it("acepta todos los tipos y limpia espacios y filas vacías", () => {
    const r = validarBloques([...BLOQUES_TODOS, { tipo: "platos", platos: [{ nombre: "  " }, { nombre: " Flan " }] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bloques[r.bloques.length - 1]).toEqual({ tipo: "platos", platos: [{ nombre: "Flan" }] });
  });

  it("rechaza enlaces e imágenes peligrosos, tipos raros, vacíos y excesos", () => {
    expect(validarBloques([{ tipo: "boton", texto: "Ir", url: "javascript:alert(1)" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "boton", texto: "Ir", url: "http://a.b" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "imagen", url: "data:image/png;base64,AA", alt: "x" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "html", texto: "<b>" }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "texto", texto: "  " }]).ok).toBe(false);
    expect(validarBloques([{ tipo: "separador" }]).ok).toBe(false);
    expect(validarBloques([]).ok).toBe(false);
    expect(validarBloques("bloques").ok).toBe(false);
    expect(validarBloques(Array.from({ length: MAX_BLOQUES + 1 }, () => ({ tipo: "texto", texto: "a" }))).ok).toBe(false);
    expect(validarBloques(Array.from({ length: 5 }, () => ({ tipo: "texto", texto: "a".repeat(1900) }))).ok).toBe(false);
    expect(validarBloques([{ tipo: "evento" }]).ok).toBe(false);
  });

  it("botones: https o teléfono; la IA solo puede enlazar a la web del restaurante", () => {
    expect(urlBotonSegura("tel:+34 966 10 78 87")).toBe("tel:+34966107887");
    expect(urlBotonSegura("https://restaurantecasatomascrevillente.es/carta")).toBe("https://restaurantecasatomascrevillente.es/carta");
    expect(esEnlacePropio("https://restaurantecasatomascrevillente.es/reservas")).toBe(true);
    expect(esEnlacePropio("tel:+34966107887")).toBe(true);
    expect(esEnlacePropio("https://restaurantecasatomascrevillente.es.malo.com/")).toBe(false);
  });
});

describe("validarPayload con bloques", () => {
  it("con bloques, el mensaje (historial) se saca de ellos si no viene", () => {
    const r = validarPayload({ tipo: "evento", titulo: "Noche", bloques: [{ tipo: "texto", texto: "Hola" }, { tipo: "evento", fecha: "Viernes" }], insignia: "Fecha especial", preheader: "Ven" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.mensaje).toBe("Hola\n\nFecha: Viernes");
      expect(r.datos.bloques).toHaveLength(2);
      expect(r.datos.insignia).toBe("Fecha especial");
      expect(r.datos.preheader).toBe("Ven");
    }
  });

  it("rechaza bloques no válidos, etiquetas largas y tipos desconocidos", () => {
    expect(validarPayload({ tipo: "evento", titulo: "a", bloques: [{ tipo: "boton", texto: "x", url: "javascript:1" }] }).ok).toBe(false);
    expect(validarPayload({ tipo: "evento", titulo: "a", mensaje: "b", insignia: "x".repeat(41) }).ok).toBe(false);
    expect(validarPayload({ tipo: "evento", titulo: "a", mensaje: "b", preheader: "x".repeat(151) }).ok).toBe(false);
    expect(validarPayload({ tipo: "cheques_regalo", titulo: "a", mensaje: "b" }).ok).toBe(true);
  });

  it("textoPlanoDeBloques: una versión de texto legible", () => {
    expect(textoPlanoDeBloques(BLOQUES_TODOS)).toContain("· Gamba roja (18 €): A la plancha");
    expect(textoPlanoDeBloques(BLOQUES_TODOS)).toContain(`Reservar mesa: ${URL_RESERVAR}`);
  });

  it("asunto con el emoji de cada plantilla nueva", () => {
    expect(asuntoNewsletter("cheques_regalo", "Regala")).toBe("🎁 Regala");
    expect(asuntoNewsletter("personalizada", "Hola")).toBe("Hola");
  });
});
