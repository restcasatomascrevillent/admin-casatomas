/**
 * `paginarConsulta` — lectura de TODAS las filas de una consulta por lotes.
 *
 * Contexto: PostgREST corta cada petición a 1000 filas sin avisar. Hoy hay 1.241 reservas
 * (más de 900 de octubre) y la Asignación y la Lista las pedían de una vez: se quedaban con
 * las 1.000 primeras. Aquí se prueba el bucle que las lee por lotes, contra un doble en memoria
 * del cliente de Supabase (`dobleSupabaseLotes.ts`) que aplica filtros, orden, `range`, el recuento
 * exacto y —lo importante— el tope de 1000 filas por petición.
 *
 * Se comprueba, con 0, 999, 1.000, 1.001, 2.000, 2.500 y 5.000 filas: que llegan todas, en el
 * orden de la consulta y sin repetirse; cuántas peticiones y con qué rangos; que solo el primer
 * lote pide recuento; que un lote que falla hace fallar la lectura entera (nada de filas a
 * medias) sin lanzar lotes nuevos y sin terminar mientras haya lotes en vuelo; que nunca hay más
 * lotes en vuelo que los permitidos; que el orden con desempate por `id` no repite ni salta filas
 * y SIN él sí (el doble lo demuestra); que los filtros se mantienen en todos los lotes; el tope de
 * seguridad; SIN recuento (también con un `max-rows` más bajo que el lote); la COHERENCIA (si los
 * datos cambian entre lotes, o un lote llega corto, error en vez de un conjunto con huecos); y la
 * cancelación (`signal`).
 */
import { describe, it, expect } from "vitest";
import {
  ErrorLecturaInconsistente,
  FILAS_POR_LOTE,
  LIMITE_FILAS,
  LOTES_SIMULTANEOS,
  paginarConsulta,
} from "@/lib/reservas/paginarConsulta";
import { crearDobleSupabase, type DobleSupabase, type FilaDoble, type OpcionesDoble } from "./dobleSupabaseLotes";

// ─── Datos ───────────────────────────────────────────────────────────────────

const relleno = (n: number, ancho = 6) => String(n).padStart(ancho, "0");

/** Comparación de cadenas por código (como la del doble), sin depender del idioma del entorno. */
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** `n` reservas con id único y repartidas en 28 días y 3 horas (así el orden por fecha y hora tiene empates). */
function reservas(n: number): FilaDoble[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${relleno(i)}`,
    fecha: `2026-10-${relleno(1 + (i % 28), 2)}`,
    hora: `${12 + (i % 3)}:00:00`,
    estado: i % 10 === 9 ? "cancelada" : "confirmada",
  }));
}

/** La misma tabla en otro orden (una permutación fija): lo que sale tiene que salir ordenado por la consulta, no por cómo esté guardada. */
function barajar(filas: FilaDoble[]): FilaDoble[] {
  const n = filas.length;
  return n === 0 ? [] : filas.map((_, k) => filas[(k * 7919) % n]);
}

const idsDe = (filas: FilaDoble[]) => filas.map((f) => f.id as string);

/** Lo que debe salir de `order("fecha").order("hora").order("id")`. */
const porFechaHoraId = (a: FilaDoble, b: FilaDoble) => cmp(a.fecha, b.fecha) || cmp(a.hora, b.hora) || cmp(a.id, b.id);

function crear(filas: FilaDoble[], opciones: OpcionesDoble = {}): DobleSupabase {
  return crearDobleSupabase({ reservas: barajar(filas) }, opciones);
}

/** La consulta de siempre: filtro, orden total (con desempate por `id`) y rango del lote. */
const consulta = (doble: DobleSupabase) => (primera: number, ultima: number, contar: boolean) =>
  doble
    .from("reservas")
    .select("*", contar ? { count: "exact" } : undefined)
    .gte("fecha", "2026-10-01")
    .order("fecha")
    .order("hora")
    .order("id")
    .range(primera, ultima);

/** Los rangos pedidos, de menor a mayor (los lotes en paralelo no llegan en orden garantizado). */
const rangos = (doble: DobleSupabase) =>
  doble.peticiones.map((p) => p.rango).sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));

/** Cede el turno al reloj: las peticiones que pueden ir juntas coinciden en vuelo. */
const cederTurno = (ms = 0) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Una promesa que se resuelve cuando el test quiere: retiene una petición en vuelo. */
const diferido = () => {
  let resolver!: () => void;
  const promesa = new Promise<void>((ok) => {
    resolver = ok;
  });
  return { promesa, resolver };
};

const claveDeId = (fila: FilaDoble) => String(fila.id);

// ─── 1. Cuántas filas y cuántas peticiones ───────────────────────────────────

describe("paginarConsulta · con recuento", () => {
  it("los valores por defecto son el tope de PostgREST, 4 lotes a la vez y 10.000 de tope", () => {
    expect(FILAS_POR_LOTE).toBe(1000);
    expect(LOTES_SIMULTANEOS).toBe(4);
    expect(LIMITE_FILAS).toBe(10_000);
  });

  it.each<[number, number[][]]>([
    [0, [[0, 999]]],
    [999, [[0, 999]]],
    [1000, [[0, 999]]],
    [1001, [[0, 999], [1000, 1000]]],
    [2000, [[0, 999], [1000, 1999]]],
    [2500, [[0, 999], [1000, 1999], [2000, 2499]]],
    [5000, [[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]],
  ])("%i filas: llegan todas, ordenadas y sin repetir, en los lotes justos", async (n, esperados) => {
    const todas = reservas(n);
    const doble = crear(todas);

    const { filas, total, truncado } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(new Set(idsDe(filas)).size).toBe(n);
    expect(total).toBe(n);
    expect(truncado).toBe(false);
    expect(rangos(doble)).toEqual(esperados);
  });

  it("solo el primer lote pide el recuento: contar cuesta lo mismo que leer y con una vez basta", async () => {
    const doble = crear(reservas(2500));

    await paginarConsulta(consulta(doble));

    expect(doble.peticiones.map((p) => p.contar)).toEqual([true, false, false]);
  });

  it("si cabe en un lote no hace ninguna petición más (0, 999 y 1.000 filas)", async () => {
    for (const n of [0, 999, 1000]) {
      const doble = crear(reservas(n));
      await paginarConsulta(consulta(doble));
      expect(doble.peticiones).toHaveLength(1);
    }
  });

  it("las opciones cambian el tamaño del lote", async () => {
    const doble = crear(reservas(1200));

    const { filas } = await paginarConsulta(consulta(doble), { filasPorLote: 500 });

    expect(filas).toHaveLength(1200);
    expect(rangos(doble)).toEqual([[0, 499], [500, 999], [1000, 1199]]);
  });

  it("la tabla puede estar guardada en cualquier orden: la salida sigue el de la consulta", async () => {
    const todas = reservas(1500);
    const doble = crearDobleSupabase({ reservas: [...todas].reverse() });

    const { filas } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
  });
});

// ─── 2. Sin recuento ─────────────────────────────────────────────────────────

describe("paginarConsulta · si el servidor no da recuento", () => {
  it.each<[number, number]>([
    [0, 1], // el primer lote viene vacío: no hay nada más
    [999, 2], // corto pero NO vacío: no es el final (un `max-rows` bajo también da lotes cortos), otra petición lo confirma
    [1000, 2],
    [1001, 3],
    [2500, 4],
  ])("%i filas: llegan todas, ordenadas y sin repetir, en %i petición(es) en serie, hasta un lote vacío", async (n, peticiones) => {
    const todas = reservas(n);
    const doble = crear(todas, { sinRecuento: true });

    const { filas, total, truncado } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(total).toBeNull();
    expect(truncado).toBe(false);
    expect(doble.peticiones).toHaveLength(peticiones);
    expect(doble.maximoEnVuelo).toBe(1);
  });

  it("un recuento que no es un número válido (`NaN`, lo que sale de `Content-Range: 0-999/*`) se trata como «sin recuento», no como «0 filas más»", async () => {
    const todas = reservas(2500);
    const doble = crear(todas, { recuentoNaN: true });

    const { filas, total, truncado } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(total).toBeNull();
    expect(truncado).toBe(false);
    expect(doble.peticiones).toHaveLength(4);
  });

  it("con un `max-rows` más bajo que el lote (300) sigue hasta un lote vacío y llegan las 2.500, no solo 300", async () => {
    const todas = reservas(2500);
    const doble = crear(todas, { sinRecuento: true, maxFilas: 300 });

    const { filas, total, truncado } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(total).toBeNull();
    expect(truncado).toBe(false);
    // Avanza por lo que ha recibido (300 cada vez), no de 1000 en 1000: si no, saltaría las filas 300-999.
    expect(doble.peticiones.map((p) => p.rango)).toEqual([
      [0, 999], [300, 1299], [600, 1599], [900, 1899], [1200, 2199],
      [1500, 2499], [1800, 2799], [2100, 3099], [2400, 3399], [2500, 3499],
    ]);
    expect(doble.maximoEnVuelo).toBe(1);
  });

  it("sin recuento y con un `max-rows` bajo, el tope de seguridad también corta, pidiendo solo lo que cabe", async () => {
    const doble = crear(reservas(2500), { sinRecuento: true, maxFilas: 300 });

    const { filas, truncado } = await paginarConsulta(consulta(doble), { limiteFilas: 1000 });

    expect(filas).toHaveLength(1000);
    expect(truncado).toBe(true);
    // Los lotes se acortan para no pasar de las 1.000: el último pide 100.
    expect(doble.peticiones.map((p) => p.rango)).toEqual([[0, 999], [300, 999], [600, 999], [900, 999]]);
  });

  it("un lote que llega corto en medio no pierde filas: el siguiente pide a partir de lo que de verdad llegó", async () => {
    const todas = reservas(2500);
    // El segundo lote llega con 990 de las 1.000 pedidas (sin recuento no hay comprobación posible, pero tampoco hueco).
    const doble = crear(todas, { sinRecuento: true, recortar: (p) => (p.numero === 2 ? 990 : undefined) });

    const { filas } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(doble.peticiones.map((p) => p.rango)).toEqual([[0, 999], [1000, 1999], [1990, 2989], [2500, 3499]]);
  });
});

// ─── 3. Un tope por petición más bajo que el lote ────────────────────────────

describe("paginarConsulta · el servidor devuelve menos filas de las pedidas", () => {
  it("el paso pasa a ser lo que ha devuelto el primer lote: no se salta ninguna fila", async () => {
    // `max-rows` de 300: se piden 1000 y llegan 300. Con pasos de 1000 se perderían las filas 300-999.
    const todas = reservas(1250);
    const doble = crear(todas, { maxFilas: 300 });

    const { filas } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
    expect(new Set(idsDe(filas)).size).toBe(1250);
    expect(rangos(doble)).toEqual([[0, 999], [300, 599], [600, 899], [900, 1199], [1200, 1249]]);
  });
});

// ─── 4. Un lote falla ────────────────────────────────────────────────────────

describe("paginarConsulta · un lote falla", () => {
  const ERROR = { code: "57014", message: "canceling statement due to statement timeout" };

  it("falla el SEGUNDO: lanza ese mismo error y no devuelve filas a medias", async () => {
    const doble = crear(reservas(2500), { fallar: (p) => (p.rango?.[0] === 1000 ? ERROR : undefined) });

    await expect(paginarConsulta(consulta(doble))).rejects.toBe(ERROR);
  });

  it("falla el PRIMERO: una sola petición y el error original", async () => {
    const doble = crear(reservas(2500), { fallar: () => ERROR });

    await expect(paginarConsulta(consulta(doble))).rejects.toBe(ERROR);
    expect(doble.peticiones).toHaveLength(1);
  });

  it("en serie, tras el fallo no se pide ningún lote más", async () => {
    const doble = crear(reservas(5000), { fallar: (p) => (p.rango?.[0] === 1000 ? ERROR : undefined) });

    await expect(paginarConsulta(consulta(doble), { lotesSimultaneos: 1 })).rejects.toBe(ERROR);

    expect(rangos(doble)).toEqual([[0, 999], [1000, 1999]]);
  });

  it("tras el PRIMER error no sale ningún lote nuevo, y no termina (ni resuelve ni rechaza) hasta que acaban los que ya iban en vuelo", async () => {
    const E1 = { code: "E1", message: "uno" };
    const puerta = diferido();
    // Con 2 a la vez: el lote de 1000 falla enseguida y el de 2000 queda retenido en vuelo.
    const doble = crear(reservas(5000), {
      fallar: (p) => (p.rango?.[0] === 1000 ? E1 : undefined),
      antesDeResponder: (p) => (p.rango?.[0] === 2000 ? puerta.promesa : undefined),
    });
    let estado: "pendiente" | "resuelta" | "rechazada" = "pendiente";
    const lectura = paginarConsulta(consulta(doble), { lotesSimultaneos: 2 }).then(
      (resultado) => {
        estado = "resuelta";
        return resultado;
      },
      (error) => {
        estado = "rechazada";
        throw error;
      },
    );

    await cederTurno(20); // el lote que falla ya contestó; el otro sigue retenido
    // (2) Aún hay un lote en vuelo: no se da la lectura por terminada.
    expect(estado).toBe("pendiente");
    // (1) Tras el primer error no se ha lanzado ninguno de los dos lotes que faltaban (3000 y 4000).
    expect(rangos(doble)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);

    puerta.resolver();
    await expect(lectura).rejects.toBe(E1);
    expect(estado).toBe("rechazada");
    // Ni siquiera al terminar el lote retenido salió alguno nuevo.
    expect(rangos(doble)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("si fallan varios a la vez lanza el primero y los demás lotes en vuelo terminan sin dejar rechazos sin escuchar", async () => {
    const E1 = { code: "E1", message: "uno" };
    const E2 = { code: "E2", message: "dos" };
    const doble = crear(reservas(4000), {
      fallar: (p) => (p.rango?.[0] === 1000 ? E1 : p.rango?.[0] === 2000 ? E2 : undefined),
    });

    const error = await paginarConsulta(consulta(doble)).catch((e) => e);

    expect([E1, E2]).toContain(error);
    expect(doble.peticiones).toHaveLength(4);
  });
});

// ─── 5. Concurrencia ─────────────────────────────────────────────────────────

describe("paginarConsulta · peticiones a la vez", () => {
  it("nunca más de `lotesSimultaneos` a la vez, pero sí varias a la vez", async () => {
    const doble = crear(reservas(5000), { antesDeResponder: () => cederTurno() });

    const { filas } = await paginarConsulta(consulta(doble), { lotesSimultaneos: 3 });

    expect(filas).toHaveLength(5000);
    expect(doble.maximoEnVuelo).toBe(3);
  });

  it("por defecto, 4 a la vez", async () => {
    const doble = crear(reservas(7000), { antesDeResponder: () => cederTurno() });

    const { filas } = await paginarConsulta(consulta(doble));

    expect(filas).toHaveLength(7000);
    expect(doble.maximoEnVuelo).toBe(LOTES_SIMULTANEOS);
  });

  it("el primer lote va solo: hasta que no llega el recuento no se sabe cuántos faltan", async () => {
    let enviadasMientrasEsperaElPrimero = -1;
    const doble = crear(reservas(5000), {
      antesDeResponder: async (p) => {
        if (p.numero !== 1) return;
        await cederTurno(5);
        enviadasMientrasEsperaElPrimero = doble.peticiones.length;
      },
    });

    await paginarConsulta(consulta(doble));

    expect(enviadasMientrasEsperaElPrimero).toBe(1);
  });

  it("las filas salen en el orden de la consulta aunque los lotes terminen en otro orden", async () => {
    const todas = reservas(3500);
    // El lote del medio es el último en contestar.
    const doble = crear(todas, { antesDeResponder: (p) => (p.rango?.[0] === 1000 ? cederTurno(15) : undefined) });

    const { filas } = await paginarConsulta(consulta(doble));

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
  });
});

// ─── 6. Orden estable ────────────────────────────────────────────────────────

describe("paginarConsulta · orden estable entre lotes", () => {
  /** 2.500 reservas el MISMO día a la MISMA hora: todo son empates salvo el `id`. */
  const todasEmpatadas = (): FilaDoble[] =>
    Array.from({ length: 2500 }, (_, i) => ({ id: `id-${relleno(i)}`, fecha: "2026-10-20", hora: "21:00:00" }));

  it("con desempate por `id`, aunque Postgres desordene los empates en cada petición, no se repite ni se salta ninguna", async () => {
    const todas = todasEmpatadas();
    const doble = crear(todas, { desordenarEmpates: true });

    const { filas } = await paginarConsulta(consulta(doble), { clave: claveDeId });

    expect(new Set(idsDe(filas)).size).toBe(2500);
    expect(idsDe(filas)).toEqual(idsDe(todas)); // y en el orden por `id`
  });

  it("CONTROL: sin desempate por columna única el doble repite y salta filas entre lotes (por eso las consultas llevan `id`)", async () => {
    const doble = crear(todasEmpatadas(), { desordenarEmpates: true });
    const sinDesempate = (primera: number, ultima: number, contar: boolean) =>
      doble
        .from("reservas")
        .select("*", contar ? { count: "exact" } : undefined)
        .order("fecha")
        .order("hora")
        .range(primera, ultima);

    const { filas } = await paginarConsulta(sinDesempate);

    expect(filas).toHaveLength(2500); // el número cuadra…
    expect(new Set(idsDe(filas)).size).toBeLessThan(2500); // …pero hay filas repetidas y, por tanto, otras que faltan.
  });

  it("y con `clave`, ese mismo control (sin desempate) ya NO pasa por buena: las repetidas se descartan y el recuento no cuadra", async () => {
    const doble = crear(todasEmpatadas(), { desordenarEmpates: true });
    const sinDesempate = (primera: number, ultima: number, contar: boolean) =>
      doble
        .from("reservas")
        .select("*", contar ? { count: "exact" } : undefined)
        .order("fecha")
        .order("hora")
        .range(primera, ultima);

    await expect(paginarConsulta(sinDesempate, { clave: claveDeId })).rejects.toBeInstanceOf(ErrorLecturaInconsistente);
  });
});

// ─── 7. Filtros ──────────────────────────────────────────────────────────────

describe("paginarConsulta · los filtros se mantienen en todos los lotes", () => {
  it("cada lote lleva el mismo select, filtros y orden, y el recuento es el de las filas FILTRADAS", async () => {
    const todas = reservas(5600);
    const doble = crear(todas);
    const filtrada = (primera: number, ultima: number, contar: boolean) =>
      doble
        .from("reservas")
        .select("id, fecha, hora", contar ? { count: "exact" } : undefined)
        .gte("fecha", "2026-10-05")
        .lte("fecha", "2026-10-14")
        .neq("estado", "cancelada")
        .order("fecha")
        .order("hora")
        .order("id")
        .range(primera, ultima);

    const { filas, total } = await paginarConsulta(filtrada);

    const esperadas = todas
      .filter((f) => String(f.fecha) >= "2026-10-05" && String(f.fecha) <= "2026-10-14" && f.estado !== "cancelada")
      .sort(porFechaHoraId);
    // En la tabla hay filas fuera del rango y canceladas: de las 5.600 solo cuentan las del filtro (más de 1.000, para que haga falta más de un lote).
    expect(esperadas.length).toBeGreaterThan(1000);
    expect(esperadas.length).toBeLessThan(5600);
    expect(idsDe(filas)).toEqual(idsDe(esperadas));
    expect(total).toBe(esperadas.length);

    expect(doble.peticiones.length).toBeGreaterThan(1);
    for (const p of doble.peticiones) {
      expect(p.tabla).toBe("reservas");
      expect(p.columnas).toBe("id, fecha, hora");
      expect(p.filtros).toEqual(["fecha>=2026-10-05", "fecha<=2026-10-14", "estado<>cancelada"]);
      expect(p.orden).toEqual([
        { columna: "fecha", ascendente: true },
        { columna: "hora", ascendente: true },
        { columna: "id", ascendente: true },
      ]);
    }
  });

  it("un orden descendente se respeta lote a lote", async () => {
    const todas = reservas(2200);
    const doble = crear(todas);
    const descendente = (primera: number, ultima: number, contar: boolean) =>
      doble
        .from("reservas")
        .select("*", contar ? { count: "exact" } : undefined)
        .order("fecha", { ascending: false })
        .order("hora", { ascending: true })
        .order("id", { ascending: true })
        .range(primera, ultima);

    const { filas } = await paginarConsulta(descendente);

    const esperadas = [...todas].sort((a, b) => cmp(b.fecha, a.fecha) || cmp(a.hora, b.hora) || cmp(a.id, b.id));
    expect(idsDe(filas)).toEqual(idsDe(esperadas));
  });
});

// ─── 8. Tope de seguridad ────────────────────────────────────────────────────

describe("paginarConsulta · tope de seguridad", () => {
  it("con recuento: se leen solo las primeras `limiteFilas`, el recuento real queda en `total` y `truncado` lo dice", async () => {
    const todas = reservas(2500);
    const doble = crear(todas);

    const { filas, total, truncado } = await paginarConsulta(consulta(doble), { limiteFilas: 2000 });

    expect(truncado).toBe(true);
    expect(total).toBe(2500);
    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId).slice(0, 2000)));
    expect(rangos(doble)).toEqual([[0, 999], [1000, 1999]]); // el tercer lote ni se pide
  });

  it("justo en el tope NO es truncado: están todas", async () => {
    const doble = crear(reservas(2000));

    const { filas, truncado } = await paginarConsulta(consulta(doble), { limiteFilas: 2000 });

    expect(filas).toHaveLength(2000);
    expect(truncado).toBe(false);
  });

  it("un tope que no es múltiplo del lote acorta el último", async () => {
    const doble = crear(reservas(3000));

    const { filas, truncado } = await paginarConsulta(consulta(doble), { limiteFilas: 1500 });

    expect(filas).toHaveLength(1500);
    expect(truncado).toBe(true);
    expect(rangos(doble)).toEqual([[0, 999], [1000, 1499]]);
  });

  it("sin recuento, llegar al tope sin haber visto un lote vacío se da por truncado (lo prudente)", async () => {
    const doble = crear(reservas(2500), { sinRecuento: true });

    const { filas, total, truncado } = await paginarConsulta(consulta(doble), { limiteFilas: 2000 });

    expect(filas).toHaveLength(2000);
    expect(total).toBeNull();
    expect(truncado).toBe(true);
    expect(doble.peticiones).toHaveLength(2);
  });

  it("con el tope por defecto: 10.000 filas están completas y 10.001 son 10.000 y truncado", async () => {
    const justas = crear(reservas(10_000));
    const resultadoJustas = await paginarConsulta(consulta(justas));
    expect(resultadoJustas.filas).toHaveLength(10_000);
    expect(resultadoJustas.truncado).toBe(false);

    const demasiadas = crear(reservas(10_001));
    const resultado = await paginarConsulta(consulta(demasiadas));
    expect(resultado.filas).toHaveLength(10_000);
    expect(resultado.total).toBe(10_001);
    expect(resultado.truncado).toBe(true);
    expect(demasiadas.peticiones).toHaveLength(10);
  });
});

// ─── 9. Los datos cambian mientras se leen los lotes (coherencia) ────────────

describe("paginarConsulta · los datos cambian entre lotes", () => {
  /** Una reserva de las del primer lote (la de la posición 10 en el orden de la consulta). */
  const delPrimerLote = (n: number) => [...reservas(n)].sort(porFechaHoraId)[10].id as string;

  /** Entre el lote 1 y el 2 una reserva SALE de la vista (pasa a «Llegó»/cancelada): todo lo posterior se corre una posición. */
  const saleUnaReservaAlLeerElSegundo = (doble: DobleSupabase, id: string) => {
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2) doble.tablas.reservas = doble.tablas.reservas.filter((f) => f.id !== id);
    };
  };

  /**
   * Entra una reserva que cae la PRIMERA del orden (a las 00:00; el resto, desde las 12:00) justo antes
   * de leer el segundo lote: todo se desplaza una posición y la última fila del primero vuelve a salir.
   */
  const entraUnaReservaAlLeerElSegundo = (doble: DobleSupabase) => {
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2) doble.tablas.reservas.push({ id: "id-nueva", fecha: "2026-10-01", hora: "00:00:00", estado: "confirmada" });
    };
  };

  it.each<[string, { clave?: (fila: FilaDoble) => string }]>([
    ["con `clave`", { clave: claveDeId }],
    ["sin `clave`", {}],
  ])(
    "una reserva SALE entre el lote 1 y el 2 (%s): error de inconsistencia, no 2.499 filas con una vieja y sin una viva",
    async (_nombre, opciones) => {
      const doble = crear(reservas(2500));
      saleUnaReservaAlLeerElSegundo(doble, delPrimerLote(2500));

      const error = await paginarConsulta(consulta(doble), opciones).catch((e) => e);

      expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("ErrorLecturaInconsistente");
      expect(error.message).toMatch(/^Lectura por lotes inconsistente: se esperaban 2500 filas y han llegado 2499/);
      // Se lanzó tras leer los tres lotes: no hay relectura escondida (de eso se encarga quien llama).
      expect(doble.peticiones).toHaveLength(3);
    },
  );

  it("entra una reserva entre lotes (todo se desplaza y una fila llega dos veces): con `clave` se descarta y el recuento ya no cuadra → error", async () => {
    const doble = crear(reservas(2500));
    entraUnaReservaAlLeerElSegundo(doble);

    const error = await paginarConsulta(consulta(doble), { clave: claveDeId }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 2500 filas y han llegado 2499 \(tras descartar 1 repetida\)/);
  });

  it("LÍMITE CONOCIDO: sin `clave` ese mismo desplazamiento NO se detecta (una repetida y una saltada se compensan en el recuento); por eso las consultas pasan `clave`", async () => {
    const doble = crear(reservas(2500));
    entraUnaReservaAlLeerElSegundo(doble);

    const { filas } = await paginarConsulta(consulta(doble));

    expect(filas).toHaveLength(2500);
    expect(new Set(idsDe(filas)).size).toBe(2499); // una repetida (y la última de las originales, que falta)
  });

  it("un lote INTERMEDIO que llega corto → error (el recuento dice que hay más)", async () => {
    const doble = crear(reservas(3500), { recortar: (p) => (p.rango?.[0] === 1000 ? 990 : undefined) });

    const error = await paginarConsulta(consulta(doble), { clave: claveDeId }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 3500 filas y han llegado 3490/);
  });

  it("el ÚLTIMO lote corto → error", async () => {
    const doble = crear(reservas(2500), { recortar: (p) => (p.rango?.[0] === 2000 ? 499 : undefined) });

    await expect(paginarConsulta(consulta(doble), { clave: claveDeId })).rejects.toBeInstanceOf(ErrorLecturaInconsistente);
  });

  it("el primer lote vacío con un recuento que dice que hay filas (desaparecieron entre contar y leer) → error, no «0 filas»", async () => {
    const doble = crear(reservas(2500), { recortar: (p) => (p.numero === 1 ? 0 : undefined) });

    const error = await paginarConsulta(consulta(doble), { clave: claveDeId }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 2500 filas y han llegado 0/);
  });

  it("un primer lote corto que es el tope del servidor (no un fallo) NO es inconsistencia: el paso se adapta y llegan todas", async () => {
    // El primer lote llega con 990 de las 1.000 pedidas y las demás vienen de 990 en 990: lectura coherente.
    const todas = reservas(2500);
    const doble = crear(todas, { recortar: (p) => (p.numero === 1 ? 990 : undefined) });

    const { filas } = await paginarConsulta(consulta(doble), { clave: claveDeId });

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(porFechaHoraId)));
  });

  it("con el tope, se esperan justo `limiteFilas` (no el recuento): un lote corto dentro del tope también es error", async () => {
    const doble = crear(reservas(3000), { recortar: (p) => (p.rango?.[0] === 1000 ? 400 : undefined) });

    const error = await paginarConsulta(consulta(doble), { limiteFilas: 1500, clave: claveDeId }).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 1500 filas y han llegado 1400/);
  });

  it("una lectura estable no lanza nada, también con `clave` y con desempate de empates desordenados", async () => {
    const todas = reservas(2500);
    const doble = crear(todas, { desordenarEmpates: true });

    const { filas } = await paginarConsulta(consulta(doble), { clave: claveDeId });

    expect(filas).toHaveLength(2500);
  });
});

// ─── 10. Cancelación ─────────────────────────────────────────────────────────

describe("paginarConsulta · cancelación (`signal`)", () => {
  it("una señal ya abortada: no pide nada y lanza el motivo del aborto", async () => {
    const doble = crear(reservas(2500));
    const control = new AbortController();
    const motivo = new Error("el panel se ha cerrado");
    control.abort(motivo);

    await expect(paginarConsulta(consulta(doble), { signal: control.signal })).rejects.toBe(motivo);

    expect(doble.peticiones).toHaveLength(0);
  });

  it("sin motivo explícito lanza un `AbortError`", async () => {
    const doble = crear(reservas(10));
    const control = new AbortController();
    control.abort();

    await expect(paginarConsulta(consulta(doble), { signal: control.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("abortada mientras el primer lote está en vuelo: ese lote termina y no se lanza ninguno más", async () => {
    const control = new AbortController();
    const puerta = diferido();
    const doble = crear(reservas(5000), { antesDeResponder: (p) => (p.numero === 1 ? puerta.promesa : undefined) });
    const lectura = paginarConsulta(consulta(doble), { signal: control.signal }).then(
      () => "resuelta",
      (error) => error,
    );

    await cederTurno(5);
    control.abort();
    puerta.resolver();

    expect(await lectura).toMatchObject({ name: "AbortError" });
    expect(doble.peticiones).toHaveLength(1);
  });

  it("abortada con varios lotes en vuelo: los que ya iban terminan y no sale ninguno nuevo", async () => {
    const control = new AbortController();
    const puerta = diferido();
    // Los lotes en paralelo (del segundo en adelante) quedan retenidos hasta soltarlos.
    const doble = crear(reservas(5000), { antesDeResponder: (p) => (p.numero >= 2 ? puerta.promesa : undefined) });
    const lectura = paginarConsulta(consulta(doble), { signal: control.signal, lotesSimultaneos: 2 }).then(
      () => "resuelta",
      (error) => error,
    );

    await cederTurno(5);
    expect(doble.peticiones).toHaveLength(3); // el primero y los dos en vuelo
    control.abort();
    puerta.resolver();

    expect(await lectura).toMatchObject({ name: "AbortError" });
    // Los dos en vuelo terminaron; los lotes de 3000 y 4000 no se pidieron.
    expect(rangos(doble)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("sin recuento (en serie), abortada entre lotes: no se pide el siguiente", async () => {
    const control = new AbortController();
    const puerta = diferido();
    const doble = crear(reservas(2500), { sinRecuento: true, antesDeResponder: (p) => (p.numero === 2 ? puerta.promesa : undefined) });
    const lectura = paginarConsulta(consulta(doble), { signal: control.signal }).then(
      () => "resuelta",
      (error) => error,
    );

    await cederTurno(5);
    control.abort();
    puerta.resolver();

    expect(await lectura).toMatchObject({ name: "AbortError" });
    expect(doble.peticiones).toHaveLength(2);
  });

  it("si la consulta lleva `.abortSignal(signal)`, la petición en vuelo falla con el `AbortError` de `fetch` y la lectura lo lanza", async () => {
    const control = new AbortController();
    const puerta = diferido();
    const doble = crear(reservas(2500), { antesDeResponder: (p) => (p.numero === 1 ? puerta.promesa : undefined) });
    const conSenal = (primera: number, ultima: number, contar: boolean) => consulta(doble)(primera, ultima, contar).abortSignal(control.signal);
    const lectura = paginarConsulta(conSenal, { signal: control.signal }).then(
      () => "resuelta",
      (error) => error,
    );

    await cederTurno(5);
    control.abort();
    puerta.resolver();

    expect(await lectura).toMatchObject({ message: expect.stringContaining("AbortError") });
    expect(doble.peticiones).toHaveLength(1);
    expect(doble.peticiones[0].signal).toBe(control.signal);
  });
});
