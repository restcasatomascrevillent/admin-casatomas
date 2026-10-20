/**
 * Tests para supabase/functions/chat-web/session-token.ts
 *
 * Igual que emails-reserva/__tests__/tokens.test.ts: usa Web Crypto
 * (`crypto.subtle`) directamente, sin globals de Deno ni DOM, asi que corre
 * bajo vitest con el entorno jsdom por defecto del proyecto (`crypto.subtle`
 * es el de Node, global, jsdom no lo sustituye).
 *
 * Lo critico (defecto de la auditoria que esto arregla: "id de sesion sin
 * firmar — cualquiera puede leer la conversacion de otro pasando su id"):
 * - Round-trip firmar/verificar funciona y devuelve el mismo id.
 * - Un id ajeno SIN firmar se rechaza (el bug en si).
 * - Un token con la firma de otro id, o firmado con otro secreto, se rechaza.
 * - Formatos rotos (sin separador, vacio) se rechazan sin lanzar.
 */
import { describe, it, expect } from "vitest";
import { firmarSessionToken, verificarSessionToken } from "../session-token.ts";

const SECRETO = "secreto-de-test-no-usar-en-produccion";

describe("firmarSessionToken / verificarSessionToken", () => {
  it("un token recien firmado se verifica y devuelve el mismo id", async () => {
    const token = await firmarSessionToken(SECRETO, "id-visitante-123");
    expect(await verificarSessionToken(SECRETO, token)).toBe("id-visitante-123");
  });

  it("ids distintos producen tokens distintos", async () => {
    const tokenA = await firmarSessionToken(SECRETO, "id-a");
    const tokenB = await firmarSessionToken(SECRETO, "id-b");
    expect(tokenA).not.toBe(tokenB);
  });

  it("se rechaza el id de otra persona mandado SIN firmar (el bug que arregla esto)", async () => {
    // Antes, chat-web/index.ts usaba directamente el `id` que mandara el
    // cliente: pasar el id ajeno (visto en un log, una cookie, etc.) daba
    // acceso a su conversacion. Ahora un id "a pelo" no verifica.
    expect(await verificarSessionToken(SECRETO, "id-de-otra-persona")).toBeNull();
  });

  it("se rechaza si se firma con un secreto y se verifica con otro", async () => {
    const token = await firmarSessionToken(SECRETO, "id-visitante-123");
    expect(await verificarSessionToken("otro-secreto-distinto", token)).toBeNull();
  });

  it("se rechaza si se sustituye el id manteniendo la firma original (firma que no cuadra con el payload)", async () => {
    const token = await firmarSessionToken(SECRETO, "id-visitante-123");
    const firma = token.slice(token.lastIndexOf(".") + 1);
    const tokenManipulado = `id-victima-456.${firma}`;
    expect(await verificarSessionToken(SECRETO, tokenManipulado)).toBeNull();
  });

  it("se rechaza un token con formato roto (sin separador)", async () => {
    expect(await verificarSessionToken(SECRETO, "sin-separador-ni-firma")).toBeNull();
  });

  it("se rechaza un token o un secreto vacios, sin lanzar", async () => {
    await expect(verificarSessionToken(SECRETO, "")).resolves.toBeNull();
    const token = await firmarSessionToken(SECRETO, "id-visitante-123");
    await expect(verificarSessionToken("", token)).resolves.toBeNull();
  });

  it("se rechaza basura que no decodifica como firma valida, sin lanzar", async () => {
    await expect(verificarSessionToken(SECRETO, "id-visitante-123.***no-es-base64url***")).resolves.toBeNull();
  });
});
