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
