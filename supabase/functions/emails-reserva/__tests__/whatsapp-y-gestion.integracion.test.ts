/**
 * Integración de emails-reserva/index.ts (el fichero REAL) con los avisos por
 * WhatsApp (prueba de concepto, 21/11/2026; ver whatsapp-reservas):
 *  · /notificar: si el cliente eligió WhatsApp, se le pide a whatsapp-reservas
 *    y, si no sale, se sigue con el correo de siempre.
 *  · /enlace/*: «Gestionar mi reserva» (token 'gestionar') enseña la reserva y
 *    la cancela; el clic que llega de WhatsApp (via='whatsapp') no verifica el
 *    email ni manda el aviso de después.
 * BD en memoria (bdFalsa.ts); fetch falso: nada sale a la red.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";
import { firmarToken, firmarTokenGestion, calcularHuella } from "../tokens.ts";

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
vi.mock("https://esm.sh/resend@2.0.0", () => ({ Resend: class {} }));

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  SUPABASE_ANON_KEY: "anon-falsa",
  RESEND_API_KEY: "re_falsa",
  EMAILS_RESERVA_SHARED_SECRET: "secreto-cron",
  EMAILS_RESERVA_TOKEN_SECRET: "secreto-tokens",
  WHATSAPP_RESERVAS_ACTIVO: "true",
  WHATSAPP_RESERVAS_SECRET: "secreto-whatsapp",
};

const URL_WHATSAPP = "https://proyecto.supabase.co/functions/v1/whatsapp-reservas/enviar";
let respuestaWhatsApp: { status: number; cuerpo: unknown } = { status: 200, cuerpo: { enviado: true, tipo: "confirmada" } };
const llamadas: { url: string; init?: RequestInit }[] = [];

async function fetchFalso(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  llamadas.push({ url: String(url), init });
  if (String(url) === URL_WHATSAPP) {
    return new Response(JSON.stringify(respuestaWhatsApp.cuerpo), { status: respuestaWhatsApp.status, headers: { "Content-Type": "application/json" } });
  }
  if (String(url) === "https://api.resend.com/emails") {
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`fetch inesperado en un test: ${String(url)}`);
}

let db: BaseFalsa;

function sembrar() {
  db = new BaseFalsa();
  estadoPrueba().db = db;
  estadoPrueba().pruebas = [];
  llamadas.length = 0;
  respuestaWhatsApp = { status: 200, cuerpo: { enviado: true, tipo: "confirmada" } };
}

/** Una fecha a `dias` de hoy (Madrid ≈ UTC para lo que importa aquí). */
function dentroDe(dias: number): string {
  return new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
}

function reserva(over: Fila = {}): Fila {
  const r: Fila = {
    id: "res-1",
    nombre: "Ana López",
    telefono: "+34612345678",
    email: "ana@correo.test",
    fecha: dentroDe(10),
    hora: "21:30:00",
    numero_comensales: 4,
    estado: "confirmada",
    espacio_id: null,
    marca: "casa_tomas",
    canal: "web",
    notas_cliente: null,
    en_blacklist: false,
    canal_avisos: "whatsapp",
    updated_at: new Date().toISOString(),
    ...over,
  };
  db.tabla("reservas").push(r);
  return r;
}

async function llamar(ruta: string, cuerpo: unknown, cabeceras: Record<string, string> = {}) {
  const handler = estadoPrueba().handler;
  if (!handler) throw new Error("index.ts no ha registrado su handler");
  const res = await handler(
    new Request(`https://proyecto.supabase.co/functions/v1/emails-reserva/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(cuerpo),
    }),
  );
  return (await res.json()) as Record<string, unknown>;
}

const notificar = (reservaId = "res-1") => llamar("notificar", { reserva_id: reservaId }, { "x-webhook-secret": "secreto-cron" });
const aWhatsApp = () => llamadas.filter((l) => l.url === URL_WHATSAPP);
const aResend = () => llamadas.filter((l) => l.url === "https://api.resend.com/emails");

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

describe("POST /notificar con avisos por WhatsApp", () => {
  it("eligió WhatsApp y sale: no se manda correo", async () => {
    reserva();

    const r = await notificar();

    expect(r).toEqual({ ok: true, motivo: "whatsapp" });
    expect(aWhatsApp()).toHaveLength(1);
    const peticion = aWhatsApp()[0].init!;
    expect(new Headers(peticion.headers).get("x-webhook-secret")).toBe("secreto-whatsapp");
    expect(JSON.parse(String(peticion.body))).toEqual({ reserva_id: "res-1" });
    expect(aResend()).toHaveLength(0);
    expect(db.tabla("envios_email_reserva")).toHaveLength(0);
  });

  it("eligió WhatsApp pero no sale (o la función falla): sigue por el correo de siempre", async () => {
    reserva();
    respuestaWhatsApp = { status: 200, cuerpo: { enviado: false, motivo: "telefono_no_valido" } };
    // Sin plantilla de correo sembrada: que llegue a buscarla prueba que fue por el correo.
    expect(await notificar()).toEqual({ ok: false, motivo: "plantilla_no_configurada_confirmada" });

    respuestaWhatsApp = { status: 500, cuerpo: { ok: false } };
    expect(await notificar()).toEqual({ ok: false, motivo: "plantilla_no_configurada_confirmada" });
    expect(aWhatsApp()).toHaveLength(2);
  });

  it("eligió correo: ni se pregunta a whatsapp-reservas", async () => {
    reserva({ canal_avisos: "email" });

    expect(await notificar()).toEqual({ ok: false, motivo: "plantilla_no_configurada_confirmada" });
    expect(aWhatsApp()).toHaveLength(0);
  });

  it("reserva recibida de la web: el correo está silenciado, pero el WhatsApp sí se pide", async () => {
    reserva({ estado: "pendiente" });

    expect(await notificar()).toEqual({ ok: true, motivo: "whatsapp" });
    expect(aWhatsApp()).toHaveLength(1);
  });

  it("sin email pero con WhatsApp: el aviso sale igual", async () => {
    reserva({ email: null });

    expect(await notificar()).toEqual({ ok: true, motivo: "whatsapp" });
  });
});

describe("«Gestionar mi reserva» (token 'gestionar')", () => {
  const token = (fecha = dentroDe(10)) => firmarTokenGestion("secreto-tokens", "res-1", fecha);

  it("consultar enseña la reserva y su estado, sin tocar nada", async () => {
    reserva({ estado: "pendiente" });

    const r = await llamar("enlace/consultar", { token: await token() });

    expect(r).toMatchObject({
      ok: true,
      estado: "pendiente",
      tipo: "gestion",
      accion: "cancelar",
      estadoReserva: "pendiente",
      detalles: { nombre: "Ana López", hora: "21:30", comensales: 4 },
    });
    expect(db.tabla("reservas")[0].estado).toBe("pendiente");
  });

  it("ejecutar la cancela y avisa al panel (pendiente, verificada o confirmada)", async () => {
    for (const estado of ["pendiente", "verificada", "confirmada"]) {
      sembrar();
      reserva({ estado });

      const r = await llamar("enlace/ejecutar", { token: await token() });

      expect(r, estado).toMatchObject({ ok: true, estado: "hecho", tipo: "gestion", estadoReserva: "cancelada" });
      expect(db.tabla("reservas")[0].estado).toBe("cancelada");
      expect(db.tabla("notificaciones_dashboard")).toEqual([
        expect.objectContaining({ tipo: "reserva_cancelada_cliente", referencia_id: "res-1", prioridad: "alta" }),
      ]);
      // Sin aviso automático al cliente.
      expect(aResend()).toHaveLength(0);
      expect(aWhatsApp()).toHaveLength(0);
    }
  });

  it("ya cancelada -> ya_hecho; día pasado -> fecha_pasada; completada -> invalido. Ninguno cambia nada", async () => {
    reserva({ estado: "cancelada" });
    expect(await llamar("enlace/ejecutar", { token: await token() })).toMatchObject({ estado: "ya_hecho", estadoReserva: "cancelada" });

    sembrar();
    reserva({ fecha: dentroDe(-3) });
    expect(await llamar("enlace/ejecutar", { token: await token(dentroDe(-3)) })).toMatchObject({ ok: false, estado: "fecha_pasada" });
    expect(db.tabla("reservas")[0].estado).toBe("confirmada");

    sembrar();
    reserva({ estado: "completada" });
    expect(await llamar("enlace/ejecutar", { token: await token() })).toMatchObject({ ok: false, estado: "invalido", detalles: null });
    expect(db.tabla("reservas")[0].estado).toBe("completada");
    expect(db.tabla("notificaciones_dashboard")).toHaveLength(0);
  });

  it("vale hasta el día de la reserva aunque sea dentro de dos meses (no caduca a los 14 días)", async () => {
    const fecha = dentroDe(60);
    reserva({ fecha });
    const t = await firmarTokenGestion("secreto-tokens", "res-1", fecha, Math.floor(Date.now() / 1000) - 30 * 86400);
    expect(await llamar("enlace/consultar", { token: t })).toMatchObject({ ok: true, estado: "pendiente" });
  });

  it("un token de aceptar la propuesta no vale como gestión ni al revés", async () => {
    reserva({ estado: "verificada" });
    const aceptar = await firmarToken("secreto-tokens", "res-1", "aceptar", calcularHuella("verificada", "21:30"));
    expect(await llamar("enlace/consultar", { token: aceptar })).toMatchObject({ tipo: "contraoferta" });
    expect(await llamar("enlace/consultar", { token: await token() })).toMatchObject({ tipo: "gestion" });
  });
});

describe("clic que llega de WhatsApp (via='whatsapp')", () => {
  it("«Sí, confirmo»: confirma, pero ni verifica el email ni manda el aviso de después", async () => {
    reserva({ estado: "verificada", consentimiento_newsletter: true });
    const t = await firmarToken("secreto-tokens", "res-1", "aceptar", calcularHuella("verificada", "21:30"));

    const r = await llamar("enlace/ejecutar", { token: t, via: "whatsapp" });

    expect(r).toMatchObject({ ok: true, estado: "hecho", tipo: "contraoferta" });
    const fila = db.tabla("reservas")[0];
    expect(fila.estado).toBe("confirmada");
    expect(fila.email_verificado_at ?? null).toBeNull();
    expect(aWhatsApp()).toHaveLength(0);
    expect(aResend()).toHaveLength(0);
  });

  it("desde la web (sin via) se comporta como siempre: verifica y pide el aviso", async () => {
    reserva({ estado: "verificada" });
    const t = await firmarToken("secreto-tokens", "res-1", "aceptar", calcularHuella("verificada", "21:30"));

    await llamar("enlace/ejecutar", { token: t });

    expect(typeof db.tabla("reservas")[0].email_verificado_at).toBe("string");
    expect(aWhatsApp()).toHaveLength(1); // eligió WhatsApp: el aviso de confirmada se le pide a whatsapp-reservas
  });
});
