/**
 * whatsapp-reservas/logica.ts: plantillas, teléfono, botones firmados,
 * lectura del webhook de Meta, su firma y las respuestas del chat.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  plantillas,
  cuerpoCrearPlantilla,
  tipoAvisoParaEstado,
  telefonoParaWhatsApp,
  fechaParaMensaje,
  limpiarVariable,
  variablesParaTipo,
  mensajePlantilla,
  mensajeSinPlantilla,
  rellenarCuerpo,
  consultaMapa,
  firmarPayloadBoton,
  leerPayloadBoton,
  firmaMetaValida,
  compararTiempoConstante,
  leerWebhook,
  datosOpacos,
  leerDatosOpacos,
  textoRespuestaBoton,
  plantillaAnterior,
  nombresPlantillas,
  TEXTO_CORTESIA,
  type ReservaParaWhatsApp,
} from "../logica";

const WEB = "https://web-casatomas-git-staging-casa-tomas.vercel.app";
const P = plantillas(`${WEB}/`);
const RESERVA: ReservaParaWhatsApp = {
  id: "0b7c6c1e-3a52-4f43-9d55-1f0d7c2a9e11",
  estado: "verificada",
  nombre: "Ana López",
  telefono: "612 345 678",
  fecha: "2026-12-12",
  hora: "21:30:00",
  numero_comensales: 4,
  marca: "casa_tomas",
};

describe("plantillas", () => {
  it("el aviso de cada estado: también la reserva recibida (aunque el correo de la web esté silenciado)", () => {
    expect(tipoAvisoParaEstado("pendiente")).toBe("solicitud_recibida");
    expect(tipoAvisoParaEstado("verificada")).toBe("propuesta");
    expect(tipoAvisoParaEstado("confirmada")).toBe("confirmada");
    expect(tipoAvisoParaEstado("cancelada")).toBe("rechazada");
    expect(tipoAvisoParaEstado("completada")).toBeNull();
    expect(tipoAvisoParaEstado("no_show")).toBeNull();
  });

  it("los botones que pidió el dueño: recibida -> gestionar + carta; verificada -> confirmar, cancelar y cómo llegar", () => {
    expect(P.solicitud_recibida.botones.map((b) => b.texto)).toEqual(["Gestionar mi reserva", "Ver la carta"]);
    expect(P.propuesta.botones.map((b) => b.texto)).toEqual(["Sí, confirmo", "No puedo, cancelar", "Cómo llegar"]);
    expect(P.confirmada.botones.map((b) => b.texto)).toEqual(["Cómo llegar"]);
    expect(P.rechazada.botones).toEqual([]);
  });

  it("cumplen las reglas de Meta: sin variable al principio ni al final, ejemplos para todas, textos de botón ≤ 25", () => {
    for (const def of Object.values(P)) {
      expect(def.nombre).toMatch(/^[a-z_]+$/);
      expect(def.cuerpo.trim()).not.toMatch(/^\{\{/);
      expect(def.cuerpo.trim()).not.toMatch(/\}\}$/);
      const variables = def.cuerpo.match(/\{\{\d+\}\}/g) ?? [];
      expect(new Set(variables).size).toBe(def.ejemplo.length);
      for (const b of def.botones) expect(b.texto.length).toBeLessThanOrEqual(25);
      // Las respuestas rápidas van juntas y primero.
      const tipos = def.botones.map((b) => b.tipo).join(",");
      expect(tipos).not.toMatch(/url,respuesta/);
    }
  });

  it("registro en Meta: utilidad, español de España, ejemplo de URL completa cuando lleva variable", () => {
    const cuerpo = cuerpoCrearPlantilla(P.solicitud_recibida) as { category: string; language: string; components: Record<string, unknown>[] };
    expect(cuerpo).toMatchObject({ name: "reserva_recibida", category: "UTILITY", language: "es_ES" });
    const botones = (cuerpo.components[1] as { buttons: Record<string, unknown>[] }).buttons;
    expect(botones[0]).toEqual({
      type: "URL",
      text: "Gestionar mi reserva",
      url: `${WEB}/reserva/respuesta?token={{1}}`,
      example: [`${WEB}/reserva/respuesta?token=eyJpZCI6ImVqZW1wbG8ifQ.ZmlybWE`],
    });
    expect(botones[1]).toEqual({ type: "URL", text: "Ver la carta", url: `${WEB}/carta` });
    const propuesta = cuerpoCrearPlantilla(P.propuesta) as { components: { buttons?: { type: string }[] }[] };
    expect(propuesta.components[1].buttons?.map((b) => b.type)).toEqual(["QUICK_REPLY", "QUICK_REPLY", "URL"]);
  });
});

describe("20 minutos de cortesía al verificar (plantilla que sustituye a otra)", () => {
  it("el aviso al verificar lleva la cortesía y la regla de liberar la mesa", () => {
    expect(P.propuesta.cuerpo).toContain(TEXTO_CORTESIA);
    expect(TEXTO_CORTESIA).toMatch(/20 minutos de cortesía/);
    expect(TEXTO_CORTESIA).toMatch(/mesa quedará liberada/);
    expect(rellenarCuerpo(P.propuesta, variablesParaTipo("propuesta", RESERVA))).toContain("20 minutos de cortesía");
  });

  it("mientras Meta no la aprueba se manda la anterior: mismo contenido salvo el nombre", () => {
    const anterior = plantillaAnterior(P.propuesta);
    expect(anterior).not.toBeNull();
    expect(anterior!.nombre).toBe("reserva_confirmar_asistencia");
    expect(anterior!.botones).toEqual(P.propuesta.botones);
    expect("anterior" in anterior!).toBe(false);
    const m = mensajePlantilla({
      para: "34612345678",
      def: anterior!,
      variables: variablesParaTipo("propuesta", RESERVA),
      botones: { payloads: { aceptar: "PA", rechazar: "PR" }, mapa: consultaMapa("casa_tomas") },
    }) as { template: { name: string; components: unknown[] } };
    expect(m.template.name).toBe("reserva_confirmar_asistencia");
    expect(m.template.components).toHaveLength(4);
  });

  it("las demás no sustituyen a ninguna; /plantillas lista también la anterior", () => {
    expect(plantillaAnterior(P.confirmada)).toBeNull();
    const nombres = nombresPlantillas(Object.values(P));
    expect(nombres).toContain("reserva_confirmar_asistencia_cortesia");
    expect(nombres).toContain("reserva_confirmar_asistencia");
    expect(nombres).toContain("reserva_confirmada");
  });

  it("el nombre nuevo cumple las reglas de Meta", () => {
    expect(cuerpoCrearPlantilla(P.propuesta)).toMatchObject({ name: "reserva_confirmar_asistencia_cortesia", category: "UTILITY" });
  });
});

describe("datos de la reserva", () => {
  it("teléfono: añade +34 a un número español y descarta lo que no es un móvil", () => {
    expect(telefonoParaWhatsApp("612 345 678")).toBe("34612345678");
    expect(telefonoParaWhatsApp("+34 612-345-678")).toBe("34612345678");
    expect(telefonoParaWhatsApp("0034612345678")).toBe("34612345678");
    expect(telefonoParaWhatsApp("+44 7700 900123")).toBe("447700900123");
    expect(telefonoParaWhatsApp("512345678")).toBeNull();
    expect(telefonoParaWhatsApp("1234")).toBeNull();
    expect(telefonoParaWhatsApp(null)).toBeNull();
  });

  it("fecha legible con día de la semana y variables sin saltos de línea ni vacías", () => {
    expect(fechaParaMensaje("2026-12-12")).toBe("sábado 12 de diciembre");
    expect(fechaParaMensaje("2027-01-01")).toBe("viernes 1 de enero");
    expect(limpiarVariable("  Ana\n\nLópez   García ", "x")).toBe("Ana López García");
    expect(limpiarVariable("   ", "👋")).toBe("👋");
  });

  it("variables de cada plantilla, en orden", () => {
    expect(variablesParaTipo("propuesta", RESERVA)).toEqual(["Ana López", "Casa Tomás", "sábado 12 de diciembre", "21:30", "4"]);
    expect(variablesParaTipo("confirmada", RESERVA)).toEqual(["Ana López", "Casa Tomás", "sábado 12 de diciembre", "21:30", "4", "966 10 78 87"]);
    expect(variablesParaTipo("rechazada", { ...RESERVA, nombre: null })).toEqual(["👋", "Casa Tomás", "sábado 12 de diciembre", "21:30", "966 10 78 87"]);
  });

  it("mensaje de la propuesta: payload en cada respuesta rápida y el final del mapa en «Cómo llegar»", () => {
    const m = mensajePlantilla({
      para: "34612345678",
      def: P.propuesta,
      variables: variablesParaTipo("propuesta", RESERVA),
      botones: { payloads: { aceptar: "PA", rechazar: "PR" }, mapa: consultaMapa("casa_tomas") },
      datosOpacos: datosOpacos(RESERVA.id, "propuesta"),
    }) as { template: { name: string; components: Record<string, unknown>[] }; biz_opaque_callback_data: string };
    expect(m.template.name).toBe("reserva_confirmar_asistencia_cortesia");
    expect(m.template.components.slice(1)).toEqual([
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "PA" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "PR" }] },
      { type: "button", sub_type: "url", index: "2", parameters: [{ type: "text", text: consultaMapa("casa_tomas") }] },
    ]);
    expect(leerDatosOpacos(m.biz_opaque_callback_data)).toEqual({ reservaId: RESERVA.id, tipo: "propuesta" });
  });

  it("mensaje de reserva recibida: token en «Gestionar mi reserva»; «Ver la carta» no lleva nada", () => {
    const m = mensajePlantilla({
      para: "34612345678",
      def: P.solicitud_recibida,
      variables: variablesParaTipo("solicitud_recibida", RESERVA),
      botones: { tokenGestion: "TOKEN" },
    }) as { template: { components: Record<string, unknown>[] } };
    expect(m.template.components.slice(1)).toEqual([
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "TOKEN" }] },
    ]);
  });

  it("sin los valores de un botón no se manda (Meta lo rechazaría)", () => {
    expect(() => mensajePlantilla({ para: "34612345678", def: P.propuesta, variables: [], botones: {} })).toThrow(/falta_payload/);
    expect(() => mensajePlantilla({ para: "34612345678", def: P.confirmada, variables: [], botones: {} })).toThrow(/falta_url/);
  });

  it("«Cómo llegar» busca el restaurante de la reserva", () => {
    expect(decodeURIComponent(consultaMapa("casa_tomas"))).toBe("Casa Tomás, C/ Santa María de la Cabeza, 2, Crevillente");
    expect(decodeURIComponent(consultaMapa("touza"))).toContain("Touza");
  });
});

describe("aviso SIN plantilla (ventana de 24 h, mientras Meta revisa las plantillas)", () => {
  it("rellena el texto de la plantilla con sus variables", () => {
    const texto = rellenarCuerpo(P.rechazada, variablesParaTipo("rechazada", RESERVA));
    expect(texto).toContain("Hola Ana López, lamentamos decirte");
    expect(texto).toContain("en Casa Tomás para el sábado 12 de diciembre a las 21:30 h");
    expect(texto).toContain("llámanos al 966 10 78 87");
    expect(texto).not.toMatch(/\{\{/);
  });

  it("confirma tu asistencia: botones de respuesta con el MISMO payload firmado y «Cómo llegar» como enlace en el texto", () => {
    const m = mensajeSinPlantilla({
      para: "34612345678",
      def: P.propuesta,
      variables: variablesParaTipo("propuesta", RESERVA),
      botones: { payloads: { aceptar: "PA", rechazar: "PR" }, mapa: consultaMapa("casa_tomas") },
      datosOpacos: datosOpacos(RESERVA.id, "propuesta"),
    }) as { type: string; interactive: { type: string; body: { text: string }; action: { buttons: unknown[] } }; biz_opaque_callback_data: string };
    expect(m.type).toBe("interactive");
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "PA", title: "Sí, confirmo" } },
      { type: "reply", reply: { id: "PR", title: "No puedo, cancelar" } },
    ]);
    expect(m.interactive.body.text).toContain("¿Confirmas tu asistencia?");
    expect(m.interactive.body.text).toContain(`Cómo llegar: https://www.google.com/maps/search/?api=1&query=${consultaMapa("casa_tomas")}`);
    expect(leerDatosOpacos(m.biz_opaque_callback_data)).toEqual({ reservaId: RESERVA.id, tipo: "propuesta" });
  });

  it("reserva recibida: texto con «Gestionar mi reserva» (token en la URL) y «Ver la carta»", () => {
    const m = mensajeSinPlantilla({
      para: "34612345678",
      def: P.solicitud_recibida,
      variables: variablesParaTipo("solicitud_recibida", RESERVA),
      botones: { tokenGestion: "abc.d+f" },
    }) as { type: string; text: { body: string } };
    expect(m.type).toBe("text");
    expect(m.text.body).toContain(`Gestionar mi reserva: ${WEB}/reserva/respuesta?token=abc.d%2Bf`);
    expect(m.text.body).toContain(`Ver la carta: ${WEB}/carta`);
  });

  it("los títulos de los botones caben en los 20 caracteres de Meta", () => {
    for (const def of Object.values(P)) {
      for (const b of def.botones) if (b.tipo === "respuesta") expect(b.texto.length, b.texto).toBeLessThanOrEqual(20);
    }
  });
});

describe("botones firmados", () => {
  const SECRETO = "secreto-tokens";
  const AHORA = 1_790_000_000;

  it("ida y vuelta, y caben de sobra en el payload (< 128 caracteres)", async () => {
    const p = await firmarPayloadBoton(SECRETO, RESERVA.id, "aceptar", "21:30:00", AHORA);
    expect(p.length).toBeLessThan(128);
    expect(await leerPayloadBoton(SECRETO, p, AHORA)).toEqual({ reservaId: RESERVA.id, accion: "aceptar", hora: "21:30" });
    const r = await firmarPayloadBoton(SECRETO, RESERVA.id, "rechazar", "13:00", AHORA);
    expect((await leerPayloadBoton(SECRETO, r, AHORA))?.accion).toBe("rechazar");
  });

  it("no valen con otro secreto, retocados, caducados o de otro formato", async () => {
    const p = await firmarPayloadBoton(SECRETO, RESERVA.id, "aceptar", "21:30", AHORA);
    expect(await leerPayloadBoton("otro", p, AHORA)).toBeNull();
    expect(await leerPayloadBoton(SECRETO, p.replace(".a.", ".r."), AHORA)).toBeNull();
    expect(await leerPayloadBoton(SECRETO, p.replace(".2130.", ".2200."), AHORA)).toBeNull();
    expect(await leerPayloadBoton(SECRETO, p, AHORA + 15 * 86400)).toBeNull();
    expect(await leerPayloadBoton(SECRETO, "hola", AHORA)).toBeNull();
    expect(await leerPayloadBoton("", p, AHORA)).toBeNull();
  });
});

describe("webhook de Meta", () => {
  it("firma X-Hub-Signature-256 con la clave secreta de la app", async () => {
    const cuerpo = new TextEncoder().encode('{"object":"whatsapp_business_account"}');
    const firma = `sha256=${createHmac("sha256", "clave-app").update(cuerpo).digest("hex")}`;
    expect(await firmaMetaValida(cuerpo, firma, "clave-app")).toBe(true);
    expect(await firmaMetaValida(cuerpo, firma, "otra")).toBe(false);
    expect(await firmaMetaValida(cuerpo, null, "clave-app")).toBe(false);
    expect(await firmaMetaValida(cuerpo, firma, "")).toBe(false);
    expect(await firmaMetaValida(new TextEncoder().encode("{}"), firma, "clave-app")).toBe(false);
  });

  it("comparación en tiempo constante", () => {
    expect(compararTiempoConstante("abc", "abc")).toBe(true);
    expect(compararTiempoConstante("abc", "abd")).toBe(false);
    expect(compararTiempoConstante("abc", "abcd")).toBe(false);
    expect(compararTiempoConstante("", "")).toBe(true);
  });

  it("separa pulsaciones de botones, mensajes escritos y estados de entrega", () => {
    const aviso = {
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            messages: [
              { from: "34612345678", id: "wamid.1", type: "button", button: { payload: "r1.x", text: "Sí, confirmo" } },
              { from: "34612345678", id: "wamid.2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "r1.y", title: "Vale" } } },
              { from: "34612345678", id: "wamid.3", type: "text", text: { body: "hola" } },
            ],
            statuses: [{
              id: "wamid.9", status: "failed", recipient_id: "34612345678", biz_opaque_callback_data: '{"r":"abc","t":"confirmada"}',
              errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "no WhatsApp" } }],
            }],
          },
        }],
      }],
    };
    const { pulsaciones, libres, estados } = leerWebhook(aviso);
    expect(pulsaciones).toEqual([
      { de: "34612345678", mensajeId: "wamid.1", payload: "r1.x", texto: "Sí, confirmo" },
      { de: "34612345678", mensajeId: "wamid.2", payload: "r1.y", texto: "Vale" },
    ]);
    expect(libres).toEqual([{ de: "34612345678", mensajeId: "wamid.3", tipo: "text" }]);
    expect(estados[0]).toMatchObject({ estado: "failed", errores: [{ codigo: 131026, titulo: "Message undeliverable", detalle: "no WhatsApp" }] });
    expect(leerDatosOpacos(estados[0].datosOpacos)).toEqual({ reservaId: "abc", tipo: "confirmada" });
  });

  it("ignora lo que no es de WhatsApp o viene mal formado", () => {
    expect(leerWebhook({ object: "page", entry: [] })).toEqual({ pulsaciones: [], estados: [], libres: [] });
    expect(leerWebhook(null)).toEqual({ pulsaciones: [], estados: [], libres: [] });
    expect(leerWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ type: "button" }] } }] }] }).pulsaciones).toEqual([]);
    expect(leerDatosOpacos("no-json")).toBeNull();
  });
});

describe("respuesta en el chat", () => {
  const negocio = { nombre: "Casa Tomás", telefonoTexto: "966 10 78 87" };
  const detalles = { nombre: "Ana López", fecha: "2026-12-12", hora: "21:30", comensales: 4 };

  it("confirmada o cancelada al pulsar", () => {
    expect(textoRespuestaBoton({ estado: "hecho", negocio, detalles }, "aceptar")).toBe(
      "¡Perfecto, Ana! Tu reserva en Casa Tomás queda confirmada el sábado 12 de diciembre a las 21:30 h, 4 personas. ¡Te esperamos!",
    );
    expect(textoRespuestaBoton({ estado: "hecho", negocio, detalles }, "rechazar")).toContain("hemos cancelado tu reserva del sábado 12 de diciembre");
  });

  it("los casos raros siempre dan el teléfono", () => {
    for (const estado of ["invalido", "sin_aforo", "fecha_pasada", "error"]) {
      expect(textoRespuestaBoton({ estado, negocio, detalles }, "aceptar")).toContain("966 10 78 87");
    }
    expect(textoRespuestaBoton(null, null)).toBe("No hemos podido registrar tu respuesta. Por favor, llámanos al 966 10 78 87.");
    expect(textoRespuestaBoton({ estado: "ya_hecho", negocio, detalles }, "aceptar")).toContain("ya estaba confirmada");
  });
});
