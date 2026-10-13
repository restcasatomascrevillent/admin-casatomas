/** Prueba el handler real con clientes en memoria: solo superadmins pueden crear usuarios. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("../../_shared/audit-client.ts", () => ({
  clienteConAuditoria: (factory: unknown) => factory,
  conAuditoriaDePeticion: (_name: string, _factory: unknown, handler: unknown) => handler,
}));
vi.mock("../../_shared/audit-auth.ts", () => ({
  ejecutarOperacionAuthAuditada: (_client: unknown, _actor: string, _operation: string, _subject: unknown, run: () => unknown) => run(),
}));

type Fila = Record<string, unknown>;
type Handler = (req: Request) => Promise<Response>;

const h = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  /** Usuario de cada cabecera Authorization (la sesión de quien llama). */
  sesiones: {} as Record<string, { id: string; email: string }>,
  /** is_admin(): rol 'admin' en user_roles. */
  admins: new Set<string>(),
  /** is_super_admin(): fila en super_admins. */
  superAdmins: new Set<string>(),
  /** RPC que devuelven error (para probar que falla cerrado). */
  rpcConError: new Set<string>(),
  /** RPC llamadas con la service role, en orden. */
  rpcs: [] as string[],
  /** Llamadas a auth.admin.createUser. */
  creados: [] as Array<Record<string, unknown>>,
  tablas: {} as Record<string, Array<Record<string, unknown>>>,
  fallo: "" as string,
  eliminados: [] as string[],
  bloqueados: [] as string[],
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, key: string, opciones?: { global?: { headers?: Record<string, string> } }) => {
    if (key !== "service-role-falsa") {
      // Cliente con el JWT de quien llama: solo se usa para auth.getUser().
      const token = opciones?.global?.headers?.Authorization ?? "";
      return {
        auth: {
          getUser: async () => {
            const user = h.sesiones[token];
            return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
          },
        },
      };
    }
    const tabla = (nombre: string) => (h.tablas[nombre] ??= []);
    return {
      rpc: async (fn: string, args: { _user_id: string }) => {
        h.rpcs.push(fn);
        if (h.rpcConError.has(fn)) return { data: null, error: { message: `${fn} no disponible` } };
        if (fn === "is_admin") return { data: h.admins.has(args._user_id), error: null };
        if (fn === "is_super_admin") return { data: h.superAdmins.has(args._user_id), error: null };
        return { data: null, error: { message: `rpc inesperada: ${fn}` } };
      },
      auth: {
        admin: {
          createUser: async (datos: { email: string }) => {
            const user = { id: `nuevo-${h.creados.length + 1}`, email: datos.email };
            h.creados.push({ ...datos, id: user.id });
            // Lo que hace el trigger on_auth_user_created (handle_new_user_role).
            tabla("user_roles").push({ user_id: user.id, role: "staff" });
            tabla("user_permissions").push({ user_id: user.id, section_key: "dashboard", can_view: true, can_edit: false });
            return { data: { user }, error: null };
          },
          deleteUser: async (id: string) => {
            if (h.fallo === "cancelar") return { error: { message: "fallo cancelación" } };
            h.eliminados.push(id);
            for (const nombre of Object.keys(h.tablas)) h.tablas[nombre] = h.tablas[nombre].filter(f => f.user_id !== id);
            return { error: null };
          },
          updateUserById: async (id: string, atributos: { ban_duration: string }) => {
            if (atributos.ban_duration) h.bloqueados.push(id);
            return { error: null };
          },
        },
      },
      from: (nombre: string) => ({
        upsert: async (fila: Record<string, unknown>, opciones?: { onConflict?: string }) => {
          if (h.fallo === "role") return { data: null, error: { message: "fallo rol" } };
          const col = opciones?.onConflict ?? "id";
          const filas = tabla(nombre);
          const i = filas.findIndex((f) => f[col] === fila[col]);
          if (i >= 0) filas[i] = { ...filas[i], ...fila };
          else filas.push({ ...fila });
          return { data: null, error: null };
        },
        insert: async (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (h.fallo === "insert" || h.fallo === "cancelar") return { data: null, error: { message: "fallo permisos" } };
          tabla(nombre).push(...(Array.isArray(v) ? v : [v]));
          return { data: null, error: null };
        },
        delete: () => ({
          eq: async (col: string, valor: unknown) => {
            if (h.fallo === "delete") return { data: null, error: { message: "fallo preparación" } };
            h.tablas[nombre] = tabla(nombre).filter((f) => f[col] !== valor);
            return { data: null, error: null };
          },
        }),
      }),
    };
  },
}));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  SUPABASE_ANON_KEY: "anon-falsa",
  SUPER_ADMIN_EMAILS: "",
};

const CON_EDICION = [
  { section_key: "dashboard", can_view: true, can_edit: false },
  { section_key: "reservas", can_view: true, can_edit: true },
];
const SIN_EDICION = [
  { section_key: "dashboard", can_view: true, can_edit: false },
  { section_key: "reservas", can_view: true, can_edit: false },
];

function sembrar() {
  h.sesiones = {
    "Bearer super": { id: "super-1", email: "dueno@correo.test" },
    "Bearer admin": { id: "admin-1", email: "encargado@correo.test" },
    "Bearer staff": { id: "staff-1", email: "camarero@staff.local" },
  };
  h.admins = new Set(["super-1", "admin-1"]);
  h.superAdmins = new Set(["super-1"]);
  h.rpcConError = new Set();
  h.rpcs = [];
  h.creados = [];
  h.tablas = {};
  h.fallo = ""; h.eliminados = []; h.bloqueados = [];
}

async function crear(token: string | null, permissions: unknown, extra: Fila = {}) {
  const handler = h.handler;
  if (!handler) throw new Error("index.ts no ha registrado su handler");
  const res = await handler(
    new Request("https://proyecto.supabase.co/functions/v1/admin-create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
      body: JSON.stringify({ username: "camarero2", password: "prueba-123", role: "staff", permissions, ...extra }),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila };
}

const permisosDe = (userId: string) => (h.tablas.user_permissions ?? []).filter((f) => f.user_id === userId);

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (k: string) => ENV[k] },
    serve: (handler: Handler) => {
      h.handler = handler;
    },
  });
  sembrar();
  await import("../index.ts");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sembrar();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin-create-user · gestión exclusiva del superadmin", () => {
  it("super admin (tabla super_admins) con can_edit: se crea y la edición se guarda tal cual", async () => {
    const r = await crear("Bearer super", CON_EDICION);

    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ success: true, userId: "nuevo-1", username: "camarero2", email: "camarero2@staff.local" });
    expect(permisosDe("nuevo-1")).toEqual([
      { user_id: "nuevo-1", section_key: "dashboard", can_view: true, can_edit: false },
      { user_id: "nuevo-1", section_key: "reservas", can_view: true, can_edit: true },
    ]);
    expect(h.rpcs).toEqual(["is_super_admin"]);
  });

  it("admin que NO es super admin con can_edit: 403 con mensaje claro y no se crea nada", async () => {
    const r = await crear("Bearer admin", CON_EDICION);

    expect(r.status).toBe(403);
    expect(r.cuerpo.error).toMatch(/^Solo un super admin puede crear usuarios/);
    expect(h.creados).toHaveLength(0);
    expect(h.tablas).toEqual({});
  });

  it.each([["true"], ["t"], ["yes"], [1]])(
    "…también si can_edit llega como %j (Postgres lo guardaría como true)",
    async (valor) => {
      const r = await crear("Bearer admin", [{ section_key: "reservas", can_view: true, can_edit: valor }]);

      expect(r.status).toBe(403);
      expect(h.creados).toHaveLength(0);
    },
  );

  it("un admin normal tampoco puede crear usuarios sin edición", async () => {
    const r = await crear("Bearer admin", SIN_EDICION, { role: "manager" });
    expect(r.status).toBe(403);
    expect(h.creados).toHaveLength(0);
    expect(h.tablas).toEqual({});
    expect(h.rpcs).toEqual(["is_super_admin"]);
  });

  it("can_edit null o ausente cuenta como «sin edición»", async () => {
    const r = await crear("Bearer super", [
      { section_key: "dashboard", can_view: true, can_edit: null },
      { section_key: "reservas", can_view: true },
    ]);

    expect(r.status).toBe(200);
    expect(h.creados).toHaveLength(1);
    expect(h.rpcs).toEqual(["is_super_admin"]);
  });

  it("sin permisos (lista vacía o ausente): igual que hoy, el usuario se queda sin permisos", async () => {
    expect((await crear("Bearer super", [])).status).toBe(200);
    expect(permisosDe("nuevo-1")).toEqual([]);

    expect((await crear("Bearer super", undefined, { username: "otro" })).status).toBe(200);
    expect(permisosDe("nuevo-2")).toEqual([]);
  });

  it("si no se puede comprobar si es super admin y pide edición: 500 y no se crea nada (falla cerrado)", async () => {
    h.rpcConError.add("is_super_admin");

    const r = await crear("Bearer super", CON_EDICION);
    expect(r.status).toBe(500);
    expect(r.cuerpo).toEqual({ error: "Error verificando permisos" });
    expect(h.creados).toHaveLength(0);

    // Sin edición también debe comprobarse: no se crea nada.
    expect((await crear("Bearer super", SIN_EDICION)).status).toBe(500);
  });

  it("un usuario sin privilegios recibe 403 antes de mirar los permisos", async () => {
    const r = await crear("Bearer staff", CON_EDICION);

    expect(r.status).toBe(403);
    expect(r.cuerpo).toEqual({ error: "Solo un super admin puede crear usuarios" });
    expect(h.rpcs).toEqual(["is_super_admin"]);
    expect(h.creados).toHaveLength(0);
  });

  it("sin sesión o con un token no válido: 401 como hoy", async () => {
    expect((await crear(null, CON_EDICION)).status).toBe(401);
    expect((await crear("Bearer caducado", CON_EDICION)).status).toBe(401);
    expect(h.creados).toHaveLength(0);
  });
});

describe("super admin por SUPER_ADMIN_EMAILS (sin fila en super_admins)", () => {
  it("también puede conceder edición, como en admin-set-super-admin", async () => {
    const original = h.handler;
    try {
      vi.resetModules();
      ENV.SUPER_ADMIN_EMAILS = " socio@correo.test , otro@correo.test";
      await import("../index.ts");
      h.sesiones["Bearer socio"] = { id: "socio-1", email: "Socio@Correo.test" };

      const r = await crear("Bearer socio", CON_EDICION);

      expect(r.status).toBe(200);
      expect(permisosDe("nuevo-1")).toContainEqual({ user_id: "nuevo-1", section_key: "reservas", can_view: true, can_edit: true });
      expect(h.rpcs).toEqual(["is_super_admin"]);
    } finally {
      ENV.SUPER_ADMIN_EMAILS = "";
      h.handler = original;
    }
  });
});

describe("Alta · no anuncia éxito ni deja una cuenta incompleta accesible", () => {
  it.each(["role", "delete", "insert"])("cancela el usuario nuevo si falla %s", async fallo => {
    h.fallo = fallo;
    const r = await crear("Bearer super", CON_EDICION);
    expect(r.status).toBe(500);
    expect(r.cuerpo.success).toBeUndefined();
    expect(r.cuerpo.error).toMatch(/cancelado el alta/);
    expect(h.eliminados).toEqual(["nuevo-1"]);
    expect(permisosDe("nuevo-1")).toEqual([]);
  });
  it("bloquea la cuenta recién creada si no se puede cancelar el alta", async () => {
    h.fallo = "cancelar";
    const r = await crear("Bearer super", CON_EDICION);
    expect(r.status).toBe(500);
    expect(r.cuerpo.error).toMatch(/ha quedado bloqueado/);
    expect(h.bloqueados).toEqual(["nuevo-1"]);
  });
  it.each([{ role: "root" }, { password: 123456 }, { username: ".." }, { permissions: "todos" }, { permissions: [{ section_key: "reservas", can_view: "true" }] }, { permissions: [CON_EDICION[0], CON_EDICION[0]] }])("valida antes de crear: %j", async extra => {
    expect((await crear("Bearer super", CON_EDICION, extra)).status).toBe(400);
    expect(h.creados).toEqual([]);
  });
  it("editar implica ver aunque el payload indique lo contrario", async () => {
    const r = await crear("Bearer super", [{ section_key: "reservas", can_view: false, can_edit: true }]);
    expect(r.status).toBe(200);
    expect(permisosDe("nuevo-1")).toEqual([{ user_id: "nuevo-1", section_key: "reservas", can_view: true, can_edit: true }]);
  });
});
