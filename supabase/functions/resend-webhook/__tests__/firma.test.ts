/**
 * Tests para supabase/functions/resend-webhook/firma.ts
 *
 * No necesita DOM (usa Web Crypto / `crypto.subtle` directamente, igual que
 * emails-reserva/tokens.ts) -- corre en el entorno "jsdom" por defecto del
 * proyecto sin problema, `crypto.subtle` es el de Node (global), no lo
 * sustituye jsdom.
 *
 * Las firmas "buenas" de cada test se calculan aquí con `node:crypto`
 * (HMAC-SHA256 manual), de forma DELIBERADAMENTE independiente de
 * `firma.ts` -- si mi propia implementación solo se comparara consigo
 * misma, un error sistemático (p.ej. la clave mal derivada) pasaría
 * desapercibido. Comparar contra un cálculo hecho con otra librería es la
 * prueba real de que el formato (prefijo whsec_, base64, HMAC-SHA256 sobre
 * "id.timestamp.cuerpo") es el que documentan Resend/Svix.
 *
 * Lo crítico (encargo, punto 2 -- "esto es lo más delicado"):
 * - Una firma válida y a tiempo se acepta.
 * - Cualquier cambio en el cuerpo, el secreto o la firma se rechaza.
 * - Un timestamp fuera de tolerancia se rechaza (protección replay).
 * - Faltar cualquier cabecera se rechaza.
 * - Con varias firmas espaciadas (rotación de secreto), basta con que UNA
 *   coincida.
 * - La comparación es en tiempo constante (no se testea el timing en sí,
 *   pero sí que compararEnTiempoConstante no usa `===` de string y detecta
 *   cualquier diferencia de contenido o de longitud).
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verificarWebhookResend, compararEnTiempoConstante } from "../firma.ts";

const SECRETO = "whsec_" + Buffer.from("clave-secreta-de-test-para-firma-svix").toString("base64");
const OTRO_SECRETO = "whsec_" + Buffer.from("una-clave-completamente-distinta").toString("base64");

function firmarParaTest(secretoWhsec: string, svixId: string, svixTimestamp: string, cuerpo: string): string {
  const claveBase64 = secretoWhsec.replace(/^whsec_/, "");
  const clave = Buffer.from(claveBase64, "base64");
  const contenido = `${svixId}.${svixTimestamp}.${cuerpo}`;
  const firma = crypto.createHmac("sha256", clave).update(contenido).digest("base64");
  return `v1,${firma}`;
}

const CUERPO = JSON.stringify({ type: "email.delivered", data: { email_id: "abc-123" } });
const SVIX_ID = "msg_test123";

describe("verificarWebhookResend", () => {
  it("acepta una firma válida dentro de la tolerancia", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const svixSignature = firmarParaTest(SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature }, CUERPO, ahora);
    expect(resultado.valido).toBe(true);
  });

  it("acepta si CUALQUIERA de varias firmas espaciadas coincide (rotación de secreto)", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const firmaBuena = firmarParaTest(SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    const svixSignature = `v1,ZmlybWEtZGUtcmVsbGVuby1pbnZhbGlkYQ== ${firmaBuena}`;
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature }, CUERPO, ahora);
    expect(resultado.valido).toBe(true);
  });

  it("rechaza si el cuerpo cambia tras firmar (integridad)", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const svixSignature = firmarParaTest(SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature }, CUERPO + "x", ahora);
    expect(resultado.valido).toBe(false);
  });

  it("rechaza si se firmó con un secreto distinto", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const svixSignature = firmarParaTest(OTRO_SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature }, CUERPO, ahora);
    expect(resultado.valido).toBe(false);
  });

  it("rechaza si falta cualquiera de las tres cabeceras", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const svixSignature = firmarParaTest(SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    expect((await verificarWebhookResend(SECRETO, { svixId: null, svixTimestamp, svixSignature }, CUERPO, ahora)).valido).toBe(false);
    expect((await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp: null, svixSignature }, CUERPO, ahora)).valido).toBe(false);
    expect((await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature: null }, CUERPO, ahora)).valido).toBe(false);
  });

  it("rechaza un timestamp fuera de tolerancia (protección replay) con motivo explícito", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const timestampViejo = String(ahora - 600); // 10 minutos, fuera de los 5 de tolerancia
    const svixSignature = firmarParaTest(SECRETO, SVIX_ID, timestampViejo, CUERPO);
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp: timestampViejo, svixSignature }, CUERPO, ahora);
    expect(resultado.valido).toBe(false);
    if (!resultado.valido) expect(resultado.motivo).toBe("timestamp_fuera_de_tolerancia");
  });

  it("acepta justo en el borde de la tolerancia (300s) y rechaza justo pasado el borde", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const timestampBorde = String(ahora - 300);
    const firmaBorde = firmarParaTest(SECRETO, SVIX_ID, timestampBorde, CUERPO);
    expect((await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp: timestampBorde, svixSignature: firmaBorde }, CUERPO, ahora)).valido).toBe(true);

    const timestampPasado = String(ahora - 301);
    const firmaPasado = firmarParaTest(SECRETO, SVIX_ID, timestampPasado, CUERPO);
    expect((await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp: timestampPasado, svixSignature: firmaPasado }, CUERPO, ahora)).valido).toBe(false);
  });

  it("rechaza una firma manipulada un solo byte", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const firmaBuena = firmarParaTest(SECRETO, SVIX_ID, svixTimestamp, CUERPO);
    const ultimoChar = firmaBuena.slice(-1);
    const charSustituto = ultimoChar === "A" ? "B" : "A";
    const firmaManipulada = firmaBuena.slice(0, -1) + charSustituto;
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature: firmaManipulada }, CUERPO, ahora);
    expect(resultado.valido).toBe(false);
  });

  it("ignora entradas con versión distinta de v1, aunque la firma en sí sea correcta", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const contenido = `${SVIX_ID}.${svixTimestamp}.${CUERPO}`;
    const claveBase64 = SECRETO.replace(/^whsec_/, "");
    const firmaCorrecta = crypto.createHmac("sha256", Buffer.from(claveBase64, "base64")).update(contenido).digest("base64");
    const svixSignature = `v2,${firmaCorrecta}`;
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature }, CUERPO, ahora);
    expect(resultado.valido).toBe(false);
  });

  it("rechaza silenciosamente (sin lanzar) una cabecera svix-signature con formato roto", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const svixTimestamp = String(ahora);
    const resultado = await verificarWebhookResend(SECRETO, { svixId: SVIX_ID, svixTimestamp, svixSignature: "esto-no-tiene-coma-ni-version" }, CUERPO, ahora);
    expect(resultado.valido).toBe(false);
  });
});

describe("compararEnTiempoConstante", () => {
  it("true para arrays idénticos, incluido el caso vacío", () => {
    expect(compararEnTiempoConstante(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(compararEnTiempoConstante(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
  it("false si difiere un byte en cualquier posición", () => {
    expect(compararEnTiempoConstante(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(compararEnTiempoConstante(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it("false si difiere la longitud, aunque el prefijo común coincida", () => {
    expect(compararEnTiempoConstante(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(compararEnTiempoConstante(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
