// @vitest-environment node
/**
 * Edge Function rrss-embed-revoke sin red: permisos y rrss simulados. Solo con el
 * secreto de la base de datos; solo si ya no tiene «Redes»; el aviso sale firmado
 * con la clave de los pases (verificable con la pública), con `typ: rrss-revoke`,
 * sin huella ni rol (no sirve como pase) y de 60 s.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { manejarAviso, type DependenciasAviso } from "../aviso";

const BRAND = "b141a5b7-65c1-4d79-acc8-a18ac6a5c84b";
const SECRETO = "s".repeat(40);
const SIN_REDES = "11111111-1111-4111-8111-111111111111";
const CON_REDES = "22222222-2222-4222-8222-222222222222";
const DESTINO = "https://rrss.supabase.test/functions/v1/embed-session/revoke";

let publica: CryptoKey;
let env: Record<string, string>;
const enviados: Array<{ url: string; cuerpo: { notice: string } }> = [];

const crearCliente = () => ({
  rpc: async (_fn: string, args: Record<string, unknown>) => ({ data: args._user_id === CON_REDES, error: null }),
});

function deps(extra: Partial<DependenciasAviso> = {}): DependenciasAviso {
  return {
    crearCliente,
    env: (n) => env[n],
    ahora: () => 1_800_000_000,
    nuevoId: () => "aviso-0123456789abcdef",
    fetch: async (url, init) => {
      enviados.push({ url, cuerpo: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    },
    ...extra,
  };
}

const pedir = (cuerpo: unknown, secreto = SECRETO) =>
  new Request("https://x.supabase.co/functions/v1/rrss-embed-revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-rrss-revoke-secret": secreto },
    body: JSON.stringify(cuerpo),
  });

beforeAll(async () => {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publica = par.publicKey;
  env = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "servicio",
    RRSS_EMBED_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", par.privateKey)),
    RRSS_EMBED_KID: "clave-1",
    RRSS_EMBED_ISSUER: "https://x.supabase.co/functions/v1/rrss-embed-pass",
    RRSS_EMBED_BRAND_ID: BRAND,
    RRSS_EMBED_REVOKE_SECRET: SECRETO,
    RRSS_EMBED_REVOKE_URL: DESTINO,
  };
});

describe("rrss-embed-revoke", () => {
  it("avisa a rrss con un aviso firmado y verificable", async () => {
    enviados.length = 0;
    const res = await manejarAviso(pedir({ user_id: SIN_REDES }), deps());
    expect(res.status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.url).toBe(DESTINO);
    const [h, c, f] = enviados[0]!.cuerpo.notice.split(".");
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString("utf8"));
    expect(claims).toEqual({
      iss: env.RRSS_EMBED_ISSUER,
      aud: "rrss",
      sub: SIN_REDES,
      brand: BRAND,
      typ: "rrss-revoke",
      iat: 1_800_000_000,
      exp: 1_800_000_060,
      jti: "aviso-0123456789abcdef",
    });
    const valida = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publica,
      Buffer.from(f!, "base64url"),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valida).toBe(true);
  });

  it("sin el secreto (o con uno corto) no hace nada", async () => {
    enviados.length = 0;
    expect((await manejarAviso(pedir({ user_id: SIN_REDES }, "otro"), deps())).status).toBe(401);
    expect((await manejarAviso(pedir({ user_id: SIN_REDES }, ""), deps())).status).toBe(401);
    const corto = { ...env, RRSS_EMBED_REVOKE_SECRET: "corto" };
    expect((await manejarAviso(pedir({ user_id: SIN_REDES }, "corto"), deps({ env: (n) => corto[n] }))).status).toBe(401);
    expect(enviados).toHaveLength(0);
  });

  it("si aún tiene «Redes», no avisa", async () => {
    enviados.length = 0;
    expect((await manejarAviso(pedir({ user_id: CON_REDES }), deps())).status).toBe(409);
    expect(enviados).toHaveLength(0);
  });

  it("si rrss no lo acepta, 502 (la caducidad lo corta igual)", async () => {
    const res = await manejarAviso(
      pedir({ user_id: SIN_REDES }),
      deps({ fetch: async () => new Response("{}", { status: 500 }) }),
    );
    expect(res.status).toBe(502);
  });
});
