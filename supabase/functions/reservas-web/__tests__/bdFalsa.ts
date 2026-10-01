// ============================================================================
// Doble EN MEMORIA de lo que usa reservas-web/index.ts de supabase-js, para
// probar el fichero REAL (touza-sin-reservas.integracion.test.ts) sin red ni
// BD: nunca habla con Supabase. Mismo patrón que
// emails-reserva/__tests__/bdFalsa.ts, pero propio, por dos cosas que aquel
// no tiene:
//   · `.or("valor.ilike.%…%,…")`: así consulta la lista negra
//     `verificarBlacklist`. Sin él la consulta lanzaría, el `catch` de
//     index.ts la daría por limpia y la lista negra nunca saltaría en un test.
//   · `accesos`: APUNTA cada consulta ejecutada (tabla + lectura/escritura),
//     para poder afirmar que una petición no ha tocado la BD en absoluto.
// No es un test (no acaba en .test.ts): solo lo importa el de integración.
// ============================================================================

export type Fila = Record<string, unknown>;
export type Operacion = "select" | "insert" | "update";
export interface Acceso {
  tabla: string;
  op: Operacion;
}
interface Resultado {
  data: unknown;
  error: { code: string; message: string } | null;
}

export class BaseFalsa {
  tablas: Record<string, Fila[]> = {};
  /** Cada consulta que ha llegado a ejecutarse, en orden. Sembrar con `tabla(...).push` NO cuenta. */
  accesos: Acceso[] = [];
  private secuencia = 0;

  tabla(nombre: string): Fila[] {
    return (this.tablas[nombre] ??= []);
  }

  nuevoId(): string {
    this.secuencia++;
    return `00000000-0000-4000-8000-${String(this.secuencia).padStart(12, "0")}`;
  }

  /** Solo los INSERT/UPDATE. */
  escrituras(): Acceso[] {
    return this.accesos.filter((a) => a.op !== "select");
  }
}

function escaparRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Patrón ILIKE -> RegExp. `%` y `_` son comodines; `\x` es la `x` literal
 * (así escapa `sanitizeForIlike` en index.ts los `%_().,*\`). */
function ilikeARegExp(patron: string): RegExp {
  let re = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === "\\" && i + 1 < patron.length) re += escaparRegExp(patron[++i]);
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += escaparRegExp(c);
  }
  return new RegExp(`^${re}$`, "is");
}

/** Trozos de un `.or()` de PostgREST: separados por comas NO escapadas. */
function partirOr(expr: string): string[] {
  const partes: string[] = [];
  let actual = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "\\" && i + 1 < expr.length) {
      actual += c + expr[++i];
    } else if (c === ",") {
      partes.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  partes.push(actual);
  return partes;
}

function comparar(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Constructor de consultas encadenable, como el de supabase-js: se ejecuta al hacer `await`. */
export class ConsultaFalsa implements PromiseLike<Resultado> {
  private filtros: Array<(f: Fila) => boolean> = [];
  private orden: Array<{ col: string; asc: boolean }> = [];
  private limite: number | null = null;
  private op: Operacion = "select";
  private carga: Fila | Fila[] | null = null;
  private devolver = false;
  private modo: "lista" | "una" | "unaOninguna" = "lista";

  constructor(
    private db: BaseFalsa,
    private nombre: string,
  ) {}

  select(_columnas?: string) {
    if (this.op !== "select") this.devolver = true;
    return this;
  }
  insert(v: Fila | Fila[]) {
    this.op = "insert";
    this.carga = v;
    return this;
  }
  update(v: Fila) {
    this.op = "update";
    this.carga = v;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[c]));
    return this;
  }
  /** Solo `col.ilike.patrón` (lo único que usa index.ts). Cualquier otra cosa lanza: mejor ruidoso que un filtro que no filtra. */
  or(expr: string) {
    const condiciones = partirOr(expr).map((parte) => {
      const m = /^([a-z_]+)\.ilike\.(.*)$/s.exec(parte);
      if (!m) throw new Error(`.or() no soportado por el doble: ${parte}`);
      const [, columna, patron] = m;
      const re = ilikeARegExp(patron);
      return (f: Fila) => f[columna] != null && re.test(String(f[columna]));
    });
    this.filtros.push((f) => condiciones.some((cumple) => cumple(f)));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orden.push({ col: c, asc: o?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  single() {
    this.modo = "una";
    return this;
  }
  maybeSingle() {
    this.modo = "unaOninguna";
    return this;
  }

  private forma(data: Fila[] | null): Resultado {
    if (this.modo === "lista") return { data, error: null };
    const filas = data ?? [];
    if (this.modo === "una") {
      return filas.length === 1 ? { data: filas[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 o varias filas" } };
    }
    return filas.length > 1
      ? { data: null, error: { code: "PGRST116", message: "varias filas" } }
      : { data: filas[0] ?? null, error: null };
  }

  private ejecutar(): Resultado {
    this.db.accesos.push({ tabla: this.nombre, op: this.op });
    const filas = this.db.tabla(this.nombre);
    if (this.op === "insert") {
      const entrada = Array.isArray(this.carga) ? this.carga : [this.carga ?? {}];
      const nuevas = entrada.map((v) => ({ id: this.db.nuevoId(), created_at: new Date().toISOString(), ...v }));
      filas.push(...nuevas);
      return this.forma(this.devolver ? nuevas.map((n) => ({ ...n })) : null);
    }
    const seleccion = filas.filter((f) => this.filtros.every((cumple) => cumple(f)));
    if (this.op === "update") {
      for (const f of seleccion) Object.assign(f, this.carga);
      return this.forma(this.devolver ? seleccion.map((f) => ({ ...f })) : null);
    }
    const ordenadas = [...seleccion].sort((x, y) => {
      for (const o of this.orden) {
        const r = comparar(x[o.col], y[o.col]);
        if (r !== 0) return o.asc ? r : -r;
      }
      return 0;
    });
    const limitadas = this.limite == null ? ordenadas : ordenadas.slice(0, this.limite);
    return this.forma(limitadas.map((f) => ({ ...f })));
  }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    // Un salto de microtarea, como la red.
    return Promise.resolve()
      .then(() => this.ejecutar())
      .then(ok, ko);
  }
}

// ----------------------------------------------------------------------------
// Estado compartido entre el test y los dobles de los módulos https:// (que
// crea vi.mock). Va en globalThis y no en una variable del módulo: tras
// vi.resetModules() este fichero se puede volver a evaluar y no debe perderse.
// Clave propia (no la de emails-reserva) para que nunca se pisen.
// ----------------------------------------------------------------------------
export interface CorreoEnviado {
  from?: string;
  to: string[];
  subject: string;
  html: string;
}
export interface EstadoPrueba {
  db: BaseFalsa;
  handler: ((req: Request) => Promise<Response>) | null;
  /** Lo que index.ts ha mandado por el SDK de Resend (doble). */
  correos: CorreoEnviado[];
}

export function estadoPrueba(): EstadoPrueba {
  const g = globalThis as unknown as Record<string, EstadoPrueba | undefined>;
  return (g.__reservasWebPrueba ??= { db: new BaseFalsa(), handler: null, correos: [] });
}

/** `createClient(url, serviceRoleKey)`: reservas-web solo usa el cliente de la service role. */
export function crearClienteFalso(_url: string, _key: string) {
  return {
    from: (tabla: string) => new ConsultaFalsa(estadoPrueba().db, tabla),
  };
}
