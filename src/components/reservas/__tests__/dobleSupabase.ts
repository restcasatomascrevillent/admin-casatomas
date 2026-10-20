/**
 * Doble en memoria de LO POCO de PostgREST que usan, a la vez, el kanban de «Hoy», el plano
 * de sala (`PlanoEspacio2D`) y el ejecutor de acciones sobre una reserva.
 *
 * Para qué sirve: los tests del mapa que se abre al mover una reserva
 * (`GestorReservasKanban.mapa.test.tsx`, `ElegirMesaDialog.test.tsx`) necesitan que MOVER una
 * reserva cambie de verdad lo que lee el plano después. Con un mock que devuelve siempre las
 * mismas filas, «la reserva ya está en esa sala» no se podría comprobar. Aquí:
 *
 *   · las lecturas APLICAN los filtros (`eq`, `neq`, `in`, `is`, incluida la ruta con punto de
 *     `eq("reservas.fecha", …)` de las asignaciones) y devuelven copias, como la red;
 *   · el `update` de `reservas` escribe en el almacén y, como el trigger
 *     `trg_reservas_sincronizar_asignaciones`, BORRA las mesas de la reserva si cambia su sala;
 *   · el RPC `asignar_mesas_reserva` reemplaza de golpe las mesas de una reserva y rechaza con
 *     `MESA_OCUPADA: La mesa X está ocupada de HH:MM a HH:MM por Y` si otra reserva del mismo día
 *     tiene esa mesa en una franja que se pisa (ocupación por tiempo, 20261005130000; minutos de
 *     `otras.configuracion_reservas` o 105 / 120 por defecto).
 *
 * `antesDeLeer` / `antesDeEscribir` dejan a un test RETENER una petición para comprobar qué
 * se pinta mientras llega. Nada sale de aquí: es un objeto, sin red.
 */

import { franjaDeHora, seSolapan, textoFranja } from "@/lib/reservas/ocupacionMesa";

export type Fila = Record<string, unknown>;

export interface LecturaDoble {
  tabla: string;
  /** Filtros `eq` de la consulta, en el orden en que se encadenaron. */
  eq: Array<[string, unknown]>;
}

export interface EscrituraDoble {
  tabla: string;
  payload: Fila;
  /** Ids de las filas que ha tocado. */
  ids: unknown[];
}

export interface AlmacenDoble {
  reservas: Fila[];
  mesas: Fila[];
  /** Solo `{ id, reserva_id, mesa_id }`: las lecturas les añaden `reservas` y `mesas`, como PostgREST. */
  asignaciones: Fila[];
  /** Cualquier otra tabla que alguna pantalla lea (p. ej. la configuración). */
  otras: Record<string, Fila[]>;
  /** Escrituras a `reservas`, en orden. */
  escrituras: EscrituraDoble[];
  /** Todas las lecturas, en orden. */
  lecturas: LecturaDoble[];
  llamadasRpc: Array<{ nombre: string; args: Record<string, unknown> }>;
  /** Llamadas a Edge Functions (el correo al cliente): estos tests comprueban que no hay ninguna. */
  invocaciones: unknown[][];
  /** Respuestas forzadas de las siguientes escrituras (se consumen de una en una). */
  respuestasEscritura: Array<{ error?: unknown }>;
  /** Si devuelve una promesa, la lectura espera a que se resuelva antes de contestar. */
  antesDeLeer?: (lectura: LecturaDoble) => Promise<void> | void;
  /** Igual, para las escrituras. */
  antesDeEscribir?: (escritura: { tabla: string; payload: Fila }) => Promise<void> | void;
  /** Fuerza el siguiente RPC a fallar con este mensaje (se consume). */
  errorRpc: string | null;
}

export function crearAlmacen(): AlmacenDoble {
  return {
    reservas: [],
    mesas: [],
    asignaciones: [],
    otras: {},
    escrituras: [],
    lecturas: [],
    llamadasRpc: [],
    invocaciones: [],
    respuestasEscritura: [],
    antesDeLeer: undefined,
    antesDeEscribir: undefined,
    errorRpc: null,
  };
}

/** Vuelve a dejar el almacén vacío SIN cambiar el objeto (los mocks ya lo tienen referenciado). */
export function vaciarAlmacen(almacen: AlmacenDoble) {
  Object.assign(almacen, crearAlmacen());
}

export function diferido<T = void>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((ok) => {
    resolver = ok;
  });
  return { promesa, resolver };
}

// Mismo corte que el SQL: `hora < '17:00:00'` → comida.
const turnoDe = (hora: unknown) => (String(hora ?? "") < "17:00:00" ? "comida" : "cena");

/** `a.b.c` → `fila.a.b.c` (las asignaciones traen `reservas` y `mesas` anidadas). */
function valorEn(fila: Fila, columna: string): unknown {
  return columna.split(".").reduce<unknown>((actual, parte) => (actual as Fila | null | undefined)?.[parte], fila);
}

interface ConsultaDoble {
  select: (columnas?: string) => ConsultaDoble;
  update: (payload: Fila) => ConsultaDoble;
  eq: (columna: string, valor: unknown) => ConsultaDoble;
  neq: (columna: string, valor: unknown) => ConsultaDoble;
  in: (columna: string, valores: unknown[]) => ConsultaDoble;
  is: (columna: string, valor: unknown) => ConsultaDoble;
  order: (columna?: string, opciones?: { ascending?: boolean }) => ConsultaDoble;
  limit: (n: number) => ConsultaDoble;
  maybeSingle: () => ConsultaDoble;
  single: () => ConsultaDoble;
  then: (ok: (valor: unknown) => unknown, ko?: (motivo: unknown) => unknown) => Promise<unknown>;
}

export function crearSupabaseDoble(almacen: AlmacenDoble) {
  const reservaDe = (id: unknown) => almacen.reservas.find((r) => r.id === id);
  const mesaDe = (id: unknown) => almacen.mesas.find((m) => m.id === id);

  const conDetalles = (a: Fila): Fila => {
    const r = reservaDe(a.reserva_id);
    const m = mesaDe(a.mesa_id);
    return {
      ...a,
      created_at: "2026-10-01T10:00:00Z",
      fecha: r?.fecha ?? null,
      turno: turnoDe(r?.hora),
      espacio_id: m?.espacio_id ?? null,
      reservas: r
        ? { id: r.id, nombre: r.nombre, hora: r.hora, numero_comensales: r.numero_comensales, estado: r.estado, fecha: r.fecha }
        : null,
      mesas: m ? { id: m.id, nombre: m.nombre, capacidad: m.capacidad, espacio_id: m.espacio_id } : null,
    };
  };

  const filasDe = (tabla: string): Fila[] => {
    if (tabla === "reservas") return almacen.reservas;
    if (tabla === "mesas") return almacen.mesas;
    if (tabla === "asignaciones_mesa") return almacen.asignaciones.map(conDetalles);
    return almacen.otras[tabla] ?? [];
  };

  const consulta = (tabla: string): ConsultaDoble => {
    const filtros: Array<(f: Fila) => boolean> = [];
    const eqs: Array<[string, unknown]> = [];
    let cambios: Fila | null = null;
    let pideFila = false;
    let modo: "varias" | "una" | "quizas" = "varias";

    const q: ConsultaDoble = {
      select: () => {
        pideFila = true;
        return q;
      },
      update: (payload) => {
        cambios = { ...payload };
        return q;
      },
      eq: (columna, valor) => {
        eqs.push([columna, valor]);
        filtros.push((f) => valorEn(f, columna) === valor);
        return q;
      },
      neq: (columna, valor) => {
        filtros.push((f) => valorEn(f, columna) !== valor);
        return q;
      },
      in: (columna, valores) => {
        filtros.push((f) => valores.includes(valorEn(f, columna)));
        return q;
      },
      is: (columna, valor) => {
        filtros.push((f) => (valor === null ? valorEn(f, columna) == null : valorEn(f, columna) === valor));
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: () => {
        modo = "quizas";
        return q;
      },
      single: () => {
        modo = "una";
        return q;
      },
      then: async (ok, ko) => {
        const resolver = async () => {
          if (cambios) {
            const escritura = { tabla, payload: cambios };
            await almacen.antesDeEscribir?.(escritura);
            const forzada = almacen.respuestasEscritura.shift();
            if (forzada?.error) return { data: null, error: forzada.error };
            const tocadas = almacen.reservas.filter((f) => filtros.every((p) => p(f)));
            const cambiaSala = "espacio_id" in cambios;
            for (const f of tocadas) {
              const salaAntes = f.espacio_id ?? null;
              Object.assign(f, cambios);
              // El trigger de la BD borra las mesas al cambiar la sala.
              if (cambiaSala && (f.espacio_id ?? null) !== salaAntes) {
                almacen.asignaciones = almacen.asignaciones.filter((a) => a.reserva_id !== f.id);
              }
            }
            almacen.escrituras.push({ tabla, payload: cambios, ids: tocadas.map((f) => f.id) });
            return { data: pideFila ? tocadas.map((f) => ({ id: f.id })) : null, error: null };
          }

          const lectura: LecturaDoble = { tabla, eq: [...eqs] };
          almacen.lecturas.push(lectura);
          await almacen.antesDeLeer?.(lectura);
          const filas = filasDe(tabla)
            .filter((f) => filtros.every((p) => p(f)))
            .map((f) => ({ ...f }));
          if (modo === "una") {
            return filas[0] ? { data: filas[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
          }
          if (modo === "quizas") return { data: filas[0] ?? null, error: null };
          return { data: filas, error: null };
        };
        return resolver().then(ok, ko);
      },
    };
    return q;
  };

  const rpc = async (nombre: string, args: Record<string, unknown>) => {
    almacen.llamadasRpc.push({ nombre, args });

    if (almacen.errorRpc) {
      const message = almacen.errorRpc;
      almacen.errorRpc = null;
      return { data: null, error: { message } };
    }
    if (nombre !== "asignar_mesas_reserva") return { data: null, error: null };

    const reservaId = args.p_reserva_id;
    const mesaIds = (args.p_mesa_ids ?? []) as unknown[];
    const reserva = reservaDe(reservaId);

    // La regla real (trigger de `asignaciones_mesa`): ninguna otra reserva del día con esa mesa en
    // una franja [hora, hora + tiempo de ocupación) que se pise con la suya. Antes de escribir.
    const cfg = (almacen.otras.configuracion_reservas?.[0] ?? {}) as Fila;
    const config = {
      estanciaComidaMinutos: Number(cfg.estancia_comida_minutos) || 105,
      estanciaCenaMinutos: Number(cfg.estancia_cena_minutos) || 120,
    };
    const propia = franjaDeHora(String(reserva?.hora ?? ""), config);
    for (const mesaId of mesaIds) {
      for (const a of almacen.asignaciones) {
        if (a.mesa_id !== mesaId || a.reserva_id === reservaId) continue;
        const otra = reservaDe(a.reserva_id);
        if (otra?.fecha !== reserva?.fecha) continue;
        const franja = franjaDeHora(String(otra?.hora ?? ""), config);
        if (propia && franja && seSolapan(propia, franja)) {
          const message = `MESA_OCUPADA: La mesa ${String(mesaDe(mesaId)?.nombre ?? mesaId)} está ocupada de ${textoFranja(franja)} por ${String(otra?.nombre ?? "otra reserva")}`;
          return { data: null, error: { code: "23514", message } };
        }
      }
    }

    almacen.asignaciones = almacen.asignaciones.filter((a) => a.reserva_id !== reservaId);
    for (const mesaId of mesaIds) {
      almacen.asignaciones.push({ id: `a-${reservaId}-${mesaId}`, reserva_id: reservaId, mesa_id: mesaId });
    }
    return { data: almacen.asignaciones.filter((a) => a.reserva_id === reservaId), error: null };
  };

  const canal = () => {
    const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} };
    return c;
  };

  return {
    from: (tabla: string) => consulta(tabla),
    rpc,
    channel: canal,
    removeChannel: () => Promise.resolve("ok"),
    functions: {
      invoke: (...args: unknown[]) => {
        almacen.invocaciones.push(args);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}
