/**
 * `leerReservasLista` — la consulta de la pestaña «Lista» de /reservas, leída por lotes.
 *
 * Hasta ahora la Lista pedía todas las reservas de una vez y PostgREST la cortaba a 1000 filas: con
 * 1.241 reservas (más de 900 de octubre) el histórico más antiguo desaparecía de la vista, sin
 * error. Aquí se comprueba, contra un doble en memoria del cliente de Supabase con el tope de 1000
 * filas por petición, que la consulta trae TODAS (0, 999, 1.000, 1.001 y 2.500 filas), en el
 * orden de siempre (fecha descendente, hora ascendente) con `id` de desempate —así que con muchas
 * reservas el mismo día y hora no se repite ni se salta ninguna aunque el servidor desordene los
 * empates—, sin ningún filtro (la Lista enseña todos los estados, canales y negocios), que un lote
 * que falla hace fallar la lectura entera, que si los datos cambian entre lotes (entra una reserva y
 * una fila llega dos veces, o sale una) la lectura se rechaza en vez de devolver repetidas o huecos
 * —ahí se comprueba que la consulta pasa `clave`: sin ella la repetida se colaría— y que el `signal`
 * de TanStack Query llega a cada lote y, abortado, no se lanzan lotes nuevos.
 */
import { describe, it, expect } from "vitest";
import { leerReservasLista } from "@/lib/reservas/leerReservasLista";
import { ErrorLecturaInconsistente, LIMITE_FILAS } from "@/lib/reservas/paginarConsulta";
import { crearDobleSupabase, type DobleSupabase, type FilaDoble } from "./dobleSupabaseLotes";

const relleno = (n: number, ancho = 6) => String(n).padStart(ancho, "0");
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const ESTADOS = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"];

/** `n` reservas de 90 días con las horas de servicio repetidas (empates a mares), de todos los estados y canales. */
function reservas(n: number): FilaDoble[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `res-${relleno(i)}`,
    nombre: `Cliente ${i}`,
    fecha: `2026-${relleno(7 + Math.floor((i % 90) / 30), 2)}-${relleno(1 + (i % 30), 2)}`,
    hora: ["13:00:00", "14:30:00", "21:00:00"][i % 3],
    estado: ESTADOS[i % ESTADOS.length],
    canal: ["telefono", "web", "manual"][i % 3],
  }));
}

/** Lo que debe salir: fecha descendente, hora ascendente, `id` ascendente. */
const ordenDeLaLista = (a: FilaDoble, b: FilaDoble) => cmp(b.fecha, a.fecha) || cmp(a.hora, b.hora) || cmp(a.id, b.id);

const idsDe = (filas: Array<{ id: string }> | FilaDoble[]) => filas.map((f) => f.id as string);

/** Guarda la tabla en otro orden (una permutación fija): lo que sale lo ordena la consulta, no el almacén. */
function barajar(filas: FilaDoble[]): FilaDoble[] {
  const n = filas.length;
  return n === 0 ? [] : filas.map((_, k) => filas[(k * 7919) % n]);
}

function crear(filas: FilaDoble[], opciones: Parameters<typeof crearDobleSupabase>[1] = {}): DobleSupabase {
  return crearDobleSupabase({ reservas: barajar(filas) }, opciones);
}

/** El doble hace de `supabase`: solo se usa `from(...)`. */
const leer = (doble: DobleSupabase, opciones?: Parameters<typeof leerReservasLista>[1]) =>
  leerReservasLista(doble as unknown as Parameters<typeof leerReservasLista>[0], opciones);

const cederTurno = (ms = 0) => new Promise<void>((resolver) => setTimeout(resolver, ms));
const diferido = () => {
  let resolver!: () => void;
  const promesa = new Promise<void>((ok) => {
    resolver = ok;
  });
  return { promesa, resolver };
};

describe("leerReservasLista · todas las reservas", () => {
  it.each<[number, number]>([
    [0, 1],
    [999, 1],
    [1000, 1],
    [1001, 2],
    [2500, 3],
  ])("%i reservas: llegan todas, en el orden de la lista y sin repetir, en %i petición(es)", async (n, peticiones) => {
    const todas = reservas(n);
    const doble = crear(todas);

    const { filas, total, truncado } = await leer(doble);

    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(ordenDeLaLista)));
    expect(new Set(idsDe(filas)).size).toBe(n);
    expect(total).toBe(n);
    expect(truncado).toBe(false);
    expect(doble.peticiones).toHaveLength(peticiones);
  });

  it("`filas` es un array de reservas tal cual (es lo que guarda la caché `reservas-lista`)", async () => {
    const doble = crear(reservas(5));

    const { filas } = await leer(doble);

    expect(Array.isArray(filas)).toBe(true);
    expect(filas[0]).toMatchObject({ id: expect.any(String), nombre: expect.any(String), estado: expect.any(String) });
  });
});

describe("leerReservasLista · la consulta", () => {
  it("lee `reservas` con `select(\"*\")`, SIN filtros y con el orden de siempre más `id` de desempate, en cada lote", async () => {
    const doble = crear(reservas(2500));

    await leer(doble);

    expect(doble.peticiones).toHaveLength(3);
    for (const p of doble.peticiones) {
      expect(p.tabla).toBe("reservas");
      expect(p.columnas).toBe("*");
      // Ni por estado ni por fecha ni por negocio: la Lista los filtra en pantalla.
      expect(p.filtros).toEqual([]);
      expect(p.orden).toEqual([
        { columna: "fecha", ascendente: false },
        { columna: "hora", ascendente: true },
        { columna: "id", ascendente: true },
      ]);
    }
    expect(doble.peticiones.map((p) => p.contar)).toEqual([true, false, false]);
    expect(doble.peticiones.map((p) => p.rango)).toEqual([[0, 999], [1000, 1999], [2000, 2499]]);
  });

  it("lo antiguo no se pierde: con 2.500 reservas llegan las más viejas (antes se quedaban fuera, tras las 1000 primeras)", async () => {
    const todas = reservas(2500);
    const doble = crear(todas);

    const { filas } = await leer(doble);

    const masAntigua = [...todas].sort((a, b) => cmp(a.fecha, b.fecha))[0].fecha;
    expect(filas.some((f) => f.fecha === masAntigua)).toBe(true);
    expect(filas.filter((f) => f.fecha === masAntigua)).toHaveLength(todas.filter((f) => f.fecha === masAntigua).length);
  });

  it("con muchas reservas el mismo día y hora y un servidor que desordena los empates, no se repite ni se salta ninguna", async () => {
    const todas: FilaDoble[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `res-${relleno(i)}`,
      fecha: "2026-10-14",
      hora: "21:00:00",
      estado: "confirmada",
    }));
    const doble = crear(todas, { desordenarEmpates: true });

    const { filas } = await leer(doble);

    expect(new Set(idsDe(filas)).size).toBe(2500);
    expect(idsDe(filas)).toEqual(idsDe(todas)); // todo empatado salvo `id`: sale por `id`
  });
});

describe("leerReservasLista · errores y tope", () => {
  it("si falla un lote, lanza ese error y no devuelve un trozo de la lista", async () => {
    const error = { code: "57014", message: "canceling statement due to statement timeout" };
    const doble = crear(reservas(2500), { fallar: (p) => (p.rango?.[0] === 1000 ? error : undefined) });

    await expect(leer(doble)).rejects.toBe(error);
  });

  it("con más de 10.000 reservas trae las 10.000 más recientes y avisa con `truncado`", async () => {
    const todas = reservas(LIMITE_FILAS + 1);
    const doble = crear(todas);

    const { filas, total, truncado } = await leer(doble);

    expect(truncado).toBe(true);
    expect(total).toBe(LIMITE_FILAS + 1);
    expect(filas).toHaveLength(LIMITE_FILAS);
    // Se queda con las primeras en el orden de la lista (las más recientes).
    expect(idsDe(filas)).toEqual(idsDe([...todas].sort(ordenDeLaLista).slice(0, LIMITE_FILAS)));
  });
});

describe("leerReservasLista · los datos cambian mientras se leen los lotes", () => {
  it("entra una reserva entre lotes (todo se desplaza y una fila llega dos veces): se rechaza, no se devuelve la repetida", async () => {
    const doble = crear(reservas(2500));
    // Una reserva de una fecha posterior a todas (la Lista va de la más reciente a la más antigua): cae la PRIMERA.
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2) doble.tablas.reservas.push({ id: "res-nueva", nombre: "Nueva", fecha: "2027-01-01", hora: "13:00:00", estado: "pendiente", canal: "web" });
    };

    const error = await leer(doble).catch((e) => e);

    // Con `clave`, la repetida se descarta y el recuento ya no cuadra. Sin `clave` llegarían 2.500 con una repetida.
    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 2500 filas y han llegado 2499 \(tras descartar 1 repetida\)/);
  });

  it("sale una reserva (pasa a «Llegó» o se cancela y deja la vista) entre lotes: se rechaza, no llegan 2.499 con una vieja", async () => {
    const todas = reservas(2500);
    const saliente = [...todas].sort(ordenDeLaLista)[10].id;
    const doble = crear(todas);
    doble.opciones.antesDeResponder = (p) => {
      if (p.numero === 2) doble.tablas.reservas = doble.tablas.reservas.filter((f) => f.id !== saliente);
    };

    await expect(leer(doble)).rejects.toBeInstanceOf(ErrorLecturaInconsistente);
  });

  it("un lote intermedio que llega corto se rechaza", async () => {
    const doble = crear(reservas(3500), { recortar: (p) => (p.rango?.[0] === 1000 ? 990 : undefined) });

    await expect(leer(doble)).rejects.toBeInstanceOf(ErrorLecturaInconsistente);
  });
});

describe("leerReservasLista · cancelación", () => {
  it("pasa el `signal` a cada lote (`.abortSignal`) y al helper; sin él, los lotes no llevan señal", async () => {
    const control = new AbortController();
    const conSenal = crear(reservas(2500));
    await leer(conSenal, { signal: control.signal });
    expect(conSenal.peticiones).toHaveLength(3);
    for (const p of conSenal.peticiones) expect(p.signal).toBe(control.signal);

    const sinSenal = crear(reservas(2500));
    await leer(sinSenal);
    for (const p of sinSenal.peticiones) expect(p.signal).toBeUndefined();
  });

  it("abortada con lotes en vuelo, los que iban terminan y no se lanza ninguno nuevo", async () => {
    const control = new AbortController();
    const puerta = diferido();
    // Los dos primeros lotes en paralelo (2.º y 3.º) quedan retenidos y NO se abortan solos (`noAbortarEnVuelo`):
    // lo que se comprueba es que quien lee deja de lanzar lotes por sí mismo.
    const doble = crear(reservas(7000), { noAbortarEnVuelo: true, antesDeResponder: (p) => (p.numero >= 2 && p.numero <= 5 ? puerta.promesa : undefined) });
    const resultado = leer(doble, { signal: control.signal }).then(
      () => "resuelta",
      (error) => error,
    );

    await cederTurno(5);
    expect(doble.peticiones).toHaveLength(5); // el primero y los cuatro en vuelo
    control.abort();
    puerta.resolver();

    expect(await resultado).toMatchObject({ name: "AbortError" });
    // Los lotes 6.º y 7.º (offsets 5000 y 6000) no se pidieron.
    expect(doble.peticiones).toHaveLength(5);
  });

  it("una señal ya abortada no pide nada", async () => {
    const control = new AbortController();
    control.abort();
    const doble = crear(reservas(10));

    await expect(leer(doble, { signal: control.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(doble.peticiones).toHaveLength(0);
  });
});
