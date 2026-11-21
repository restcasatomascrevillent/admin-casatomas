/**
 * Integración de reservas-web/index.ts (el fichero REAL) con los avisos por
 * WhatsApp ACTIVOS (WHATSAPP_RESERVAS_ACTIVO='true', como en la demo; prueba
 * de concepto del 21/11/2026):
 *   · /disponibilidad anuncia `avisos_whatsapp: true` en la fila `meta` (la
 *     web enseña entonces el selector «¿Cómo quieres recibir los avisos?»).
 *   · /crear guarda `canal_avisos: "whatsapp"` si el cliente lo elige, exige
 *     teléfono para ello y, si la migración 20261215100000 no está aplicada,
 *     guarda la reserva igual (avisos por correo).
 * Con la variable apagada no cambia nada: ver el bloque «WhatsApp apagado» al
 * final de consentimientos-reserva-web.integracion.test.ts.
 * Mismo andamiaje que ese fichero: BD en memoria, nada sale a la red.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";

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

const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  RESEND_API_KEY: "re_falsa",
  RESEND_FROM_EMAIL: "Casa Tomás <reservas@correo.test>",
  // Sin RESERVAS_WEB_CONDICIONES_OBLIGATORIAS: como quedará en producción (se exige).
  // Para firmar a mano un enlace antiguo de /confirmar (doble opt-in, abajo).
  RESERVAS_WEB_TOKEN_SECRET: "secreto-tokens-web",
  // Avisos por WhatsApp activos (como en la demo).
  WHATSAPP_RESERVAS_ACTIVO: "true",
};

const URL_FUNCION = "https://proyecto.supabase.co/functions/v1/reservas-web";
// «Ahora» fijo: jueves 1-10-2026, 10:00 en Madrid (08:00 UTC, horario de verano).
const AHORA = new Date("2026-10-01T08:00:00.000Z");
const FECHA = "2026-10-15";

const RECHAZO_CONDICIONES = {
  ok: false,
  error: "condiciones_no_aceptadas",
  mensaje: "Para enviar la reserva tienes que aceptar la política de privacidad y las condiciones de la reserva.",
};

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

/** Lo que mandará casa-tomas-story (ReservationForm.tsx) tras el cambio: sin `marca`, con las dos casillas. */
function reserva(over: Fila = {}): Fila {
  return {
    nombre: "Ana López",
    telefono: "+34 611 222 333",
    email: "ana@correo.test",
    fecha: FECHA,
    hora: "14:00",
    numero_comensales: 4,
    notas_cliente: "",
    acepta_condiciones: true,
    consentimiento_newsletter: false,
    ...over,
  };
}

async function crear(body: Fila) {
  const h = estadoPrueba().handler;
  if (!h) throw new Error("index.ts no ha registrado su handler");
  const res = await h(
    new Request(`${URL_FUNCION}/crear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  delete ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});


async function disponibilidad(body: Fila) {
  const h = estadoPrueba().handler;
  if (!h) throw new Error("index.ts no ha registrado su handler");
  const res = await h(
    new Request(`${URL_FUNCION}/disponibilidad`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, cuerpo: JSON.parse(await res.text()) };
}

describe("avisos por WhatsApp activos", () => {
  it("/disponibilidad: la fila meta anuncia avisos_whatsapp", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 4 });

    expect(r.status).toBe(200);
    expect(r.cuerpo[0]).toMatchObject({ kind: "meta", avisos_whatsapp: true });
  });

  it("eligió WhatsApp: se guarda en la reserva", async () => {
    const r = await crear(reserva({ canal_avisos: "whatsapp" }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toHaveLength(1);
    expect(db.tabla("reservas")[0]).toMatchObject({ canal_avisos: "whatsapp", telefono: "+34611222333" });
  });

  it("WhatsApp sin teléfono: 400 telefono_requerido_whatsapp y no se guarda nada", async () => {
    const r = await crear(reserva({ canal_avisos: "whatsapp", telefono: "" }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual({ ok: false, error: "telefono_requerido_whatsapp" });
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it.each([[undefined], ["email"], ["sms"], [true]])("canal_avisos = %j: no se manda la columna (queda el DEFAULT, correo)", async (valor) => {
    const r = await crear(reserva({ canal_avisos: valor }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")[0]).not.toHaveProperty("canal_avisos");
  });

  it("migración 20261215100000 sin aplicar: la reserva se guarda igual, sin la columna, y queda rastro", async () => {
    db.columnasInexistentes = { reservas: ["canal_avisos"] };

    const r = await crear(reserva({ canal_avisos: "whatsapp" }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toHaveLength(1);
    expect(db.tabla("reservas")[0]).not.toHaveProperty("canal_avisos");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("20261215100000"));
  });
});
