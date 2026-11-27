// @vitest-environment node
/**
 * Edge Function rrss-menu sin red: Auth, permisos y datos del panel simulados, y rrss
 * simulado. El pedido sale firmado con ES256 (se comprueba con la pública, como hará
 * rrss), `typ: rrss-menu`, con las tapas LEÍDAS del panel (no las del navegador), la
 * hora de los ajustes y la clave de la semana; sin «Redes» con «Puede editar», sin
 * configurar o con la historia antigua ya publicada no sale nada.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  instantePublicacion,
  leerTapa,
  manejarMenu,
  menuDelDia,
  semanaDe,
  tapasDelPedido,
  type DatosPanel,
  type DependenciasMenu,
} from "../menu";

const BRAND = "b141a5b7-65c1-4d79-acc8-a18ac6a5c84b";
const PANEL = "https://admin-casatomas-git-staging-casa-tomas.vercel.app";
const DESTINO = "https://rrss.supabase.co/functions/v1/embed-session/menu";
const USUARIOS: Record<string, { id: string; super?: boolean; redes?: "view" | "edit" }> = {
  "jwt-super": { id: "11111111-1111-4111-8111-111111111111", super: true },
  "jwt-editar": { id: "22222222-2222-4222-8222-222222222222", redes: "edit" },
  "jwt-ver": { id: "33333333-3333-4333-8333-333333333333", redes: "view" },
};

let privada: JsonWebKey;
let publica: CryptoKey;
let env: Record<string, string>;

const crearCliente = () => ({
  auth: {
    getUser: async (token?: string) => {
      const u = token ? USUARIOS[token] : undefined;
      return u ? { data: { user: { id: u.id, email: null } }, error: null } : { data: { user: null }, error: { message: "x" } };
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

function datos(over: Partial<DatosPanel> = {}): DatosPanel {
  return {
    tapas: vi.fn(async () => ["Croquetas de jamón | 2,50 €", "Patatas bravas 3€", "  ", "Pulpo"]),
    tapasEnLaWeb: vi.fn(async () => true),
    ajustes: vi.fn(async () => ({ activa: true, hora: "12:00" })),
    turnos: vi.fn(async () => "20:30 y 22:00"),
    historiaAntiguaPublicada: vi.fn(async () => false),
    cancelarHistoriaAntigua: vi.fn(async () => undefined),
    ...over,
  };
}

// Martes 24/11/2026 a las 10:00 de Madrid.
const AHORA = new Date("2026-11-24T09:00:00.000Z");

function deps(extra: Partial<DependenciasMenu> = {}): DependenciasMenu & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: "created" }), { status: 200 }));
  return { crearCliente, env: (n) => env[n], ahoraFecha: () => AHORA, datos: datos(), fetch, ...extra } as never;
}

const pedir = (token?: string, cuerpo: unknown = { fecha: "2026-11-26" }) =>
  new Request("https://x.supabase.co/functions/v1/rrss-menu", {
    method: "POST",
    headers: { Origin: PANEL, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });

function leer(token: string) {
  const [h, c, f] = token.split(".");
  const j = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  return { cabecera: j(h!), claims: j(c!), entrada: `${h}.${c}`, firma: Buffer.from(f!, "base64url") };
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
    RRSS_EMBED_MENU_URL: DESTINO,
  };
});

describe("tapas del pedido", () => {
  it("lee nombre y precio de cada línea, sin comillas ni repetidas", () => {
    expect(leerTapa("Croquetas de jamón | 2,50 €")).toEqual({ name: "Croquetas de jamón", price: "2,50 €" });
    expect(leerTapa("Patatas bravas · 3,00€")).toEqual({ name: "Patatas bravas", price: "3,00 €" });
    expect(leerTapa("Patatas bravas 3€")).toEqual({ name: "Patatas bravas", price: "3 €" });
    expect(leerTapa('Tosta "de la casa"')).toEqual({ name: "Tosta de la casa" });
    expect(leerTapa("Pulpo a la gallega")).toEqual({ name: "Pulpo a la gallega" });
    expect(leerTapa("   ")).toBeNull();
    expect(tapasDelPedido(["Pulpo", "pulpo", "", "Bravas"])).toEqual([{ name: "Pulpo" }, { name: "Bravas" }]);
  });

  it("clave de la semana, título, fecha y hora de Madrid (con el cambio de hora)", () => {
    expect(semanaDe("2026-11-26")).toBe("2026-11-23");
    const m = menuDelDia({ dia: "2026-11-26", tapas: [{ name: "Pulpo" }], hora: "12:00", turnos: "20:30 y 22:00", ahora: AHORA });
    expect(m).toMatchObject({
      key: "tapas:2026-11-23",
      kind: "tapas",
      day: "2026-11-26",
      title: "Jueves de tapas",
      kicker: "26 de noviembre",
      footer: "Turnos 20:30 y 22:00",
      publish_at: "2026-11-26T11:00:00.000Z",
    });
    expect(instantePublicacion("2026-07-02", "12:00", new Date("2026-07-01T00:00:00Z")).toISOString()).toBe("2026-07-02T10:00:00.000Z");
    // Si la hora ya pasó, en 15 minutos.
    expect(instantePublicacion("2026-11-24", "08:00", AHORA).toISOString()).toBe("2026-11-24T09:15:00.000Z");
  });
});

describe("rrss-menu", () => {
  it("manda el pedido firmado con las tapas guardadas y cancela la historia antigua", async () => {
    const d = deps();
    const r = await manejarMenu(pedir("jwt-editar", { fecha: "2026-11-26", tapas: ["Inventada"] }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, estado: "enviada", programadaPara: "2026-11-26T11:00:00.000Z" });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DESTINO);
    const { request } = JSON.parse(String(init.body)) as { request: string };
    const { cabecera, claims, entrada, firma } = leer(request);
    expect(cabecera).toEqual({ alg: "ES256", typ: "JWT", kid: "clave-1" });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publica, firma, new TextEncoder().encode(entrada))).toBe(true);
    expect(claims).toMatchObject({ typ: "rrss-menu", role: "editar", sub: USUARIOS["jwt-editar"]!.id, brand: BRAND, aud: "rrss" });
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.cnf).toBeUndefined();
    // Las del panel, no las que mandó el navegador.
    expect(claims.menu.items).toEqual([
      { name: "Croquetas de jamón", price: "2,50 €" },
      { name: "Patatas bravas", price: "3 €" },
      { name: "Pulpo" },
    ]);
    expect(d.datos!.cancelarHistoriaAntigua).toHaveBeenCalledWith("2026-11-23");
  });

  it("sin «Puede editar» en Redes, sin sesión o sin configurar no sale nada", async () => {
    for (const [token, status] of [["jwt-ver", 403], [undefined, 401]] as const) {
      const d = deps();
      expect((await manejarMenu(pedir(token), d)).status).toBe(status);
      expect(d.fetch).not.toHaveBeenCalled();
    }
    const d = deps({ env: (n) => (n === "RRSS_EMBED_MENU_URL" ? "http://inseguro" : env[n]) });
    expect((await manejarMenu(pedir("jwt-super"), d)).status).toBe(503);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("no pide otra si la historia antigua ya salió; respeta el interruptor y la web", async () => {
    const vieja = deps({ datos: datos({ historiaAntiguaPublicada: vi.fn(async () => true) }) });
    expect((await manejarMenu(pedir("jwt-super"), vieja)).status).toBe(409);
    expect(vieja.fetch).not.toHaveBeenCalled();
    const apagada = deps({ datos: datos({ ajustes: vi.fn(async () => ({ activa: false, hora: "12:00" })) }) });
    expect(await (await manejarMenu(pedir("jwt-super"), apagada)).json()).toMatchObject({ estado: "desactivada" });
    const web = deps({ datos: datos({ tapasEnLaWeb: vi.fn(async () => false) }) });
    expect(await (await manejarMenu(pedir("jwt-super"), web)).json()).toMatchObject({ estado: "web-apagada" });
    const pasada = deps();
    expect(await (await manejarMenu(pedir("jwt-super", { fecha: "2026-11-20" }), pasada)).json()).toMatchObject({ estado: "pasada" });
    for (const d of [apagada, web, pasada]) expect(d.fetch).not.toHaveBeenCalled();
  });

  it("fecha no válida, sin tapas o demasiadas", async () => {
    expect((await manejarMenu(pedir("jwt-super", { fecha: "2026-02-30" }), deps())).status).toBe(400);
    expect((await manejarMenu(pedir("jwt-super"), deps({ datos: datos({ tapas: vi.fn(async () => null) }) }))).status).toBe(404);
    const trece = Array.from({ length: 13 }, (_, i) => `Tapa ${i}`);
    expect((await manejarMenu(pedir("jwt-super"), deps({ datos: datos({ tapas: vi.fn(async () => trece) }) }))).status).toBe(422);
  });

  it("si rrss dice que ya salió o no responde, lo dice y no cancela la antigua", async () => {
    const salio = deps({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: "published" } }), { status: 409 })) as never,
    });
    const r = await manejarMenu(pedir("jwt-super"), salio);
    expect(r.status).toBe(409);
    expect(salio.datos!.cancelarHistoriaAntigua).not.toHaveBeenCalled();
    const caido = deps({ fetch: vi.fn(async () => Promise.reject(new Error("red"))) as never });
    expect((await manejarMenu(pedir("jwt-super"), caido)).status).toBe(502);
    const igual = deps({ fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true, result: "unchanged" }))) as never });
    expect(await (await manejarMenu(pedir("jwt-super"), igual)).json()).toMatchObject({ estado: "sin-cambios" });
  });
});
