/**
 * whatsapp-reservas/resenas.ts: cuándo se pide la reseña (hora + 3 h), a quién,
 * la plantilla de Meta y el mensaje que sale.
 */
import { describe, expect, it } from "vitest";
import casos from "./casos-momento-resena.json";
import { cuerpoCrearPlantilla, leerDatosOpacos, datosOpacos, leerWebhook, mensajePlantilla, rellenarCuerpo } from "../logica";
import {
  PLACE_ID_CASA_TOMAS,
  decidirResena,
  destinatariosResena,
  diasAMirar,
  enlaceResena,
  errorPlantillaNoDisponible,
  momentoResena,
  momentoResenaLocal,
  placeIdValido,
  plantillaResena,
  variablesResena,
  type ReservaParaResena,
} from "../resenas";

const RESERVA: ReservaParaResena = {
  id: "0b7c6c1e-3a52-4f43-9d55-1f0d7c2a9e11",
  estado: "confirmada",
  nombre: "Ana López García",
  telefono: "612 345 678",
  fecha: "2026-11-25",
  hora: "14:00:00",
  numero_comensales: 4,
  marca: "casa_tomas",
  canal_avisos: "whatsapp",
};
const A_LAS = (iso: string) => new Date(iso);

describe("momentoResena (mismos casos que la función SQL)", () => {
  for (const c of casos.casos) {
    it(`${c.fecha} ${c.hora}: ${c.por}`, () => {
      expect(momentoResena(c.fecha, c.hora).toISOString()).toBe(c.utc);
    });
  }

  it("da también la fecha y hora de Madrid", () => {
    expect(momentoResenaLocal("2026-11-25", "14:00")).toEqual({ fecha: "2026-11-25", hora: "17:00" });
    expect(momentoResenaLocal("2026-11-25", "21:30")).toEqual({ fecha: "2026-11-26", hora: "12:00" });
  });
});

describe("decidirResena", () => {
  it("antes de las 17:00 espera; a las 17:00 la manda al móvil con prefijo", () => {
    expect(decidirResena(RESERVA, A_LAS("2026-11-25T15:59:00Z")).accion).toBe("esperar");
    expect(decidirResena(RESERVA, A_LAS("2026-11-25T16:00:00Z"))).toMatchObject({ accion: "enviar", para: "34612345678" });
  });

  it("si no salió a su hora, vale hasta 12 h después; luego se da por perdida", () => {
    expect(decidirResena(RESERVA, A_LAS("2026-11-26T04:00:00Z")).accion).toBe("enviar");
    expect(decidirResena(RESERVA, A_LAS("2026-11-26T04:01:00Z"))).toMatchObject({ accion: "omitir", motivo: "fuera_de_plazo" });
  });

  it("solo confirmadas o completadas (llegó): ni canceladas, ni no presentadas, ni sin confirmar", () => {
    const ahora = A_LAS("2026-11-25T17:00:00Z");
    expect(decidirResena({ ...RESERVA, estado: "completada" }, ahora).accion).toBe("enviar");
    for (const estado of ["cancelada", "no_show", "pendiente", "verificada"]) {
      expect(decidirResena({ ...RESERVA, estado }, ahora)).toMatchObject({ accion: "omitir", motivo: `estado_${estado}` });
    }
  });

  it("por defecto solo a quien eligió WhatsApp; con 'todos', a cualquiera con móvil", () => {
    const ahora = A_LAS("2026-11-25T17:00:00Z");
    const porEmail = { ...RESERVA, canal_avisos: "email" };
    expect(decidirResena(porEmail, ahora)).toMatchObject({ accion: "omitir", motivo: "no_eligio_whatsapp" });
    expect(decidirResena(porEmail, ahora, { destinatarios: "todos" }).accion).toBe("enviar");
  });

  it("sin móvil válido o de Touza, no", () => {
    const ahora = A_LAS("2026-11-25T17:00:00Z");
    expect(decidirResena({ ...RESERVA, telefono: "" }, ahora)).toMatchObject({ accion: "omitir", motivo: "telefono_no_valido" });
    expect(decidirResena({ ...RESERVA, telefono: "123" }, ahora)).toMatchObject({ accion: "omitir", motivo: "telefono_no_valido" });
    expect(decidirResena({ ...RESERVA, marca: "touza" }, ahora)).toMatchObject({ accion: "omitir", motivo: "marca_sin_plantillas_whatsapp" });
  });

  it("la cena de las 21:30 se pide al día siguiente a las 12:00, no de madrugada", () => {
    const cena = { ...RESERVA, hora: "21:30" };
    expect(decidirResena(cena, A_LAS("2026-11-26T00:30:00Z")).accion).toBe("esperar");
    expect(decidirResena(cena, A_LAS("2026-11-26T11:00:00Z")).accion).toBe("enviar");
  });
});

describe("errorPlantillaNoDisponible", () => {
  it("plantilla sin aprobar, pausada o desactivada: se reintenta; el resto, no", () => {
    expect(errorPlantillaNoDisponible("132001: Template name does not exist in the translation")).toBe(true);
    expect(errorPlantillaNoDisponible("132015: Template is paused")).toBe(true);
    expect(errorPlantillaNoDisponible("132016/2494: Template is disabled")).toBe(true);
    expect(errorPlantillaNoDisponible("131026: Message undeliverable")).toBe(false);
    expect(errorPlantillaNoDisponible("1320011: otro")).toBe(false);
    expect(errorPlantillaNoDisponible("timeout")).toBe(false);
    expect(errorPlantillaNoDisponible(null)).toBe(false);
  });
});

describe("destinatarios y días", () => {
  it("WHATSAPP_RESENAS_DESTINATARIOS: 'todos' o, si no, solo WhatsApp", () => {
    expect(destinatariosResena("todos")).toBe("todos");
    expect(destinatariosResena(" TODOS ")).toBe("todos");
    expect(destinatariosResena("")).toBe("whatsapp");
    expect(destinatariosResena(undefined)).toBe("whatsapp");
    expect(destinatariosResena("cualquiera")).toBe("whatsapp");
  });

  it("mira desde anteayer hasta hoy", () => {
    expect(diasAMirar("2026-12-01")).toEqual({ desde: "2026-11-29", hasta: "2026-12-01" });
  });
});

describe("plantilla y mensaje", () => {
  it("se registra como UTILITY, con texto antes y después de las variables y el botón a la ficha de Google", () => {
    const cuerpo = cuerpoCrearPlantilla(plantillaResena());
    expect(cuerpo).toMatchObject({ name: "resena_tras_visita", language: "es_ES", category: "UTILITY" });
    const comps = cuerpo.components as Record<string, unknown>[];
    expect(comps[0]).toMatchObject({ type: "BODY", example: { body_text: [["Ana", "Casa Tomás", "martes 24 de noviembre"]] } });
    expect(comps[1]).toEqual({
      type: "BUTTONS",
      buttons: [{
        type: "URL",
        text: "Dejar mi opinión",
        url: "https://search.google.com/local/writereview?placeid={{1}}",
        example: [`https://search.google.com/local/writereview?placeid=${PLACE_ID_CASA_TOMAS}`],
      }],
    });
    const texto = plantillaResena().cuerpo;
    expect(texto.startsWith("{{")).toBe(false);
    expect(texto.trim().endsWith("}}")).toBe(false);
  });

  it("variables: nombre de pila, negocio y fecha de la visita", () => {
    expect(variablesResena(RESERVA)).toEqual(["Ana", "Casa Tomás", "miércoles 25 de noviembre"]);
    expect(variablesResena({ ...RESERVA, nombre: null })).toEqual(["👋", "Casa Tomás", "miércoles 25 de noviembre"]);
    expect(rellenarCuerpo(plantillaResena(), variablesResena(RESERVA))).toContain("gracias por venir a Casa Tomás el miércoles 25 de noviembre");
  });

  it("el mensaje lleva el place_id en el botón y el dato opaco de la reserva", () => {
    const m = mensajePlantilla({
      para: "34612345678",
      def: plantillaResena(),
      variables: variablesResena(RESERVA),
      botones: { placeId: "ChIJotroPlaceId123" },
      datosOpacos: datosOpacos(RESERVA.id, "resena"),
    });
    expect(m).toMatchObject({ to: "34612345678", type: "template", template: { name: "resena_tras_visita" } });
    const comps = (m.template as { components: unknown[] }).components;
    expect(comps[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "ChIJotroPlaceId123" }] });
    // Si no llega, el panel no avisa «llámale» (solo los avisos de reserva).
    expect(leerDatosOpacos(m.biz_opaque_callback_data as string)).toBeNull();
  });

  it("sin place_id no se manda", () => {
    expect(() => mensajePlantilla({ para: "34612345678", def: plantillaResena(), variables: variablesResena(RESERVA) })).toThrow("falta_url_resena");
  });

  it("place_id y enlace", () => {
    expect(placeIdValido(PLACE_ID_CASA_TOMAS)).toBe(true);
    expect(placeIdValido("x")).toBe(false);
    expect(placeIdValido("ChIJ<script>")).toBe(false);
    expect(placeIdValido(null)).toBe(false);
    expect(enlaceResena(PLACE_ID_CASA_TOMAS)).toBe(`https://search.google.com/local/writereview?placeid=${PLACE_ID_CASA_TOMAS}`);
  });
});

describe("webhook: precio de cada mensaje", () => {
  it("lee pricing.billable/category/type del estado", () => {
    const { estados } = leerWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [
        { id: "wamid.A", status: "delivered", recipient_id: "34612345678", pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "utility" } },
        { id: "wamid.B", status: "sent", recipient_id: "34612345678", pricing: { billable: false, pricing_model: "PMP", type: "free_customer_service", category: "service", subtype: "free_tier" } },
        { id: "wamid.C", status: "read", recipient_id: "34612345678" },
      ] } }] }],
    });
    expect(estados.map((e) => e.precio)).toEqual([
      { facturable: true, categoria: "utility", tipo: "regular" },
      { facturable: false, categoria: "service", tipo: "free_customer_service" },
      null,
    ]);
  });
});
