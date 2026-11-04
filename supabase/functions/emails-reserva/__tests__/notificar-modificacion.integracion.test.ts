/**
 * Integración de emails-reserva/index.ts (el fichero REAL) para el aviso de
 * «reserva modificada»: POST /notificar-modificacion, el reintento del cron y
 * el envío de prueba, contra una BD EN MEMORIA (bdFalsa.ts) y un Resend falso
 * (fetch sustituido). Nada sale a la red ni toca Supabase.
 *
 * index.ts importa tres módulos por URL (deno.land / esm.sh) que Node no puede
 * cargar: aquí los sustituye vi.mock, sin tocar vitest.config.ts. Lo que se
 * comprueba es lo que las pruebas puras no ven: el orden de las consultas, el
 * 23505 del índice, la lista negra, el registro en envios_email_reserva, la
 * Idempotency-Key, el token firmado y el despliegue en otro orden.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";
import { verificarToken } from "../tokens.ts";

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

interface EnvioResend {
  key: string;
  body: { to: string[]; subject: string; html: string };
}
let resend: EnvioResend[] = [];
let respuestasResend: Array<{ status: number; body: unknown }> = [];
let db: BaseFalsa;

async function fetchFalso(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (String(url) !== "https://api.resend.com/emails") throw new Error(`fetch inesperado en un test: ${String(url)}`);
  const cabeceras = (init?.headers ?? {}) as Record<string, string>;
  resend.push({ key: cabeceras["Idempotency-Key"], body: JSON.parse(String(init?.body)) });
  const r = respuestasResend.shift() ?? { status: 200, body: { id: `re_${resend.length}` } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
}

const PLANTILLA_MODIFICADA: Fila = {
  tipo: "reserva_modificada",
  version: 1,
  es_actual: true,
  asunto: "Hemos modificado tu reserva - {{negocio}}",
  saludo: "Hola, {{nombre}}",
  cuerpo:
    "Te escribimos porque hemos modificado tu reserva en {{negocio}}. Aquí tienes lo que ha cambiado y cómo queda.\n\nSi los nuevos datos no te vienen bien o tienes cualquier duda, llámanos y buscamos una solución.",
  texto_boton_principal: "Sí, confirmo mi asistencia",
  texto_boton_secundario: "No puedo, cancelar reserva",
  pie: "Si necesitas cambiar algo más o cancelarla, llámanos con antelación.",
  color_acento: "#B8936A",
  color_oscuro: "#1C1F22",
  logo_url: null,
  bloques: { mostrar_tabla_detalles: true, mostrar_boton_secundario: true, mostrar_pie_contacto: true },
};

function sembrar(opciones: { migracion?: boolean } = {}) {
  db = new BaseFalsa();
  db.migracionAplicada = opciones.migracion ?? true;
  estadoPrueba().db = db;
  estadoPrueba().pruebas = [];
  db.tabla("espacios_reserva").push({ id: "esp-1", nombre: "Comedor" });
  if (db.migracionAplicada) db.tabla("plantillas_email_reserva").push({ id: "pl-mod-1", ...PLANTILLA_MODIFICADA });
  db.tabla("plantillas_email_reserva").push({
    ...PLANTILLA_MODIFICADA,
    id: "pl-conf-1",
    tipo: "confirmada",
    asunto: "Reserva confirmada - Casa Tomás",
    cuerpo: "Tu reserva en Casa Tomás queda confirmada. Te esperamos.",
    texto_boton_principal: null,
    texto_boton_secundario: null,
  });
}

/** Reserva confirmada del 10-12-2026 a las 21:30 (antes 21:00), recién guardada. */
function reserva(over: Fila = {}): Fila {
  const r: Fila = {
    id: "res-1",
    nombre: "Ana López",
    telefono: "+34612345678",
    email: "ana@correo.test",
    fecha: "2026-12-10",
    hora: "21:30:00",
    numero_comensales: 4,
    estado: "confirmada",
    espacio_id: "esp-1",
    hora_solicitada: "20:00:00",
    espacio_solicitado_id: null,
    marca: "casa_tomas",
    canal: "telefono",
    notas_cliente: null,
    en_blacklist: false,
    updated_at: new Date().toISOString(),
    ...over,
  };
  db.tabla("reservas").push(r);
  return r;
}

const ANTES = { fecha: "2026-12-10", hora: "21:00", comensales: 4 };
const CRON = { "x-webhook-secret": "secreto-cron" };

async function llamar(ruta: string, body: unknown, cabeceras: Record<string, string> = { Authorization: "Bearer valido" }) {
  const handler = estadoPrueba().handler;
  if (!handler) throw new Error("index.ts no ha registrado su handler");
  const res = await handler(
    new Request(`https://proyecto.supabase.co/functions/v1/emails-reserva/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}

const avisar = (antes: unknown = ANTES, reservaId = "res-1") => llamar("notificar-modificacion", { reserva_id: reservaId, antes });
const avisos = () => db.tabla("envios_email_reserva").filter((e) => e.tipo_email === "reserva_modificada");
const ENVIADO = { status: 200, cuerpo: { ok: true } };

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
  resend = [];
  respuestasResend = [];
  sembrar();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST /notificar-modificacion — sale el correo que toca", () => {
  it("confirmada, cambia la hora: UN correo con antes/ahora, sin botones ni «Pediste», y queda registrado", async () => {
    reserva();
    expect(await avisar()).toEqual(ENVIADO);
    expect(resend).toHaveLength(1);
    const { body, key } = resend[0];
    expect(body.to).toEqual(["ana@correo.test"]);
    expect(body.subject).toBe("Hemos modificado tu reserva - Casa Tomás");
    expect(body.html).toContain("Cambios en tu reserva");
    expect(body.html).toContain("Hora:</strong> antes 21:00, ahora");
    expect(body.html).not.toContain("Fecha:</strong> antes");
    expect(body.html).not.toContain("Pediste:"); // hora_solicitada (20:00) ≠ 21:30, pero no es una contraoferta
    expect(body.html).toMatch(/sigue confirmada/);
    expect(body.html).not.toContain("Sí, confirmo mi asistencia");
    const [fila] = avisos();
    expect(fila).toMatchObject({
      resultado: "enviado",
      destinatario: "ana@correo.test",
      plantilla_id: "pl-mod-1",
      clave_aviso: "2026-12-10|21:30|4|tras:ninguno",
      detalle: { antes: ANTES, ahora: { fecha: "2026-12-10", hora: "21:30", comensales: 4 }, estado: "confirmada" },
    });
    expect(key).toBe(`envio-email-reserva/${fila.id}`);
  });

  it("verificada: los dos botones llevan un token NUEVO firmado con la hora nueva (v2|verificada|21:30)", async () => {
    reserva({ estado: "verificada" });
    expect(await avisar()).toEqual(ENVIADO);
    const html = resend[0].body.html;
    expect(html).toContain("Sí, confirmo mi asistencia");
    expect(html).toContain("No puedo, cancelar reserva");
    expect(html).toMatch(/pendiente de tu confirmación/);
    const tokens = [...html.matchAll(/reserva\/respuesta\?token=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]));
    expect(tokens).toHaveLength(2);
    expect(await verificarToken("secreto-tokens", tokens[0], "aceptar")).toMatchObject({ id: "res-1", fp: "v2|verificada|21:30" });
    expect(await verificarToken("secreto-tokens", tokens[1], "rechazar")).toMatchObject({ id: "res-1", fp: "v2|verificada|21:30" });
  });

  it("pendiente de teléfono (sí recibió «solicitud recibida»): sigue en revisión, sin botones", async () => {
    reserva({ estado: "pendiente", canal: "telefono" });
    expect(await avisar()).toEqual(ENVIADO);
    expect(resend[0].body.html).toMatch(/pendiente de revisión/);
    expect(resend[0].body.html).not.toContain("Sí, confirmo mi asistencia");
  });
});

describe("idempotencia", () => {
  it("doble clic / reintento con los mismos datos: el segundo no manda nada", async () => {
    reserva();
    expect(await avisar()).toEqual(ENVIADO);
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "ya_enviado_o_en_curso" });
    expect(resend).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
  });

  it("dos peticiones A LA VEZ: el índice único (23505) deja salir un solo correo", async () => {
    reserva();
    const [a, b] = await Promise.all([avisar(), avisar()]);
    expect([a, b].filter((x) => x.cuerpo.ok === true)).toHaveLength(1);
    expect([a, b].find((x) => x.cuerpo.ok === false)?.cuerpo.motivo).toBe("ya_enviado_o_en_curso");
    expect(db.rechazos23505).toBe(1);
    expect(resend).toHaveLength(1);
  });

  it("una segunda modificación sí se avisa, encadenada; y el ida y vuelta A→B→A→B avisa las tres veces", async () => {
    const r = reserva(); // 21:00 -> 21:30
    expect(await avisar({ ...ANTES, hora: "21:00" })).toEqual(ENVIADO);
    r.hora = "21:00:00"; // 21:30 -> 21:00
    expect(await avisar({ ...ANTES, hora: "21:30" })).toEqual(ENVIADO);
    r.hora = "21:30:00"; // 21:00 -> 21:30 otra vez
    expect(await avisar({ ...ANTES, hora: "21:00" })).toEqual(ENVIADO);
    expect(resend).toHaveLength(3);
    const claves = avisos().map((e) => e.clave_aviso);
    expect(new Set(claves).size).toBe(3);
    expect(claves[1]).toBe(`2026-12-10|21:00|4|tras:${avisos()[0].id}`);
    expect(resend[1].body.html).toContain("Hora:</strong> antes 21:30, ahora");
  });

  it("los demás correos no cambian: /notificar sigue siendo uno por (reserva, tipo) y no choca con el aviso", async () => {
    reserva();
    expect((await llamar("notificar", { reserva_id: "res-1" }, CRON)).cuerpo).toEqual({ ok: true });
    expect((await llamar("notificar", { reserva_id: "res-1" }, CRON)).cuerpo).toEqual({ ok: false, motivo: "ya_enviado_o_en_curso" });
    expect(resend[0].body.subject).toBe("Reserva confirmada - Casa Tomás");
    expect(await avisar()).toEqual(ENVIADO);
    expect(resend).toHaveLength(2);
  });
});

describe("cuándo NO sale", () => {
  it.each([
    ["sin email", { email: null }, "reserva_sin_email"],
    ["cancelada", { estado: "cancelada" }, "reserva_no_viva"],
    ["pendiente de la web (su primer correo será la propuesta)", { estado: "pendiente", canal: "web" }, "pendiente_sin_correo_previo"],
    ["ya pasó", { fecha: "2024-01-10" }, "reserva_pasada"],
    ["marcada en lista negra", { en_blacklist: true }, "en_lista_negra"],
    ["datos de prueba", { email: "demo@example.com" }, "reserva_de_prueba"],
    ["no se acaba de guardar (petición suelta, «antes» sin edición detrás)", { updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }, "cambio_no_reciente"],
  ])("%s", async (_caso, over, motivo) => {
    reserva(over);
    const antes = typeof over.fecha === "string" ? { ...ANTES, fecha: over.fecha } : ANTES;
    expect((await avisar(antes)).cuerpo).toEqual({ ok: false, motivo });
    expect(resend).toHaveLength(0);
    expect(avisos()).toHaveLength(0);
  });

  it("lista negra por su teléfono en OTRO formato (vigente); una entrada caducada ya no cuenta", async () => {
    reserva();
    db.tabla("blacklist").push({ tipo: "telefono", valor: "612 345 678", caduca_el: "2099-01-01" });
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "en_lista_negra" });
    db.tabla("blacklist")[0].caduca_el = "2020-01-01";
    expect(await avisar()).toEqual(ENVIADO);
  });

  it("no cambió nada relevante, o el «antes» no es válido", async () => {
    reserva();
    expect((await avisar({ fecha: "2026-12-10", hora: "21:30", comensales: 4 })).cuerpo).toEqual({ ok: false, motivo: "sin_cambios" });
    expect((await avisar({ fecha: "2026-12-10", hora: "<b>", comensales: 4 })).cuerpo).toEqual({ ok: false, motivo: "antes_invalido" });
    expect(resend).toHaveLength(0);
  });

  it("dirección suprimida (rebotó): no se intenta, queda fallido_definitivo y aviso ALTO en la campana", async () => {
    reserva();
    db.tabla("direcciones_email_suprimidas").push({ email: "ana@correo.test" });
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "destinatario_suprimido" });
    expect(resend).toHaveLength(0);
    expect(avisos()[0]).toMatchObject({ resultado: "fallido_definitivo", error: "destinatario_suprimido" });
    expect(db.tabla("notificaciones_dashboard")[0]).toMatchObject({ tipo: "email_fallido", prioridad: "alta" });
  });

  it("con «Puede editar» en Reservas basta (no hace falta el de Configuración): es una acción sobre la reserva", async () => {
    reserva();
    estadoPrueba().seccionesPedidas.length = 0;
    const r = await llamar("notificar-modificacion", { reserva_id: "res-1", antes: ANTES }, { Authorization: "Bearer solo_reservas" });
    expect(r).toEqual(ENVIADO);
    expect(estadoPrueba().seccionesPedidas).toEqual(["reservas"]);
    expect(resend).toHaveLength(1);
  });

  it("sin sesión de usuario: 401; sin permiso de escritura en reservas: 403", async () => {
    reserva();
    const cuerpo = { reserva_id: "res-1", antes: ANTES };
    expect((await llamar("notificar-modificacion", cuerpo, {})).status).toBe(401);
    expect((await llamar("notificar-modificacion", cuerpo, { Authorization: "Bearer anon" })).status).toBe(401);
    expect((await llamar("notificar-modificacion", cuerpo, { Authorization: "Bearer sinpermiso" })).status).toBe(403);
    expect(resend).toHaveLength(0);
  });

  it("más de 20 peticiones en 5 minutos del mismo usuario: se corta (rate_limit_log)", async () => {
    reserva();
    const reciente = new Date().toISOString();
    for (let i = 0; i < 20; i++) {
      db.tabla("rate_limit_log").push({ identifier: "emails-reserva:notificar-modificacion:usuario-1", created_at: reciente });
    }
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "demasiados_avisos" });
    expect(resend).toHaveLength(0);
  });
});

describe("hora de Madrid en INVIERNO (UTC+1)", () => {
  it("una reserva a las 21:00 del 10-12 aún se avisa a las 20:59 de Madrid (19:59 UTC) y ya no a las 21:00 (20:00 UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-10T19:59:00.000Z"));
    reserva({ hora: "21:00:00", numero_comensales: 6 });
    expect(await avisar({ fecha: "2026-12-10", hora: "21:00", comensales: 4 })).toEqual(ENVIADO);

    sembrar();
    vi.setSystemTime(new Date("2026-12-10T20:00:00.000Z"));
    reserva({ hora: "21:00:00", numero_comensales: 6 });
    expect((await avisar({ fecha: "2026-12-10", hora: "21:00", comensales: 4 })).cuerpo).toEqual({
      ok: false,
      motivo: "reserva_pasada",
    });
  });
});

describe("reintentos del cron (/reintentar-fallidos)", () => {
  it("un fallo transitorio se reintenta con EXACTAMENTE el mismo correo y la misma Idempotency-Key", async () => {
    reserva({ estado: "verificada" });
    respuestasResend = [{ status: 500, body: { name: "application_error", message: "caído" } }];
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "fallido_reintentable" });
    const [fila] = avisos();
    expect(fila.resultado).toBe("fallido");
    fila.proximo_reintento_en = new Date(Date.now() - 1000).toISOString();

    expect((await llamar("reintentar-fallidos", {}, CRON)).cuerpo).toMatchObject({ ok: true, enviados: 1 });
    expect(resend).toHaveLength(2);
    expect(resend[1].key).toBe(resend[0].key);
    expect(resend[1].body.html).toBe(resend[0].body.html);
    expect(avisos()[0].resultado).toBe("enviado");
  });

  it("si la reserva volvió a cambiar antes del reintento, ese aviso se abandona sin aviso al personal", async () => {
    const r = reserva();
    respuestasResend = [{ status: 500, body: { name: "application_error", message: "caído" } }];
    await avisar();
    avisos()[0].proximo_reintento_en = new Date(Date.now() - 1000).toISOString();
    r.hora = "22:00:00";

    expect((await llamar("reintentar-fallidos", {}, CRON)).cuerpo).toMatchObject({ ok: true, enviados: 0, omitidos_estado_cambiado: 1 });
    expect(resend).toHaveLength(1);
    expect(avisos()[0]).toMatchObject({ resultado: "fallido_definitivo", error: "estado_reserva_cambio_email_obsoleto" });
    expect(db.tabla("notificaciones_dashboard")).toHaveLength(0);
  });

  it("mientras un aviso espera su reintento, el siguiente cambio cuenta desde lo que el cliente sí sabía", async () => {
    const r = reserva(); // 21:00 -> 21:30 (falla)
    respuestasResend = [{ status: 500, body: { name: "application_error", message: "caído" } }];
    await avisar();
    r.hora = "22:00:00"; // 21:30 -> 22:00
    expect(await avisar({ ...ANTES, hora: "21:30" })).toEqual(ENVIADO);
    expect(resend[1].body.html).toContain("Hora:</strong> antes 21:00, ahora");
  });
});

describe("despliegue en otro orden: falla cerrado", () => {
  it("función nueva SIN la migración: no hay plantilla y no se escribe nada", async () => {
    sembrar({ migracion: false });
    reserva();
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "plantilla_no_configurada_reserva_modificada" });
    expect(resend).toHaveLength(0);
    expect(db.tabla("envios_email_reserva")).toHaveLength(0);
  });

  it("…y si alguien crea la plantilla a mano sin la migración: migracion_pendiente (nunca «ya enviado»)", async () => {
    sembrar({ migracion: false });
    db.tabla("plantillas_email_reserva").push({ id: "pl-mod-x", ...PLANTILLA_MODIFICADA });
    reserva();
    expect((await avisar()).cuerpo).toEqual({ ok: false, motivo: "migracion_pendiente" });
    expect(resend).toHaveLength(0);
  });

  it("los reintentos de los demás correos siguen funcionando sin la migración (select *)", async () => {
    sembrar({ migracion: false });
    reserva();
    respuestasResend = [{ status: 500, body: { name: "application_error", message: "caído" } }];
    expect((await llamar("notificar", { reserva_id: "res-1" }, CRON)).cuerpo).toEqual({ ok: false, motivo: "fallido_reintentable" });
    db.tabla("envios_email_reserva")[0].proximo_reintento_en = new Date(Date.now() - 1000).toISOString();
    expect((await llamar("reintentar-fallidos", {}, CRON)).cuerpo).toMatchObject({ enviados: 1 });
  });
});

describe("envío de prueba desde el editor", () => {
  it("pide «Puede editar» en «Reservas · Configuración» (04/11/2026): con el de Reservas solo, 403 y no sale nada", async () => {
    estadoPrueba().pruebas.length = 0;
    estadoPrueba().seccionesPedidas.length = 0;
    const cuerpo = { tipo: "reserva_modificada", destinatario: "x@y.z", plantilla: PLANTILLA_MODIFICADA };
    const r = await llamar("enviar-prueba", cuerpo, { Authorization: "Bearer solo_reservas" });
    expect(r.status).toBe(403);
    expect(r.cuerpo).toEqual({ ok: false, error: "no_autorizado" });
    expect(estadoPrueba().seccionesPedidas).toEqual(["reservas_configuracion"]);
    expect(estadoPrueba().pruebas).toHaveLength(0);
  });

  it("la prueba de «Reserva modificada» enseña el bloque de cambios y botones de relleno, nunca un token", async () => {
    const r = await llamar("enviar-prueba", { tipo: "reserva_modificada", destinatario: "x@y.z", plantilla: PLANTILLA_MODIFICADA });
    expect(r.cuerpo).toEqual({ ok: true });
    const [prueba] = estadoPrueba().pruebas;
    expect(prueba.to).toEqual(["personal@correo.test"]);
    expect(prueba.html).toContain("Cambios en tu reserva");
    expect(prueba.html).toContain('href="#"');
    expect(prueba.html).not.toContain("token=");
  });
});

describe("sin EMAILS_RESERVA_TOKEN_SECRET", () => {
  it("a una verificada no se le manda un aviso sin enlace (token_no_configurado); a una confirmada, sí", async () => {
    const original = estadoPrueba().handler;
    try {
      vi.resetModules();
      ENV.EMAILS_RESERVA_TOKEN_SECRET = "";
      await import("../index.ts");
      reserva({ estado: "verificada" });
      reserva({ id: "res-2", estado: "confirmada" });
      expect((await avisar(ANTES, "res-1")).cuerpo).toEqual({ ok: false, motivo: "token_no_configurado" });
      expect(await avisar(ANTES, "res-2")).toEqual(ENVIADO);
    } finally {
      ENV.EMAILS_RESERVA_TOKEN_SECRET = "secreto-tokens";
      estadoPrueba().handler = original;
    }
  });
});
