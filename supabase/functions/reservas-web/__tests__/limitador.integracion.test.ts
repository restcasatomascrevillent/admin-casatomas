/**
 * CT-REM-FN-07 · Limitador de POST /reservas-web/crear, contra el index.ts
 * REAL con la BD en memoria (bdFalsa.ts) y las RPC del limitador simuladas
 * con la MISMA semántica que la migración 20261030150000 (la semántica SQL
 * se prueba en PGlite: scripts/test-abuso-limites.mjs).
 *
 *   · N+1 solicitudes de una IP -> 429 sin fila ni correo.
 *   · La RPC del limitador falla -> 503 sin efecto (fail-closed).
 *   · Segundo rechazo a la misma dirección en 24 h -> no se envía correo.
 *   · La reserva válida sigue dando 201 (contrato).
 *   · La IP viaja solo como HMAC y no se puede esquivar con X-Forwarded-For.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila, type LimitadorFalso } from "./bdFalsa";
import { hashIp, ipCliente, puedeEnviarCorreoRechazo, reservarCupoCrear } from "../limitador";

vi.mock("https://deno.land/std@0.190.0/http/server.ts", async () => {
  const { estadoPrueba: estado } = await import("./bdFalsa");
  return {
    serve: (h: (req: Request) => Promise<Response>) => {
      estado().handler = h;
    },
  };
});
vi.mock("https://esm.sh/@supabase/supabase-js@2", async () => {
  const { crearClienteFalso } = await import("./bdFalsa");
  return { createClient: crearClienteFalso };
});
vi.mock("https://esm.sh/resend@2.0.0", async () => {
  const { estadoPrueba: estado } = await import("./bdFalsa");
  return {
    Resend: class {
      emails = {
        send: async (p: { from?: string; to: string[]; subject: string; html: string }) => {
          estado().correos.push(p);
          return { data: { id: "re_prueba" }, error: null };
        },
      };
    },
  };
});

const CONTRATO = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "supabase/functions/reservas-web/__tests__/contrato/reserva-web-crear.contrato.json"), "utf8"),
) as { casos: Record<string, { cuerpo: Fila }> };
const VALIDA = CONTRATO.casos.con_newsletter.cuerpo;
// Más comensales que el máximo (12): rechazo `grupo_grande` con correo al email del cuerpo.
const GRUPO_GRANDE: Fila = { ...VALIDA, numero_comensales: 50, email: "victima@example.com" };

const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  RESEND_API_KEY: "re_falsa",
  RESEND_FROM_EMAIL: "Casa Tomás <reservas@correo.test>",
};
const URL_FUNCION = "https://proyecto.supabase.co/functions/v1/reservas-web";
const AHORA = new Date("2026-10-01T08:00:00.000Z");

let db: BaseFalsa;

function sembrar() {
  db = new BaseFalsa();
  estadoPrueba().db = db;
  estadoPrueba().correos = [];
  db.tabla("configuracion_reservas").push({
    id: "cfg-1",
    max_comensales_por_reserva: 12,
    min_comensales_por_reserva: 1,
    max_reservas_por_telefono_dia: 2,
    max_reservas_por_email_dia: 2,
    dias_max_antelacion: 60,
    minutos_corte_antes_servicio: 60,
    telefono_obligatorio: false,
    email_obligatorio: false,
    auto_confirmar: false,
  });
  db.tabla("configuracion_turnos").push(
    { id: "turno-comida", nombre_periodo: "Comida", hora_inicio: "13:00:00", hora_fin: "16:00:00", intervalo_base_minutos: 60, activo: true, espacio_id: null, dias_semana: null },
    { id: "turno-cena", nombre_periodo: "Cena", hora_inicio: "20:00:00", hora_fin: "23:00:00", intervalo_base_minutos: 60, activo: true, espacio_id: null, dias_semana: null },
  );
  db.tabla("espacios_reserva").push(
    { id: "sala-comedor", nombre: "Comedor", capacidad_maxima: 80, activa: true, caracteristicas: { marca: "casa_tomas" } },
    { id: "sala-terraza", nombre: "Terraza", capacidad_maxima: 70, activa: true, caracteristicas: {} },
  );
}

/** Doble con la semántica de la migración: cupo por ip_hash y 1 correo por dirección cada 24 h. */
function instalarLimitador(maxPorIp: number, opciones: { cupoFalla?: boolean; correoFalla?: boolean } = {}): LimitadorFalso {
  const porIp = new Map<string, number>();
  const correos = new Set<string>();
  const lim: LimitadorFalso = {
    llamadas: [],
    cupo(ipHash) {
      if (opciones.cupoFalla) return { data: null, error: { message: "function reservas_web_reservar_cupo does not exist" } };
      const n = porIp.get(ipHash) ?? 0;
      if (n >= maxPorIp) return { data: { permitido: false, motivo: "max_ip_hora" }, error: null };
      porIp.set(ipHash, n + 1);
      return { data: { permitido: true }, error: null };
    },
    correo(email) {
      if (opciones.correoFalla) return { data: null, error: { message: "timeout" } };
      const clave = email.trim().toLowerCase();
      if (correos.has(clave)) return { data: false, error: null };
      correos.add(clave);
      return { data: true, error: null };
    },
  };
  (globalThis as unknown as { __limitadorFalso?: LimitadorFalso }).__limitadorFalso = lim;
  return lim;
}

async function crear(body: Fila, cabeceras: Record<string, string> = { "cf-connecting-ip": "203.0.113.10" }) {
  const h = estadoPrueba().handler;
  if (!h) throw new Error("index.ts no ha registrado su handler");
  const res = await h(
    new Request(`${URL_FUNCION}/crear`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(body),
    }),
  );
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null };
}

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
  vi.stubGlobal("fetch", async (url: unknown) => {
    throw new Error(`fetch inesperado en un test: ${String(url)}`);
  });
  sembrar();
  await import("../index.ts");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sembrar();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as unknown as { __limitadorFalso?: LimitadorFalso }).__limitadorFalso;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("limitador por IP en /crear", () => {
  it("N+1 solicitudes de una IP: la última da 429 sin fila, sin solicitud y sin correo", async () => {
    instalarLimitador(2);
    expect((await crear(VALIDA)).status).toBe(201);
    expect((await crear({ ...VALIDA, hora: "14:00" })).status).toBe(201);
    const escriturasAntes = db.escrituras().length;
    const reservasAntes = db.tabla("reservas").length;

    const r = await crear(GRUPO_GRANDE);

    expect(r.status).toBe(429);
    expect(r.cuerpo).toEqual({
      ok: false,
      error: "demasiadas_solicitudes",
      motivo: "demasiadas_solicitudes",
      mensaje: expect.stringContaining("966 10 78 87"),
    });
    expect(db.escrituras()).toHaveLength(escriturasAntes);
    expect(db.tabla("reservas")).toHaveLength(reservasAntes);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("no se esquiva rotando la primera posición de X-Forwarded-For", async () => {
    const lim = instalarLimitador(1);
    const a = await crear(VALIDA, { "x-forwarded-for": "1.1.1.1, 198.51.100.7" });
    const b = await crear({ ...VALIDA, hora: "14:00" }, { "x-forwarded-for": "2.2.2.2, 198.51.100.7" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(429);
    const hashes = lim.llamadas.filter((l) => l.nombre === "reservas_web_reservar_cupo").map((l) => l.args.p_ip_hash);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("otra IP tiene su propio cupo", async () => {
    instalarLimitador(1);
    expect((await crear(VALIDA, { "cf-connecting-ip": "203.0.113.1" })).status).toBe(201);
    expect((await crear({ ...VALIDA, hora: "14:00" }, { "cf-connecting-ip": "203.0.113.2" })).status).toBe(201);
  });

  it("la IP solo viaja como HMAC hex, nunca en claro", async () => {
    const lim = instalarLimitador(5);
    await crear(VALIDA, { "cf-connecting-ip": "203.0.113.55" });
    const [llamada] = lim.llamadas;
    expect(llamada.nombre).toBe("reservas_web_reservar_cupo");
    expect(Object.keys(llamada.args)).toEqual(["p_ip_hash"]);
    expect(String(llamada.args.p_ip_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(lim.llamadas)).not.toContain("203.0.113.55");
  });

  it("si la RPC del limitador falla: 503 y ningún efecto (fail-closed)", async () => {
    instalarLimitador(10, { cupoFalla: true });
    const r = await crear(GRUPO_GRANDE);
    expect(r.status).toBe(503);
    expect(r.cuerpo).toEqual({ ok: false, error: "limitador_no_disponible", mensaje: expect.stringContaining("966 10 78 87") });
    expect(db.escrituras()).toEqual([]);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("las validaciones baratas siguen antes del limitador (no consumen cupo)", async () => {
    const lim = instalarLimitador(1);
    const r = await crear({ ...VALIDA, acepta_condiciones: false });
    expect(r.status).toBe(400);
    expect(lim.llamadas).toEqual([]);
  });
});

describe("tope de correos de rechazo por dirección", () => {
  it("el segundo rechazo a la misma dirección en 24 h no envía correo (la solicitud sí se registra)", async () => {
    instalarLimitador(10);
    const r1 = await crear(GRUPO_GRANDE);
    expect(r1.status).toBe(422);
    expect(r1.cuerpo.motivo).toBe("grupo_grande");
    expect(estadoPrueba().correos).toHaveLength(1);
    expect(estadoPrueba().correos[0].to).toEqual(["victima@example.com"]);

    const r2 = await crear({ ...GRUPO_GRANDE, email: "VICTIMA@example.com" });
    expect(r2.status).toBe(422);
    expect(estadoPrueba().correos).toHaveLength(1);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(2);
  });

  it("si el tope de correos no responde, no se envía (fail-closed) y la respuesta no cambia", async () => {
    instalarLimitador(10, { correoFalla: true });
    const r = await crear(GRUPO_GRANDE);
    expect(r.status).toBe(422);
    expect(estadoPrueba().correos).toEqual([]);
  });
});

describe("la reserva válida no cambia", () => {
  it("contrato con_newsletter con el limitador activo: 201", async () => {
    instalarLimitador(10);
    const r = await crear(VALIDA);
    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ ok: true, reserva_id: expect.any(String), estado: "pendiente" });
  });
});

describe("limitador.ts (puro)", () => {
  it("ipCliente: cf-connecting-ip primero, si no el ÚLTIMO salto de X-Forwarded-For", () => {
    expect(ipCliente(new Request("https://x", { headers: { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))).toBe("9.9.9.9");
    expect(ipCliente(new Request("https://x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))).toBe("2.2.2.2");
    expect(ipCliente(new Request("https://x"))).toBeNull();
  });

  it("hashIp: estable, depende de la sal, y sin sal no hay hash", async () => {
    const a = await hashIp("203.0.113.1", "sal");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp("203.0.113.1", "sal")).toBe(a);
    expect(await hashIp("203.0.113.1", "otra")).not.toBe(a);
    expect(await hashIp("203.0.113.1", "")).toBeNull();
  });

  it("reservarCupoCrear: sin sal o con respuesta rara -> no_disponible", async () => {
    const ok = { rpc: async () => ({ data: { permitido: true }, error: null }) };
    const raro = { rpc: async () => ({ data: "si", error: null }) };
    const lanza = { rpc: async () => { throw new Error("red"); } };
    const req = new Request("https://x");
    expect(await reservarCupoCrear(ok, req, "sal")).toEqual({ estado: "permitido" });
    expect(await reservarCupoCrear(ok, req, "")).toEqual({ estado: "no_disponible" });
    expect(await reservarCupoCrear(raro, req, "sal")).toEqual({ estado: "no_disponible" });
    expect(await reservarCupoCrear(lanza, req, "sal")).toEqual({ estado: "no_disponible" });
  });

  it("puedeEnviarCorreoRechazo: solo true explícito permite enviar", async () => {
    expect(await puedeEnviarCorreoRechazo({ rpc: async () => ({ data: true, error: null }) }, "a@b.c")).toBe(true);
    expect(await puedeEnviarCorreoRechazo({ rpc: async () => ({ data: false, error: null }) }, "a@b.c")).toBe(false);
    expect(await puedeEnviarCorreoRechazo({ rpc: async () => ({ data: true, error: { m: 1 } }) }, "a@b.c")).toBe(false);
    expect(await puedeEnviarCorreoRechazo({ rpc: async () => { throw new Error("x"); } }, "a@b.c")).toBe(false);
  });
});
