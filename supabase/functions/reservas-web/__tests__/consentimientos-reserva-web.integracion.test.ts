/**
 * Integración de reservas-web/index.ts (el fichero REAL): casillas RGPD del
 * formulario web en POST /crear (2026-10-03). Contra una BD EN MEMORIA
 * (bdFalsa.ts) y un Resend falso: nada sale a la red ni toca Supabase.
 *
 * QUÉ FALLO CUBREN. La migración 20260926062009 creó
 * `reservas.consentimiento_newsletter` y el trigger
 * `agregar_suscriptor_al_reservar_consentida` (alta en el newsletter solo con
 * consentimiento) y dejó escrito que reservas-web rellenaba la columna desde
 * el body. No lo hacía: todas las reservas web guardaban false y nadie se
 * daba de alta. Ahora:
 *   · `consentimiento_newsletter` (opcional) se guarda tal cual, solo si es
 *     el booleano `true`.
 *   · `acepta_condiciones` (obligatoria) se exige: sin ella, 400
 *     `condiciones_no_aceptadas` ANTES de leer o escribir nada; con ella se
 *     guarda la hora en `reservas.condiciones_aceptadas_at`.
 *   · Interruptor de transición: el secret
 *     RESERVAS_WEB_CONDICIONES_OBLIGATORIAS=false deja de exigirla.
 *   · Si la migración 20261003143000 no está aplicada (no existe
 *     `condiciones_aceptadas_at`), la reserva se crea igual, sin esa columna.
 *
 * El trigger es de la BD: aquí solo se comprueba lo que la función guarda en
 * `reservas`, que es lo que lo dispara.
 *
 * Mismos dobles que touza-sin-reservas.integracion.test.ts (vi.mock de los
 * tres imports por URL que Node no puede cargar).
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

describe("acepta_condiciones — obligatoria", () => {
  it("sin la casilla (la web de hoy): 400 «condiciones_no_aceptadas», sin tocar la BD ni mandar correos", async () => {
    const sinCasilla = reserva();
    delete sinCasilla.acepta_condiciones;

    const r = await crear(sinCasilla);

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
    expect(db.accesos).toEqual([]);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it.each([[false], ["true"], [1], ["on"], [null]])("acepta_condiciones = %j: 400 (solo el booleano true vale)", async (valor) => {
    const r = await crear(reserva({ acepta_condiciones: valor }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it("grupo grande sin la casilla: 400, y NO se registra solicitud ni se manda el correo de «no procesada»", async () => {
    const r = await crear(reserva({ acepta_condiciones: undefined, numero_comensales: 15 }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("Touza sin la casilla: sigue saliendo el 409 de Touza (va antes)", async () => {
    const r = await crear(reserva({ marca: "touza", acepta_condiciones: undefined }));

    expect(r.status).toBe(409);
    expect(r.cuerpo.motivo).toBe("touza_sin_reservas");
    expect(db.accesos).toEqual([]);
  });

  it("los datos obligatorios del formulario se siguen validando antes (nombre vacío -> nombre_requerido)", async () => {
    const r = await crear(reserva({ nombre: "", acepta_condiciones: undefined }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual({ ok: false, error: "nombre_requerido" });
  });

  it("con la casilla: 201 y la hora de aceptación guardada en condiciones_aceptadas_at", async () => {
    const r = await crear(reserva());

    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ ok: true, reserva_id: expect.any(String), estado: "pendiente" });
    expect(db.tabla("reservas")).toEqual([
      expect.objectContaining({
        id: r.cuerpo.reserva_id,
        canal: "web",
        marca: "casa_tomas",
        condiciones_aceptadas_at: AHORA.toISOString(),
        consentimiento_newsletter: false,
      }),
    ]);
  });
});

describe("consentimiento_newsletter — opcional, se guarda en la reserva (lo lee el trigger)", () => {
  it("true: la reserva se guarda con consentimiento_newsletter = true", async () => {
    const r = await crear(reserva({ consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ consentimiento_newsletter: true })]);
  });

  it("ausente: false (nunca se suscribe a nadie por omisión)", async () => {
    const sinCasilla = reserva();
    delete sinCasilla.consentimiento_newsletter;

    const r = await crear(sinCasilla);

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ consentimiento_newsletter: false })]);
  });

  it.each([["true"], [1], ["on"], [null]])("valor ambiguo %j: false", async (valor) => {
    const r = await crear(reserva({ consentimiento_newsletter: valor }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ consentimiento_newsletter: false })]);
  });
});

describe("interruptor de transición RESERVAS_WEB_CONDICIONES_OBLIGATORIAS", () => {
  it('"false": la reserva sin la casilla entra (201) con condiciones_aceptadas_at = null; el newsletter se sigue respetando', async () => {
    ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = "false";

    const r = await crear(reserva({ acepta_condiciones: undefined, consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([
      expect.objectContaining({ condiciones_aceptadas_at: null, consentimiento_newsletter: true }),
    ]);
  });

  it("se lee en cada petición: volver a quitarlo exige la casilla de nuevo sin recargar la función", async () => {
    ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = "false";
    expect((await crear(reserva({ acepta_condiciones: undefined }))).status).toBe(201);

    delete ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS;
    const r = await crear(reserva({ acepta_condiciones: undefined, telefono: "+34 622 333 444", email: "otra@correo.test" }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
  });
});

describe("función desplegada antes que la migración 20261003143000", () => {
  it("sin la columna condiciones_aceptadas_at: 201 igual, guardada sin ella y con consentimiento_newsletter; queda rastro en los logs", async () => {
    db.columnasInexistentes.reservas = ["condiciones_aceptadas_at"];

    const r = await crear(reserva({ consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toHaveLength(1);
    const fila = db.tabla("reservas")[0];
    expect(fila).not.toHaveProperty("condiciones_aceptadas_at");
    expect(fila).toMatchObject({ id: r.cuerpo.reserva_id, consentimiento_newsletter: true, canal: "web" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("condiciones_aceptadas_at"));
  });
});
