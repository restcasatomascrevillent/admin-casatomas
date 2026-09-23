/**
 * Tests para supabase/functions/emails-reserva/tokens.ts
 *
 * No necesita DOM (usa Web Crypto / `crypto.subtle` directamente), pero se
 * deja correr en el entorno "jsdom" por defecto del proyecto en vez de
 * forzar "node": el `setupFiles` global (`src/test/setup.ts`) asume que
 * `window` existe y rompería bajo un entorno sin DOM. `crypto.subtle` es
 * el de Node (global, no lo sustituye jsdom), así que funciona igual.
 *
 * Lo crítico:
 * - Round-trip firmar/verificar funciona con la huella correcta.
 * - Un token manipulado (firma, carga o acción) se rechaza.
 * - Un token caducado se rechaza.
 * - La huella cambia si cambia estado, hora o espacio -> invalida enlaces
 *   viejos si el restaurante revisa la oferta antes de que el cliente
 *   responda (motivo documentado en tokens.ts).
 */
import { describe, it, expect } from "vitest";
import { firmarToken, verificarToken, calcularHuella } from "../tokens.ts";

const SECRETO = "secreto-de-test-no-usar-en-produccion";

describe("calcularHuella", () => {
  it("combina estado, hora (recortada a HH:MM) y espacio", () => {
    expect(calcularHuella("verificada", "21:00:00", "esp-1")).toBe("verificada|21:00|esp-1");
  });

  it("usa cadena vacía cuando no hay espacio", () => {
    expect(calcularHuella("verificada", "21:00", null)).toBe("verificada|21:00|");
  });

  it("cambia si cambia cualquiera de los tres componentes", () => {
    const base = calcularHuella("verificada", "21:00", "esp-1");
    expect(calcularHuella("confirmada", "21:00", "esp-1")).not.toBe(base);
    expect(calcularHuella("verificada", "20:30", "esp-1")).not.toBe(base);
    expect(calcularHuella("verificada", "21:00", "esp-2")).not.toBe(base);
  });
});

describe("firmarToken / verificarToken", () => {
  it("un token recién firmado se verifica correctamente con la misma huella y acción", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella);
    const carga = await verificarToken(SECRETO, token, "aceptar");
    expect(carga).not.toBeNull();
    expect(carga?.id).toBe("reserva-123");
    expect(carga?.fp).toBe(huella);
  });

  it("se rechaza si se verifica con la acción equivocada", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella);
    expect(await verificarToken(SECRETO, token, "rechazar")).toBeNull();
  });

  it("se rechaza si se firma con un secreto y se verifica con otro", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella);
    expect(await verificarToken("otro-secreto-distinto", token, "aceptar")).toBeNull();
  });

  it("se rechaza si se manipula la carga (payload) sin volver a firmar", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella);
    const [cargaB64, firmaB64] = token.split(".");
    const cargaManipulada = JSON.parse(atob(cargaB64.replace(/-/g, "+").replace(/_/g, "/")));
    cargaManipulada.id = "reserva-de-otro-cliente";
    const cargaManipuladaB64 = btoa(JSON.stringify(cargaManipulada)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tokenManipulado = `${cargaManipuladaB64}.${firmaB64}`;
    expect(await verificarToken(SECRETO, tokenManipulado, "aceptar")).toBeNull();
  });

  it("se rechaza un token caducado", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const hace20dias = Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60;
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella, hace20dias);
    expect(await verificarToken(SECRETO, token, "aceptar")).toBeNull();
  });

  it("se rechaza un token con formato roto", async () => {
    expect(await verificarToken(SECRETO, "esto-no-es-un-token", "aceptar")).toBeNull();
    expect(await verificarToken(SECRETO, "", "aceptar")).toBeNull();
  });

  it("se rechaza cualquier token si no hay secreto configurado (falla cerrado)", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token = await firmarToken(SECRETO, "reserva-123", "aceptar", huella);
    expect(await verificarToken("", token, "aceptar")).toBeNull();
  });

  /**
   * Guarda de regresión para el bug de emails-reserva/index.ts corregido en
   * esta entrega (punto 3 del encargo "cierre del círculo resend-webhook"):
   * construirCorreoParaTipo llamaba a firmarToken SIN pasar
   * `ahoraEpochSegundos`, así que usaba el valor por defecto (`Date.now()`
   * EN EL MOMENTO DE CADA LLAMADA) — el token (y por tanto el HTML) salía
   * distinto entre el envío original y cada reintento de la MISMA fila,
   * rompiendo la idempotencia de Resend (mismo Idempotency-Key, payload
   * distinto -> 409 -> se clasificaba como fallo permanente sobre una
   * propuesta que en realidad sí se había entregado). El arreglo fue en
   * index.ts (pasar el `creado_at` de la fila en vez de dejar el default),
   * no en `firmarToken` — esta función ya soportaba un timestamp explícito
   * (se usa más abajo para el test de caducidad); lo que faltaba era que
   * quien la llama lo aprovechara con un valor ESTABLE. Este test fija esa
   * propiedad para que no se rompa por accidente en el futuro.
   */
  it("dos llamadas con el MISMO ahoraEpochSegundos producen el MISMO token (estabilidad entre reintentos)", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const epochFijo = Math.floor(new Date("2026-09-20T10:00:00Z").getTime() / 1000);
    const token1 = await firmarToken(SECRETO, "reserva-123", "aceptar", huella, epochFijo);
    const token2 = await firmarToken(SECRETO, "reserva-123", "aceptar", huella, epochFijo);
    expect(token1).toBe(token2);
  });

  it("dos llamadas SIN ahoraEpochSegundos explícito (el bug original) pueden producir tokens distintos", async () => {
    const huella = calcularHuella("verificada", "21:00", "esp-1");
    const token1 = await firmarToken(SECRETO, "reserva-123", "aceptar", huella, 1_000_000_000);
    const token2 = await firmarToken(SECRETO, "reserva-123", "aceptar", huella, 1_000_000_001);
    expect(token1).not.toBe(token2);
  });
});
