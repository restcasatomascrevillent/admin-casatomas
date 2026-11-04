// CT-REM-FN-01 · ADMITE_INTEGRACION es la lista de funciones que el envoltorio
// deja pasar SIN usuario ni service role. Cada una tiene que defenderse sola.
// Este test falla si:
//   · se añade a la lista una función que no está declarada aquí con su mecanismo;
//   · el código de la función ya no contiene ese mecanismo;
//   · vuelve a entrar `traducir-contenido` (o cualquier función sin control propio).
// Además prueba el envoltorio de verdad: anon/publishable → 401 fuera de la
// lista, y la IP de auditoría = cf-connecting-ip o ÚLTIMO salto de XFF.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMITE_INTEGRACION, clienteConAuditoria, conAuditoriaDePeticion } from "../audit-client";

const FUNCIONES = resolve(__dirname, "../..");

/** Mecanismo de autenticación propia de cada función de la lista (todas las expresiones deben aparecer). */
const AUTENTICACION_PROPIA: Record<string, { mecanismo: string; patrones: RegExp[] }> = {
  "chat-web": { mecanismo: "pública; cupo SQL fail-closed por IP/sesión/día + token de sesión HMAC", patrones: [/chat_web_reservar_cupo/, /HMAC/] },
  "newsletter-baja": { mecanismo: "enlace HMAC comparado en tiempo constante", patrones: [/HMAC/, /timingSafeEqual/] },
  "resend-webhook": { mecanismo: "firma svix de Resend", patrones: [/verificarWebhookResend/, /compararEnTiempoConstante/] },
  "reservas-web": { mecanismo: "pública (web) + tokens HMAC de un solo uso + secreto interno", patrones: [/HMAC/, /crypto\.subtle\.verify/] },
  "emails-reserva": { mecanismo: "secreto x-webhook-secret, token HMAC o usuario con can_write_section", patrones: [/x-webhook-secret/, /verificarToken/, /can_write_section/] },
  "newsletter-sync-resend": { mecanismo: "secreto de cron en tiempo constante o usuario de marketing", patrones: [/compararTiempoConstante/, /can_write_section/] },
  "sync-trafico-web": { mecanismo: "x-webhook-secret en tiempo constante", patrones: [/x-webhook-secret/, /compararTiempoConstante/] },
  "ocr-trabajo": { mecanismo: "x-ocr-secret en tiempo constante, fail-closed", patrones: [/verificarSecreto/] },
  "clasificar-productos": { mecanismo: "x-ocr-secret o usuario con facturas:edit", patrones: [/verificarSecreto/, /autenticar\(req, cfgAuth, "edit"\)/] },
  "sincronizar-costes-openai": { mecanismo: "x-ocr-secret en tiempo constante", patrones: [/verificarSecreto/] },
  "instagram-metricas": { mecanismo: "x-webhook-secret del cron en tiempo constante (falla cerrado) o usuario de marketing", patrones: [/x-webhook-secret/, /compararTiempoConstante/, /can_read_section/, /can_write_section/] },
};

function fuentes(dir: string): string {
  let total = "";
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__" || nombre === "evals" || nombre === "fixtures") continue;
      total += fuentes(ruta);
    } else if (nombre.endsWith(".ts") && !nombre.endsWith(".test.ts")) {
      total += readFileSync(ruta, "utf8") + "\n";
    }
  }
  return total;
}

describe("ADMITE_INTEGRACION", () => {
  it("no incluye traducir-contenido", () => {
    expect(ADMITE_INTEGRACION.has("traducir-contenido")).toBe(false);
  });

  it.each([...ADMITE_INTEGRACION])("%s tiene autenticación propia declarada y presente en su código", (fn) => {
    const declarada = AUTENTICACION_PROPIA[fn];
    expect(declarada, `${fn} está en ADMITE_INTEGRACION pero no tiene mecanismo declarado en este test`).toBeDefined();
    const codigo = fuentes(join(FUNCIONES, fn));
    // Envuelta de verdad por el envoltorio con ese nombre.
    expect(codigo).toContain(`"${fn}"`);
    for (const patron of declarada.patrones) {
      expect(patron.test(codigo), `${fn}: falta ${patron} (${declarada.mecanismo})`).toBe(true);
    }
  });

  it("la tabla del test no tiene entradas sobrantes (cada salida de la lista se refleja aquí)", () => {
    expect(Object.keys(AUTENTICACION_PROPIA).sort()).toEqual([...ADMITE_INTEGRACION].sort());
  });
});

describe("conAuditoriaDePeticion: autenticación del envoltorio", () => {
  const ENV: Record<string, string> = { SUPABASE_URL: "https://ejemplo.supabase.co", SUPABASE_ANON_KEY: "anon-jwt", SUPABASE_SERVICE_ROLE_KEY: "service" };
  beforeAll(() => vi.stubGlobal("Deno", { env: { get: (n: string) => ENV[n] } }));
  afterAll(() => vi.unstubAllGlobals());

  const fabrica = () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "x" } }) }, rpc: async () => ({ error: null }) });
  const llamar = async (fuente: string, token?: string) => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await conAuditoriaDePeticion(fuente, fabrica, handler)(new Request("https://ejemplo.test/" + fuente, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {},
    }));
    return { status: res.status, ejecutado: handler.mock.calls.length > 0 };
  };

  it.each([undefined, "anon-jwt", "sb_publishable_xyz"])("traducir-contenido con %s → 401 sin ejecutar el handler", async (token) => {
    expect(await llamar("traducir-contenido", token)).toEqual({ status: 401, ejecutado: false });
  });
  it("una función de la lista sí llega a su handler (que se autentica sola)", async () => {
    expect(await llamar("ocr-trabajo", "anon-jwt")).toEqual({ status: 200, ejecutado: true });
  });
  it("service role sigue pasando (modo bulk de traducir-contenido)", async () => {
    expect(await llamar("traducir-contenido", "service")).toEqual({ status: 200, ejecutado: true });
  });
});

describe("conAuditoriaDePeticion: IP de auditoría (CT-REM-FN-03)", () => {
  beforeAll(() => vi.stubGlobal("Deno", { env: { get: (n: string) => ({ SUPABASE_URL: "https://e.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" } as Record<string, string>)[n] } }));
  afterAll(() => vi.unstubAllGlobals());

  async function ipRegistrada(headers: Record<string, string>): Promise<string | null> {
    let vista: string | null = null;
    const transporte = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      vista = new Headers(init?.headers).get("x-audit-ip");
      return new Response("{}");
    });
    const fabrica = (_u: string, _k: string, opciones: { global: { fetch: typeof fetch } }) => opciones.global.fetch;
    const cliente = clienteConAuditoria(fabrica as never, "ocr-trabajo") as unknown as (u: string, k: string, o: unknown) => typeof fetch;
    const handler = async () => {
      const f = cliente("https://e.supabase.co", "service", { global: { fetch: transporte } });
      await f("https://e.supabase.co/rest/v1/x");
      return new Response("{}");
    };
    await conAuditoriaDePeticion("ocr-trabajo", fabrica, handler)(new Request("https://e.test/ocr-trabajo", { method: "POST", headers }));
    return vista;
  }

  it("con cf-connecting-ip se usa esa, aunque XFF diga otra cosa", async () => {
    expect(await ipRegistrada({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" })).toBe("203.0.113.7");
  });
  it("sin cf-connecting-ip se usa el ÚLTIMO salto de XFF, no el primero que pone el cliente", async () => {
    expect(await ipRegistrada({ "x-forwarded-for": "6.6.6.6, 198.51.100.2" })).toBe("198.51.100.2");
  });
});
