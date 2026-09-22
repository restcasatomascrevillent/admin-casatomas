/**
 * Tests para supabase/functions/emails-reserva/reintentos.ts
 *
 * Capa pura: clasificación de errores de Resend, cálculo de espera creciente,
 * elegibilidad para reintento y agrupación del aviso al personal. Lo crítico:
 * - Un 429/5xx/409-concurrencia/sin-respuesta-HTTP se clasifica como
 *   reintentable; un 400/401/403/404/405/422 y un 409 de payload distinto
 *   con la misma clave, como permanente — reintentar eso nunca lo arregla.
 * - El backoff crece y tiene tope; toda la ventana de reintento queda muy
 *   por debajo de las 24h que Resend conserva la clave de idempotencia.
 * - Una fila ya agotada, o a la que aún no le toca, nunca se da por elegible.
 * - El aviso al personal se agrupa en uno solo — nunca un aviso por reserva.
 */
import { describe, it, expect } from "vitest";
import {
  clasificarErrorEnvio,
  calcularBackoffMs,
  calcularProximoReintento,
  seHanAgotadoLosIntentos,
  esReintentableAhora,
  tipoDeEmailSigueVigente,
  claveIdempotenciaEnvio,
  debeCrearAvisoLote,
  construirAvisoLote,
  MAX_INTENTOS_POR_DEFECTO,
  BACKOFF_BASE_MS_POR_DEFECTO,
  BACKOFF_MAX_MS_POR_DEFECTO,
  type EnvioPerdido,
} from "../reintentos.ts";

describe("clasificarErrorEnvio", () => {
  it("429 (rate_limit_exceeded) es reintentable", () => {
    const r = clasificarErrorEnvio({ status: 429, name: "rate_limit_exceeded", message: "Too many requests" });
    expect(r.reintentable).toBe(true);
  });

  it("429 con name ausente sigue siendo reintentable (el status manda)", () => {
    expect(clasificarErrorEnvio({ status: 429, name: null, message: null }).reintentable).toBe(true);
  });

  it("429 daily_quota_exceeded / monthly_quota_exceeded también son reintentables (el límite de intentos acota el daño)", () => {
    expect(clasificarErrorEnvio({ status: 429, name: "daily_quota_exceeded" }).reintentable).toBe(true);
    expect(clasificarErrorEnvio({ status: 429, name: "monthly_quota_exceeded" }).reintentable).toBe(true);
  });

  it.each([500, 502, 503, 504])("%i (error de servidor) es reintentable", (status) => {
    expect(clasificarErrorEnvio({ status, name: "application_error" }).reintentable).toBe(true);
  });

  it("409 concurrent_idempotent_requests es reintentable (conflicto transitorio)", () => {
    const r = clasificarErrorEnvio({ status: 409, name: "concurrent_idempotent_requests" });
    expect(r.reintentable).toBe(true);
  });

  it("409 invalid_idempotent_request es PERMANENTE (payload distinto con la misma clave — repetir no lo arregla)", () => {
    const r = clasificarErrorEnvio({ status: 409, name: "invalid_idempotent_request" });
    expect(r.reintentable).toBe(false);
    expect(r.motivo).toBe("payload_cambio_con_misma_clave");
  });

  it("sin respuesta HTTP (excepción de red/timeout, status null) se asume reintentable", () => {
    expect(clasificarErrorEnvio({ status: null }).reintentable).toBe(true);
    expect(clasificarErrorEnvio({ status: null }).motivo).toBe("sin_respuesta_http");
  });

  it.each([400, 401, 403, 404, 405, 422])("%i es PERMANENTE (formato/credenciales/permisos, repetir no cambia nada)", (status) => {
    expect(clasificarErrorEnvio({ status, name: "validation_error" }).reintentable).toBe(false);
  });

  it("400 validation_error de sandbox de Resend es permanente (destinatario rechazado, no un blip)", () => {
    const r = clasificarErrorEnvio({
      status: 403,
      name: "validation_error",
      message: "You can only send testing emails to your own email address",
    });
    expect(r.reintentable).toBe(false);
  });

  it("422 missing_required_field (correo mal formado) es permanente", () => {
    expect(clasificarErrorEnvio({ status: 422, name: "missing_required_field" }).reintentable).toBe(false);
  });
});

describe("calcularBackoffMs", () => {
  it("crece exponencialmente: 10 -> 20 -> 40 -> 80 minutos con los valores por defecto", () => {
    expect(calcularBackoffMs(1)).toBe(10 * 60 * 1000);
    expect(calcularBackoffMs(2)).toBe(20 * 60 * 1000);
    expect(calcularBackoffMs(3)).toBe(40 * 60 * 1000);
    expect(calcularBackoffMs(4)).toBe(80 * 60 * 1000);
  });

  it("nunca supera el tope aunque intentosPrevios sea muy grande", () => {
    expect(calcularBackoffMs(50)).toBe(BACKOFF_MAX_MS_POR_DEFECTO);
  });

  it("trata intentosPrevios < 1 como 1 (nunca da una espera menor que la base)", () => {
    expect(calcularBackoffMs(0)).toBe(BACKOFF_BASE_MS_POR_DEFECTO);
    expect(calcularBackoffMs(-3)).toBe(BACKOFF_BASE_MS_POR_DEFECTO);
  });

  it("admite parámetros propios (base/factor/tope)", () => {
    expect(calcularBackoffMs(1, 1000, 3, 100000)).toBe(1000);
    expect(calcularBackoffMs(2, 1000, 3, 100000)).toBe(3000);
    expect(calcularBackoffMs(3, 1000, 3, 100000)).toBe(9000);
    expect(calcularBackoffMs(10, 1000, 3, 100000)).toBe(100000);
  });

  it("toda la ventana de reintento (hasta agotar MAX_INTENTOS_POR_DEFECTO) queda muy por debajo de las 24h que Resend conserva la clave de idempotencia", () => {
    let totalMs = 0;
    for (let intento = 1; intento < MAX_INTENTOS_POR_DEFECTO; intento++) {
      totalMs += calcularBackoffMs(intento);
    }
    expect(totalMs).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

describe("calcularProximoReintento", () => {
  it("suma el backoff correspondiente a la fecha dada", () => {
    expect(calcularProximoReintento("2026-03-16T10:00:00.000Z", 1)).toBe("2026-03-16T10:10:00.000Z");
    expect(calcularProximoReintento("2026-03-16T10:00:00.000Z", 2)).toBe("2026-03-16T10:20:00.000Z");
  });
});

describe("seHanAgotadoLosIntentos", () => {
  it("falso por debajo del máximo", () => {
    expect(seHanAgotadoLosIntentos(4, 5)).toBe(false);
  });

  it("verdadero justo en el máximo (el intento que lo alcanza ya no reintenta más)", () => {
    expect(seHanAgotadoLosIntentos(5, 5)).toBe(true);
  });

  it("verdadero por encima del máximo", () => {
    expect(seHanAgotadoLosIntentos(9, 5)).toBe(true);
  });

  it("usa MAX_INTENTOS_POR_DEFECTO si no se pasa un máximo", () => {
    expect(seHanAgotadoLosIntentos(MAX_INTENTOS_POR_DEFECTO)).toBe(true);
    expect(seHanAgotadoLosIntentos(MAX_INTENTOS_POR_DEFECTO - 1)).toBe(false);
  });
});

function filaFallida(overrides: Partial<{ resultado: string; intentos: number; proximo_reintento_en: string | null }> = {}) {
  return { resultado: "fallido", intentos: 1, proximo_reintento_en: null, ...overrides };
}

describe("esReintentableAhora", () => {
  const ahora = "2026-03-16T12:00:00.000Z";

  it("verdadero si no tiene proximo_reintento_en asignado (fallo recién marcado)", () => {
    expect(esReintentableAhora(filaFallida({ proximo_reintento_en: null }), ahora)).toBe(true);
  });

  it("falso si a la fila todavía no le toca (proximo_reintento_en en el futuro)", () => {
    expect(esReintentableAhora(filaFallida({ proximo_reintento_en: "2026-03-16T12:00:01.000Z" }), ahora)).toBe(false);
  });

  it("verdadero justo cuando se cumple proximo_reintento_en", () => {
    expect(esReintentableAhora(filaFallida({ proximo_reintento_en: "2026-03-16T12:00:00.000Z" }), ahora)).toBe(true);
  });

  it("verdadero si proximo_reintento_en ya quedó en el pasado", () => {
    expect(esReintentableAhora(filaFallida({ proximo_reintento_en: "2026-03-16T11:00:00.000Z" }), ahora)).toBe(true);
  });

  it("falso si el resultado no es 'fallido' (p.ej. 'pendiente', reclamado por otra ejecución)", () => {
    expect(esReintentableAhora(filaFallida({ resultado: "pendiente" }), ahora)).toBe(false);
    expect(esReintentableAhora(filaFallida({ resultado: "enviado" }), ahora)).toBe(false);
    expect(esReintentableAhora(filaFallida({ resultado: "fallido_definitivo" }), ahora)).toBe(false);
  });

  it("falso si ya se agotaron los intentos, aunque le tocase por tiempo", () => {
    expect(esReintentableAhora(filaFallida({ intentos: 5, proximo_reintento_en: "2026-03-16T11:00:00.000Z" }), ahora, 5)).toBe(false);
  });
});

describe("tipoDeEmailSigueVigente", () => {
  it("verdadero si el tipo de la fila coincide con el que corresponde al estado actual", () => {
    expect(tipoDeEmailSigueVigente("propuesta", "verificada", "propuesta")).toBe(true);
  });

  it("falso si la reserva avanzó a otro estado (el correo pendiente de reintento quedó obsoleto)", () => {
    expect(tipoDeEmailSigueVigente("propuesta", "confirmada", "confirmada")).toBe(false);
  });

  it("falso si el estado actual no dispara ningún correo (null, p.ej. completada/no_show)", () => {
    expect(tipoDeEmailSigueVigente("propuesta", "completada", null)).toBe(false);
  });

  // Caso especial: 'recordatorio' no lo dispara ninguna transición de
  // estado (tipoEmailParaEstado nunca devuelve 'recordatorio'), así que NO
  // puede juzgarse con la regla general de comparar contra
  // tipoEmailParaEstadoActual — eso lo marcaría SIEMPRE como obsoleto,
  // exactamente el caso que el encargo señala como el más grave
  // ("si falla el recordatorio, nunca se reintenta").
  it("'recordatorio' sigue vigente mientras la reserva siga 'confirmada' (aunque tipoEmailParaEstadoActual sea 'confirmada', no 'recordatorio')", () => {
    expect(tipoDeEmailSigueVigente("recordatorio", "confirmada", "confirmada")).toBe(true);
  });

  it("'recordatorio' deja de estar vigente si la reserva ya no está 'confirmada' (p.ej. se canceló)", () => {
    expect(tipoDeEmailSigueVigente("recordatorio", "cancelada", "rechazada")).toBe(false);
  });
});

describe("claveIdempotenciaEnvio", () => {
  it("es estable para el mismo id (la misma fila siempre produce la misma clave)", () => {
    const a = claveIdempotenciaEnvio("11111111-1111-1111-1111-111111111111");
    const b = claveIdempotenciaEnvio("11111111-1111-1111-1111-111111111111");
    expect(a).toBe(b);
  });

  it("distintos ids producen distintas claves", () => {
    expect(claveIdempotenciaEnvio("id-a")).not.toBe(claveIdempotenciaEnvio("id-b"));
  });

  it("cabe dentro del límite de 256 caracteres de Resend para un uuid típico", () => {
    expect(claveIdempotenciaEnvio("11111111-1111-1111-1111-111111111111").length).toBeLessThanOrEqual(256);
  });
});

describe("debeCrearAvisoLote", () => {
  const ahora = "2026-03-16T12:00:00.000Z";

  it("verdadero si nunca hubo un aviso previo", () => {
    expect(debeCrearAvisoLote(null, ahora)).toBe(true);
  });

  it("falso si el último aviso fue hace menos del cooldown (evita el aluvión)", () => {
    expect(debeCrearAvisoLote("2026-03-16T11:45:00.000Z", ahora, 30)).toBe(false);
  });

  it("verdadero justo al cumplirse el cooldown", () => {
    expect(debeCrearAvisoLote("2026-03-16T11:30:00.000Z", ahora, 30)).toBe(true);
  });

  it("verdadero bastante después del cooldown", () => {
    expect(debeCrearAvisoLote("2026-03-15T00:00:00.000Z", ahora, 30)).toBe(true);
  });
});

function envioPerdido(overrides: Partial<EnvioPerdido> = {}): EnvioPerdido {
  return {
    reservaId: "r1",
    nombre: "Juan Pérez",
    telefono: "600111222",
    email: "juan@example.com",
    fecha: "2026-03-16",
    hora: "21:00:00",
    tipoEmail: "confirmada",
    motivo: "error_servidor_500",
    ...overrides,
  };
}

describe("construirAvisoLote", () => {
  it("null si no hay nada que avisar", () => {
    expect(construirAvisoLote([])).toBeNull();
  });

  it("un único elemento se redacta en singular, nombrando la reserva concreta", () => {
    const aviso = construirAvisoLote([envioPerdido()]);
    expect(aviso).not.toBeNull();
    expect(aviso?.titulo).toContain("un correo de reserva");
    expect(aviso?.mensaje).toContain("Juan Pérez");
    expect(aviso?.mensaje).toContain("600111222");
    expect(aviso?.mensaje.toLowerCase()).toContain("llama");
  });

  it("prioriza el teléfono sobre el email como contacto, y usa 'sin contacto' si no hay ninguno", () => {
    const aviso = construirAvisoLote([envioPerdido({ telefono: null, email: null })]);
    expect(aviso?.mensaje).toContain("sin contacto");
  });

  it("varios elementos se agrupan en UN SOLO aviso, nunca uno por reserva", () => {
    const perdidos = [envioPerdido({ reservaId: "a", nombre: "Ana" }), envioPerdido({ reservaId: "b", nombre: "Bea" })];
    const aviso = construirAvisoLote(perdidos);
    expect(aviso?.titulo).toContain("2 correos");
    expect(aviso?.mensaje).toContain("Ana");
    expect(aviso?.mensaje).toContain("Bea");
  });

  it("trunca la lista a 5 nombres y resume el resto como 'y N más' (el aviso no debe crecer sin límite)", () => {
    const perdidos = Array.from({ length: 8 }, (_, i) => envioPerdido({ reservaId: `r${i}`, nombre: `Cliente ${i}` }));
    const aviso = construirAvisoLote(perdidos);
    expect(aviso?.mensaje).toContain("Cliente 0");
    expect(aviso?.mensaje).toContain("Cliente 4");
    expect(aviso?.mensaje).not.toContain("Cliente 5");
    expect(aviso?.mensaje).toContain("y 3 más");
  });

  it("distingue un problema de configuración (RESEND_API_KEY) del caso normal de 'llama al cliente'", () => {
    const aviso = construirAvisoLote([envioPerdido({ motivo: "resend_no_configurado" })]);
    expect(aviso?.mensaje.toLowerCase()).toContain("configuración");
    expect(aviso?.mensaje.toLowerCase()).not.toContain("llama para confirmarlo");
  });

  it("usa el nombre 'Cliente' si nombre es null", () => {
    const aviso = construirAvisoLote([envioPerdido({ nombre: null })]);
    expect(aviso?.mensaje).toContain("Cliente");
  });
});
