/**
 * Integración de reservas-web/index.ts (el fichero REAL): SALVAGUARDA del
 * doble opt-in (revisión final, 2026-10-04; ver reglas.ts).
 *
 * Mientras 20261003184500 no esté aplicada sigue vivo en producción el
 * trigger `agregar_suscriptor_al_reservar_consentida` (20261003143000): da de
 * alta en el newsletter EN EL INSERT de una reserva con
 * `consentimiento_newsletter = true`, sin verificar el email. Si la función
 * se desplegara antes que la migración, cualquiera podría suscribir un email
 * ajeno. Por eso la función solo guarda la casilla cuando existe
 * `reservas.email_verificado_at` (la crea 184500 en la misma transacción que
 * borra ese trigger).
 *
 * Fichero aparte a propósito: index.ts recuerda el «sí» del sondeo en una
 * variable de módulo y cada fichero de vitest carga el módulo de cero.
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

const insertada = () => db.tabla("reservas").find((f) => f.nombre === "Ana López") as Fila | undefined;

describe("salvaguarda del doble opt-in en POST /crear", () => {
  it("SIN la migración 184500 (no existe email_verificado_at): la reserva se crea, pero la casilla NO llega a la BD", async () => {
    db.columnasInexistentes.reservas = ["email_verificado_at"];

    const r = await crear(reserva({ consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(insertada()?.consentimiento_newsletter).toBe(false);
    // Las condiciones sí se guardan (no disparan nada).
    expect(typeof insertada()?.condiciones_aceptadas_at).toBe("string");
  });

  it("CON la migración 184500: la casilla se guarda (y el «sí» se recuerda: no se vuelve a sondear)", async () => {
    const r = await crear(reserva({ consentimiento_newsletter: true }));
    expect(r.status).toBe(201);
    expect(insertada()?.consentimiento_newsletter).toBe(true);

    // Aunque ahora la columna "desapareciera", el «sí» quedó recordado.
    sembrar();
    db.columnasInexistentes.reservas = ["email_verificado_at"];
    const r2 = await crear(reserva({ consentimiento_newsletter: true }));
    expect(r2.status).toBe(201);
    expect(insertada()?.consentimiento_newsletter).toBe(true);
  });
});
