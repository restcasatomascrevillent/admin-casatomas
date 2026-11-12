// @vitest-environment node
/**
 * Edge Function facturas-original sin red: Supabase (Auth, permiso y la fila
 * de facturas) y Google (token y descarga) simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_PRIVADA, idDriveDeUrl, manejarOriginal } from "../original.ts";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";

const SB = "https://sfonaclosuafvlhutkon.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.firmaDelUsuario123";
const ID_DRIVE = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
const DRIVE_URL = `https://drive.google.com/file/d/${ID_DRIVE}/view?usp=drivesdk`;
const SECRETO = "secretoDeGoogle987";
const REFRESH = "1//refreshTokenDeGoogle";
const TOKEN = "ya29.tokenDeAccesoDeGoogle";
const ENV: Record<string, string> = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: "clave-publica",
  SUPABASE_SERVICE_ROLE_KEY: "clave-servicio",
  GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: SECRETO,
  GOOGLE_REFRESH_TOKEN: REFRESH,
};
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

interface Escenario {
  usuario?: boolean;
  permiso?: boolean;
  fila?: Record<string, unknown> | null;
  errorFila?: boolean;
  drive?: { estado?: number; tipo?: string; tokenFalla?: boolean };
}

function montar(e: Escenario = {}) {
  const permisos: Array<Record<string, unknown>> = [];
  const lecturas: Array<{ tabla: string; clave: string; auth?: string; filtro?: [string, unknown] }> = [];
  const crearCliente = vi.fn((_url: string, clave: string, opciones?: { global?: { headers?: Record<string, string> } }) => ({
    auth: {
      getUser: async () => (e.usuario === false ? { data: { user: null }, error: { message: "jwt" } } : { data: { user: { id: "usuario-1", email: "u@x" } }, error: null }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      permisos.push({ fn, ...args });
      return { data: e.permiso ?? true, error: null };
    },
    from: (tabla: string) => {
      const l: (typeof lecturas)[number] = { tabla, clave, auth: opciones?.global?.headers?.Authorization };
      lecturas.push(l);
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          l.filtro = [col, v];
          return q;
        },
        maybeSingle: async () =>
          e.errorFila ? { data: null, error: { message: "fallo" } } : { data: e.fila === undefined ? { id: 7, drive_url: DRIVE_URL } : e.fila, error: null },
      };
      return q;
    },
  }));
  const google: string[] = [];
  const fetchFalso = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    google.push(url);
    if (url === "https://oauth2.googleapis.com/token") {
      if (e.drive?.tokenFalla) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3599, scope: "https://www.googleapis.com/auth/drive" }), { status: 200 });
    }
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    const estado = e.drive?.estado ?? 200;
    if (estado !== 200) return new Response(JSON.stringify({ error: { message: "File not found" } }), { status: estado });
    return new Response(BYTES, { status: 200, headers: { "Content-Type": e.drive?.tipo ?? "image/jpeg" } });
  });
  return { deps: { crearCliente, env: (n: string) => ENV[n], fetch: fetchFalso as unknown as typeof fetch }, permisos, lecturas, google };
}

const pedir = (id: string | null = "7", auth: string | null = `Bearer ${JWT}`, metodo = "GET") =>
  new Request(`${SB}/functions/v1/facturas-original${id === null ? "" : `?id=${id}`}`, {
    method: metodo,
    headers: auth ? { Authorization: auth } : {},
  });

async function textoCompleto(r: Response) {
  return JSON.stringify([...r.headers.entries()]) + (await r.clone().text());
}

beforeEach(() => olvidarTokenDrive());

describe("Edge Function facturas-original", () => {
  it("devuelve los bytes del original con caché privada, leyendo la fila como el usuario", async () => {
    const m = montar();
    const r = await manejarOriginal(pedir(), m.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe(CACHE_PRIVADA);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES);
    // Permiso: «Ver» en Facturas, con el id del usuario verificado.
    expect(m.permisos).toEqual([{ fn: "has_section_permission", _user_id: "usuario-1", _section: "facturas", _permission: "view" }]);
    // La fila se lee con la clave pública y el JWT del usuario (RLS), por id.
    expect(m.lecturas).toEqual([{ tabla: "facturas", clave: "clave-publica", auth: `Bearer ${JWT}`, filtro: ["id", 7] }]);
    // Y el id de Drive sale de drive_url.
    expect(m.google.at(-1)).toContain(`/drive/v3/files/${ID_DRIVE}?alt=media`);
  });

  it("PDF también", async () => {
    const r = await manejarOriginal(pedir(), montar({ drive: { tipo: "application/pdf" } }).deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
  });

  it("CORS: OPTIONS responde sin pedir nada", async () => {
    const m = montar();
    const r = await manejarOriginal(pedir("7", null, "OPTIONS"), m.deps);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(m.deps.crearCliente).not.toHaveBeenCalled();
  });

  it("401 sin sesión y 403 sin Facturas, sin tocar Google", async () => {
    const a = montar();
    expect((await manejarOriginal(pedir("7", null), a.deps)).status).toBe(401);
    const b = montar({ usuario: false });
    expect((await manejarOriginal(pedir(), b.deps)).status).toBe(401);
    const c = montar({ permiso: false });
    expect((await manejarOriginal(pedir(), c.deps)).status).toBe(403);
    expect([...a.google, ...b.google, ...c.google]).toHaveLength(0);
  });

  it("400 con un id que no es un número positivo; 405 con otro método", async () => {
    for (const id of [null, "", "abc", "-3", "1.5", "0"]) {
      expect((await manejarOriginal(pedir(id), montar().deps)).status).toBe(400);
    }
    expect((await manejarOriginal(pedir("7", `Bearer ${JWT}`, "POST"), montar().deps)).status).toBe(405);
  });

  it("404 si la factura no existe o RLS no la deja ver, y si no tiene Drive", async () => {
    expect((await manejarOriginal(pedir(), montar({ fila: null }).deps)).status).toBe(404);
    for (const drive_url of [null, "https://example.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view", "http://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz"]) {
      const m = montar({ fila: { id: 7, drive_url } });
      const r = await manejarOriginal(pedir(), m.deps);
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ sinDrive: true });
      expect(m.google).toHaveLength(0);
    }
  });

  it("503 si no se puede leer la fila o faltan los secretos de Google", async () => {
    expect((await manejarOriginal(pedir(), montar({ errorFila: true }).deps)).status).toBe(503);
    const m = montar();
    const r = await manejarOriginal(pedir(), { ...m.deps, env: (n: string) => (n === "GOOGLE_REFRESH_TOKEN" ? undefined : ENV[n]) });
    expect(r.status).toBe(503);
    expect(m.google).toHaveLength(0);
  });

  it("errores de Google: 404 si Drive no lo encuentra, 503 sin token, 502 si falla; nunca filtra secretos", async () => {
    const casos: Array<[Escenario["drive"], number]> = [
      [{ estado: 404 }, 404],
      [{ estado: 403 }, 404],
      [{ tokenFalla: true }, 503],
      [{ estado: 500 }, 502],
      [{ estado: 429 }, 429],
    ];
    for (const [drive, estado] of casos) {
      olvidarTokenDrive();
      const r = await manejarOriginal(pedir(), montar({ drive }).deps);
      expect(r.status).toBe(estado);
      const todo = await textoCompleto(r);
      for (const s of [TOKEN, SECRETO, REFRESH]) expect(todo).not.toContain(s);
    }
  });

  it("415 si el original no es imagen ni PDF (p. ej. SVG o HTML)", async () => {
    for (const tipo of ["image/svg+xml", "text/html", "application/octet-stream"]) {
      expect((await manejarOriginal(pedir(), montar({ drive: { tipo } }).deps)).status).toBe(415);
    }
  });
});

describe("idDriveDeUrl", () => {
  it("saca el id de las formas habituales y rechaza lo demás", () => {
    expect(idDriveDeUrl(DRIVE_URL)).toBe(ID_DRIVE);
    expect(idDriveDeUrl(`https://drive.google.com/open?id=${ID_DRIVE}`)).toBe(ID_DRIVE);
    expect(idDriveDeUrl(`https://docs.google.com/document/d/${ID_DRIVE}/edit`)).toBe(ID_DRIVE);
    expect(idDriveDeUrl(`https://drive.google.com.evil.com/file/d/${ID_DRIVE}`)).toBeNull();
    expect(idDriveDeUrl("https://drive.google.com/drive/folders")).toBeNull();
    expect(idDriveDeUrl(42)).toBeNull();
  });
});
