/**
 * Integración de reservas-web/index.ts (el fichero REAL): Touza NO admite
 * reservas (decisión del dueño, 2026-10-01: «toda la lógica de reservas de
 * Touza va fuera, no se reserva»). Contra una BD EN MEMORIA (bdFalsa.ts) y un
 * Resend falso: nada sale a la red ni toca Supabase.
 *
 * QUÉ FALLO CUBREN. La web de Touza (touza-restaurant-website, desplegada)
 * sigue mandando `marca: "touza"` a POST /crear desde /reservado. Hasta ahora
 * esa petición recorría el circuito entero: lista negra, `grupo_grande` (casi
 * todas: El Reservado es para hasta 20 y el máximo automático es 12), límites
 * por teléfono/email e INSERT. `grupo_grande` registra una solicitud en
 * `solicitudes_pendientes` y la web de Touza lo pinta como «Solicitud
 * recibida»: el cliente cree que alguien la va a revisar y no la atiende nadie.
 *
 * CONTRATO CON LA WEB DE TOUZA (src/pages/Reservado.tsx +
 * src/lib/reservas-web.ts::interpretarRechazoReserva): solo un 201 o
 * `motivo: "grupo_grande"` se pintan como «Solicitud recibida». Todo lo demás
 * es un rechazo: título «No hemos podido enviar tu solicitud», el `mensaje`
 * del servidor tal cual y, para un 409 con un motivo que no conoce, la salida
 * «Llámanos al 966 782 000…». Por eso: 409 + `motivo` + `mensaje`.
 *
 * Y LO QUE NO DEBE CAMBIAR: Casa Tomás (crear, disponibilidad, grupo grande,
 * lista negra) y las marcas desconocidas, que siguen cayendo en Casa Tomás.
 *
 * index.ts importa tres módulos por URL (deno.land / esm.sh) que Node no puede
 * cargar: aquí los sustituye vi.mock, sin tocar vitest.config.ts (mismo patrón
 * que emails-reserva/__tests__/notificar-modificacion.integracion.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { BaseFalsa, estadoPrueba, type Fila } from "./bdFalsa";
import { MARCAS_VALIDAS, resolverMarca } from "../plantillas.ts";

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

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  RESEND_API_KEY: "re_falsa",
  RESEND_FROM_EMAIL: "Casa Tomás <reservas@correo.test>",
  // Sin RESERVAS_WEB_ALLOWED_ORIGIN ni RESERVAS_WEB_SHARED_SECRET: como en producción.
};

const URL_FUNCION = "https://proyecto.supabase.co/functions/v1/reservas-web";
// «Ahora» fijo: jueves 1-10-2026, 10:00 en Madrid (08:00 UTC, horario de verano).
const AHORA = new Date("2026-10-01T08:00:00.000Z");
// Dos semanas después: ni hoy, ni pasada, ni más allá de los 60 días de antelación.
const FECHA = "2026-10-15";

/** Lo que tiene que ver el cliente de Touza. `mensaje` incluye el teléfono de Touza. */
const RECHAZO_TOUZA = {
  ok: false,
  motivo: "touza_sin_reservas",
  mensaje: "Touza no admite reservas por la web. Para cualquier consulta, llámanos al 966 782 000.",
};

let db: BaseFalsa;
let llamadasFetch: string[] = [];

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
    { id: "el-reservado", nombre: "El Reservado", capacidad_maxima: 20, activa: true, caracteristicas: { marca: "touza" } },
  );
}

/** Lo que manda HOY la web de Touza desde /reservado (Reservado.tsx, handleSubmit). */
function solicitudTouza(over: Fila = {}): Fila {
  return {
    marca: "touza",
    nombre: "Lucía Pérez",
    telefono: "612 345 678",
    email: "lucia@correo.test",
    fecha: FECHA,
    hora: "22:00",
    numero_comensales: 8,
    notas_cliente: "Solicitud de El Reservado (espacio privado, hasta 20 personas).",
    estado: "pendiente",
    ...over,
  };
}

/** Lo que manda casa-tomas-story (ReservationForm.tsx): sin `marca` y, desde el
 * 2026-10-03, con la casilla obligatoria `acepta_condiciones` (sin ella, 400 —
 * ver consentimientos-reserva-web.integracion.test.ts). */
function reservaCasaTomas(over: Fila = {}): Fila {
  return {
    acepta_condiciones: true,
    nombre: "Ana López",
    telefono: "+34 611 222 333",
    email: "ana@correo.test",
    fecha: FECHA,
    hora: "14:00",
    numero_comensales: 4,
    notas_cliente: "",
    estado: "pendiente",
    ...over,
  };
}

function handler(): (req: Request) => Promise<Response> {
  const h = estadoPrueba().handler;
  if (!h) throw new Error("index.ts no ha registrado su handler");
  return h;
}

async function llamar(ruta: string, body: unknown) {
  const res = await handler()(
    new Request(`${URL_FUNCION}/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const texto = await res.text();
  return { status: res.status, cabeceras: res.headers, cuerpo: texto ? JSON.parse(texto) : null };
}
const crear = (body: Fila) => llamar("crear", body);
const disponibilidad = (body: Fila) => llamar("disponibilidad", body);
const correos = () => estadoPrueba().correos;

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ENV[k] } });
  vi.stubGlobal("fetch", async (url: unknown) => {
    llamadasFetch.push(String(url));
    throw new Error(`fetch inesperado en un test: ${String(url)}`);
  });
  sembrar();
  await import("../index.ts");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  llamadasFetch = [];
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

describe("POST /crear de Touza — 409 «touza_sin_reservas» y nada más", () => {
  it("la petición tal cual la manda la web de Touza: 409 con motivo y mensaje, sin tocar la BD ni mandar correos", async () => {
    const r = await crear(solicitudTouza());

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    // Ni una lectura: se rechaza antes de leer la configuración.
    expect(db.accesos).toEqual([]);
    expect(correos()).toEqual([]);
    expect(llamadasFetch).toEqual([]);
  });

  it("grupo grande (15 > máximo automático de 12): 409 y NO «grupo_grande» (la web lo pintaría como «Solicitud recibida»); no se registra solicitud", async () => {
    const r = await crear(solicitudTouza({ numero_comensales: 15 }));

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(db.tabla("notificaciones_dashboard")).toHaveLength(0);
    expect(db.accesos).toEqual([]);
    expect(correos()).toEqual([]);
  });

  it("teléfono en la lista negra: el 409 de Touza, no el 403 de la lista negra, y sin correo de «no procesada»", async () => {
    db.tabla("blacklist").push({ tipo: "telefono", valor: "612345678", motivo: "No se presentó" });

    const r = await crear(solicitudTouza());

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.accesos).toEqual([]);
    expect(correos()).toEqual([]);
  });

  it("límite por teléfono ya alcanzado ese día: 409 de Touza, sin «max_reservas_telefono» ni solicitud", async () => {
    for (const id of ["r-1", "r-2"]) {
      db.tabla("reservas").push({ id, telefono: "+34612345678", fecha: FECHA, hora: "22:00:00", numero_comensales: 8, estado: "pendiente", marca: "touza" });
    }

    const r = await crear(solicitudTouza());

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(db.tabla("reservas")).toHaveLength(2);
    expect(correos()).toEqual([]);
  });

  it("aunque el formulario venga mal (sin nombre, fecha rota, 0 personas): no se le pide corregir algo que nunca se va a poder enviar", async () => {
    const r = await crear(solicitudTouza({ nombre: "", fecha: "15/10/2026", numero_comensales: 0 }));

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.accesos).toEqual([]);
  });

  it("sin `marca`, reconocida por la nota fija de El Reservado (misma resolución que ya usaba la función): 409", async () => {
    const sinMarca = solicitudTouza();
    delete sinMarca.marca;

    const r = await crear(sinMarca);

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.accesos).toEqual([]);
  });

  it("con el espacio de El Reservado (espacio_id y sala): 409, sin crear la reserva", async () => {
    const r = await crear(solicitudTouza({ espacio_id: "el-reservado", sala: "El Reservado" }));

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it("LA TRAMPA: Touza sigue siendo una marca VÁLIDA; si dejara de serlo, esta misma petición acabaría creando en silencio una reserva de Casa Tomás", () => {
    expect(MARCAS_VALIDAS).toContain("touza");
    expect(resolverMarca({ marcaExplicita: solicitudTouza().marca })).toBe("touza");
  });
});

describe("POST /disponibilidad de Touza — 409, sin calcular nada", () => {
  it("con `marca: \"touza\"`: 409 con el mismo cuerpo, sin escrituras y sin leer la ocupación", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 8, marca: "touza" });

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.escrituras()).toEqual([]);
    const tablasLeidas = db.accesos.map((a) => a.tabla);
    expect(tablasLeidas).not.toContain("reservas");
    expect(tablasLeidas).not.toContain("configuracion_reservas");
  });

  it("con el espacio de El Reservado y sin `marca` (la marca sale del espacio, como ya hacía la función): 409", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 8, espacio_id: "el-reservado" });

    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual(RECHAZO_TOUZA);
    expect(db.escrituras()).toEqual([]);
  });
});

describe("CORS — la web de Touza tiene que poder LEER el 409", () => {
  it("el 409 lleva las mismas cabeceras CORS que cualquier otra respuesta de la función", async () => {
    const touza = await crear(solicitudTouza());
    const casaTomas = await crear(reservaCasaTomas());

    expect(touza.status).toBe(409);
    expect(casaTomas.status).toBe(201);
    for (const cabecera of ["Access-Control-Allow-Origin", "Access-Control-Allow-Headers", "Access-Control-Allow-Methods", "Content-Type"]) {
      expect(touza.cabeceras.get(cabecera)).toBe(casaTomas.cabeceras.get(cabecera));
    }
    expect(touza.cabeceras.get("Access-Control-Allow-Origin")).toBe("*");
    expect(touza.cabeceras.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(touza.cabeceras.get("Content-Type")).toBe("application/json");
  });

  it("el preflight OPTIONS sigue respondiendo con CORS (si no, el navegador ni siquiera enviaría la petición)", async () => {
    const res = await handler()(new Request(`${URL_FUNCION}/crear`, { method: "OPTIONS" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("content-type");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });
});

describe("Casa Tomás — exactamente igual que antes", () => {
  it("/crear: 201 y una reserva 'pendiente' de Casa Tomás, canal web, sin sala; sin correo", async () => {
    const r = await crear(reservaCasaTomas());

    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ ok: true, reserva_id: expect.any(String), estado: "pendiente" });
    expect(db.tabla("reservas")).toEqual([
      expect.objectContaining({
        id: r.cuerpo.reserva_id,
        marca: "casa_tomas",
        canal: "web",
        estado: "pendiente",
        espacio_id: null,
        telefono: "+34611222333",
        fecha: FECHA,
        hora: "14:00",
        numero_comensales: 4,
      }),
    ]);
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(correos()).toEqual([]);
  });

  it("/crear de un grupo grande: 422 «grupo_grande», solicitud de Casa Tomás registrada y correo de «no procesada»", async () => {
    const r = await crear(reservaCasaTomas({ numero_comensales: 15 }));

    expect(r.status).toBe(422);
    expect(r.cuerpo).toEqual({
      ok: false,
      motivo: "grupo_grande",
      mensaje: "Para más de 12 personas contacta directamente con el restaurante.",
    });
    expect(db.tabla("solicitudes_pendientes")).toEqual([
      expect.objectContaining({ motivo_rechazo: "grupo_grande", marca: "casa_tomas", numero_comensales: 15, estado: "pendiente" }),
    ]);
    expect(db.tabla("reservas")).toHaveLength(0);
    expect(correos()).toEqual([expect.objectContaining({ to: ["ana@correo.test"], subject: "Estado de reserva Casa Tomás" })]);
  });

  it("/crear con el teléfono en la lista negra: 403 «no_disponible» y sin solicitud (prueba también que la lista negra del doble salta)", async () => {
    db.tabla("blacklist").push({ tipo: "telefono", valor: "611222333", motivo: "No se presentó" });

    const r = await crear(reservaCasaTomas());

    expect(r.status).toBe(403);
    expect(r.cuerpo).toEqual({ ok: false, motivo: "no_disponible", mensaje: "No ha sido posible formalizar la solicitud." });
    expect(db.tabla("solicitudes_pendientes")).toHaveLength(0);
    expect(db.tabla("reservas")).toHaveLength(0);
  });

  it("/crear con el espacio de El Reservado pero sin `marca`: reserva de Casa Tomás SIN sala, nunca una de Touza", async () => {
    // Fija por qué basta con rechazar sobre la PRIMERA resolución de la marca:
    // `salaDelCliente` descarta el espacio en Casa Tomás, así que la segunda
    // pasada de `resolverMarca` (justo antes del INSERT) no puede volverla Touza.
    const r = await crear(reservaCasaTomas({ espacio_id: "el-reservado" }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ marca: "casa_tomas", espacio_id: null })]);
  });

  it("/disponibilidad: 200, array plano con la meta de Casa Tomás y sus huecos", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 4 });

    expect(r.status).toBe(200);
    expect(Array.isArray(r.cuerpo)).toBe(true);
    expect(r.cuerpo[0]).toMatchObject({ kind: "meta", fecha: FECHA, marca: "casa_tomas", cerrado: false, reservable: true });
    // El aforo es el de Casa Tomás (80 + 70): El Reservado (Touza) no cuenta.
    expect(r.cuerpo[0].aforo_turno.comida.capacidad_maxima).toBe(150);
    const huecos = (r.cuerpo as Array<{ kind: string; hora: string }>).filter((x) => x.kind === "hueco").map((h) => h.hora);
    expect(huecos).toEqual(expect.arrayContaining(["14:00", "21:00"]));
    expect(db.escrituras()).toEqual([]);
  });

  it("/disponibilidad: el Reservado de Casa Tomás (sala privada) está FUERA DE AFORO: ni suma sus 20 plazas ni sus reservas ocupan turno", async () => {
    db.tabla("espacios_reserva").push({
      id: "reservado-ct",
      nombre: "Reservado",
      capacidad_maxima: 20,
      activa: true,
      caracteristicas: { marca: "casa_tomas", privada: true },
    });
    db.tabla("reservas").push({
      id: "res-reservado",
      fecha: FECHA,
      hora: "14:00:00",
      numero_comensales: 8,
      estado: "confirmada",
      marca: "casa_tomas",
      espacio_id: "reservado-ct",
    });
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 4 });

    expect(r.status).toBe(200);
    expect(r.cuerpo[0].aforo_turno.comida).toMatchObject({ capacidad_maxima: 150, ocupacion: 0 });
    expect(r.cuerpo[0].aforo_turno.cena).toMatchObject({ capacidad_maxima: 150, ocupacion: 0 });
  });
});

describe("marca desconocida — igual que hoy: cae en Casa Tomás", () => {
  it("/crear con `marca: \"otra\"`: 201 y reserva de Casa Tomás", async () => {
    const r = await crear(reservaCasaTomas({ marca: "otra" }));

    expect(r.status).toBe(201);
    expect(db.tabla("reservas")).toEqual([expect.objectContaining({ marca: "casa_tomas" })]);
  });

  it("/disponibilidad con `marca: \"otra\"`: 200 con el aforo de Casa Tomás", async () => {
    const r = await disponibilidad({ fecha: FECHA, numero_comensales: 4, marca: "otra" });

    expect(r.status).toBe(200);
    expect(r.cuerpo[0]).toMatchObject({ kind: "meta", marca: "casa_tomas" });
  });
});
