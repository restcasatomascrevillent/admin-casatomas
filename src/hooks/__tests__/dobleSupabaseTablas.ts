/**
 * Doble en memoria del cliente de Supabase para los tests que LEEN tablas a través de un hook o de un
 * componente (no es un test: lo importan los tests).
 *
 * Un builder que lo devuelve todo pase lo que pase deja pasar justo los fallos que importan aquí: que un
 * hook deje de pedir una columna o de filtrar. Este se porta como PostgREST en lo que hace falta para
 * cazarlos:
 *   · devuelve SOLO las columnas pedidas en `select` (si un hook deja de pedir `marca`, sus filas llegan
 *     sin `marca`, como en producción, y el test que depende de ella cae);
 *   · aplica `eq`, `neq`, `in`, `gt`, `gte`, `lt` y `lte` con la semántica de SQL (un NULL no pasa ningún
 *     filtro) y el orden de `order`, con los NULL como en Postgres: AL FINAL al ordenar de forma ascendente
 *     y AL PRINCIPIO de forma descendente (`NULLS LAST` / `NULLS FIRST` por defecto);
 *   · anota cada petición (tabla, columnas y filtros) en `peticiones`.
 *
 * Lo que NO imita: `or`, `not`, `range`, recuentos, selects con relaciones o alias (los rechaza con un
 * error, para que nadie crea que los prueba), escrituras ni el realtime (los canales no emiten nada).
 * Y tres cosas más, que NO se rechazan y por eso pueden esconder un fallo:
 *   · el TOPE de filas por petición (`max-rows`: 1000 en Supabase): aquí llegan todas las que pasan los
 *     filtros, así que una lectura que en producción se queda en 1.000 filas, aquí no se queda corta
 *     (para probarlo, `src/lib/reservas/__tests__/dobleSupabaseLotes.ts` sí lo aplica);
 *   · una columna que NO existe en un `eq`, `neq`, `in`, `gt`, `gte`, `lt` o `lte`: devuelve cero filas
 *     (ninguna pasa el filtro) en vez del error 400 de PostgREST («column … does not exist»);
 *   · una columna que NO existe en un `select`: la fila trae esa columna a `null` en vez de dar ese
 *     mismo error 400.
 * Es decir: un nombre de columna mal escrito aquí no falla, y en producción sí. Los tests que dependan
 * de que una columna exista tienen que sembrarla en las filas de `tablas`.
 */
import { vi } from "vitest";

export type FilaDobleTablas = Record<string, unknown>;

export interface PeticionDobleTablas {
  tabla: string;
  /** El primer argumento de `select` ("*" si no se llamó). */
  columnas: string;
  /** `fecha=2026-10-01`, `estado<>cancelada`, `estado in (a,b)`… en el orden en que se encadenaron. */
  filtros: string[];
}

export interface DobleTablas {
  /** Contenido de cada tabla o vista, por nombre. */
  tablas: Record<string, FilaDobleTablas[]>;
  /** Si una tabla tiene error aquí, toda lectura suya lo devuelve (`{ data: null, error }`). */
  errores: Record<string, unknown>;
  peticiones: PeticionDobleTablas[];
  from: ReturnType<typeof vi.fn>;
  channel: ReturnType<typeof vi.fn>;
  removeChannel: ReturnType<typeof vi.fn>;
  /** Vacía tablas, errores y peticiones (para el `beforeEach`). */
  reiniciar: () => void;
}

const COLUMNA_SIMPLE = /^[a-z_][a-z0-9_]*$/i;

function proyectar(fila: FilaDobleTablas, columnas: string): FilaDobleTablas {
  const lista = columnas
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (lista.length === 0 || lista.includes("*")) return { ...fila };
  for (const c of lista) {
    if (!COLUMNA_SIMPLE.test(c)) throw new Error(`dobleSupabaseTablas: select no soportado ("${c}")`);
  }
  return Object.fromEntries(lista.map((c) => [c, fila[c] ?? null]));
}

/**
 * Compara como el `ORDER BY` de Postgres: un NULL es MAYOR que cualquier valor, así que en ascendente va
 * AL FINAL y, como `ascendente ? c : -c` invierte el signo, en descendente va AL PRINCIPIO (`NULLS LAST` /
 * `NULLS FIRST` por defecto). Los NULL empatan entre sí. Los filtros de rango (`gt`, `gte`, `lt`, `lte`) no
 * la usan con un NULL: un NULL no pasa ninguno, ni como valor de la columna ni como argumento.
 */
const comparar = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
};

class ConsultaDobleTablas implements PromiseLike<{ data: FilaDobleTablas[] | null; error: unknown }> {
  private columnas = "*";
  private readonly filtros: Array<{ texto: string; pasa: (f: FilaDobleTablas) => boolean }> = [];
  private readonly orden: Array<{ columna: string; ascendente: boolean }> = [];

  constructor(
    private readonly doble: DobleTablas,
    private readonly tabla: string,
  ) {}

  select(columnas = "*") {
    this.columnas = columnas;
    return this;
  }

  eq(columna: string, valor: unknown) {
    return this.filtrar(`${columna}=${String(valor)}`, (f) => f[columna] != null && f[columna] === valor);
  }

  neq(columna: string, valor: unknown) {
    return this.filtrar(`${columna}<>${String(valor)}`, (f) => f[columna] != null && f[columna] !== valor);
  }

  in(columna: string, valores: readonly unknown[]) {
    return this.filtrar(
      `${columna} in (${valores.map(String).join(",")})`,
      (f) => f[columna] != null && valores.includes(f[columna]),
    );
  }

  gt(columna: string, valor: unknown) {
    return this.filtrar(
      `${columna}>${String(valor)}`,
      (f) => f[columna] != null && valor != null && comparar(f[columna], valor) > 0,
    );
  }

  gte(columna: string, valor: unknown) {
    return this.filtrar(
      `${columna}>=${String(valor)}`,
      (f) => f[columna] != null && valor != null && comparar(f[columna], valor) >= 0,
    );
  }

  lt(columna: string, valor: unknown) {
    return this.filtrar(
      `${columna}<${String(valor)}`,
      (f) => f[columna] != null && valor != null && comparar(f[columna], valor) < 0,
    );
  }

  lte(columna: string, valor: unknown) {
    return this.filtrar(
      `${columna}<=${String(valor)}`,
      (f) => f[columna] != null && valor != null && comparar(f[columna], valor) <= 0,
    );
  }

  order(columna: string, opciones?: { ascending?: boolean }) {
    this.orden.push({ columna, ascendente: opciones?.ascending !== false });
    return this;
  }

  then<A = { data: FilaDobleTablas[] | null; error: unknown }, B = never>(
    ok?: ((v: { data: FilaDobleTablas[] | null; error: unknown }) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.ejecutar())
      .then(ok, ko);
  }

  private filtrar(texto: string, pasa: (f: FilaDobleTablas) => boolean) {
    this.filtros.push({ texto, pasa });
    return this;
  }

  private ejecutar(): { data: FilaDobleTablas[] | null; error: unknown } {
    this.doble.peticiones.push({
      tabla: this.tabla,
      columnas: this.columnas,
      filtros: this.filtros.map((f) => f.texto),
    });
    const error = this.doble.errores[this.tabla];
    if (error) return { data: null, error };
    const filas = (this.doble.tablas[this.tabla] ?? []).filter((f) => this.filtros.every((x) => x.pasa(f)));
    if (this.orden.length > 0) {
      filas.sort((a, b) => {
        for (const { columna, ascendente } of this.orden) {
          const c = comparar(a[columna], b[columna]);
          if (c !== 0) return ascendente ? c : -c;
        }
        return 0;
      });
    }
    return { data: filas.map((f) => proyectar(f, this.columnas)), error: null };
  }
}

export function crearDobleTablas(): DobleTablas {
  const canal: Record<string, unknown> = {};
  canal.on = vi.fn(() => canal);
  canal.subscribe = vi.fn(() => canal);

  const doble = {
    tablas: {},
    errores: {},
    peticiones: [],
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(),
  } as unknown as DobleTablas;
  doble.from = vi.fn((tabla: string) => new ConsultaDobleTablas(doble, tabla));
  doble.reiniciar = () => {
    doble.tablas = {};
    doble.errores = {};
    doble.peticiones = [];
  };
  return doble;
}
