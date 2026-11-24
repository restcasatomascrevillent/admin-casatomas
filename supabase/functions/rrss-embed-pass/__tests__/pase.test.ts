// @vitest-environment node
/**
 * Edge Function rrss-embed-pass sin red: Auth y RPC de permisos simulados. El
 * pase sale firmado con ES256 (se comprueba con la clave pública, como hará
 * rrss), con el nivel de Redes de cada usuario, 60 s de vida y un jti único;
 * sin sesión, sin permiso o sin configuración no sale nada.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { leerConfig, manejarPase, VIDA_PASE_SEGUNDOS, type DependenciasPase } from "../pase";

const BRAND = "b141a5b7-65c1-4d79-acc8-a18ac6a5c84b";
const PANEL = "https://admin-casatomas-git-staging-casa-tomas.vercel.app";
const USUARIOS: Record<string, { id: string; email: string; nombre?: string; super?: boolean; redes?: "view" | "edit" }> = {
  "jwt-super": { id: "11111111-1111-4111-8111-111111111111", email: "dueno@ct.test", super: true },
  "jwt-editar": { id: "22222222-2222-4222-8222-222222222222", email: "sala@ct.test", nombre: "Sala", redes: "edit" },
  "jwt-ver": { id: "33333333-3333-4333-8333-333333333333", email: "camarero@ct.test", redes: "view" },
  "jwt-nada": { id: "44444444-4444-4444-8444-444444444444", email: "cocina@ct.test" },
};

let privada: JsonWebKey;
let publica: CryptoKey;
let env: Record<string, string>;

const crearCliente = () => ({
  auth: {
    getUser: async (token?: string) => {
      const u = token ? USUARIOS[token] : undefined;
      return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "x" } };
    },
    admin: {
      getUserById: async (id: string) => {
        const u = Object.values(USUARIOS).find((x) => x.id === id);
        return { data: { user: u ? { id: u.id, user_metadata: u.nombre ? { display_name: u.nombre } : {} } : null }, error: null };
      },
    },
  },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
    if (fn === "is_super_admin") return { data: !!u?.super, error: null };
    if (fn === "has_section_permission") {
      if (u?.super) return { data: true, error: null };
      const ok = args._permission === "edit" ? u?.redes === "edit" : !!u?.redes;
      return { data: args._section === "redes" && ok, error: null };
    }
    return { data: null, error: { message: "desconocida" } };
  },
});

function deps(extra: Partial<DependenciasPase> = {}): DependenciasPase {
  return { crearCliente, env: (n) => env[n], ahora: () => 1_800_000_000, ...extra };
}

/** Huella (SHA-256 en base64url) del secreto del iframe. */
const CNF = "a".repeat(43);
const pedir = (token?: string, origen = PANEL, cuerpo: unknown = { cnf: CNF }) =>
  new Request("https://x.supabase.co/functions/v1/rrss-embed-pass", {
    method: "POST",
    headers: { Origin: origen, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });

function leer(pase: string) {
  const [h, c, f] = pase.split(".");
  const json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  return { cabecera: json(h!), claims: json(c!), entrada: `${h}.${c}`, firma: Buffer.from(f!, "base64url") };
}

beforeAll(async () => {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  privada = await crypto.subtle.exportKey("jwk", par.privateKey);
  publica = par.publicKey;
  env = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "servicio",
    RRSS_EMBED_PRIVATE_JWK: JSON.stringify(privada),
    RRSS_EMBED_KID: "clave-1",
    RRSS_EMBED_ISSUER: "https://x.supabase.co/functions/v1/rrss-embed-pass",
    RRSS_EMBED_BRAND_ID: BRAND,
    RRSS_EMBED_PANEL_ORIGINS: PANEL,
  };
});

describe("rrss-embed-pass", () => {
  it("emite un pase ES256 verificable con la clave pública, para la marca y con 60 s de vida", async () => {
    const res = await manejarPase(pedir("jwt-editar"), deps({ nuevoId: () => "jti-0123456789abcdef" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PANEL);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { pase, caducaEn } = await res.json();
    expect(caducaEn).toBe(VIDA_PASE_SEGUNDOS);
    const { cabecera, claims, entrada, firma } = leer(pase);
    expect(cabecera).toEqual({ alg: "ES256", typ: "JWT", kid: "clave-1" });
    expect(claims).toEqual({
      iss: env.RRSS_EMBED_ISSUER,
      aud: "rrss",
      sub: USUARIOS["jwt-editar"]!.id,
      brand: BRAND,
      role: "editar",
      // El nombre visible, nunca el correo.
      name: "Sala",
      iat: 1_800_000_000,
      exp: 1_800_000_060,
      jti: "jti-0123456789abcdef",
      // Ligado al iframe que lo pidió (prueba de posesión).
      cnf: CNF,
    });
    const valida = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publica,
      firma,
      new TextEncoder().encode(entrada),
    );
    expect(valida).toBe(true);
    // La clave privada no sale nunca.
    expect(pase).not.toContain(String(privada.d));
  });

  it("el nivel es el de Redes: super admin, editar o ver", async () => {
    const nivel = async (token: string) => leer((await (await manejarPase(pedir(token), deps())).json()).pase).claims.role;
    expect(await nivel("jwt-super")).toBe("superadmin");
    expect(await nivel("jwt-ver")).toBe("ver");
  });

  it("cada pase tiene su propio jti", async () => {
    const a = leer((await (await manejarPase(pedir("jwt-ver"), deps())).json()).pase).claims.jti;
    const b = leer((await (await manejarPase(pedir("jwt-ver"), deps())).json()).pase).claims.jti;
    expect(a).not.toBe(b);
  });

  it("sin la huella del iframe no hay pase (no se puede sacar uno para usarlo fuera)", async () => {
    expect((await manejarPase(pedir("jwt-editar", PANEL, {}), deps())).status).toBe(400);
    expect((await manejarPase(pedir("jwt-editar", PANEL, { cnf: "corta" }), deps())).status).toBe(400);
  });

  it("sin nombre visible no se manda nada en su lugar (tampoco el correo)", async () => {
    const { claims } = leer((await (await manejarPase(pedir("jwt-ver"), deps())).json()).pase);
    expect(claims.name).toBeUndefined();
    expect(JSON.stringify(claims)).not.toContain("@");
  });

  it("sin sesión 401, sin permiso de Redes 403", async () => {
    expect((await manejarPase(pedir(), deps())).status).toBe(401);
    expect((await manejarPase(pedir("anon"), deps())).status).toBe(401);
    expect((await manejarPase(pedir("jwt-nada"), deps())).status).toBe(403);
  });

  it("sin configuración (o con una clave que no es EC P-256) no emite nada", async () => {
    expect((await manejarPase(pedir("jwt-super"), deps({ env: (n) => (n === "RRSS_EMBED_PRIVATE_JWK" ? undefined : env[n]) }))).status).toBe(503);
    expect(leerConfig((n) => (n === "RRSS_EMBED_BRAND_ID" ? "casa-tomas" : env[n]))).toBeNull();
    expect(leerConfig((n) => (n === "RRSS_EMBED_PRIVATE_JWK" ? JSON.stringify({ kty: "oct", k: "x" }) : env[n]))).toBeNull();
  });

  it("CORS solo para el panel; otros orígenes no reciben la cabecera", async () => {
    const res = await manejarPase(pedir("jwt-ver", "https://malo.test"), deps());
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const pre = await manejarPase(new Request("https://x", { method: "OPTIONS", headers: { Origin: PANEL } }), deps());
    expect(pre.status).toBe(204);
    expect((await manejarPase(new Request("https://x", { method: "GET" }), deps())).status).toBe(405);
  });
});
