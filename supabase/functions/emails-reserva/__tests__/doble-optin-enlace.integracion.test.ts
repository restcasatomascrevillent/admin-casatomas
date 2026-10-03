/**
 * Integración de emails-reserva/index.ts (el fichero REAL): doble opt-in del
 * newsletter (migración 20261003184500). El clic del cliente que ACEPTA
 * desde el correo (POST /enlace/ejecutar) marca reservas.email_verificado_at,
 * que es lo que dispara el alta en la BD. Rechazar no la marca. Si la
 * migración no está aplicada, la reserva se confirma igual.
 * BD en memoria (bdFalsa.ts) y Resend falso: nada sale a la red.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";
import { firmarToken, calcularHuella, type AccionToken } from "../tokens.ts";

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
        send: async (p: { to: string[]; subject: string; html: string }) => {
          estado().pruebas.push(p);
          return { data: { id: "prueba" }, error: null };
        },
      };
    },
  };
});

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  SUPABASE_ANON_KEY: "anon-falsa",
  RESEND_API_KEY: "re_falsa",
  RESEND_FROM_EMAIL: "Casa Tomás <reservas@correo.test>",
  EMAILS_RESERVA_SHARED_SECRET: "secreto-cron",
  EMAILS_RESERVA_TOKEN_SECRET: "secreto-tokens",
};

async function fetchFalso(url: string | URL | Request): Promise<Response> {
  if (String(url) !== "https://api.resend.com/emails") throw new Error(`fetch inesperado en un test: ${String(url)}`);
  return new Response(JSON.stringify({ id: "re_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
}

let db: BaseFalsa;

function sembrar() {
  db = new BaseFalsa();
  estadoPrueba().db = db;
  estadoPrueba().pruebas = [];
}

function reservaVerificada(over: Fila = {}): Fila {
  const r: Fila = {
    id: "res-1",
    nombre: "Ana López",
    telefono: "+34612345678",
    email: "ana@correo.test",
    fecha: "2026-12-10",
    hora: "21:30:00",
    numero_comensales: 4,
    estado: "verificada",
    espacio_id: null,
    marca: "casa_tomas",
    canal: "web",
    notas_cliente: null,
    en_blacklist: false,
    consentimiento_newsletter: true,
    updated_at: new Date().toISOString(),
    ...over,
  };
  db.tabla("reservas").push(r);
  return r;
}

async function ejecutar(accion: AccionToken, reservaId = "res-1", hora = "21:30") {
  const token = await firmarToken("secreto-tokens", reservaId, accion, calcularHuella("verificada", hora));
  const handler = estadoPrueba().handler;
  if (!handler) throw new Error("index.ts no ha registrado su handler");
  const res = await handler(
    new Request("https://proyecto.supabase.co/functions/v1/emails-reserva/enlace/ejecutar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://restaurantecasatomascrevillente.es" },
      body: JSON.stringify({ token }),
    }),
  );
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
  vi.stubGlobal("fetch", fetchFalso);
  sembrar();
  await import("../index.ts");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sembrar();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /enlace/ejecutar — contraoferta", () => {
  it("«Confirmo»: verificada -> confirmada y email_verificado_at marcado", async () => {
    reservaVerificada();

    const r = await ejecutar("aceptar");

    expect(r).toMatchObject({ ok: true, estado: "hecho", tipo: "contraoferta" });
    const fila = db.tabla("reservas")[0];
    expect(fila.estado).toBe("confirmada");
    expect(typeof fila.email_verificado_at).toBe("string");
  });

  it("una verificación anterior no se mueve", async () => {
    reservaVerificada({ email_verificado_at: "2026-10-01T10:00:00.000Z" });

    await ejecutar("aceptar");

    expect(db.tabla("reservas")[0]).toMatchObject({ estado: "confirmada", email_verificado_at: "2026-10-01T10:00:00.000Z" });
  });

  it("«No puedo» (rechazar): cancelada y SIN verificar (puede ser alguien diciendo «no es mía»)", async () => {
    reservaVerificada();

    const r = await ejecutar("rechazar");

    expect(r).toMatchObject({ ok: true, estado: "hecho" });
    const fila = db.tabla("reservas")[0];
    expect(fila.estado).toBe("cancelada");
    expect(fila.email_verificado_at ?? null).toBeNull();
  });

  it("enlace caducado por cambio de hora: ni confirma ni verifica", async () => {
    reservaVerificada({ hora: "22:00:00" });

    const r = await ejecutar("aceptar", "res-1", "21:30");

    expect(r.ok).toBe(false);
    expect(db.tabla("reservas")[0]).toMatchObject({ estado: "verificada" });
    expect(db.tabla("reservas")[0].email_verificado_at ?? null).toBeNull();
  });

  it("migración 20261003184500 sin aplicar: la reserva se confirma igual y queda rastro en el log", async () => {
    db.sinColumnaVerificacion = true;
    reservaVerificada();

    const r = await ejecutar("aceptar");

    expect(r).toMatchObject({ ok: true, estado: "hecho" });
    const fila = db.tabla("reservas")[0];
    expect(fila.estado).toBe("confirmada");
    expect(fila).not.toHaveProperty("email_verificado_at");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("20261003184500"));
  });
});
