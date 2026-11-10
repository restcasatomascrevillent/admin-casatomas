// Permisos de Facturas en las Edge Functions (dueño, 06/11/2026):
//   procesar-factura  → subir con «Facturas · Subida» o «Editar»; con solo
//                       «Ver», no. Sustituir / añadir página: «Editar», o con
//                       Subida solo si la factura y el trabajo son suyos.
//   chat-facturas     → la IA de Facturas, solo con «Editar».
// Sin red: Supabase, OpenAI y Drive simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Permisos = Record<string, { view?: boolean; edit?: boolean }>;
  const USUARIOS: Record<string, { id: string; permisos: Permisos; superAdmin?: boolean }> = {
    "jwt-nada": { id: "10000000-0000-4000-8000-000000000001", permisos: { dashboard: { view: true } } },
    "jwt-ver": { id: "10000000-0000-4000-8000-000000000002", permisos: { facturas: { view: true } } },
    "jwt-subida": { id: "10000000-0000-4000-8000-000000000003", permisos: { facturas_subida: { view: true } } },
    "jwt-subida-ver": { id: "10000000-0000-4000-8000-000000000004", permisos: { facturas: { view: true }, facturas_subida: { view: true } } },
    "jwt-subida-flag": { id: "10000000-0000-4000-8000-000000000005", permisos: { facturas_subida: { edit: true } } },
    "jwt-edita": { id: "10000000-0000-4000-8000-000000000006", permisos: { facturas: { view: true, edit: true } } },
    "jwt-sa": { id: "10000000-0000-4000-8000-000000000007", permisos: {}, superAdmin: true },
    // Tipo «Albaranes» (10/11/2026): solo «Facturas · Solo fotos».
    "jwt-albaranes": { id: "10000000-0000-4000-8000-000000000008", permisos: { facturas_albaranes: { view: true } } },
    "jwt-albaranes-flag": { id: "10000000-0000-4000-8000-000000000009", permisos: { facturas_albaranes: { edit: true } } },
  };
  const SUBIDA = USUARIOS["jwt-subida"].id;
  const estado = {
    handlers: {} as Record<string, (req: Request) => Promise<Response>>,
    ultimo: null as ((req: Request) => Promise<Response>) | null,
    rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    lecturas: [] as string[],
    fetchs: [] as string[],
    // Tablas mínimas: de quién es cada documento y cada trabajo.
    facturas: [
      { id: 1, subido_por: SUBIDA },
      { id: 2, subido_por: "otra-persona" },
      { id: 3, subido_por: null },
    ] as Array<{ id: number; subido_por: string | null }>,
    trabajos: [
      { id: "t-mio", creado_por: SUBIDA, estado: "completado", documento_pendiente: null },
      { id: "t-otro", creado_por: "otra-persona", estado: "duplicado", documento_pendiente: null },
    ] as Array<Record<string, unknown>>,
    falloLectura: false,
  };
  const builder = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const filas = () => {
      const base = tabla === "facturas" ? estado.facturas : tabla === "ocr_trabajos" ? estado.trabajos : [];
      return base.filter((f) => Object.entries(filtros).every(([k, v]) => (f as Record<string, unknown>)[k] === v));
    };
    b.select = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.in = () => b;
    b.eq = (col: string, v: unknown) => { filtros[col] = v; return b; };
    b.maybeSingle = async () => {
      estado.lecturas.push(tabla);
      if (estado.falloLectura) return { data: null, error: { message: "column facturas.subido_por does not exist" } };
      return { data: filas()[0] ?? null, error: null };
    };
    b.single = b.maybeSingle;
    b.insert = async () => ({ error: null });
    b.update = () => ({ eq: async () => ({ error: null }) });
    b.then = (ok: (v: unknown) => unknown) => ok({ data: filas(), error: null });
    return b;
  };
  const usuarioDe = (token?: string | null) => (token ? USUARIOS[token.replace(/^Bearer\s+/i, "")] : undefined);
  const cliente = (_url?: string, _key?: string, opciones?: { global?: { headers?: { Authorization?: string } } }) => ({
    auth: {
      getUser: async (token?: string) => {
        const u = usuarioDe(token ?? opciones?.global?.headers?.Authorization);
        return u ? { data: { user: { id: u.id, email: "x@t" } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ fn, args });
      const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
      if (fn === "has_section_permission") {
        if (u?.superAdmin) return { data: true, error: null };
        const p = u?.permisos[args._section as string];
        return { data: args._permission === "edit" ? !!p?.edit : !!p?.view, error: null };
      }
      return { data: null, error: null };
    },
    from: (t: string) => builder(t),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no" } }), remove: async () => ({ error: null }) }) },
  });
  return { USUARIOS, estado, cliente, SUBIDA };
});

vi.mock("../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (f: unknown) => f,
  conAuditoriaDePeticion: (_n: string, _f: unknown, handler: unknown) => handler,
  registrarHerramientaChat: () => {},
}));
vi.mock("../_shared/registrar-uso-ia.ts", () => ({
  AcumuladorUso: class { sumar() {} },
  registrarUso: async () => {},
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: h.cliente }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.57.4", () => ({ createClient: h.cliente }));
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ejemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  OPENAI_API_KEY: "sk-prueba",
};

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] }, serve: (fn: (r: Request) => Promise<Response>) => { h.estado.ultimo = fn; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    h.estado.fetchs.push(String(url));
    return new Response(JSON.stringify({ error: "sin red en los tests" }), { status: 500 });
  }));
  for (const fn of ["procesar-factura", "chat-facturas"]) {
    await import(`../${fn}/index.ts`);
    h.estado.handlers[fn] = h.estado.ultimo!;
  }
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  h.estado.rpcs = [];
  h.estado.lecturas = [];
  h.estado.fetchs = [];
  h.estado.falloLectura = false;
});

function llamar(fn: string, token: string | undefined, body: unknown) {
  return h.estado.handlers[fn](new Request(`https://ejemplo.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
}

// `iniciar` con un trabajo_id mal formado: si pasa el permiso, contesta el validador (200, success:false).
const INICIAR_MAL = { modo: "iniciar", trabajo_id: "no-es-un-uuid" };
const sustituir = (factura_id: number, trabajo_id: string, modo = "sustituir") => ({ modo, factura_id, trabajo_id });

describe("procesar-factura · subir", () => {
  it.each([undefined, "jwt-falso"])("token %s → 401", async (token) => {
    expect((await llamar("procesar-factura", token, INICIAR_MAL)).status).toBe(401);
  });

  it.each(["jwt-nada", "jwt-ver"])("%s (sin Subida ni Editar; con solo «Ver» ya no se sube) → 403", async (token) => {
    const res = await llamar("procesar-factura", token, INICIAR_MAL);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/Facturas · Subida/) });
  });

  it.each(["jwt-subida", "jwt-subida-ver", "jwt-subida-flag", "jwt-edita", "jwt-sa"])("%s pasa el permiso de subir", async (token) => {
    const res = await llamar("procesar-factura", token, INICIAR_MAL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, error: "trabajo_id no es un UUID válido" });
  });

  it("comprueba Editar en Facturas y luego «Facturas · Subida» (can_view y can_edit)", async () => {
    await llamar("procesar-factura", "jwt-subida-flag", INICIAR_MAL);
    expect(h.estado.rpcs.map((r) => `${r.args._section}:${r.args._permission}`)).toEqual([
      "facturas:edit", "facturas_subida:view", "facturas_subida:edit",
    ]);
  });
});

describe("procesar-factura · usuario «Albaranes» (solo fotos)", () => {
  it.each(["jwt-albaranes", "jwt-albaranes-flag"])("%s pasa el permiso para crear el trabajo (modo iniciar)", async (token) => {
    const res = await llamar("procesar-factura", token, INICIAR_MAL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, error: "trabajo_id no es un UUID válido" });
  });

  it("comprueba «Solo fotos» la última (Editar y Subida antes)", async () => {
    await llamar("procesar-factura", "jwt-albaranes-flag", INICIAR_MAL);
    expect(h.estado.rpcs.map((r) => `${r.args._section}:${r.args._permission}`)).toEqual([
      "facturas:edit", "facturas_subida:view", "facturas_subida:edit", "facturas_albaranes:view", "facturas_albaranes:edit",
    ]);
  });

  it.each(["sustituir", "anadir_pagina"])("%s → 403 sin leer nada (ni sobre lo suyo)", async (modo) => {
    const res = await llamar("procesar-factura", "jwt-albaranes", sustituir(1, "t-mio", modo));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/Solo fotos/) });
    expect(h.estado.lecturas).toEqual([]);
    expect(h.estado.fetchs).toEqual([]);
  });

  it("el camino síncrono (que devuelve lo leído con sus importes) → 403 sin llamar a OpenAI", async () => {
    const res = await llamar("procesar-factura", "jwt-albaranes", {
      tipo: "AUTO",
      archivo: { nombre: "a.jpg", tipo: "image/jpeg", size: 3, contenido_base64: "AAAA" },
    });
    expect(res.status).toBe(403);
    expect(h.estado.fetchs).toEqual([]);
  });

  it("con «Facturas · Subida», el camino síncrono no se corta aquí", async () => {
    const res = await llamar("procesar-factura", "jwt-subida", { tipo: "AUTO", archivo: {} });
    expect(res.status).toBe(200);
    expect((await res.json()).error).not.toMatch(/Solo fotos/);
  });
});

describe("procesar-factura · sustituir o añadir página", () => {
  it.each(["sustituir", "anadir_pagina"])("%s: con Subida, sobre un documento de otro → 403 sin tocar nada", async (modo) => {
    const res = await llamar("procesar-factura", "jwt-subida", sustituir(2, "t-mio", modo));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/que hayas subido tú/) });
    expect(h.estado.fetchs).toEqual([]);
  });

  it("con Subida, documento histórico sin dueño → 403", async () => {
    expect((await llamar("procesar-factura", "jwt-subida", sustituir(3, "t-mio"))).status).toBe(403);
  });

  it("con Subida, documento suyo pero el trabajo nuevo es de otro → 403", async () => {
    expect((await llamar("procesar-factura", "jwt-subida", sustituir(1, "t-otro"))).status).toBe(403);
  });

  it("con Subida, documento y trabajo suyos → pasa (sigue al guardado)", async () => {
    const res = await llamar("procesar-factura", "jwt-subida", sustituir(1, "t-mio"));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.error).not.toMatch(/que hayas subido tú/);
    // El guardado ya lee el trabajo (no está pendiente): se para ahí, sin OpenAI.
    expect(cuerpo).toMatchObject({ success: false, error: expect.stringMatching(/ya no está pendiente/) });
  });

  it("si no se puede comprobar de quién es (sin la columna subido_por), falla cerrado → 403", async () => {
    h.estado.falloLectura = true;
    expect((await llamar("procesar-factura", "jwt-subida", sustituir(1, "t-mio"))).status).toBe(403);
  });

  it.each(["jwt-edita", "jwt-sa"])("%s (Editar) decide sobre documentos de otros sin mirar el dueño", async (token) => {
    const res = await llamar("procesar-factura", token, sustituir(2, "t-otro"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: false, error: expect.stringMatching(/ya no está pendiente/) });
    expect(h.estado.lecturas).not.toContain("facturas");
  });

  it("con solo «Ver», ni siquiera llega: 403 de subir", async () => {
    expect((await llamar("procesar-factura", "jwt-ver", sustituir(2, "t-otro"))).status).toBe(403);
  });
});

describe("esDocumentoPropio", () => {
  it("solo si la factura y el trabajo son del usuario", async () => {
    const { esDocumentoPropio } = await import("../procesar-factura/auth.ts");
    const sb = h.cliente();
    expect(await esDocumentoPropio(sb, 1, "t-mio", h.SUBIDA)).toBe(true);
    expect(await esDocumentoPropio(sb, 2, "t-mio", h.SUBIDA)).toBe(false);
    expect(await esDocumentoPropio(sb, 1, "t-otro", h.SUBIDA)).toBe(false);
    expect(await esDocumentoPropio(sb, 99, "t-mio", h.SUBIDA)).toBe(false);
    expect(await esDocumentoPropio({ from: () => { throw new Error("caído"); } }, 1, "t-mio", h.SUBIDA)).toBe(false);
  });
});

describe("chat-facturas · la IA solo con «Editar»", () => {
  it.each(["jwt-ver", "jwt-subida", "jwt-subida-ver", "jwt-nada"])("%s → 403 sin llamar a OpenAI", async (token) => {
    const res = await llamar("chat-facturas", token, { mensaje: "¿Cuánto gasté en octubre?", session_id: "s" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, error: "forbidden", respuesta: expect.stringMatching(/«Editar»/) });
    expect(h.estado.fetchs).toEqual([]);
    expect(h.estado.rpcs).toEqual([
      expect.objectContaining({ fn: "has_section_permission", args: expect.objectContaining({ _section: "facturas", _permission: "edit" }) }),
    ]);
  });

  it.each(["jwt-edita", "jwt-sa"])("%s pasa el permiso", async (token) => {
    const res = await llamar("chat-facturas", token, { mensaje: "", session_id: "s" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ respuesta: "No he recibido ninguna pregunta." });
  });

  it("sin token → 401", async () => {
    expect((await llamar("chat-facturas", undefined, { mensaje: "hola" })).status).toBe(401);
  });
});
