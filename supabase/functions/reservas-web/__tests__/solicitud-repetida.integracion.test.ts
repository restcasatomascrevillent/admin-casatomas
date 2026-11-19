/**
 * Solicitud repetida en POST /reservas-web/crear (CAS-13, 19/11/2026), contra
 * el index.ts REAL con la base de datos en memoria (`bdFalsa.ts`).
 *
 * El 18/11/2026 un cliente reservó, la web le enseñó un error justo después de
 * guardarse (el traductor del navegador tiraba la página) y volvió a reservar:
 * dos reservas iguales con un minuto de diferencia. Ahora la segunda petición
 * devuelve la reserva que ya existe (mismo 201, `repetida: true`) y no se crea
 * otra fila.
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
};
const URL_FUNCION = "https://proyecto.supabase.co/functions/v1/reservas-web";
// Jueves 1-10-2026, 10:00 en Madrid: el 15-10 queda dentro de la antelación máxima.
const AHORA = new Date("2026-10-01T08:00:00.000Z");

const CUERPO: Fila = {
  nombre: "Marta Ruiz",
  telefono: "+34 612345678",
  email: "marta@example.com",
  fecha: "2026-10-15",
  hora: "20:00",
  numero_comensales: 2,
  notas_cliente: "",
  estado: "pendiente",
  acepta_condiciones: true,
  consentimiento_newsletter: false,
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
  );
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

const reservas = () => db.tabla("reservas");

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /crear con una solicitud repetida", () => {
  it("la misma solicitud un minuto después devuelve la reserva que ya existe y no crea otra", async () => {
    const primera = await crear(CUERPO);
    expect(primera.status).toBe(201);
    expect(reservas()).toHaveLength(1);

    vi.setSystemTime(new Date(AHORA.getTime() + 67_000));
    const segunda = await crear(CUERPO);

    expect(segunda.status).toBe(201);
    expect(segunda.cuerpo).toMatchObject({ ok: true, reserva_id: primera.cuerpo.reserva_id, estado: "pendiente", repetida: true });
    expect(reservas()).toHaveLength(1);
    expect(estadoPrueba().correos).toEqual([]);
    expect(db.tabla("solicitudes_pendientes")).toEqual([]);
  });

  it("con el mismo teléfono escrito de otra forma y otro email también es la misma", async () => {
    const primera = await crear(CUERPO);
    const segunda = await crear({ ...CUERPO, telefono: "612 345 678", email: "otra@example.com" });
    expect(segunda.status).toBe(201);
    expect(segunda.cuerpo.reserva_id).toBe(primera.cuerpo.reserva_id);
    expect(reservas()).toHaveLength(1);
  });

  it("otra hora u otros comensales sí crean una reserva nueva", async () => {
    await crear(CUERPO);
    const otraHora = await crear({ ...CUERPO, hora: "21:00" });
    expect(otraHora.status).toBe(201);
    expect(otraHora.cuerpo.repetida).toBeUndefined();
    expect(reservas()).toHaveLength(2);
  });

  it("si la primera se canceló, la nueva solicitud crea otra reserva", async () => {
    await crear(CUERPO);
    reservas()[0].estado = "cancelada";
    const otra = await crear(CUERPO);
    expect(otra.status).toBe(201);
    expect(otra.cuerpo.repetida).toBeUndefined();
    expect(reservas()).toHaveLength(2);
  });

  it("pasada media hora cuenta como reserva nueva (sigue mandando el límite por teléfono)", async () => {
    await crear(CUERPO);
    vi.setSystemTime(new Date(AHORA.getTime() + 31 * 60_000));
    const otra = await crear(CUERPO);
    expect(otra.status).toBe(201);
    expect(otra.cuerpo.repetida).toBeUndefined();
    expect(reservas()).toHaveLength(2);
  });
});
