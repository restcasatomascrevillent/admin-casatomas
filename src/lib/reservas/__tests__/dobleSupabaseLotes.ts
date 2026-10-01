/**
 * Doble en memoria del cliente de Supabase para probar LECTURAS POR LOTES
 * (`paginarConsulta` y quienes la usan). No es un test: lo importan los tests.
 *
 * Imita lo que de PostgREST importa para paginar, y lo imita en serio, porque un doble
 * demasiado amable hace pasar tests que luego fallan en producción:
 *   · filtros (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`), `order` encadenado (varias columnas,
 *     ascendente o descendente) y `range` con sus dos extremos incluidos;
 *   · el TOPE de filas por petición (`max-rows`: 1000 por defecto, como Supabase), que se aplica
 *     aunque se pida un rango mayor y SIN avisar;
 *   · el RECUENTO exacto (`select(cols, { count: "exact" })`): el de las filas que pasan los
 *     filtros, no el de la tabla ni el del lote;
 *   · los EMPATES del orden (`desordenarEmpates`): Postgres no garantiza en qué orden devuelve
 *     las filas que empatan en todo el `ORDER BY`, y puede ser otro en cada petición. Con esta
 *     opción cada petición los saca en un orden distinto (pero estable dentro de ella), así que
 *     una consulta sin desempate por columna única repite y salta filas entre lotes, como en
 *     producción. Sin la opción, los empates salen en el orden en que están en la tabla;
 *   · fallos (`fallar`) y esperas (`antesDeResponder`) por petición, para probar el error en un
 *     lote concreto, que no se vean datos a medias mientras faltan lotes y el máximo de
 *     peticiones simultáneas;
 *   · lotes que llegan CORTOS (`recortar`) aunque el recuento diga que hay más;
 *   · la CANCELACIÓN: `.abortSignal(signal)` anota la señal en la petición y, si está abortada
 *     cuando se contesta, la respuesta es el error que saca `postgrest-js` de un `fetch` abortado
 *     (`AbortError`), salvo con `noAbortarEnVuelo`, que contesta igual: así se puede comprobar que
 *     quien lee deja de lanzar lotes por sí mismo, sin depender de que el `fetch` los aborte.
 *
 * Cada petición queda anotada en `peticiones` (tabla, columnas, filtros, orden, rango, si pidió
 * recuento y la señal de cancelación), que es lo que los tests comparan para comprobar que los
 * filtros y el orden son los mismos en todos los lotes.
 *
 * Lo que NO imita: nulos en el orden (aquí ordenan como el valor más pequeño), tipos distintos de
 * cadena o número, y nada de escritura.
 */
import { vi } from "vitest";

export type FilaDoble = Record<string, unknown>;

export interface PeticionDoble {
  /** 1, 2, 3… en el orden en que llegan al doble. */
  numero: number;
  tabla: string;
  /** El primer argumento de `select`. */
  columnas: string | undefined;
  /** ¿Pidió el recuento exacto? */
  contar: boolean;
  /** `fecha>=2026-10-01`, `estado<>cancelada`… en el orden en que se encadenaron. */
  filtros: string[];
  /** El orden pedido, columna a columna. */
  orden: Array<{ columna: string; ascendente: boolean }>;
  /** `[primera, ultima]` de `.range()`; `null` si no se pidió rango. */
  rango: [number, number] | null;
  /** La señal de `.abortSignal(signal)`; `undefined` si la consulta no la llevaba. */
  signal: AbortSignal | undefined;
}

export interface OpcionesDoble {
  /** Tope de filas por petición (PostgREST `max-rows`). 1000 por defecto, como Supabase. */
  maxFilas?: number;
  /** Los empates salen en otro orden en cada petición (ver la cabecera). */
  desordenarEmpates?: boolean;
  /** Responde sin recuento aunque se pida (`count: null`), para probar ese camino. */
  sinRecuento?: boolean;
  /**
   * Responde `count: NaN`: lo que saca `postgrest-js` (con `parseInt`) cuando el servidor contesta
   * `Content-Range: 0-999/*`, o sea, sin recuento. Es un número, pero no un recuento.
   */
  recuentoNaN?: boolean;
  /** Si devuelve algo distinto de `undefined`, esa petición falla con ese error. */
  fallar?: (peticion: PeticionDoble) => unknown;
  /**
   * Se espera antes de contestar. Se puede escribir en `tablas` aquí para imitar a alguien que
   * escribe mientras se leen los lotes: la respuesta se calcula DESPUÉS de esta espera.
   */
  antesDeResponder?: (peticion: PeticionDoble) => void | Promise<void>;
  /**
   * Si devuelve un número, esa petición contesta SOLO con esas primeras filas aunque el recuento
   * diga que hay más (un lote que llega corto).
   */
  recortar?: (peticion: PeticionDoble) => number | undefined;
  /** Contesta con normalidad aunque la señal esté abortada (ver la cabecera). */
  noAbortarEnVuelo?: boolean;
}

export interface RespuestaDoble {
  data: FilaDoble[] | null;
  error: unknown;
  count: number | null;
}

export interface DobleSupabase {
  /** Las filas de cada tabla o vista. Se pueden cambiar entre peticiones. */
  tablas: Record<string, FilaDoble[]>;
  opciones: OpcionesDoble;
  /** Todas las peticiones recibidas, en orden de llegada. */
  peticiones: PeticionDoble[];
  /** Cuántas peticiones han estado esperando respuesta A LA VEZ, como máximo. */
  readonly maximoEnVuelo: number;
  from: (tabla: string) => ConsultaDoble;
  /** Realtime: el panel se suscribe a cambios; aquí no llega ninguno. */
  channel: (nombre: string) => unknown;
  removeChannel: (canal: unknown) => unknown;
  /** Vuelve al estado de partida: sin tablas, sin opciones y sin peticiones anotadas. */
  reiniciar: () => void;
}

/** Hash de cadena (FNV-1a de 32 bits): desordena los empates sin azar, así los tests son deterministas. */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function comparar(a: unknown, b: unknown): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

export class ConsultaDoble implements PromiseLike<RespuestaDoble> {
  private columnas: string | undefined;
  private contar = false;
  private readonly filtros: Array<{ texto: string; pasa: (fila: FilaDoble) => boolean }> = [];
  private readonly orden: Array<{ columna: string; ascendente: boolean }> = [];
  private rango: [number, number] | null = null;
  private senal: AbortSignal | undefined;

  constructor(
    private readonly doble: DobleSupabase,
    private readonly tabla: string,
    private readonly contador: { enVuelo: number; maximo: number; siguiente: number },
  ) {}

  select(columnas?: string, opciones?: { count?: string; head?: boolean }): this {
    this.columnas = columnas;
    this.contar = opciones?.count === "exact";
    return this;
  }

  private filtro(columna: string, operador: string, valor: unknown, pasa: (v: unknown) => boolean): this {
    this.filtros.push({ texto: `${columna}${operador}${String(valor)}`, pasa: (fila) => pasa(fila[columna]) });
    return this;
  }

  eq(columna: string, valor: unknown): this {
    return this.filtro(columna, "=", valor, (v) => v === valor);
  }
  neq(columna: string, valor: unknown): this {
    return this.filtro(columna, "<>", valor, (v) => v !== valor);
  }
  gt(columna: string, valor: unknown): this {
    return this.filtro(columna, ">", valor, (v) => comparar(v, valor) > 0);
  }
  gte(columna: string, valor: unknown): this {
    return this.filtro(columna, ">=", valor, (v) => comparar(v, valor) >= 0);
  }
  lt(columna: string, valor: unknown): this {
    return this.filtro(columna, "<", valor, (v) => comparar(v, valor) < 0);
  }
  lte(columna: string, valor: unknown): this {
    return this.filtro(columna, "<=", valor, (v) => comparar(v, valor) <= 0);
  }
  in(columna: string, valores: unknown[]): this {
    return this.filtro(columna, " in ", `(${valores.join(",")})`, (v) => valores.includes(v));
  }

  order(columna: string, opciones?: { ascending?: boolean }): this {
    this.orden.push({ columna, ascendente: opciones?.ascending ?? true });
    return this;
  }

  range(primera: number, ultima: number): this {
    this.rango = [primera, ultima];
    return this;
  }

  abortSignal(signal: AbortSignal): this {
    this.senal = signal;
    return this;
  }

  then<R1 = RespuestaDoble, R2 = never>(
    alResolver?: ((valor: RespuestaDoble) => R1 | PromiseLike<R1>) | null,
    alRechazar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.ejecutar().then(alResolver, alRechazar);
  }

  private async ejecutar(): Promise<RespuestaDoble> {
    const peticion: PeticionDoble = {
      numero: ++this.contador.siguiente,
      tabla: this.tabla,
      columnas: this.columnas,
      contar: this.contar,
      filtros: this.filtros.map((f) => f.texto),
      orden: this.orden.map((o) => ({ ...o })),
      rango: this.rango ? [...this.rango] : null,
      signal: this.senal,
    };
    this.doble.peticiones.push(peticion);

    this.contador.enVuelo++;
    this.contador.maximo = Math.max(this.contador.maximo, this.contador.enVuelo);
    try {
      await this.doble.opciones.antesDeResponder?.(peticion);

      // `fetch` abortado: `postgrest-js` lo devuelve como un error de la respuesta, no lo lanza.
      if (this.senal?.aborted && !this.doble.opciones.noAbortarEnVuelo) {
        return { data: null, error: { message: "AbortError: The operation was aborted.", details: "", hint: "", code: "" }, count: null };
      }

      const error = this.doble.opciones.fallar?.(peticion);
      if (error !== undefined) return { data: null, error, count: null };

      // La respuesta se calcula ahora, con las tablas tal como están en este momento.
      const filtradas = (this.doble.tablas[this.tabla] ?? []).filter((fila) => this.filtros.every((f) => f.pasa(fila)));
      const desordenar = !!this.doble.opciones.desordenarEmpates;
      const ordenadas = [...filtradas].sort((a, b) => {
        for (const { columna, ascendente } of this.orden) {
          const c = comparar(a[columna], b[columna]);
          if (c !== 0) return ascendente ? c : -c;
        }
        return desordenar ? hash(`${JSON.stringify(a)}#${peticion.numero}`) - hash(`${JSON.stringify(b)}#${peticion.numero}`) : 0;
      });

      const tope = this.doble.opciones.maxFilas ?? 1000;
      const delRango = (this.rango ? ordenadas.slice(this.rango[0], this.rango[1] + 1) : ordenadas).slice(0, tope);
      const recorte = this.doble.opciones.recortar?.(peticion);
      const lote = recorte === undefined ? delRango : delRango.slice(0, recorte);
      const recuento = !this.contar || this.doble.opciones.sinRecuento ? null : this.doble.opciones.recuentoNaN ? NaN : filtradas.length;
      return { data: lote, error: null, count: recuento };
    } finally {
      this.contador.enVuelo--;
    }
  }
}

export function crearDobleSupabase(tablas: Record<string, FilaDoble[]> = {}, opciones: OpcionesDoble = {}): DobleSupabase {
  const contador = { enVuelo: 0, maximo: 0, siguiente: 0 };
  const canal = { on: vi.fn(() => canal), subscribe: vi.fn(() => canal) };

  const doble: DobleSupabase = {
    tablas,
    opciones,
    peticiones: [],
    get maximoEnVuelo() {
      return contador.maximo;
    },
    from: (tabla) => new ConsultaDoble(doble, tabla, contador),
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(),
    reiniciar: () => {
      for (const clave of Object.keys(doble.tablas)) delete doble.tablas[clave];
      for (const clave of Object.keys(doble.opciones)) delete (doble.opciones as Record<string, unknown>)[clave];
      doble.peticiones.length = 0;
      contador.enVuelo = 0;
      contador.maximo = 0;
      contador.siguiente = 0;
    },
  };
  return doble;
}
