/**
 * `paginarConsulta` contra el cliente REAL de `supabase-js` (postgrest-js) y un `fetch` falso que
 * habla PostgREST. Es el contrato con lo que sale por la red, que el doble en memoria de los otros
 * tests no puede comprobar porque se salta el constructor de consultas:
 *
 *   · `.range(a, b)` viaja como `offset=a&limit=b-a+1` y el orden como `order=fecha.desc,hora.asc,id.asc`;
 *   · `{ count: "exact" }` viaja como `Prefer: count=exact` SOLO en el primer lote, y el recuento se
 *     lee de `Content-Range` (`0-999/2500`);
 *   · un servidor que contesta sin recuento (`Content-Range: 0-999/*`) hace que `postgrest-js` devuelva
 *     `count: NaN`, y eso no puede confundirse con «no hay más filas»: se lee en serie hasta un lote
 *     VACÍO, avanzando por lo recibido;
 *   · con un `max-rows` más bajo que el lote (300), con o sin recuento, llegan todas las filas;
 *   · el error de PostgREST (500 con su JSON) llega tal cual a quien llama;
 *   · si los datos cambian entre lotes, la lectura se rechaza (`ErrorLecturaInconsistente`);
 *   · `.abortSignal(signal)` viaja como `signal` del `fetch`, y un `fetch` abortado corta la lectura.
 *
 * Nada sale a la red: el `fetch` es una función.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { leerReservasLista } from "@/lib/reservas/leerReservasLista";
import { ErrorLecturaInconsistente } from "@/lib/reservas/paginarConsulta";

type Fila = { id: string; fecha: string; hora: string; estado: string };

interface Opciones {
  /** Contesta `Content-Range: a-b/*` aunque se pida recuento. */
  sinRecuento?: boolean;
  /** `max-rows` de PostgREST: tope de filas por petición (1000 por defecto, como Supabase). */
  maxRows?: number;
  /** Si devuelve algo, la petición falla con 500 y ese cuerpo JSON. */
  error?: (offset: number) => Record<string, unknown> | undefined;
  /** Se espera antes de contestar cada petición; se puede cambiar la tabla aquí para imitar escrituras entre lotes. */
  antes?: (numero: number, offset: number) => void | Promise<void>;
}

const reservas = (n: number): Fila[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `res-${String(i).padStart(6, "0")}`,
    fecha: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
    hora: ["13:00:00", "14:30:00", "21:00:00"][i % 3],
    estado: "confirmada",
  }));

/** Lo que debe salir de la Lista: fecha descendente, hora ascendente, `id` ascendente. */
const enOrdenDeLaLista = (filas: Fila[]) =>
  [...filas].sort(
    (a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0) || (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0) || (a.id < b.id ? -1 : 1),
  );

const diferido = () => {
  let resolver!: () => void;
  const promesa = new Promise<void>((ok) => {
    resolver = ok;
  });
  return { promesa, resolver };
};

/** Un PostgREST de mentira: aplica `order`, `offset` y `limit` de la URL, `max-rows` y `Prefer: count=exact`. */
function crearCliente(tabla: Fila[], opciones: Opciones = {}) {
  const peticiones: Array<{ url: URL; prefer: string | null; signal: AbortSignal | null | undefined }> = [];

  const fetchFalso = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url);
    const prefer = new Headers(init?.headers).get("Prefer");
    peticiones.push({ url, prefer, signal: init?.signal });
    const numero = peticiones.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);

    await opciones.antes?.(numero, offset);
    // Como `fetch`: con la señal abortada, rechaza con un `AbortError` (postgrest-js lo devuelve como error de la respuesta).
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

    const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), opciones.maxRows ?? 1000);
    const fallo = opciones.error?.(offset);
    if (fallo) return new Response(JSON.stringify(fallo), { status: 500, headers: { "Content-Type": "application/json" } });

    const orden = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map((t) => {
      const [columna, sentido] = t.split(".");
      return { columna, desc: sentido === "desc" };
    });
    const ordenadas = [...tabla].sort((a, b) => {
      for (const { columna, desc } of orden) {
        const x = a[columna as keyof Fila];
        const y = b[columna as keyof Fila];
        if (x !== y) return (x < y ? -1 : 1) * (desc ? -1 : 1);
      }
      return 0;
    });
    const lote = ordenadas.slice(offset, offset + limit);

    const quiereRecuento = prefer?.includes("count=exact") && !opciones.sinRecuento;
    const rango = lote.length ? `${offset}-${offset + lote.length - 1}` : "*";
    return new Response(JSON.stringify(lote), {
      status: lote.length < tabla.length ? 206 : 200,
      headers: { "Content-Type": "application/json", "Content-Range": `${rango}/${quiereRecuento ? tabla.length : "*"}` },
    });
  };

  const cliente = createClient("http://localhost:54321", "clave-falsa", {
    global: { fetch: fetchFalso as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { cliente, peticiones };
}

const lectura = (cliente: ReturnType<typeof crearCliente>["cliente"], opciones?: Parameters<typeof leerReservasLista>[1]) =>
  leerReservasLista(cliente as unknown as Parameters<typeof leerReservasLista>[0], opciones);

/** `offset` y `limit` de cada petición, de menor a mayor `offset` (los lotes en paralelo no llegan a `fetch` en un orden garantizado). */
const offsetsYLimites = (peticiones: ReturnType<typeof crearCliente>["peticiones"]) =>
  [...peticiones]
    .sort((a, b) => Number(a.url.searchParams.get("offset")) - Number(b.url.searchParams.get("offset")))
    .map((p) => [Number(p.url.searchParams.get("offset")), Number(p.url.searchParams.get("limit"))]);

describe("paginarConsulta · con el cliente real de supabase-js", () => {
  it("2.500 reservas: tres peticiones con `offset`/`limit` y `order` correctos, recuento solo en la primera, y llegan todas ordenadas", async () => {
    const todas = reservas(2500);
    const { cliente, peticiones } = crearCliente(todas);

    const { filas, total, truncado } = await lectura(cliente);

    // El último pide solo lo que falta.
    expect(offsetsYLimites(peticiones)).toEqual([[0, 1000], [1000, 1000], [2000, 500]]);
    for (const p of peticiones) {
      expect(p.url.pathname).toBe("/rest/v1/reservas");
      expect(p.url.searchParams.get("select")).toBe("*");
      expect(p.url.searchParams.get("order")).toBe("fecha.desc,hora.asc,id.asc");
    }
    // Pide recuento una sola vez: el primer lote, el de `offset=0`.
    expect(peticiones.filter((p) => p.prefer?.includes("count=exact")).map((p) => p.url.searchParams.get("offset"))).toEqual(["0"]);

    expect(total).toBe(2500);
    expect(truncado).toBe(false);
    expect(new Set(filas.map((f) => f.id)).size).toBe(2500);
    expect(filas.map((f) => f.id)).toEqual(enOrdenDeLaLista(todas).map((f) => f.id));
  });

  it("1.000 reservas justas: una sola petición (el recuento dice que no hay más)", async () => {
    const { cliente, peticiones } = crearCliente(reservas(1000));

    const { filas } = await lectura(cliente);

    expect(filas).toHaveLength(1000);
    expect(peticiones).toHaveLength(1);
  });

  it("si el servidor contesta sin recuento (`Content-Range: …/*`, `count: NaN` en postgrest-js) sigue en serie hasta un lote VACÍO", async () => {
    const todas = reservas(2500);
    const { cliente, peticiones } = crearCliente(todas, { sinRecuento: true });

    const { filas, total } = await lectura(cliente);

    expect(filas.map((f) => f.id)).toEqual(enOrdenDeLaLista(todas).map((f) => f.id));
    expect(total).toBeNull();
    // Cada lote pide a partir de lo recibido: 1000, 1000, 500 y el que llega vacío.
    expect(peticiones.map((p) => p.url.searchParams.get("offset"))).toEqual(["0", "1000", "2000", "2500"]);
  });

  it("con un `max-rows` de 300 y recuento: llegan 1.250 de 1.250 (el paso pasa a ser lo que devuelve el primer lote)", async () => {
    const todas = reservas(1250);
    const { cliente, peticiones } = crearCliente(todas, { maxRows: 300 });

    const { filas, total } = await lectura(cliente);

    expect(total).toBe(1250);
    expect(filas).toHaveLength(1250);
    expect(new Set(filas.map((f) => f.id)).size).toBe(1250);
    expect(filas.map((f) => f.id)).toEqual(enOrdenDeLaLista(todas).map((f) => f.id));
    // El primero pide 1000 y llegan 300; desde ahí, de 300 en 300 y el último solo los 50 que faltan.
    expect(offsetsYLimites(peticiones)).toEqual([[0, 1000], [300, 300], [600, 300], [900, 300], [1200, 50]]);
  });

  it("con un `max-rows` de 300 y SIN recuento: llegan 2.500 de 2.500, no 300", async () => {
    const todas = reservas(2500);
    const { cliente, peticiones } = crearCliente(todas, { maxRows: 300, sinRecuento: true });

    const { filas, total } = await lectura(cliente);

    expect(total).toBeNull();
    expect(filas).toHaveLength(2500);
    expect(filas.map((f) => f.id)).toEqual(enOrdenDeLaLista(todas).map((f) => f.id));
    expect(peticiones.map((p) => p.url.searchParams.get("offset"))).toEqual(
      ["0", "300", "600", "900", "1200", "1500", "1800", "2100", "2400", "2500"],
    );
  });

  it("el error de PostgREST de un lote llega tal cual y la lectura no devuelve nada", async () => {
    const { cliente } = crearCliente(reservas(2500), {
      error: (offset) => (offset === 1000 ? { code: "57014", message: "canceling statement due to statement timeout", details: null, hint: null } : undefined),
    });

    await expect(lectura(cliente)).rejects.toMatchObject({ code: "57014", message: "canceling statement due to statement timeout" });
  });

  it("si una reserva sale de la vista entre el lote 1 y el 2, la lectura se rechaza (no llegan 2.499 filas con una vieja y sin una viva)", async () => {
    const todas = reservas(2500);
    const saliente = enOrdenDeLaLista(todas)[10].id;
    const { cliente } = crearCliente(todas, {
      antes: (numero) => {
        if (numero === 2) todas.splice(todas.findIndex((f) => f.id === saliente), 1);
      },
    });

    const error = await lectura(cliente).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(error.message).toMatch(/se esperaban 2500 filas y han llegado 2499/);
  });
});

describe("paginarConsulta · cancelación con el cliente real", () => {
  it("el `signal` viaja a cada petición como `signal` del `fetch`; sin él, no viaja ninguno", async () => {
    const control = new AbortController();
    const conSenal = crearCliente(reservas(2500));
    await lectura(conSenal.cliente, { signal: control.signal });
    expect(conSenal.peticiones).toHaveLength(3);
    for (const p of conSenal.peticiones) expect(p.signal).toBe(control.signal);

    const sinSenal = crearCliente(reservas(2500));
    await lectura(sinSenal.cliente);
    for (const p of sinSenal.peticiones) expect(p.signal ?? null).toBeNull();
  });

  it("abortado con el primer lote en vuelo: el `fetch` rechaza con `AbortError`, la lectura lo lanza y no se pide ningún lote más", async () => {
    const control = new AbortController();
    const puerta = diferido();
    const { cliente, peticiones } = crearCliente(reservas(2500), {
      antes: (numero) => (numero === 1 ? puerta.promesa : undefined),
    });
    const resultado = lectura(cliente, { signal: control.signal }).then(
      () => "resuelta",
      (error) => error,
    );

    await new Promise((resolver) => setTimeout(resolver, 5));
    control.abort();
    puerta.resolver();

    expect(await resultado).toMatchObject({ message: expect.stringContaining("AbortError") });
    expect(peticiones).toHaveLength(1);
  });
});
