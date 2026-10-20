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
  construirTokens,
  debeEnviarSolicitudRecibida,
  CANALES_SIN_SOLICITUD_RECIBIDA,
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
  it("es falso cuando la hora ofrecida coincide con la solicitada", () => {
    expect(hayContraoferta(datosBase())).toBe(false);
  });

  it("es verdadero si la hora ofrecida difiere de la solicitada", () => {
    expect(hayContraoferta(datosBase({ hora: "20:30", horaSolicitada: "21:00" }))).toBe(true);
  });

  // Cambiado el 2026-09-28 (antes esto daba true): el correo del cliente ya
  // no nombra la sala, así que un cambio SOLO de sala pintaría el bloque
  // "Pediste: 21:00 / Te ofrecemos: 21:00", dos veces lo mismo. Ver punto 7
  // del contrato en plantillas.ts.
  it("es FALSO si solo cambia el espacio: la sala no se le dice al cliente", () => {
    expect(hayContraoferta(datosBase({ espacio: "Salón", espacioSolicitado: "Terraza" }))).toBe(false);
  });

  it("sigue siendo verdadero si cambian la hora Y el espacio (manda la hora)", () => {
    expect(hayContraoferta(datosBase({ hora: "20:30", horaSolicitada: "21:00", espacio: "Salón", espacioSolicitado: "Terraza" }))).toBe(true);
  });

  it("es falso si no hay dato de lo solicitado (reserva sin snapshot, p.ej. anterior a la migración)", () => {
    expect(hayContraoferta(datosBase({ horaSolicitada: null, espacioSolicitado: null }))).toBe(false);
  });

  it("ignora los segundos al comparar horas (21:00 == 21:00:00)", () => {
    expect(hayContraoferta(datosBase({ hora: "21:00:00", horaSolicitada: "21:00" }))).toBe(false);
  });
});

// Decisión del dueño 2026-09-28: al cliente no se le dice la sala. Ver el
// punto 7 del contrato en plantillas.ts.
describe("la sala no aparece en el correo del cliente", () => {
  it("la tabla de detalles no lleva fila 'Espacio' aunque la reserva tenga sala asignada", () => {
    const { html } = renderPlantilla(plantillaBase(), datosBase({ espacio: "Terraza" }));
    expect(html).toContain("Fecha");
    expect(html).toContain("Hora");
    expect(html).toContain("Comensales");
    expect(html).not.toContain("Espacio");
    expect(html).not.toContain("Terraza");
  });

  it("el bloque de contraoferta compara solo horas, sin ' en <sala>'", () => {
    const { html } = renderPlantilla(
      plantillaBase(),
      datosBase({ hora: "20:30", espacio: "Salón", horaSolicitada: "21:00", espacioSolicitado: "Terraza" }),
    );
    expect(html).toContain("Pediste:");
    expect(html).toContain("Te ofrecemos:");
    expect(html).not.toContain("en Terraza");
    expect(html).not.toContain("en Salón");
    expect(html).not.toContain("Terraza");
    expect(html).not.toContain("Salón");
  });

  it("{{espacio}} y {{espacio_solicitado}} se sustituyen por cadena vacía, sin dejar {{...}} literal", () => {
    const tokens = construirTokens(datosBase({ espacio: "Terraza", espacioSolicitado: "Salón" }));
    expect(tokens.espacio).toBe("");
    expect(tokens.espacio_solicitado).toBe("");

    const { html } = renderPlantilla(
      plantillaBase({ cuerpo: "Mesa en [{{espacio}}], pediste [{{espacio_solicitado}}]." }),
      datosBase({ espacio: "Terraza", espacioSolicitado: "Salón" }),
    );
    expect(html).toContain("Mesa en [], pediste [].");
    expect(html).not.toContain("{{");
  });

  it("el resto de tokens siguen funcionando igual", () => {
    const tokens = construirTokens(datosBase());
    expect(tokens.nombre).toBe("Elena Morales");
    expect(tokens.hora).toBe("21:00");
    expect(tokens.comensales).toBe("4 personas");
    expect(tokens.fecha).toBe("16 de marzo de 2026");
  });
});

// Decisión del dueño 2026-09-28: el canal web deja de recibir el correo de
// "hemos recibido tu solicitud"; su único correo es la 'propuesta'.
describe("debeEnviarSolicitudRecibida", () => {
  it("el canal web NO lo recibe", () => {
    expect(debeEnviarSolicitudRecibida("web")).toBe(false);
  });

  it("no depende de mayúsculas ni de espacios sobrantes", () => {
    expect(debeEnviarSolicitudRecibida(" WEB ")).toBe(false);
    expect(debeEnviarSolicitudRecibida("Web")).toBe(false);
  });

  it("teléfono y manual lo siguen recibiendo (blacklist telefónica, altas del panel)", () => {
    expect(debeEnviarSolicitudRecibida("telefono")).toBe(true);
    expect(debeEnviarSolicitudRecibida("manual")).toBe(true);
  });

  it("canal desconocido, null o vacío: se manda (fail-open, es un correo informativo)", () => {
    expect(debeEnviarSolicitudRecibida(null)).toBe(true);
    expect(debeEnviarSolicitudRecibida(undefined)).toBe(true);
    expect(debeEnviarSolicitudRecibida("")).toBe(true);
    expect(debeEnviarSolicitudRecibida("canal_nuevo_de_mañana")).toBe(true);
  });

  it("solo 'web' está silenciado, para que revertirlo sea vaciar la lista", () => {
    expect(CANALES_SIN_SOLICITUD_RECIBIDA).toEqual(["web"]);
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
    // Solo horas: la sala salió del correo el 2026-09-28 (punto 7 del
    // contrato en plantillas.ts).
    expect(html).toContain("Pediste:</strong> 21:00");
    expect(html).toContain("Te ofrecemos:</strong> 20:30");
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
