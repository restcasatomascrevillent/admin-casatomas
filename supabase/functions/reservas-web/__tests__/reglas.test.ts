/**
 * Tests para supabase/functions/reservas-web/reglas.ts
 *
 * reservas-sin-salas (decisión del dueño, 2026-09-29): en Casa Tomás el
 * cliente reserva una HORA; la sala es una decisión interna. Por eso:
 *  - La web ignora la sala o el espacio_id que mande un cliente de Casa Tomás.
 *  - La regla "una sola sala tiene que caber el grupo entero" solo se aplica
 *    en Touza, donde el espacio (El Reservado) es lo que se reserva.
 *  - El aforo del turno (suma de las salas del negocio) sigue mandando en los
 *    dos negocios, igual que el trigger validar_capacidad_reserva.
 *
 * Touza NO admite reservas (decisión del dueño, 2026-10-01): ver
 * `rechazoTouzaSinReservas` abajo y touza-sin-reservas.integracion.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  rechazarPorSala,
  salaDelCliente,
  contarEspaciosQueCaben,
  rechazoTouzaSinReservas,
  MOTIVO_TOUZA_SIN_RESERVAS,
  leerConsentimientos,
  condicionesObligatorias,
  rechazoCondicionesNoAceptadas,
  esColumnaInexistente,
  camposConsentimientoSolicitud,
  faltaColumnaConsentimientoSolicitud,
  ERROR_CONDICIONES_NO_ACEPTADAS,
  interpretarSondeoDobleOptin,
  consentimientoNewsletterParaGuardar,
} from "../reglas.ts";
import { NEGOCIOS } from "../plantillas.ts";

describe("rechazoTouzaSinReservas", () => {
  it("Touza: 409 con motivo y un mensaje claro con el teléfono de Touza", () => {
    expect(rechazoTouzaSinReservas("touza")).toEqual({
      status: 409,
      cuerpo: {
        ok: false,
        motivo: "touza_sin_reservas",
        mensaje: "Touza no admite reservas por la web. Para cualquier consulta, llámanos al 966 782 000.",
      },
    });
    expect(MOTIVO_TOUZA_SIN_RESERVAS).toBe("touza_sin_reservas");
  });

  it("el teléfono sale de NEGOCIOS.touza (una sola fuente), nunca el de Casa Tomás", () => {
    const mensaje = rechazoTouzaSinReservas("touza")?.cuerpo.mensaje ?? "";
    expect(mensaje).toContain(NEGOCIOS.touza.telefonoTexto);
    expect(mensaje).not.toContain(NEGOCIOS.casa_tomas.telefonoTexto);
  });

  it("ni 2xx ni «grupo_grande»: son los dos casos que la web de Touza pinta como «Solicitud recibida»", () => {
    const rechazo = rechazoTouzaSinReservas("touza");
    expect(rechazo?.status).toBeGreaterThanOrEqual(400);
    expect(rechazo?.cuerpo.motivo).not.toBe("grupo_grande");
  });

  it("Casa Tomás: null, sigue el circuito de siempre", () => {
    expect(rechazoTouzaSinReservas("casa_tomas")).toBeNull();
  });
});

// Casa Tomás real: 170 plazas, ninguna sala de más de 50.
const SALAS_CT = [
  { disponible: 50 },
  { disponible: 50 },
  { disponible: 40 },
  { disponible: 30 },
];
// Touza: El Reservado, 20 plazas.
const SALAS_TOUZA = [{ disponible: 20 }];

describe("rechazarPorSala", () => {
  it("Casa Tomás: un grupo de 60 cabe en el turno aunque no quepa en ninguna sala", () => {
    const libres = contarEspaciosQueCaben(SALAS_CT, 60);
    expect(libres).toBe(0);
    expect(rechazarPorSala("casa_tomas", 60 <= 170, libres)).toBe(false);
  });

  it("Touza: un grupo de 25 no cabe en El Reservado y se rechaza", () => {
    const libres = contarEspaciosQueCaben(SALAS_TOUZA, 25);
    expect(libres).toBe(0);
    expect(rechazarPorSala("touza", 25 <= 80, libres)).toBe(true);
  });

  it("Touza: un grupo que cabe en El Reservado pasa", () => {
    expect(rechazarPorSala("touza", true, contarEspaciosQueCaben(SALAS_TOUZA, 12))).toBe(false);
  });

  it("sin aforo en el turno se rechaza en los dos negocios", () => {
    expect(rechazarPorSala("casa_tomas", false, 3)).toBe(true);
    expect(rechazarPorSala("touza", false, 1)).toBe(true);
  });
});

describe("salaDelCliente", () => {
  it("Casa Tomás: se ignoran sala y espacio_id del cliente", () => {
    expect(salaDelCliente("casa_tomas", { espacioId: "esp-1", salaNombre: "Terraza" })).toEqual({
      espacioId: null,
      salaNombre: null,
    });
  });

  it("Touza: se respetan tal cual (el espacio es el producto)", () => {
    expect(salaDelCliente("touza", { espacioId: "reservado", salaNombre: null })).toEqual({
      espacioId: "reservado",
      salaNombre: null,
    });
    expect(salaDelCliente("touza", { espacioId: null, salaNombre: "El Reservado" })).toEqual({
      espacioId: null,
      salaNombre: "El Reservado",
    });
  });
});

describe("contarEspaciosQueCaben", () => {
  it("cuenta las salas con hueco para todo el grupo", () => {
    expect(contarEspaciosQueCaben(SALAS_CT, 40)).toBe(3);
    expect(contarEspaciosQueCaben([], 2)).toBe(0);
  });
});

// Casillas RGPD del formulario web (2026-10-03). Solo el booleano `true` es un sí.
describe("leerConsentimientos", () => {
  it("las dos casillas a true", () => {
    expect(leerConsentimientos({ acepta_condiciones: true, consentimiento_newsletter: true })).toEqual({
      aceptaCondiciones: true,
      consentimientoNewsletter: true,
    });
  });

  it("ausentes, null o cuerpo vacío: false", () => {
    expect(leerConsentimientos({})).toEqual({ aceptaCondiciones: false, consentimientoNewsletter: false });
    expect(leerConsentimientos(null)).toEqual({ aceptaCondiciones: false, consentimientoNewsletter: false });
    expect(leerConsentimientos({ acepta_condiciones: null, consentimiento_newsletter: undefined })).toEqual({
      aceptaCondiciones: false,
      consentimientoNewsletter: false,
    });
  });

  it.each([["true"], [1], ["on"], ["sí"], [{}], [[true]]])("valor ambiguo %j: NO cuenta como consentimiento", (valor) => {
    expect(leerConsentimientos({ acepta_condiciones: valor, consentimiento_newsletter: valor })).toEqual({
      aceptaCondiciones: false,
      consentimientoNewsletter: false,
    });
  });

  it("son independientes: aceptar las condiciones no suscribe al newsletter", () => {
    expect(leerConsentimientos({ acepta_condiciones: true })).toEqual({ aceptaCondiciones: true, consentimientoNewsletter: false });
  });
});

describe("condicionesObligatorias (secret RESERVAS_WEB_CONDICIONES_OBLIGATORIAS)", () => {
  it("sin secret: se exige", () => {
    expect(condicionesObligatorias(undefined)).toBe(true);
    expect(condicionesObligatorias(null)).toBe(true);
    expect(condicionesObligatorias("")).toBe(true);
  });

  it('solo "false" (sin distinguir mayúsculas ni espacios) la desactiva', () => {
    expect(condicionesObligatorias("false")).toBe(false);
    expect(condicionesObligatorias(" FALSE ")).toBe(false);
  });

  it.each([["true"], ["0"], ["no"], ["fasle"], ["off"]])("%j no la desactiva (un secret mal escrito nunca apaga la exigencia)", (v) => {
    expect(condicionesObligatorias(v)).toBe(true);
  });
});

describe("rechazoCondicionesNoAceptadas", () => {
  const sinCondiciones = { aceptaCondiciones: false, consentimientoNewsletter: false };
  const conCondiciones = { aceptaCondiciones: true, consentimientoNewsletter: false };

  it("exigida y sin marcar: 400 con error y mensaje claros", () => {
    expect(rechazoCondicionesNoAceptadas(sinCondiciones, true)).toEqual({
      status: 400,
      cuerpo: {
        ok: false,
        error: ERROR_CONDICIONES_NO_ACEPTADAS,
        mensaje: "Para enviar la reserva tienes que aceptar la política de privacidad y las condiciones de la reserva.",
      },
    });
  });

  it("exigida y marcada: null", () => {
    expect(rechazoCondicionesNoAceptadas(conCondiciones, true)).toBeNull();
  });

  it("interruptor apagado: null aunque no venga marcada", () => {
    expect(rechazoCondicionesNoAceptadas(sinCondiciones, false)).toBeNull();
  });
});

describe("esColumnaInexistente", () => {
  const errorPostgrest = {
    code: "PGRST204",
    message: "Could not find the 'condiciones_aceptadas_at' column of 'reservas' in the schema cache",
  };

  it("el error real de PostgREST para esa columna: true", () => {
    expect(esColumnaInexistente(errorPostgrest, "condiciones_aceptadas_at")).toBe(true);
  });

  it("otra columna, otro error o sin error: false", () => {
    expect(esColumnaInexistente(errorPostgrest, "consentimiento_newsletter")).toBe(false);
    expect(esColumnaInexistente({ code: "23514", message: "Aforo superado" }, "condiciones_aceptadas_at")).toBe(false);
    expect(esColumnaInexistente(null, "condiciones_aceptadas_at")).toBe(false);
  });
});

describe("camposConsentimientoSolicitud (doble opt-in, migración 20261003184500)", () => {
  const AHORA = "2026-10-03T18:45:00.000Z";

  it("las dos casillas: newsletter true y la hora de aceptación de las condiciones", () => {
    expect(camposConsentimientoSolicitud({ aceptaCondiciones: true, consentimientoNewsletter: true }, AHORA)).toEqual({
      consentimiento_newsletter: true,
      condiciones_aceptadas_at: AHORA,
    });
  });

  it("sin casillas (o sin datos): false y null", () => {
    expect(camposConsentimientoSolicitud({ aceptaCondiciones: false, consentimientoNewsletter: false }, AHORA)).toEqual({
      consentimiento_newsletter: false,
      condiciones_aceptadas_at: null,
    });
    expect(camposConsentimientoSolicitud(undefined, AHORA)).toEqual({ consentimiento_newsletter: false, condiciones_aceptadas_at: null });
  });

  it("faltaColumnaConsentimientoSolicitud: solo el PGRST204 de esas dos columnas", () => {
    expect(faltaColumnaConsentimientoSolicitud({ code: "PGRST204", message: "Could not find the 'consentimiento_newsletter' column of 'solicitudes_pendientes' in the schema cache" })).toBe(true);
    expect(faltaColumnaConsentimientoSolicitud({ code: "PGRST204", message: "Could not find the 'condiciones_aceptadas_at' column of 'solicitudes_pendientes' in the schema cache" })).toBe(true);
    expect(faltaColumnaConsentimientoSolicitud({ code: "PGRST204", message: "Could not find the 'marca' column of 'solicitudes_pendientes' in the schema cache" })).toBe(false);
    expect(faltaColumnaConsentimientoSolicitud(null)).toBe(false);
  });
});

describe("salvaguarda del doble opt-in (sin 20261003184500 el trigger antiguo suscribiría sin verificar)", () => {
  it("interpretarSondeoDobleOptin: sin error = activo; columna inexistente = inactivo; otro error = desconocido", () => {
    expect(interpretarSondeoDobleOptin(null)).toBe("activo");
    expect(interpretarSondeoDobleOptin({ code: "42703", message: "column reservas.email_verificado_at does not exist" })).toBe("inactivo");
    expect(interpretarSondeoDobleOptin({ code: "PGRST204", message: "Could not find the 'email_verificado_at' column of 'reservas'" })).toBe("inactivo");
    expect(interpretarSondeoDobleOptin({ code: "500", message: "fetch failed" })).toBe("desconocido");
  });

  it("consentimientoNewsletterParaGuardar: true SOLO con la casilla marcada y el doble opt-in confirmado", () => {
    const si = { aceptaCondiciones: true, consentimientoNewsletter: true };
    const no = { aceptaCondiciones: true, consentimientoNewsletter: false };
    expect(consentimientoNewsletterParaGuardar(si, "activo")).toBe(true);
    expect(consentimientoNewsletterParaGuardar(si, "inactivo")).toBe(false);
    expect(consentimientoNewsletterParaGuardar(si, "desconocido")).toBe(false);
    expect(consentimientoNewsletterParaGuardar(no, "activo")).toBe(false);
  });
});
