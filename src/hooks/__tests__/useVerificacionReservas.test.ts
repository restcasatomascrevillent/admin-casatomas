/**
 * Tests para src/hooks/useVerificacionReservas.ts
 *
 * Los dos temas que cubren, los dos por el mismo motivo — que el panel no
 * afirme nada que el cliente no vaya a ver:
 *
 * 1. `difiereSolicitudDeOferta` tiene que decir EXACTAMENTE lo mismo que
 *    `hayContraoferta()` de `supabase/functions/emails-reserva/plantillas.ts`,
 *    que es la que decide lo que se pinta en el correo de verdad. Aquí no se
 *    prueba "la regla" (esa ya la prueba la Edge Function): se prueba que el
 *    panel la usa y no una copia suya. El fallo de septiembre de 2026 fue
 *    justo ese — el correo pasó a mirar solo la hora y el panel se quedó
 *    mirando hora O sala, así que asignar el Salón a una solicitud de las
 *    14:00 pintaba un aviso ámbar por una diferencia invisible para el
 *    cliente.
 *
 * 2. `avisoAlCliente` cuenta lo que el camarero NO puede ver en pantalla: si al cliente
 *    le llega o no el correo. (Los avisos completos de cada acción —título con la hora,
 *    «Solicitud rechazada», el resumen del bloque— se prueban donde se ejecutan: las
 *    acciones de gestión son del ejecutor, `useAccionesServicioReserva`; ver
 *    `useVerificacionReservas.efectos.test.ts`.)
 */
import { describe, it, expect, vi } from "vitest";

// El módulo importa el cliente de Supabase (por `notificarCambioReserva`); aquí no se usa.
vi.mock("@/integrations/supabase/client");

import {
  type ReservaParaVerificar,
  difiereSolicitudDeOferta,
  espacioAlAceptar,
  avisoAlCliente,
} from "@/hooks/useVerificacionReservas";
// La función del correo REAL, sin pasar por el hook: el espejo se compara
// contra ella, no contra otra copia.
import { hayContraoferta } from "../../../supabase/functions/emails-reserva/plantillas";

const reserva = (overrides: Partial<ReservaParaVerificar> = {}): ReservaParaVerificar => ({
  id: "res-1",
  nombre: "Miguel Benito Castellanos",
  telefono: "+34600111222",
  email: "miguel@ejemplo.com",
  fecha: "2026-10-02",
  hora: "14:00:00",
  numero_comensales: 4,
  estado: "pendiente",
  notas_cliente: null,
  espacio_id: null,
  ...overrides,
});

// ─── 1. Mismo criterio que el correo ─────────────────────────────────────────

describe("difiereSolicitudDeOferta", () => {
  it("MISMA hora y sala distinta: NO hay diferencia que avisar (la sala no sale en el correo)", () => {
    // El caso exacto de la captura del dueño: solicitud a las 14:00 a la que
    // se le asigna el Salón. El cliente no verá nada distinto.
    const r = reserva({
      hora: "14:00:00",
      hora_solicitada: "14:00:00",
      espacio_id: "salon-uuid",
      espacio_solicitado_id: null,
    });
    expect(difiereSolicitudDeOferta(r)).toBe(false);
  });

  it("hora distinta: sí hay diferencia, se toque o no la sala", () => {
    const r = reserva({ hora: "21:00:00", hora_solicitada: "14:00:00", espacio_id: null, espacio_solicitado_id: null });
    expect(difiereSolicitudDeOferta(r)).toBe(true);
  });

  it("no compara los segundos: 14:00 y 14:00:00 son la misma hora", () => {
    expect(difiereSolicitudDeOferta(reserva({ hora: "14:00:00", hora_solicitada: "14:00" }))).toBe(false);
  });

  it("sin hora_solicitada (migración sin aplicar): no se afirma una diferencia que no se puede leer", () => {
    expect(difiereSolicitudDeOferta(reserva({ hora: "14:00:00" }))).toBe(false);
    expect(difiereSolicitudDeOferta(reserva({ hora: "14:00:00", hora_solicitada: null }))).toBe(false);
  });

  it("sin hora_solicitada pero con sala asignada: sigue sin haber diferencia", () => {
    // Antes esta fila devolvía `true` por la rama del espacio.
    const r = reserva({ hora: "14:00:00", espacio_id: "salon-uuid", espacio_solicitado_id: null });
    expect(difiereSolicitudDeOferta(r)).toBe(false);
  });

  it("dice lo mismo que hayContraoferta() del correo en toda la matriz de casos", () => {
    const horas: Array<string | null | undefined> = ["14:00:00", "14:00", "21:00", null, undefined];
    const salas: Array<string | null | undefined> = [null, "salon-uuid", "terraza-uuid", undefined];
    for (const horaSolicitada of horas) {
      for (const espacioSolicitadoId of salas) {
        for (const espacioId of salas) {
          const r = reserva({
            hora: "14:00:00",
            hora_solicitada: horaSolicitada,
            espacio_id: espacioId ?? null,
            espacio_solicitado_id: espacioSolicitadoId,
          });
          const esperado = hayContraoferta({
            nombre: r.nombre ?? "",
            fecha: r.fecha,
            hora: r.hora,
            comensales: r.numero_comensales,
            espacio: null,
            horaSolicitada,
          });
          expect(
            difiereSolicitudDeOferta(r),
            JSON.stringify({ horaSolicitada, espacioSolicitadoId, espacioId }),
          ).toBe(esperado);
        }
      }
    }
  });
});

describe("espacioAlAceptar", () => {
  // cambio acordado con el dueño (2026-10-01): «Aceptar» acepta la reserva TAL COMO ESTÁ AHORA. Antes el test fijaba
  // `objetivoAceptarComoSolicitado` = { hora: hora_solicitada, espacio_id: espacio_solicitado_id }, que borraba la
  // sala y las mesas que el personal ya hubiera asignado (Casa Tomás: sala pedida null) y revertía la hora editada.
  // La matriz completa está en `src/lib/reservas/__tests__/verificacion.test.ts`; aquí solo se comprueba que el hook
  // sigue reexportando la función (la usa la ficha de verificación) y que respeta las columnas de lo solicitado.
  it("con la hora editada y otra sala puesta: no toca ninguna de las dos (ni hora ni sala)", () => {
    const r = reserva({ hora: "21:00", hora_solicitada: "14:00", espacio_id: "a", espacio_solicitado_id: "b" });
    expect(espacioAlAceptar(r)).toEqual({});
  });

  it("sin sala y con una pedida (Touza): la rellena con la pedida", () => {
    const r = reserva({ hora: "21:00", hora_solicitada: "14:00", espacio_id: null, espacio_solicitado_id: "b" });
    expect(espacioAlAceptar(r)).toEqual({ espacio_id: "b" });
  });
});

// ─── 2. El aviso del correo ──────────────────────────────────────────────────

describe("avisoAlCliente", () => {
  it("con correo, dice a dónde va", () => {
    expect(avisoAlCliente(reserva({ email: "ana@ejemplo.com" }))).toBe("Se le manda el correo a ana@ejemplo.com");
  });

  it("sin correo, dice que hay que llamar (no se puede mandar nada)", () => {
    expect(avisoAlCliente(reserva({ email: null }))).toBe("No tiene correo: hay que avisarle por teléfono");
    expect(avisoAlCliente(reserva({ email: "   " }))).toBe("No tiene correo: hay que avisarle por teléfono");
  });
});
