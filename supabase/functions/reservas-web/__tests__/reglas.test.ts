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
