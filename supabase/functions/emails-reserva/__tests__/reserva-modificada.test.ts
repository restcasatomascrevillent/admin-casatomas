/**
 * Tests del correo «reserva modificada» (emails-reserva):
 *   · reserva-modificada.ts — decisiones puras: cuándo se avisa, la clave de
 *     idempotencia (varias modificaciones sí, el mismo aviso dos veces no), qué
 *     «antes» se enseña, y si un reintento sigue valiendo.
 *   · plantillas.ts — el bloque automático «Cambios en tu reserva» (antes/ahora,
 *     solo lo que cambió) y la frase de qué tiene que hacer el cliente según el
 *     estado de su reserva.
 *
 * Todo puro: sin Supabase, sin Resend, sin red.
 */
import { describe, it, expect } from "vitest";
import {
  renderPlantilla,
  cambiosDeLaReserva,
  fraseEstadoTrasModificacion,
  TIPOS_PLANTILLA,
  type FilaPlantilla,
  type DatosReservaParaCorreo,
} from "../plantillas.ts";
import {
  TIPO_RESERVA_MODIFICADA,
  leerDiaHoraComensales,
  diaHoraComensalesDeReserva,
  huellaDiaHoraComensales,
  claveAviso,
  reservaYaPaso,
  modificacionReciente,
  motivoParaNoAvisar,
  planificarAviso,
  avisoSigueVigente,
  leerDetalleAviso,
  datosModificacionParaCorreo,
  valoresListaNegra,
  hayEntradaListaNegraVigente,
  type ReservaParaAviso,
  type DetalleAviso,
} from "../reserva-modificada.ts";
import { datosEjemploParaTipo } from "../envio-prueba.ts";
import { prioridadEmailFallido, construirAvisoLote } from "../reintentos.ts";

// 2026-10-10 21:00 en Madrid (horario de verano, UTC+2) = 19:00 UTC.
const ANTES_DE_LA_RESERVA = "2026-10-01T10:00:00.000Z";

function reserva(over: Partial<ReservaParaAviso> = {}): ReservaParaAviso {
  return {
    email: "ana@ejemplo.com",
    telefono: "+34612345678",
    estado: "confirmada",
    fecha: "2026-10-10",
    hora: "21:00:00",
    numero_comensales: 4,
    nombre: "Ana López",
    notas_cliente: null,
    en_blacklist: false,
    ...over,
  };
}

const ANTES = { fecha: "2026-10-10", hora: "20:00", comensales: 4 };

function plantillaModificada(over: Partial<FilaPlantilla> = {}): FilaPlantilla {
  return {
    tipo: "reserva_modificada",
    version: 1,
    asunto: "Hemos modificado tu reserva - {{negocio}}",
    saludo: "Hola, {{nombre}}",
    cuerpo: "Te escribimos porque hemos modificado tu reserva en {{negocio}}.",
    texto_boton_principal: "Sí, confirmo mi asistencia",
    texto_boton_secundario: "No puedo, cancelar reserva",
    pie: "Si necesitas cambiar algo más o cancelarla, llámanos con antelación.",
    color_acento: "#B8936A",
    color_oscuro: "#1C1F22",
    logo_url: null,
    bloques: {},
    ...over,
  };
}

function datosCorreo(over: Partial<DatosReservaParaCorreo> = {}): DatosReservaParaCorreo {
  return {
    nombre: "Ana López",
    fecha: "2026-10-10",
    hora: "21:30",
    comensales: 6,
    espacio: "Terraza",
    horaSolicitada: null,
    espacioSolicitado: null,
    modificacion: { antes: { fecha: "2026-10-08", hora: "21:00", comensales: 4 }, estado: "confirmada" },
    ...over,
  };
}

describe("reserva_modificada es un tipo más de plantilla", () => {
  it("está en TIPOS_PLANTILLA (el editor del panel y /enviar-prueba lo aceptan como los demás)", () => {
    expect(TIPOS_PLANTILLA).toContain("reserva_modificada");
    expect(TIPO_RESERVA_MODIFICADA).toBe("reserva_modificada");
  });
});

// ----------------------------------------------------------------------------
// Render: el bloque «Cambios en tu reserva»
// ----------------------------------------------------------------------------

describe("cambiosDeLaReserva — solo lo que cambió, antes → ahora", () => {
  it("lista fecha, hora y comensales cuando cambian los tres, en ese orden y ya formateados", () => {
    expect(cambiosDeLaReserva(datosCorreo())).toEqual([
      { etiqueta: "Fecha", antes: "8 de octubre de 2026", ahora: "10 de octubre de 2026" },
      { etiqueta: "Hora", antes: "21:00", ahora: "21:30" },
      { etiqueta: "Comensales", antes: "4", ahora: "6" },
    ]);
  });

  it("no enseña lo que no ha cambiado", () => {
    const soloHora = datosCorreo({
      fecha: "2026-10-10",
      comensales: 4,
      modificacion: { antes: { fecha: "2026-10-10", hora: "21:00", comensales: 4 }, estado: "confirmada" },
    });
    expect(cambiosDeLaReserva(soloHora)).toEqual([{ etiqueta: "Hora", antes: "21:00", ahora: "21:30" }]);
  });

  it("las horas se comparan sin segundos (21:00:00 de la BD = 21:00)", () => {
    const igual = datosCorreo({
      fecha: "2026-10-08",
      hora: "21:00:00",
      comensales: 4,
      modificacion: { antes: { fecha: "2026-10-08", hora: "21:00", comensales: 4 }, estado: "confirmada" },
    });
    expect(cambiosDeLaReserva(igual)).toEqual([]);
  });

  it("sin datos de modificación (el resto de correos) no hay cambios que enseñar", () => {
    expect(cambiosDeLaReserva(datosCorreo({ modificacion: null }))).toEqual([]);
    expect(cambiosDeLaReserva(datosCorreo({ modificacion: undefined }))).toEqual([]);
  });
});

describe("renderPlantilla con datos de modificación", () => {
  it("pinta el bloque automático con antes y ahora de cada cambio, y la insignia «Reserva modificada»", () => {
    const { html, asunto } = renderPlantilla(plantillaModificada(), datosCorreo());
    expect(asunto).toBe("Hemos modificado tu reserva - Casa Tomás");
    expect(html).toContain("Reserva modificada");
    expect(html).toContain("Cambios en tu reserva");
    expect(html).toContain("Fecha:</strong> antes 8 de octubre de 2026, ahora");
    expect(html).toContain("Hora:</strong> antes 21:00, ahora");
    expect(html).toContain("Comensales:</strong> antes 4, ahora");
    // Y los datos finales siguen en la tabla de detalles de siempre.
    expect(html).toContain("10 de octubre de 2026");
    expect(html).toContain("21:30");
  });

  it("solo pinta las líneas de lo que cambió", () => {
    const { html } = renderPlantilla(
      plantillaModificada(),
      datosCorreo({
        fecha: "2026-10-10",
        comensales: 4,
        modificacion: { antes: { fecha: "2026-10-10", hora: "21:00", comensales: 4 }, estado: "confirmada" },
      }),
    );
    expect(html).toContain("Hora:</strong> antes 21:00, ahora");
    expect(html).not.toContain("Fecha:</strong> antes");
    expect(html).not.toContain("Comensales:</strong> antes");
  });

  it("nunca mezcla el «Pediste / Te ofrecemos» de la contraoferta con el aviso de cambio", () => {
    const { html } = renderPlantilla(plantillaModificada(), datosCorreo({ horaSolicitada: "20:00" }));
    expect(html).not.toContain("Pediste:");
    expect(html).not.toContain("Te ofrecemos:");
    expect(html).toContain("Cambios en tu reserva");
  });

  it("si al final no cambió nada visible, no hay bloque (nunca «antes 21:00, ahora 21:00»)", () => {
    const { html } = renderPlantilla(
      plantillaModificada(),
      datosCorreo({
        fecha: "2026-10-08",
        hora: "21:00",
        comensales: 4,
        modificacion: { antes: { fecha: "2026-10-08", hora: "21:00", comensales: 4 }, estado: "confirmada" },
      }),
    );
    expect(html).not.toContain("Cambios en tu reserva");
  });

  it("el resto de correos no cambian: sin modificación no hay bloque ni frase", () => {
    const { html } = renderPlantilla({ ...plantillaModificada(), tipo: "confirmada" }, datosCorreo({ modificacion: null }));
    expect(html).not.toContain("Cambios en tu reserva");
    expect(html).not.toContain("sigue confirmada");
  });

  it("escapa lo que se pinta en el bloque", () => {
    const { html } = renderPlantilla(
      plantillaModificada(),
      datosCorreo({ modificacion: { antes: { fecha: "<b>x</b>", hora: "21:00", comensales: 4 }, estado: "confirmada" } }),
    );
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("la sala no aparece aunque la reserva tenga una (punto 7 del contrato)", () => {
    const { html } = renderPlantilla(plantillaModificada(), datosCorreo({ espacio: "Terraza", espacioSolicitado: "Salón" }));
    expect(html).not.toContain("Terraza");
    expect(html).not.toContain("Salón");
  });
});

describe("frase automática de qué tiene que hacer el cliente", () => {
  it("confirmada: sigue confirmada, no tiene que hacer nada", () => {
    expect(fraseEstadoTrasModificacion("confirmada", false)).toMatch(/sigue confirmada/);
    const { html } = renderPlantilla(plantillaModificada(), datosCorreo());
    expect(html).toMatch(/sigue confirmada/);
  });

  it("verificada con botón: la confirma con el botón, que sustituye al enlace de un correo anterior", () => {
    const frase = fraseEstadoTrasModificacion("verificada", true)!;
    expect(frase).toMatch(/pendiente de tu confirmación/);
    expect(frase).toMatch(/botón/);
    expect(frase).toMatch(/correo anterior/);
  });

  it("verificada sin botón (plantilla sin texto de botón o sin enlace): no le promete un botón que no está", () => {
    const frase = fraseEstadoTrasModificacion("verificada", false)!;
    expect(frase).not.toMatch(/botón/);
    expect(frase).toMatch(/llámanos/i);
  });

  it("pendiente: sigue pendiente de revisión, se le escribirá cuando esté confirmada", () => {
    expect(fraseEstadoTrasModificacion("pendiente", false)).toMatch(/pendiente de revisión/);
  });

  it("cualquier otro estado: sin frase", () => {
    expect(fraseEstadoTrasModificacion("cancelada", false)).toBeNull();
    expect(fraseEstadoTrasModificacion("", false)).toBeNull();
  });

  it("verificada con enlaces: salen los dos botones y la frase que los menciona", () => {
    const { html } = renderPlantilla(
      plantillaModificada(),
      datosCorreo({
        modificacion: { antes: { fecha: "2026-10-08", hora: "21:00", comensales: 4 }, estado: "verificada" },
        botonPrincipalUrl: "https://web/reserva/respuesta?token=nuevo-aceptar",
        botonSecundarioUrl: "https://web/reserva/respuesta?token=nuevo-rechazar",
      }),
    );
    expect(html).toContain("token=nuevo-aceptar");
    expect(html).toContain("token=nuevo-rechazar");
    expect(html).toContain("Sí, confirmo mi asistencia");
    expect(html).toMatch(/pendiente de tu confirmación/);
  });

  it("confirmada: aunque la plantilla tenga texto de botones, sin enlaces no sale ningún botón", () => {
    const { html } = renderPlantilla(plantillaModificada(), datosCorreo());
    expect(html).not.toContain("Sí, confirmo mi asistencia");
    expect(html).not.toContain("No puedo, cancelar reserva");
  });
});

// ----------------------------------------------------------------------------
// Decisiones puras de reserva-modificada.ts
// ----------------------------------------------------------------------------

describe("leerDiaHoraComensales — lo que manda el panel como «antes» no se cree a ciegas", () => {
  it("acepta y normaliza un valor correcto", () => {
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00:00", comensales: 4 })).toEqual({
      fecha: "2026-10-10",
      hora: "21:00",
      comensales: 4,
    });
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "9:05", comensales: "2" })).toEqual({
      fecha: "2026-10-10",
      hora: "09:05",
      comensales: 2,
    });
  });

  it("rechaza fechas, horas y comensales imposibles o con otra forma", () => {
    expect(leerDiaHoraComensales(null)).toBeNull();
    expect(leerDiaHoraComensales("2026-10-10")).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-02-30", hora: "21:00", comensales: 4 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "10/10/2026", hora: "21:00", comensales: 4 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "25:00", comensales: 4 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:60", comensales: 4 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "<script>", comensales: 4 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00", comensales: 0 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00", comensales: 2.5 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00", comensales: 5000 })).toBeNull();
    expect(leerDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00" })).toBeNull();
  });
});

describe("huella y clave del aviso", () => {
  it("la huella son los datos NUEVOS: día|HH:MM|comensales", () => {
    expect(huellaDiaHoraComensales({ fecha: "2026-10-10", hora: "21:00", comensales: 4 })).toBe("2026-10-10|21:00|4");
    expect(diaHoraComensalesDeReserva({ fecha: "2026-10-10", hora: "21:00:00", numero_comensales: 4 })).toEqual({
      fecha: "2026-10-10",
      hora: "21:00",
      comensales: 4,
    });
  });

  it("la clave encadena la huella con el aviso anterior de la misma reserva", () => {
    const ahora = { fecha: "2026-10-10", hora: "21:00", comensales: 4 };
    expect(claveAviso(ahora, null)).toBe("2026-10-10|21:00|4|tras:ninguno");
    expect(claveAviso(ahora, "env-1")).toBe("2026-10-10|21:00|4|tras:env-1");
  });
});

describe("reservaYaPaso — con la hora de Madrid, no la del servidor", () => {
  it("21:00 en Madrid (verano, UTC+2) son las 19:00 UTC", () => {
    const r = { fecha: "2026-10-10", hora: "21:00:00" };
    expect(reservaYaPaso(r, "2026-10-10T18:59:00.000Z")).toBe(false);
    expect(reservaYaPaso(r, "2026-10-10T19:00:00.000Z")).toBe(true);
    expect(reservaYaPaso(r, "2026-10-11T08:00:00.000Z")).toBe(true);
  });

  it("21:00 en Madrid (invierno, UTC+1) son las 20:00 UTC", () => {
    const r = { fecha: "2026-12-10", hora: "21:00:00" };
    expect(reservaYaPaso(r, "2026-12-10T19:59:00.000Z")).toBe(false);
    expect(reservaYaPaso(r, "2026-12-10T20:00:00.000Z")).toBe(true);
  });

  it("el día del cambio de hora (25-10-2026, a las 03:00 vuelven a ser las 02:00) también cuadra", () => {
    // 13:00 de ese domingo ya es horario de invierno (UTC+1) = 12:00 UTC.
    const r = { fecha: "2026-10-25", hora: "13:00:00" };
    expect(reservaYaPaso(r, "2026-10-25T11:59:00.000Z")).toBe(false);
    expect(reservaYaPaso(r, "2026-10-25T12:00:00.000Z")).toBe(true);
  });
});

describe("modificacionReciente — el «antes» solo se acepta justo después de guardar", () => {
  const ahora = "2026-10-01T10:00:00.000Z";

  it("la reserva se acaba de guardar (el trigger update_reservas_updated_at mueve updated_at): sí", () => {
    expect(modificacionReciente("2026-10-01T09:59:30.000Z", ahora)).toBe(true);
    expect(modificacionReciente("2026-10-01T09:50:01.000Z", ahora)).toBe(true);
  });

  it("una reserva que nadie ha tocado en los últimos 10 minutos: no (petición fuera de una edición)", () => {
    expect(modificacionReciente("2026-10-01T09:49:59.000Z", ahora)).toBe(false);
    expect(modificacionReciente("2026-09-20T10:00:00.000Z", ahora)).toBe(false);
  });

  it("un reloj de la BD unos segundos por delante no la rechaza; sin fecha legible, sí", () => {
    expect(modificacionReciente("2026-10-01T10:00:05.000Z", ahora)).toBe(true);
    expect(modificacionReciente(null, ahora)).toBe(false);
    expect(modificacionReciente("ayer", ahora)).toBe(false);
  });

  it("acepta el formato de Postgres (espacio y +00)", () => {
    expect(modificacionReciente("2026-10-01 09:59:30.123456+00", ahora)).toBe(true);
  });
});

describe("motivoParaNoAvisar — los casos en que NO sale el correo", () => {
  const opciones = { ahoraIso: ANTES_DE_LA_RESERVA, enListaNegra: false };

  it("una reserva viva, futura, con email y un cambio de verdad: se avisa", () => {
    expect(motivoParaNoAvisar(reserva(), ANTES, opciones)).toBeNull();
    expect(motivoParaNoAvisar(reserva({ estado: "verificada" }), ANTES, opciones)).toBeNull();
    expect(motivoParaNoAvisar(reserva({ estado: "pendiente" }), ANTES, opciones)).toBeNull();
  });

  it("sin «antes» legible no se inventa nada", () => {
    expect(motivoParaNoAvisar(reserva(), null, opciones)).toBe("antes_invalido");
  });

  // Decisión del dueño 2026-09-28 (debeEnviarSolicitudRecibida, plantillas.ts):
  // la reserva WEB pendiente no recibe ningún correo hasta la «propuesta». Un
  // aviso de cambio sería justo el doble correo que se quitó.
  it("pendiente de la WEB: no se avisa (aún no ha recibido ningún correo; le llegará la propuesta al verificarla)", () => {
    expect(motivoParaNoAvisar(reserva({ estado: "pendiente", canal: "web" }), ANTES, opciones)).toBe(
      "pendiente_sin_correo_previo",
    );
    expect(motivoParaNoAvisar(reserva({ estado: "pendiente", canal: " WEB " }), ANTES, opciones)).toBe(
      "pendiente_sin_correo_previo",
    );
  });

  it("pendiente de teléfono o manual (sí recibieron «solicitud recibida»), o web ya verificada/confirmada: sí se avisa", () => {
    expect(motivoParaNoAvisar(reserva({ estado: "pendiente", canal: "telefono" }), ANTES, opciones)).toBeNull();
    expect(motivoParaNoAvisar(reserva({ estado: "pendiente", canal: "manual" }), ANTES, opciones)).toBeNull();
    expect(motivoParaNoAvisar(reserva({ estado: "verificada", canal: "web" }), ANTES, opciones)).toBeNull();
    expect(motivoParaNoAvisar(reserva({ estado: "confirmada", canal: "web" }), ANTES, opciones)).toBeNull();
  });

  it("sin email (o en blanco)", () => {
    expect(motivoParaNoAvisar(reserva({ email: null }), ANTES, opciones)).toBe("reserva_sin_email");
    expect(motivoParaNoAvisar(reserva({ email: "   " }), ANTES, opciones)).toBe("reserva_sin_email");
  });

  it.each(["cancelada", "completada", "no_show"])("reserva que ya no está viva («%s»)", (estado) => {
    expect(motivoParaNoAvisar(reserva({ estado }), ANTES, opciones)).toBe("reserva_no_viva");
  });

  it("la reserva ya pasó (mirando día Y hora)", () => {
    expect(motivoParaNoAvisar(reserva(), ANTES, { ...opciones, ahoraIso: "2026-10-10T19:30:00.000Z" })).toBe(
      "reserva_pasada",
    );
  });

  it("cliente en lista negra (la marca de la reserva o la lista)", () => {
    expect(motivoParaNoAvisar(reserva(), ANTES, { ...opciones, enListaNegra: true })).toBe("en_lista_negra");
    expect(motivoParaNoAvisar(reserva({ en_blacklist: true }), ANTES, opciones)).toBe("en_lista_negra");
  });

  it("datos de prueba (seed de demo o @example.com): igual que el recordatorio, no se escribe", () => {
    expect(motivoParaNoAvisar(reserva({ email: "demo@example.com" }), ANTES, opciones)).toBe("reserva_de_prueba");
    expect(motivoParaNoAvisar(reserva({ notas_cliente: "[DEMO-SEED] x" }), ANTES, opciones)).toBe("reserva_de_prueba");
  });

  it("no cambió ni el día, ni la hora, ni los comensales", () => {
    const igual = { fecha: "2026-10-10", hora: "21:00", comensales: 4 };
    expect(motivoParaNoAvisar(reserva(), igual, opciones)).toBe("sin_cambios");
  });
});

describe("planificarAviso — idempotencia: varias modificaciones sí, el mismo aviso dos veces no", () => {
  const detalle = (antes: DetalleAviso["antes"], ahora: DetalleAviso["ahora"], estado = "confirmada"): DetalleAviso => ({
    antes,
    ahora,
    estado,
  });
  const A = { fecha: "2026-10-10", hora: "20:00", comensales: 4 };
  const B = { fecha: "2026-10-10", hora: "21:00", comensales: 4 };
  const C = { fecha: "2026-10-10", hora: "21:30", comensales: 4 };
  const reservaEn = (d: typeof A, over: Partial<ReservaParaAviso> = {}) =>
    reserva({ fecha: d.fecha, hora: `${d.hora}:00`, numero_comensales: d.comensales, ...over });

  it("primer aviso de la reserva: se envía, con su clave y lo necesario para repetir el MISMO correo en un reintento", () => {
    const plan = planificarAviso({ reserva: reservaEn(B), antes: A, anterior: null });
    expect(plan).toEqual({
      accion: "enviar",
      clave: "2026-10-10|21:00|4|tras:ninguno",
      detalle: { antes: A, ahora: B, estado: "confirmada" },
    });
  });

  it.each(["pendiente", "enviado", "fallido"])(
    "doble clic o reintento: si el último aviso (%s) ya lleva estos mismos datos nuevos, no se repite",
    (resultado) => {
      const plan = planificarAviso({
        reserva: reservaEn(B),
        antes: A,
        anterior: { id: "env-1", resultado, detalle: detalle(A, B) },
      });
      expect(plan).toEqual({ accion: "no_enviar", motivo: "ya_enviado_o_en_curso" });
    },
  );

  it("una segunda modificación (otros datos) SÍ se avisa, encadenada al aviso anterior", () => {
    const plan = planificarAviso({
      reserva: reservaEn(C),
      antes: B,
      anterior: { id: "env-1", resultado: "enviado", detalle: detalle(A, B) },
    });
    expect(plan).toEqual({
      accion: "enviar",
      clave: "2026-10-10|21:30|4|tras:env-1",
      detalle: { antes: B, ahora: C, estado: "confirmada" },
    });
  });

  it("ida y vuelta A→B→A→B: cada aviso tiene su clave (no se bloquea el tercero por repetir datos)", () => {
    const p1 = planificarAviso({ reserva: reservaEn(B), antes: A, anterior: null });
    const p2 = planificarAviso({
      reserva: reservaEn(A),
      antes: B,
      anterior: { id: "env-1", resultado: "enviado", detalle: detalle(A, B) },
    });
    const p3 = planificarAviso({
      reserva: reservaEn(B),
      antes: A,
      anterior: { id: "env-2", resultado: "enviado", detalle: detalle(B, A) },
    });
    const claves = [p1, p2, p3].map((p) => (p.accion === "enviar" ? p.clave : p.motivo));
    expect(new Set(claves).size).toBe(3);
    expect(claves.every((c) => c.includes("|tras:"))).toBe(true);
  });

  it("si el aviso anterior NO llegó a salir (fallido, se reintentará), el nuevo cuenta desde lo que el cliente sí sabía", () => {
    const plan = planificarAviso({
      reserva: reservaEn(C),
      antes: B,
      anterior: { id: "env-1", resultado: "fallido", detalle: detalle(A, B) },
    });
    expect(plan).toEqual({
      accion: "enviar",
      clave: "2026-10-10|21:30|4|tras:env-1",
      detalle: { antes: A, ahora: C, estado: "confirmada" },
    });
  });

  it("…y si con eso vuelve a quedar como el cliente la conocía, no hay nada que avisar", () => {
    const plan = planificarAviso({
      reserva: reservaEn(A),
      antes: B,
      anterior: { id: "env-1", resultado: "fallido", detalle: detalle(A, B) },
    });
    expect(plan).toEqual({ accion: "no_enviar", motivo: "sin_cambios" });
  });

  it("un aviso anterior ilegible no bloquea el nuevo (y se encadena igual)", () => {
    const plan = planificarAviso({
      reserva: reservaEn(C),
      antes: B,
      anterior: { id: "env-9", resultado: "enviado", detalle: { basura: true } },
    });
    expect(plan.accion).toBe("enviar");
    expect(plan.accion === "enviar" && plan.clave).toBe("2026-10-10|21:30|4|tras:env-9");
  });

  it("guarda el estado con el que se avisa (decide botones y frase; un reintento debe salir igual)", () => {
    const plan = planificarAviso({ reserva: reservaEn(B, { estado: "verificada" }), antes: A, anterior: null });
    expect(plan.accion === "enviar" && plan.detalle.estado).toBe("verificada");
  });
});

describe("avisoSigueVigente — un reintento solo sale si el correo sigue siendo verdad", () => {
  const detalle: DetalleAviso = {
    antes: { fecha: "2026-10-10", hora: "20:00", comensales: 4 },
    ahora: { fecha: "2026-10-10", hora: "21:00", comensales: 4 },
    estado: "confirmada",
  };

  it("mismos datos, mismo estado, aún no ha pasado: sí", () => {
    expect(avisoSigueVigente(detalle, reserva(), ANTES_DE_LA_RESERVA)).toBe(true);
  });

  it("la reserva ha vuelto a cambiar: ese aviso ya es viejo (el nuevo tiene el suyo)", () => {
    expect(avisoSigueVigente(detalle, reserva({ hora: "21:30:00" }), ANTES_DE_LA_RESERVA)).toBe(false);
    expect(avisoSigueVigente(detalle, reserva({ numero_comensales: 6 }), ANTES_DE_LA_RESERVA)).toBe(false);
  });

  it("cambió el estado (p. ej. ya la confirmó o se canceló): no", () => {
    expect(avisoSigueVigente(detalle, reserva({ estado: "verificada" }), ANTES_DE_LA_RESERVA)).toBe(false);
    expect(avisoSigueVigente(detalle, reserva({ estado: "cancelada" }), ANTES_DE_LA_RESERVA)).toBe(false);
  });

  it("ya pasó, o no hay detalle: no", () => {
    expect(avisoSigueVigente(detalle, reserva(), "2026-10-11T00:00:00.000Z")).toBe(false);
    expect(avisoSigueVigente(null, reserva(), ANTES_DE_LA_RESERVA)).toBe(false);
  });
});

describe("leerDetalleAviso / datosModificacionParaCorreo", () => {
  it("lee el detalle guardado en envios_email_reserva.detalle y rechaza formas raras", () => {
    const guardado = {
      antes: { fecha: "2026-10-10", hora: "20:00", comensales: 4 },
      ahora: { fecha: "2026-10-10", hora: "21:00", comensales: 4 },
      estado: "verificada",
    };
    expect(leerDetalleAviso(guardado)).toEqual(guardado);
    expect(leerDetalleAviso(null)).toBeNull();
    expect(leerDetalleAviso({ antes: guardado.antes })).toBeNull();
    expect(leerDetalleAviso({ ...guardado, estado: 3 })).toBeNull();
  });

  it("lo que necesita el render: el antes y el estado", () => {
    const d: DetalleAviso = {
      antes: { fecha: "2026-10-10", hora: "20:00", comensales: 4 },
      ahora: { fecha: "2026-10-10", hora: "21:00", comensales: 4 },
      estado: "pendiente",
    };
    expect(datosModificacionParaCorreo(d)).toEqual({ antes: d.antes, estado: "pendiente" });
  });
});

describe("lista negra (comprobación del servidor, además de la del panel)", () => {
  it("busca el email sin espacios y en minúsculas, y el teléfono en todas sus formas", () => {
    const { emails, telefonos } = valoresListaNegra(" Ana@Ejemplo.com ", "+34 612 345 678");
    expect(emails).toEqual(expect.arrayContaining(["Ana@Ejemplo.com", "ana@ejemplo.com"]));
    expect(telefonos).toEqual(expect.arrayContaining(["612345678", "+34612345678", "0034612345678"]));
  });

  it("sin contacto, nada que buscar", () => {
    expect(valoresListaNegra(null, null)).toEqual({ emails: [], telefonos: [] });
  });

  it("una entrada caducada ya no cuenta; sin caducidad o con caducidad futura, sí", () => {
    const hoy = "2026-10-01";
    expect(hayEntradaListaNegraVigente([], hoy)).toBe(false);
    expect(hayEntradaListaNegraVigente([{ caduca_el: null }], hoy)).toBe(true);
    expect(hayEntradaListaNegraVigente([{ caduca_el: "2026-10-01" }], hoy)).toBe(true);
    expect(hayEntradaListaNegraVigente([{ caduca_el: "2026-09-30" }], hoy)).toBe(false);
  });
});

describe("encaje con el resto del sistema de correos", () => {
  it("el envío de prueba trae un cambio de ejemplo (y ninguna contraoferta)", () => {
    const datos = datosEjemploParaTipo("reserva_modificada", "2026-01-01");
    expect(datos.horaSolicitada).toBeUndefined();
    expect(datos.modificacion).toBeTruthy();
    expect(cambiosDeLaReserva(datos).length).toBeGreaterThan(0);
  });

  it("si un aviso de cambio se pierde, el aviso al personal es de prioridad ALTA (el cliente no sabe el cambio)", () => {
    expect(prioridadEmailFallido("reserva_modificada", "error_servidor_500")).toBe("alta");
  });

  it("el aviso al personal lo nombra en castellano", () => {
    const aviso = construirAvisoLote([
      {
        reservaId: "r1",
        nombre: "Ana",
        telefono: "+34612345678",
        email: "ana@ejemplo.com",
        fecha: "2026-10-10",
        hora: "21:00",
        tipoEmail: "reserva_modificada",
        motivo: "error_servidor_500",
      },
    ]);
    expect(aviso?.titulo).toMatch(/aviso de cambio de reserva/);
  });
});
