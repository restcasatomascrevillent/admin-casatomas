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
 *   · Desde 20261003184500 (doble opt-in) el alta ya no la hace ese trigger
 *     en el INSERT: la casilla se guarda aquí y el alta llega cuando el
 *     cliente verifica el email (ver el bloque «Doble opt-in» al final).
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

// ============================================================================
// Batería ampliada (2026-10-03): casos límite que no cubría lo de arriba.
// ============================================================================

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
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null };
}

/** Intentos de INSERT en `reservas` (incluidos los que fallaron con PGRST204). */
const insertsEnReservas = () => db.accesos.filter((a) => a.tabla === "reservas" && a.op === "insert").length;

describe("acepta_condiciones no válida: la petición muere ANTES de tocar nada", () => {
  it.each([
    ["ausente", undefined],
    ["false", false],
    ['"true"', "true"],
    ["1", 1],
    ["0", 0],
    ['""', ""],
    ['"on"', "on"],
    ["null", null],
    ["{}", {}],
    ["[true]", [true]],
  ])("acepta_condiciones %s: 400, cero lecturas/escrituras, cero solicitudes y cero correos", async (_etiqueta, valor) => {
    const cuerpo = reserva({ consentimiento_newsletter: true });
    if (valor === undefined) delete cuerpo.acepta_condiciones;
    else cuerpo.acepta_condiciones = valor;

    const r = await crear(cuerpo);

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
    expect(db.accesos).toEqual([]);
    expect(db.tabla("reservas")).toHaveLength(0);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("teléfono en la lista negra y sin la casilla: 400 (no el 403), sin consultar siquiera la lista negra", async () => {
    db.tabla("blacklist").push({ tipo: "telefono", valor: "611222333", motivo: "No se presentó" });

    const r = await crear(reserva({ acepta_condiciones: false }));

    expect(r.status).toBe(400);
    expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
    expect(db.accesos).toEqual([]);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("límite de reservas por teléfono ya alcanzado y sin la casilla: 400, sin solicitud «max_reservas_telefono»", async () => {
    for (const id of ["r-1", "r-2"]) {
      db.tabla("reservas").push({ id, telefono: "+34611222333", fecha: FECHA, hora: "21:00:00", numero_comensales: 2, estado: "pendiente", marca: "casa_tomas" });
    }

    const r = await crear(reserva({ acepta_condiciones: false }));

    expect(r.status).toBe(400);
    expect(db.accesos).toEqual([]);
    expect(db.tabla("reservas")).toHaveLength(2);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("reserva para HOY sin la casilla: 400, sin solicitud «reserva_hoy» ni correo", async () => {
    const r = await crear(reserva({ acepta_condiciones: false, fecha: "2026-10-01", hora: "21:00" }));

    expect(r.status).toBe(400);
    expect(db.accesos).toEqual([]);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(estadoPrueba().correos).toEqual([]);
  });

  it("aceptar la newsletter NO sustituye a las condiciones", async () => {
    const r = await crear(reserva({ acepta_condiciones: false, consentimiento_newsletter: true }));

    expect(r.status).toBe(400);
    expect(db.tabla("reservas")).toHaveLength(0);
  });
});

describe("consentimiento_newsletter — tabla completa de valores", () => {
  it.each([
    [true, true],
    [false, false],
    ["true", false],
    ["false", false],
    [1, false],
    [0, false],
    ["on", false],
    ["yes", false],
    [null, false],
    [{}, false],
    [[true], false],
  ])("consentimiento_newsletter = %j -> se guarda %j (solo el booleano true es un sí)", async (valor, esperado) => {
    const r = await crear(reserva({ consentimiento_newsletter: valor }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([
      expect.objectContaining({ consentimiento_newsletter: esperado, condiciones_aceptadas_at: AHORA.toISOString() }),
    ]);
  });

  it("se guarda siempre como booleano, nunca el valor crudo del cuerpo", async () => {
    await crear(reserva({ consentimiento_newsletter: "true" }));

    expect(typeof db.tabla("reservas")[0].consentimiento_newsletter).toBe("boolean");
  });

  it("sin email y con la casilla marcada: la reserva entra y guarda el consentimiento (el trigger de la BD no da de alta sin email)", async () => {
    const r = await crear(reserva({ email: "", consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ email: null, consentimiento_newsletter: true })]);
  });

  it("la reserva de un grupo grande (422) no guarda ninguna reserva, así que no puede dar de alta a nadie", async () => {
    const r = await crear(reserva({ numero_comensales: 15, consentimiento_newsletter: true }));

    expect(r.status).toBe(422);
    expect(db.tabla("reservas")).toHaveLength(0);
  });
});

describe("interruptor RESERVAS_WEB_CONDICIONES_OBLIGATORIAS — valores mal escritos NO lo apagan", () => {
  it.each([["0"], ["no"], ["off"], ["fasle"], ["falso"], ["true"], [""], ["   "], ["false;"], ["'false'"]])(
    "secret = %j: se sigue exigiendo la casilla (400 sin ella)",
    async (valor) => {
      ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = valor;

      const r = await crear(reserva({ acepta_condiciones: undefined }));

      expect(r.status).toBe(400);
      expect(r.cuerpo).toEqual(RECHAZO_CONDICIONES);
      expect(db.accesos).toEqual([]);
    },
  );

  // Comportamiento DOCUMENTADO en reglas.ts (`condicionesObligatorias`):
  // "false" se compara sin distinguir mayúsculas ni espacios. Se fija aquí
  // para que un cambio de criterio sea consciente (ver informe de la batería).
  it.each([["false"], ["FALSE"], ["False"], [" false "]])("secret = %j: la desactiva (201 sin la casilla, condiciones_aceptadas_at null)", async (valor) => {
    ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = valor;

    const r = await crear(reserva({ acepta_condiciones: undefined }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ condiciones_aceptadas_at: null })]);
  });

  it("con el interruptor apagado y la casilla marcada, se sigue guardando la hora de aceptación", async () => {
    ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = "false";

    const r = await crear(reserva());

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ condiciones_aceptadas_at: AHORA.toISOString() })]);
  });
});

describe("reintento sin condiciones_aceptadas_at (PGRST204) — solo para ESA columna y una sola vez", () => {
  it("casilla de newsletter desmarcada: reintenta una vez y guarda false", async () => {
    db.columnasInexistentes.reservas = ["condiciones_aceptadas_at"];

    const r = await crear(reserva());

    expect(r.status).toBe(201);
    expect(insertsEnReservas()).toBe(2);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ consentimiento_newsletter: false })]);
    expect(db.tabla("reservas")[0]).not.toHaveProperty("condiciones_aceptadas_at");
  });

  it("interruptor apagado y sin casilla (condiciones_aceptadas_at = null también va en la fila): reintenta y entra", async () => {
    ENV.RESERVAS_WEB_CONDICIONES_OBLIGATORIAS = "false";
    db.columnasInexistentes.reservas = ["condiciones_aceptadas_at"];

    const r = await crear(reserva({ acepta_condiciones: undefined }));

    expect(r.status).toBe(201);
    expect(insertsEnReservas()).toBe(2);
  });

  it("si falta OTRA columna (p. ej. consentimiento_newsletter) NO se reintenta: 500 y ningún dato a medias", async () => {
    db.columnasInexistentes.reservas = ["consentimiento_newsletter"];

    const r = await crear(reserva({ consentimiento_newsletter: true }));

    expect(r.status).toBe(500);
    expect(r.cuerpo).toEqual({ ok: false, error: "internal_error" });
    expect(insertsEnReservas()).toBe(1);
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it("si el reintento también falla, no hay un tercer intento: 500", async () => {
    db.columnasInexistentes.reservas = ["condiciones_aceptadas_at", "consentimiento_newsletter"];

    const r = await crear(reserva());

    expect(r.status).toBe(500);
    expect(insertsEnReservas()).toBe(2);
    expect(db.tabla("reservas")).toHaveLength(0);
  });
});

describe("lo que NO debe cambiar con las casillas", () => {
  it("Touza con acepta_condiciones false y newsletter true: 409 de Touza, sin guardar consentimiento alguno", async () => {
    const r = await crear(reserva({ marca: "touza", acepta_condiciones: false, consentimiento_newsletter: true }));

    expect(r.status).toBe(409);
    expect(r.cuerpo.motivo).toBe("touza_sin_reservas");
    expect(db.accesos).toEqual([]);
  });

  it("Touza CON las dos casillas: sigue siendo 409 (aceptar condiciones no reabre las reservas de Touza)", async () => {
    const r = await crear(reserva({ marca: "touza", consentimiento_newsletter: true }));

    expect(r.status).toBe(409);
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it("un `canal` en el cuerpo se ignora: la reserva es siempre canal 'web' y la casilla se exige igual", async () => {
    expect((await crear(reserva({ canal: "telefono", acepta_condiciones: undefined }))).status).toBe(400);

    const r = await crear(reserva({ canal: "telefono", consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ canal: "web", consentimiento_newsletter: true })]);
  });

  it("/disponibilidad no pide casillas (la usan también el panel y otros canales): 200 sin acepta_condiciones", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 4 });

    expect(r.status).toBe(200);
    expect(Array.isArray(r.cuerpo)).toBe(true);
    expect(db.escrituras()).toEqual([]);
  });

  it("cuerpo que no es JSON: 400 invalid_json (antes de mirar las casillas)", async () => {
    const h = estadoPrueba().handler!;
    const res = await h(
      new Request(`${URL_FUNCION}/crear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{no-json" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_json" });
    expect(db.accesos).toEqual([]);
  });
});

// ============================================================================
// Doble opt-in del newsletter (migración 20261003184500)
// ============================================================================

describe("solicitudes pendientes: la casilla del newsletter ya no se pierde", () => {
  it("grupo grande con la casilla: la solicitud guarda consentimiento_newsletter y condiciones_aceptadas_at", async () => {
    const r = await crear(reserva({ numero_comensales: 15, consentimiento_newsletter: true }));

    expect(r.status).toBe(422);
    expect(r.cuerpo.motivo).toBe("grupo_grande");
    expect(db.tabla("reservas")).toHaveLength(0);
    expect(db.tabla("solicitudes_pendientes")).toEqual([
      expect.objectContaining({
        email: "ana@correo.test",
        motivo_rechazo: "grupo_grande",
        consentimiento_newsletter: true,
        condiciones_aceptadas_at: AHORA.toISOString(),
      }),
    ]);
  });

  it("sin la casilla del newsletter: la solicitud guarda false", async () => {
    const r = await crear(reserva({ numero_comensales: 15 }));

    expect(r.status).toBe(422);
    expect(db.tabla("solicitudes_pendientes")).toEqual([
      expect.objectContaining({ consentimiento_newsletter: false, condiciones_aceptadas_at: AHORA.toISOString() }),
    ]);
  });

  it("para hoy (reserva_hoy) también la guarda", async () => {
    const r = await crear(reserva({ fecha: "2026-10-01", hora: "21:00", consentimiento_newsletter: true }));

    expect(r.cuerpo.motivo).toBe("reserva_hoy");
    expect(db.tabla("solicitudes_pendientes")).toEqual([expect.objectContaining({ consentimiento_newsletter: true })]);
  });

  it("función desplegada antes que la migración: la solicitud se guarda igual, sin las casillas", async () => {
    db.columnasInexistentes.solicitudes_pendientes = ["consentimiento_newsletter", "condiciones_aceptadas_at"];

    const r = await crear(reserva({ numero_comensales: 15, consentimiento_newsletter: true }));

    expect(r.status).toBe(422);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(1);
    const fila = db.tabla("solicitudes_pendientes")[0];
    expect(fila).not.toHaveProperty("consentimiento_newsletter");
    expect(fila).not.toHaveProperty("condiciones_aceptadas_at");
    expect(fila).toMatchObject({ motivo_rechazo: "grupo_grande", email: "ana@correo.test" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("20261003184500"));
  });

  it("crear la reserva con la casilla NO la da por verificada (el alta espera al clic del correo)", async () => {
    const r = await crear(reserva({ consentimiento_newsletter: true }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")[0]).not.toHaveProperty("email_verificado_at");
  });
});

describe("GET /confirmar (enlaces antiguos): el clic del cliente verifica el email", () => {
  function b64url(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function tokenConfirmar(id: string, fp: string): Promise<string> {
    const carga = b64url(new TextEncoder().encode(JSON.stringify({ id, action: "confirmar", exp: Math.floor(AHORA.getTime() / 1000) + 3600, fp })));
    const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode("secreto-tokens-web"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(carga)));
    return `${carga}.${b64url(firma)}`;
  }
  async function confirmar(token: string) {
    const h = estadoPrueba().handler;
    if (!h) throw new Error("index.ts no ha registrado su handler");
    return h(new Request(`${URL_FUNCION}/confirmar?token=${encodeURIComponent(token)}`, { method: "GET" }));
  }
  const ACTUALIZADA = "2026-09-30T10:00:00.000Z";

  it("verificada -> confirmada y email_verificado_at = ahora", async () => {
    db.tabla("reservas").push({
      id: "res-web-1", nombre: "Ana", email: "ana@correo.test", fecha: FECHA, hora: "14:00", numero_comensales: 2,
      estado: "verificada", updated_at: ACTUALIZADA, consentimiento_newsletter: true, marca: "casa_tomas",
    });

    const res = await confirmar(await tokenConfirmar("res-web-1", `verificada|${ACTUALIZADA}`));

    expect(res.status).toBe(200);
    expect(db.tabla("reservas")[0]).toMatchObject({ estado: "confirmada", email_verificado_at: AHORA.toISOString() });
  });

  it("token inválido: ni se confirma ni se verifica", async () => {
    db.tabla("reservas").push({
      id: "res-web-2", nombre: "Ana", email: "ana@correo.test", fecha: FECHA, hora: "14:00", numero_comensales: 2,
      estado: "verificada", updated_at: ACTUALIZADA, consentimiento_newsletter: true, marca: "casa_tomas",
    });

    await confirmar(await tokenConfirmar("res-web-2", "verificada|otra-fecha"));

    expect(db.tabla("reservas")[0]).toMatchObject({ estado: "verificada" });
    expect(db.tabla("reservas")[0]).not.toHaveProperty("email_verificado_at");
  });
});
