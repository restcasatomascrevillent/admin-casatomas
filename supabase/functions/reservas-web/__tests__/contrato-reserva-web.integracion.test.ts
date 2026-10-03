/**
 * CONTRATO web <-> backend de POST /reservas-web/crear (lado BACKEND).
 *
 * El fixture `contrato/reserva-web-crear.contrato.json` es el cuerpo EXACTO
 * que manda el formulario de casa-tomas-story (ReservationForm.tsx). Vive
 * duplicado, byte a byte igual, en
 * casa-tomas-story/src/__tests__/contratos/reserva-web-crear.contrato.json,
 * donde otro test comprueba que el formulario envía justo eso. Aquí se
 * comprueba que el index.ts REAL lo acepta y guarda lo que debe:
 *   · `acepta_condiciones: true`  -> 201 + `condiciones_aceptadas_at`
 *   · `consentimiento_newsletter` -> `reservas.consentimiento_newsletter`
 *     (lo que dispara el alta en `newsletter_suscriptores`).
 * Si alguien renombra un campo en un lado y no en el otro, uno de los dos
 * tests se rompe (ver también los casos de «deriva» al final).
 *
 * Comprobación opcional entre repos: con
 *   CONTRATO_RESERVA_WEB_GEMELO=<ruta al JSON de casa-tomas-story> npx vitest run …
 * se exige además que las dos copias sean idénticas.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";
import { leerConsentimientos } from "../reglas";

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

// Los tests se lanzan desde la raíz del repo (como el resto de la suite).
const RUTA_CONTRATO = path.resolve(process.cwd(), "supabase/functions/reservas-web/__tests__/contrato/reserva-web-crear.contrato.json");
const TEXTO_CONTRATO = readFileSync(RUTA_CONTRATO, "utf8");

interface Contrato {
  version: number;
  endpoint: string;
  tipos: Record<string, "string" | "number" | "boolean">;
  casos: Record<string, { descripcion: string; cuerpo: Fila }>;
}
const CONTRATO = JSON.parse(TEXTO_CONTRATO) as Contrato;

const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  RESEND_API_KEY: "re_falsa",
  RESEND_FROM_EMAIL: "Casa Tomás <reservas@correo.test>",
};

const URL_FUNCION = "https://proyecto.supabase.co/functions/v1/reservas-web";
// «Ahora» fijo: jueves 1-10-2026, 10:00 en Madrid. La fecha del contrato
// (15-10-2026) queda dentro de la antelación máxima y fuera del «mismo día».
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

describe("el fixture de contrato es coherente consigo mismo", () => {
  it("endpoint y casos esperados", () => {
    expect(CONTRATO.endpoint).toBe("POST /functions/v1/reservas-web/crear");
    expect(Object.keys(CONTRATO.casos).sort()).toEqual(["con_newsletter", "sin_newsletter"]);
  });

  it.each(Object.entries(CONTRATO.casos))("caso %s: exactamente los campos de `tipos`, con esos tipos", (_nombre, caso) => {
    expect(Object.keys(caso.cuerpo).sort()).toEqual(Object.keys(CONTRATO.tipos).sort());
    for (const [campo, tipo] of Object.entries(CONTRATO.tipos)) {
      expect(typeof caso.cuerpo[campo], campo).toBe(tipo);
    }
  });

  it("las dos casillas viajan como booleanos con estos nombres EXACTOS", () => {
    expect(CONTRATO.tipos.acepta_condiciones).toBe("boolean");
    expect(CONTRATO.tipos.consentimiento_newsletter).toBe("boolean");
  });

  const gemelo = process.env.CONTRATO_RESERVA_WEB_GEMELO;
  it.skipIf(!gemelo)("la copia de casa-tomas-story es idéntica (solo con CONTRATO_RESERVA_WEB_GEMELO)", () => {
    expect(existsSync(gemelo!), `no existe ${gemelo}`).toBe(true);
    expect(readFileSync(gemelo!, "utf8").replace(/\r\n/g, "\n")).toBe(TEXTO_CONTRATO.replace(/\r\n/g, "\n"));
  });
});

describe("reglas.ts lee los campos del contrato", () => {
  it.each(Object.entries(CONTRATO.casos))("caso %s: leerConsentimientos devuelve lo que dice el cuerpo", (_nombre, caso) => {
    expect(leerConsentimientos(caso.cuerpo)).toEqual({
      aceptaCondiciones: caso.cuerpo.acepta_condiciones,
      consentimientoNewsletter: caso.cuerpo.consentimiento_newsletter,
    });
  });
});

describe("index.ts acepta el cuerpo del contrato tal cual", () => {
  it.each(Object.entries(CONTRATO.casos))("caso %s: 201 y la reserva guarda las casillas del cuerpo", async (_nombre, caso) => {
    const r = await crear(caso.cuerpo);

    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ ok: true, reserva_id: expect.any(String), estado: "pendiente" });
    expect(db.tabla("reservas")).toEqual([
      expect.objectContaining({
        id: r.cuerpo.reserva_id,
        nombre: caso.cuerpo.nombre,
        email: caso.cuerpo.email,
        // El formulario manda "+34 612345678"; la función lo normaliza.
        telefono: "+34612345678",
        fecha: caso.cuerpo.fecha,
        hora: caso.cuerpo.hora,
        numero_comensales: caso.cuerpo.numero_comensales,
        estado: "pendiente",
        canal: "web",
        marca: "casa_tomas",
        consentimiento_newsletter: caso.cuerpo.consentimiento_newsletter,
        condiciones_aceptadas_at: AHORA.toISOString(),
      }),
    ]);
    // El canal web no manda correo en el alta (decisión del 2026-09-28).
    expect(estadoPrueba().correos).toEqual([]);
  });
});

describe("deriva del contrato: lo que pasaría si un lado cambiase y el otro no", () => {
  const base = CONTRATO.casos.con_newsletter.cuerpo;

  it("si la web mandase `aceptaCondiciones` (camelCase) en vez de `acepta_condiciones`: 400 y nada guardado", async () => {
    const { acepta_condiciones, ...resto } = base;
    const r = await crear({ ...resto, aceptaCondiciones: acepta_condiciones });

    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe("condiciones_no_aceptadas");
    expect(db.accesos).toEqual([]);
  });

  it("si la web mandase `newsletter` en vez de `consentimiento_newsletter`: la reserva entra pero SIN consentimiento (nunca se infiere)", async () => {
    const { consentimiento_newsletter, ...resto } = base;
    const r = await crear({ ...resto, newsletter: consentimiento_newsletter });

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ consentimiento_newsletter: false })]);
  });

  it('si la web mandase las casillas como texto ("true"): condiciones rechazadas', async () => {
    const r = await crear({ ...base, acepta_condiciones: "true", consentimiento_newsletter: "true" });

    expect(r.status).toBe(400);
    expect(db.tabla("reservas")).toHaveLength(0);
  });
});
