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
 * 2. Los avisos (toasts) cuentan lo que el camarero NO puede ver en pantalla:
 *    si al cliente le llega o no el correo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

import * as clienteMock from "@/integrations/supabase/client";
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { toast } from "sonner";
import {
  type ReservaParaVerificar,
  difiereSolicitudDeOferta,
  objetivoAceptarComoSolicitado,
  avisoAlCliente,
  aceptarComoSolicitado,
  verificarConHoraYSala,
  rechazarReserva,
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

beforeEach(() => {
  resetSupabaseMocks();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
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

describe("objetivoAceptarComoSolicitado", () => {
  it("sigue leyendo las columnas de lo solicitado (no se ha borrado ningún dato)", () => {
    const r = reserva({ hora: "21:00", hora_solicitada: "14:00", espacio_id: "a", espacio_solicitado_id: "b" });
    expect(objetivoAceptarComoSolicitado(r)).toEqual({ hora: "14:00", espacio_id: "b" });
  });
});

// ─── 2. Los avisos ───────────────────────────────────────────────────────────

describe("avisoAlCliente", () => {
  it("con correo, dice a dónde va", () => {
    expect(avisoAlCliente(reserva({ email: "ana@ejemplo.com" }))).toBe("Se le manda el correo a ana@ejemplo.com");
  });

  it("sin correo, dice que hay que llamar (no se puede mandar nada)", () => {
    expect(avisoAlCliente(reserva({ email: null }))).toBe("No tiene correo: hay que avisarle por teléfono");
    expect(avisoAlCliente(reserva({ email: "   " }))).toBe("No tiene correo: hay que avisarle por teléfono");
  });
});

describe("avisos de las acciones", () => {
  it("verificar: título corto con la hora y el efecto de verdad debajo", async () => {
    await verificarConHoraYSala(reserva(), { hora: "21:00", espacio_id: "salon-uuid" });
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 21:00", {
      description: "Se le manda el correo a miguel@ejemplo.com",
    });
  });

  it("verificar sin correo del cliente: lo dice en vez de dar por hecho el aviso", async () => {
    await verificarConHoraYSala(reserva({ email: null }), { hora: "14:00", espacio_id: null });
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 14:00", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it("aceptar de un clic (lista/hoy): mismo aviso, sin vocabulario de regateo", async () => {
    await aceptarComoSolicitado(reserva({ hora_solicitada: "13:30:00" }));
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 13:30", {
      description: "Se le manda el correo a miguel@ejemplo.com",
    });
  });

  it("el título no lleva el nombre del cliente (con uno largo partía en dos líneas)", async () => {
    await aceptarComoSolicitado(reserva());
    const [titulo] = vi.mocked(toast.success).mock.calls[0];
    expect(String(titulo)).not.toContain("Miguel");
    expect(String(titulo).length).toBeLessThan(40);
  });

  it("rechazar: también cuenta si al cliente le llega el correo", async () => {
    await rechazarReserva(reserva({ email: null }));
    expect(toast.success).toHaveBeenCalledWith("Solicitud rechazada", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it("ningún aviso usa vocabulario de regateo", async () => {
    await verificarConHoraYSala(reserva(), { hora: "21:00", espacio_id: null });
    await aceptarComoSolicitado(reserva());
    await rechazarReserva(reserva());
    const textos = JSON.stringify(vi.mocked(toast.success).mock.calls).toLowerCase();
    expect(textos).not.toContain("contraoferta");
    expect(textos).not.toContain("tal y como se pidió");
    expect(textos).not.toContain("propuesta");
  });
});
