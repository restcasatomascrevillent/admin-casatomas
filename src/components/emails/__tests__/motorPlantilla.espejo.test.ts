// ============================================================================
// EL ESPEJO NO PUEDE MENTIR — vista previa del panel vs. correo real
// ============================================================================
// `src/components/emails/motorPlantilla.ts` es una copia a mano del render de
// `supabase/functions/emails-reserva/plantillas.ts`. En septiembre de 2026 las
// dos copias se desincronizaron: la función dejó de enseñar la sala al cliente
// y el panel siguió pintándola, así que la vista previa enseñaba un correo que
// nadie iba a recibir. Una vista previa que miente es PEOR que no tener vista
// previa, porque da confianza falsa.
//
// El arreglo de fondo fue quitar la copia: `motorPlantilla.ts` ya solo
// REEXPORTA el render de la Edge Function, así que hoy las comparaciones de
// este fichero son verdad por construcción. Se quedan igualmente, y a
// propósito, como ALAMBRE TRAMPA: si alguien vuelve a copiar el render a mano
// en el panel —por un merge, por "no quiero importar de supabase/", por lo que
// sea— estas pruebas son lo que se pone rojo en cuanto la copia se desvíe un
// byte. Es barato mantenerlas y es exactamente el fallo que ya nos costó un
// despliegue.
//
// La segunda mitad del fichero NO es tautológica: fija el comportamiento que
// el dueño tiene que poder dar por bueno (la sala no sale por ningún lado, el
// bloque de comparación solo aparece por la hora, el selector no ofrece
// variables muertas). Eso seguiría teniendo sentido aunque el render cambiara
// de sitio otra vez.
//
// Importar el fichero de la Edge Function desde el navegador funciona porque
// `plantillas.ts` y su única dependencia (`reservas-web/plantillas.ts`) son
// módulos PUROS: sin I/O, sin `Deno.*`, sin imports de red. No es una vía
// nueva: el panel ya importaba de `supabase/functions/` en otros 9 sitios.
// ============================================================================

import { describe, it, expect } from "vitest";

import {
  renderPlantilla as renderPanel,
  hayContraoferta as hayContraofertaPanel,
  construirTokens as construirTokensPanel,
  type FilaPlantilla,
  type DatosReservaParaCorreo,
  type DatosNegocio,
} from "../motorPlantilla";

import {
  renderPlantilla as renderFuncion,
  hayContraoferta as hayContraofertaFuncion,
  construirTokens as construirTokensFuncion,
} from "../../../../supabase/functions/emails-reserva/plantillas";

import { datosEjemploPara, TOKENS_DISPONIBLES } from "../catalogoTokens";

// ----------------------------------------------------------------------------
// Plantillas de prueba. Las dos primeras son COPIA LITERAL de las filas
// vigentes de `plantillas_email_reserva` (leídas de la BD el 2026-09-29): si
// el espejo cuadra con los textos reales, cuadra con lo que ve el dueño.
// ----------------------------------------------------------------------------

const PROPUESTA_REAL: FilaPlantilla = {
  tipo: "propuesta",
  version: 1,
  asunto: "Confirma tu reserva - Casa Tomás",
  saludo: "Hola, {{nombre}}",
  cuerpo: "Tu mesa está casi lista. Revisa los datos de tu reserva y confirma tu asistencia para garantizarla.",
  texto_boton_principal: "Sí, confirmo mi asistencia",
  texto_boton_secundario: "No puedo, cancelar reserva",
  pie: "Si no confirmas, la mesa puede quedar disponible para otros clientes.",
  color_acento: "#B8936A",
  color_oscuro: "#1C1F22",
  logo_url: null,
  bloques: { mostrar_pie_contacto: true, mostrar_tabla_detalles: true, mostrar_boton_secundario: true },
};

const SOLICITUD_REAL: FilaPlantilla = {
  tipo: "solicitud_recibida",
  version: 1,
  asunto: "Hemos recibido tu solicitud - Casa Tomás",
  saludo: "Hola, {{nombre}}",
  cuerpo:
    "Hemos recibido tu solicitud de reserva en Casa Tomás. Nuestro equipo la revisará y te confirmaremos la disponibilidad a la mayor brevedad posible.\n\nNo es necesario que hagas nada más. Recibirás un correo en cuanto esté todo listo.",
  texto_boton_principal: null,
  texto_boton_secundario: null,
  pie: "Casa Tomás · Crevillente",
  color_acento: "#B8936A",
  color_oscuro: "#1C1F22",
  logo_url: null,
  bloques: { mostrar_pie_contacto: true, mostrar_tabla_detalles: true },
};

/** Plantilla que escribe A PROPÓSITO todos los tokens, incluidos los dos de
 * sala, para comprobar que los dos motores los resuelven igual (a vacío). */
const PLANTILLA_CON_TODOS_LOS_TOKENS: FilaPlantilla = {
  ...PROPUESTA_REAL,
  asunto: "{{nombre}} — {{fecha}} a las {{hora}} [{{espacio}}]",
  saludo: "Hola, {{nombre}}",
  cuerpo:
    "Reserva para {{comensales}} el {{fecha}}.\n\nPediste las {{hora_solicitada}} en {{espacio_solicitado}} y te damos las {{hora}} en {{espacio}}.\n\nToken inventado: {{no_existe}}.",
  pie: "{{espacio}}{{espacio_solicitado}}",
};

const BASE: DatosReservaParaCorreo = {
  nombre: "Laura Martínez",
  fecha: "2026-03-16",
  hora: "21:00",
  comensales: 4,
  espacio: "Comedor",
  horaSolicitada: "21:00",
  espacioSolicitado: "Comedor",
  botonPrincipalUrl: "https://ejemplo.test/si",
  botonSecundarioUrl: "https://ejemplo.test/no",
};

const CASOS: Array<{ nombre: string; plantilla: FilaPlantilla; datos: DatosReservaParaCorreo }> = [
  {
    nombre: "propuesta con CAMBIO DE HORA y de sala (contraoferta de verdad)",
    plantilla: PROPUESTA_REAL,
    datos: { ...BASE, hora: "21:30", espacio: "Terraza", horaSolicitada: "21:00", espacioSolicitado: "Comedor" },
  },
  {
    nombre: "propuesta con CAMBIO DE SALA SOLO, misma hora — no debe salir comparación",
    plantilla: PROPUESTA_REAL,
    datos: { ...BASE, hora: "21:00", espacio: "Terraza", horaSolicitada: "21:00", espacioSolicitado: "Comedor" },
  },
  {
    nombre: "propuesta sin sala asignada",
    plantilla: PROPUESTA_REAL,
    datos: { ...BASE, espacio: null, espacioSolicitado: null },
  },
  {
    nombre: "solicitud_recibida con sala asignada",
    plantilla: SOLICITUD_REAL,
    datos: { ...BASE, espacio: "Salón" },
  },
  {
    nombre: "tabla de detalles apagada",
    plantilla: { ...PROPUESTA_REAL, bloques: { mostrar_tabla_detalles: false } },
    datos: { ...BASE, hora: "22:00", horaSolicitada: "21:00" },
  },
  {
    nombre: "pie y botón secundario apagados",
    plantilla: { ...PROPUESTA_REAL, bloques: { mostrar_pie_contacto: false, mostrar_boton_secundario: false } },
    datos: BASE,
  },
  {
    nombre: "sin horaSolicitada (recordatorio típico)",
    plantilla: { ...PROPUESTA_REAL, tipo: "recordatorio" },
    datos: { ...BASE, horaSolicitada: null, espacioSolicitado: null, espacio: "Terraza" },
  },
  {
    nombre: "todos los tokens escritos a mano, incluidos los de sala",
    plantilla: PLANTILLA_CON_TODOS_LOS_TOKENS,
    datos: { ...BASE, hora: "21:30", espacio: "Terraza", horaSolicitada: "21:00", espacioSolicitado: "Comedor" },
  },
  {
    nombre: "nombre con HTML dentro (escapado en los dos lados)",
    plantilla: PROPUESTA_REAL,
    datos: { ...BASE, nombre: '<script>alert("x")</script> & "Pepe"' },
  },
  {
    nombre: "una sola persona (singular de comensales)",
    plantilla: PLANTILLA_CON_TODOS_LOS_TOKENS,
    datos: { ...BASE, comensales: 1 },
  },
];

describe("motorPlantilla (panel) es un espejo exacto de plantillas.ts (Edge Function)", () => {
  it.each(CASOS)("mismo HTML y mismo asunto — $nombre", ({ plantilla, datos }) => {
    const panel = renderPanel(plantilla, datos);
    const funcion = renderFuncion(plantilla, datos);

    expect(panel.asunto).toBe(funcion.asunto);
    expect(panel.html).toBe(funcion.html);
  });

  it("los cinco tipos de plantilla salen idénticos con los datos de ejemplo del editor", () => {
    const tipos = ["solicitud_recibida", "propuesta", "confirmada", "rechazada", "recordatorio"] as const;
    for (const tipo of tipos) {
      const plantilla: FilaPlantilla = { ...PROPUESTA_REAL, tipo };
      const datos = datosEjemploPara(tipo);
      expect(renderPanel(plantilla, datos).html, `tipo ${tipo}`).toBe(renderFuncion(plantilla, datos).html);
    }
  });

  it("hayContraoferta devuelve lo mismo en los dos motores", () => {
    const variantes: DatosReservaParaCorreo[] = [
      { ...BASE },
      { ...BASE, hora: "21:30" },
      { ...BASE, espacio: "Terraza" },
      { ...BASE, hora: "21:30", espacio: "Terraza" },
      { ...BASE, horaSolicitada: null },
      { ...BASE, horaSolicitada: undefined },
      { ...BASE, hora: "21:00:00", horaSolicitada: "21:00" },
    ];
    for (const datos of variantes) {
      expect(hayContraofertaPanel(datos), JSON.stringify(datos)).toBe(hayContraofertaFuncion(datos));
    }
  });

  it("construirTokens coincide en todas las claves que comparten", () => {
    const panel = construirTokensPanel(BASE);
    const funcion = construirTokensFuncion(BASE);
    for (const clave of Object.keys(panel)) {
      expect(panel[clave], `token ${clave}`).toBe(funcion[clave]);
    }
  });
});

describe("la sala no se le enseña al cliente (punto 7 del contrato)", () => {
  const datosConSala: DatosReservaParaCorreo = {
    ...BASE,
    hora: "21:30",
    espacio: "Terraza",
    horaSolicitada: "21:00",
    espacioSolicitado: "Comedor",
  };

  it("la tabla de detalles no lleva fila Espacio aunque la reserva tenga sala", () => {
    const { html } = renderPanel(PROPUESTA_REAL, datosConSala);
    expect(html).not.toContain("Espacio");
    expect(html).not.toContain("Terraza");
    expect(html).not.toContain("Comedor");
  });

  it("la tabla de detalles tiene exactamente 3 filas: Fecha, Hora y Comensales", () => {
    const { html } = renderPanel(PROPUESTA_REAL, datosConSala);
    const etiquetas = [...html.matchAll(/text-transform:uppercase;color:#B8936A;display:block[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(etiquetas).toEqual(["Fecha", "Hora", "Comensales"]);
  });

  it('el bloque de comparación dice solo las horas, sin " en <sala>"', () => {
    const { html } = renderPanel(PROPUESTA_REAL, datosConSala);
    expect(html).toContain("Pediste:</strong> 21:00<br>");
    expect(html).toContain("Te ofrecemos:</strong> 21:30");
    expect(html).not.toMatch(/Pediste:<\/strong>[^<]*\sen\s/);
  });

  it("un cambio de SALA a la misma hora no pinta el absurdo 21:00 / 21:00", () => {
    const soloSala: DatosReservaParaCorreo = { ...datosConSala, hora: "21:00", horaSolicitada: "21:00" };
    expect(hayContraofertaPanel(soloSala)).toBe(false);
    const { html } = renderPanel(PROPUESTA_REAL, soloSala);
    expect(html).not.toContain("Pediste:");
    expect(html).not.toContain("Te ofrecemos:");
  });

  it("{{espacio}} y {{espacio_solicitado}} se sustituyen por vacío, no por la sala ni por el literal", () => {
    const { html, asunto } = renderPanel(PLANTILLA_CON_TODOS_LOS_TOKENS, datosConSala);
    expect(asunto).toBe("Laura Martínez — 16 de marzo de 2026 a las 21:30 []");
    expect(html).not.toContain("{{");
    expect(html).not.toContain("Terraza");
    expect(html).not.toContain("Comedor");
    expect(html).toContain("Pediste las 21:00 en  y te damos las 21:30 en .");
  });

  it("el selector de variables del editor ya no ofrece los tokens de sala", () => {
    const claves = TOKENS_DISPONIBLES.map((t) => t.clave);
    expect(claves).not.toContain("espacio");
    expect(claves).not.toContain("espacio_solicitado");
    expect(claves).toEqual(["nombre", "fecha", "hora", "comensales", "hora_solicitada", "negocio"]);
  });
});

// ----------------------------------------------------------------------------
// El punto ciego de antes: la marca. Mientras el panel tuvo su propia copia
// del render, no sabía nada de `negocio` — hardcodeaba "Casa Tomás", su
// dirección y su teléfono, y `{{negocio}}` se le quedaba en blanco. Con la
// reexportación el panel hereda el soporte de marca entero; esto lo fija para
// que una copia futura no pueda volver a perderlo sin que se note.
// ----------------------------------------------------------------------------

describe("la marca del correo (Casa Tomás / Touza) también viaja a la vista previa", () => {
  const TOUZA: DatosNegocio = {
    nombre: "Touza",
    localidad: "Crevillente",
    direccion: "C/ Ejemplo, 1",
    telefonoTexto: "900 00 00 00",
    telefonoDigits: "900000000",
  };

  it("{{negocio}} se resuelve, no se queda vacío", () => {
    const plantilla: FilaPlantilla = { ...PROPUESTA_REAL, asunto: "Tu reserva en {{negocio}}" };
    expect(renderPanel(plantilla, BASE).asunto).toBe("Tu reserva en Casa Tomás");
    expect(renderPanel(plantilla, { ...BASE, negocio: TOUZA }).asunto).toBe("Tu reserva en Touza");
  });

  it("sin marca explícita se pinta Casa Tomás, con su dirección y su teléfono", () => {
    const { html } = renderPanel(PROPUESTA_REAL, BASE);
    expect(html).toContain("Casa Tomás");
    expect(html).toContain("966 10 78 87");
    expect(html).not.toContain("Touza");
  });

  it("una reserva de Touza pinta Touza por todas partes, no Casa Tomás", () => {
    const { html, asunto } = renderPanel(PROPUESTA_REAL, { ...BASE, negocio: TOUZA });
    expect(html).toContain("Touza");
    expect(html).toContain("900 00 00 00");
    expect(html).not.toContain("Casa Tom");
    // El asunto guardado dice "Casa Tomás" a fuego y aun así sale adaptado.
    expect(asunto).toBe("Confirma tu reserva - Touza");
  });

  it("vista previa y correo real siguen coincidiendo con una marca distinta", () => {
    const datos = { ...BASE, negocio: TOUZA };
    expect(renderPanel(PROPUESTA_REAL, datos).html).toBe(renderFuncion(PROPUESTA_REAL, datos).html);
    expect(renderPanel(PROPUESTA_REAL, datos).asunto).toBe(renderFuncion(PROPUESTA_REAL, datos).asunto);
  });
});
