/**
 * Tests para supabase/functions/emails-reserva/plantillas.ts
 *
 * Capa pura: mezcla el contenido editable (fila de plantillas_email_reserva)
 * con el esqueleto fijo. Lo crítico:
 * - Nunca se interpreta HTML/markup que venga del contenido editable (contra
 *   correos rotos y contra inyección desde un panel comprometido).
 * - El bloque de comparación solicitado/ofrecido aparece SOLO cuando los
 *   datos realmente difieren — no es un flag editorial.
 * - Los `bloques` respetan sus valores por defecto cuando faltan.
 */
import { describe, it, expect } from "vitest";
import {
  renderPlantilla,
  hayContraoferta,
  formatearFecha,
  formatearHora,
  sustituirTexto,
  type FilaPlantilla,
  type DatosReservaParaCorreo,
} from "../plantillas.ts";

function plantillaBase(overrides: Partial<FilaPlantilla> = {}): FilaPlantilla {
  return {
    tipo: "propuesta",
    version: 1,
    asunto: "Confirma tu reserva, {{nombre}}",
    saludo: "Hola, {{nombre}}",
    cuerpo: "Te esperamos el {{fecha}} a las {{hora}}.",
    texto_boton_principal: "Sí, confirmo",
    texto_boton_secundario: "No puedo venir",
    pie: "Casa Tomás",
    color_acento: "#B8936A",
    color_oscuro: "#1C1F22",
    logo_url: null,
    bloques: {},
    ...overrides,
  };
}

function datosBase(overrides: Partial<DatosReservaParaCorreo> = {}): DatosReservaParaCorreo {
  return {
    nombre: "Elena Morales",
    fecha: "2026-03-16",
    hora: "21:00",
    comensales: 4,
    espacio: "Terraza",
    horaSolicitada: "21:00",
    espacioSolicitado: "Terraza",
    ...overrides,
  };
}

describe("formatearFecha / formatearHora", () => {
  it("formatea una fecha ISO en español, sin ceros a la izquierda en el día", () => {
    expect(formatearFecha("2026-03-06")).toBe("6 de marzo de 2026");
    expect(formatearFecha("2026-12-25")).toBe("25 de diciembre de 2026");
  });

  it("recorta segundos de la hora", () => {
    expect(formatearHora("21:00:00")).toBe("21:00");
    expect(formatearHora("21:00")).toBe("21:00");
  });
});

describe("sustituirTexto", () => {
  it("escapa HTML del texto plano y de los valores sustituidos", () => {
    const resultado = sustituirTexto("Hola {{nombre}}, <b>tu reserva</b>", { nombre: "<script>alert(1)</script>" });
    expect(resultado).not.toContain("<script>");
    expect(resultado).not.toContain("<b>tu reserva</b>");
    expect(resultado).toContain("&lt;script&gt;");
    expect(resultado).toContain("&lt;b&gt;");
  });

  it("sustituye un token desconocido por cadena vacía, sin dejar {{...}} literal", () => {
    const resultado = sustituirTexto("Hola {{nombre}}, {{campo_inventado}}!", { nombre: "Ana" });
    expect(resultado).toBe("Hola Ana, !");
    expect(resultado).not.toContain("{{");
  });
});

describe("hayContraoferta", () => {
  it("es falso cuando hora y espacio ofrecidos coinciden con lo solicitado", () => {
    expect(hayContraoferta(datosBase())).toBe(false);
  });

  it("es verdadero si la hora ofrecida difiere de la solicitada", () => {
    expect(hayContraoferta(datosBase({ hora: "20:30", horaSolicitada: "21:00" }))).toBe(true);
  });

  it("es verdadero si el espacio ofrecido difiere del solicitado", () => {
    expect(hayContraoferta(datosBase({ espacio: "Salón", espacioSolicitado: "Terraza" }))).toBe(true);
  });

  it("es falso si no hay dato de lo solicitado (reserva sin snapshot, p.ej. anterior a la migración)", () => {
    expect(hayContraoferta(datosBase({ horaSolicitada: null, espacioSolicitado: null }))).toBe(false);
  });

  it("ignora los segundos al comparar horas (21:00 == 21:00:00)", () => {
    expect(hayContraoferta(datosBase({ hora: "21:00:00", horaSolicitada: "21:00" }))).toBe(false);
  });
});

describe("renderPlantilla", () => {
  it("sustituye los tokens en asunto y saludo", () => {
    const { asunto, html } = renderPlantilla(plantillaBase(), datosBase());
    expect(asunto).toBe("Confirma tu reserva, Elena Morales");
    expect(html).toContain("Hola, Elena Morales");
  });

  it("nunca interpreta HTML que venga del contenido editable", () => {
    const plantilla = plantillaBase({ cuerpo: "<img src=x onerror=alert(1)> {{nombre}}" });
    const { html } = renderPlantilla(plantilla, datosBase());
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("pinta el bloque de comparación cuando hay contraoferta, con Pediste/Te ofrecemos", () => {
    const { html } = renderPlantilla(
      plantillaBase(),
      datosBase({ hora: "20:30", espacio: "Salón", horaSolicitada: "21:00", espacioSolicitado: "Terraza" }),
    );
    expect(html).toContain("Pediste:");
    expect(html).toContain("21:00 en Terraza");
    expect(html).toContain("Te ofrecemos:");
    expect(html).toContain("20:30 en Salón");
  });

  it("NO pinta el bloque de comparación cuando lo ofrecido coincide con lo solicitado", () => {
    const { html } = renderPlantilla(plantillaBase(), datosBase());
    expect(html).not.toContain("Pediste:");
    expect(html).not.toContain("Te ofrecemos:");
  });

  it("respeta mostrar_tabla_detalles = false", () => {
    const plantilla = plantillaBase({ bloques: { mostrar_tabla_detalles: false } });
    const { html } = renderPlantilla(plantilla, datosBase());
    expect(html).not.toContain("Comensales");
  });

  it("pinta la tabla de detalles por defecto (bloques vacío)", () => {
    const { html } = renderPlantilla(plantillaBase({ bloques: {} }), datosBase());
    expect(html).toContain("Comensales");
    expect(html).toContain("Fecha");
  });

  it("el botón secundario no aparece si mostrar_boton_secundario es false, aunque haya texto y URL", () => {
    const plantilla = plantillaBase({ bloques: { mostrar_boton_secundario: false } });
    const { html } = renderPlantilla(plantilla, datosBase({ botonPrincipalUrl: "https://x/aceptar", botonSecundarioUrl: "https://x/rechazar" }));
    expect(html).toContain("https://x/aceptar");
    expect(html).not.toContain("https://x/rechazar");
  });

  it("no pinta ningún botón si la plantilla no trae texto de botón, aunque haya URL en los datos", () => {
    const plantilla = plantillaBase({ texto_boton_principal: null, texto_boton_secundario: null });
    const { html } = renderPlantilla(plantilla, datosBase({ botonPrincipalUrl: "https://x/aceptar" }));
    expect(html).not.toContain("https://x/aceptar");
  });

  it("no pinta el pie cuando mostrar_pie_contacto es false", () => {
    const plantilla = plantillaBase({ bloques: { mostrar_pie_contacto: false }, pie: "Texto de pie exclusivo" });
    const { html } = renderPlantilla(plantilla, datosBase());
    expect(html).not.toContain("Texto de pie exclusivo");
  });
});

// Decisión del dueño 2026-09-24: las reservas de El Reservado (Touza) se
// gestionan igual que las de Casa Tomás, pero su correo lleva la marca Touza.
import { negocioParaMarca, adaptarTextoANegocio, adaptarPaginaANegocio } from "../plantillas.ts";
import { marcaDeSolicitudParaCorreo } from "../propuesta-solicitud.ts";

describe("marca del negocio en el correo", () => {
  it("sin negocio (o casa_tomas) se ve exactamente como siempre", () => {
    const sin = renderPlantilla(plantillaBase(), datosBase());
    const ct = renderPlantilla(plantillaBase(), datosBase({ negocio: negocioParaMarca("casa_tomas") }));
    expect(ct).toEqual(sin);
    expect(sin.html).toContain("Casa Tomás");
    expect(sin.html).toContain("966 10 78 87");
  });

  it("una reserva de Touza no lleva el nombre, la dirección ni el teléfono de Casa Tomás", () => {
    const { html, asunto } = renderPlantilla(
      plantillaBase({ asunto: "Tu reserva en Casa Tomás", cuerpo: "Gracias por elegir Casa Tomás, {{negocio}}.", logo_url: "https://x/logo-ct.png" }),
      datosBase({ negocio: negocioParaMarca("touza") }),
    );
    expect(asunto).toBe("Tu reserva en Touza");
    expect(html).not.toContain("Casa Tomás");
    expect(html).not.toContain("966 10 78 87");
    expect(html).not.toContain("logo-ct.png");
    expect(html).toContain("Touza");
    expect(html).toContain("C/ San Vicente, 14");
    expect(html).toContain("tel:966782000");
  });

  it("marca desconocida => Casa Tomás", () => {
    expect(negocioParaMarca("otra").nombre).toBe("Casa Tomás");
    expect(negocioParaMarca(null).nombre).toBe("Casa Tomás");
  });

  it("adapta textos y páginas solo para otro negocio", () => {
    const touza = negocioParaMarca("touza");
    expect(adaptarTextoANegocio("Bienvenido a Casa Tomás", negocioParaMarca("casa_tomas"))).toBe("Bienvenido a Casa Tomás");
    expect(adaptarTextoANegocio("Bienvenido a Casa Tomás", touza)).toBe("Bienvenido a Touza");
    expect(adaptarPaginaANegocio('<title>X - Casa Tomás</title><a href="tel:966107887">966 10 78 87</a>', touza)).toBe(
      '<title>X - Touza</title><a href="tel:966782000">966 782 000</a>',
    );
  });

  it("negocio de una solicitud: sala propuesta > marcador de El Reservado > Casa Tomás", () => {
    expect(marcaDeSolicitudParaCorreo({ espacio_propuesto_id: "r", notas_cliente: null }, "touza")).toBe("touza");
    expect(marcaDeSolicitudParaCorreo({ espacio_propuesto_id: "c", notas_cliente: "Solicitud de El Reservado" }, undefined)).toBe(
      "casa_tomas",
    );
    expect(marcaDeSolicitudParaCorreo({ espacio_propuesto_id: null, notas_cliente: "Solicitud de El Reservado\nx" }, null)).toBe(
      "touza",
    );
    expect(marcaDeSolicitudParaCorreo({ espacio_propuesto_id: null, notas_cliente: "hola" }, null)).toBe("casa_tomas");
  });
});
