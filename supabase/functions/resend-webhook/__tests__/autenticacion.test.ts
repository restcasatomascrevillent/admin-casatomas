/** CT-REM-FN-04: el webhook falla cerrado si falta el secreto. */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { autenticarWebhookResend } from "../firma.ts";

const CLAVE = crypto.randomBytes(24);
const SECRETO = "whsec_" + CLAVE.toString("base64");
const ID = "msg_test_1";
const CUERPO = JSON.stringify({ type: "email.bounced", data: { to: ["x@example.com"] } });

function firmar(ts: string, cuerpo = CUERPO): string {
  const h = crypto.createHmac("sha256", CLAVE).update(`${ID}.${ts}.${cuerpo}`).digest("base64");
  return `v1,${h}`;
}
const ahora = () => String(Math.floor(Date.now() / 1000));

describe("autenticarWebhookResend (CT-REM-FN-04)", () => {
  it("sin secreto configurado devuelve 500 aunque llegue una firma", async () => {
    const ts = ahora();
    for (const s of [undefined, null, ""]) {
      const r = await autenticarWebhookResend(s, { svixId: ID, svixTimestamp: ts, svixSignature: firmar(ts) }, CUERPO);
      expect(r).toMatchObject({ ok: false, status: 500 });
    }
  });
  it("sin secreto y sin cabeceras tampoco pasa", async () => {
    const r = await autenticarWebhookResend(undefined, { svixId: null, svixTimestamp: null, svixSignature: null }, CUERPO);
    expect(r).toMatchObject({ ok: false, status: 500 });
  });
  it("firma incorrecta da 401", async () => {
    const ts = ahora();
    const r = await autenticarWebhookResend(SECRETO, { svixId: ID, svixTimestamp: ts, svixSignature: firmar(ts, "otro") }, CUERPO);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it("sin cabeceras svix da 401", async () => {
    const r = await autenticarWebhookResend(SECRETO, { svixId: null, svixTimestamp: null, svixSignature: null }, CUERPO);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it("firma correcta se acepta", async () => {
    const ts = ahora();
    const r = await autenticarWebhookResend(SECRETO, { svixId: ID, svixTimestamp: ts, svixSignature: firmar(ts) }, CUERPO);
    expect(r).toEqual({ ok: true });
  });
});
