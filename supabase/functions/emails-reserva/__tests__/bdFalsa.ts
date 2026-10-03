// ============================================================================
// Doble EN MEMORIA de lo que usa emails-reserva/index.ts de supabase-js, para
// probar su cableado (notificar-modificacion.integracion.test.ts) sin red ni
// BD: nunca habla con Supabase. Reproduce lo que importa de la BD real:
//   · CHECK de tipo_email (5 o 6 tipos según `migracionAplicada`) y el CHECK
//     clave_aviso ⇔ 'reserva_modificada' (migración 20260930211000);
//   · el índice único parcial uq_envio_email_reserva_activo, con o sin
//     clave_aviso (23505), también en los UPDATE;
//   · sin la migración, las columnas nuevas no existen (PGRST204).
// No es un test (no acaba en .test.ts): solo lo importa el de integración.
// ============================================================================

export type Fila = Record<string, unknown>;
export interface ErrorPg {
  code: string;
  message: string;
}
interface Resultado {
  data: unknown;
  error: ErrorPg | null;
  count?: number;
}

const TIPOS = ["solicitud_recibida", "propuesta", "confirmada", "rechazada", "recordatorio", "reserva_modificada"];

export class BaseFalsa {
  tablas: Record<string, Fila[]> = {};
  secuencia = 0;
  ultimoInstante = 0;
  /** false = como producción ANTES de 20260930211000: 5 tipos, sin columnas nuevas, índice viejo. */
  migracionAplicada = true;
  /** INSERT/UPDATE rechazados por el índice único (para saber que saltó el 23505 y no la comprobación previa). */
  rechazos23505 = 0;
  /** true = como producción ANTES de 20261003184500 (sin reservas.email_verificado_at). */
  sinColumnaVerificacion = false;

  tabla(nombre: string): Fila[] {
    return (this.tablas[nombre] ??= []);
  }

  private nuevoId(): string {
    this.secuencia++;
    return `00000000-0000-4000-8000-${String(this.secuencia).padStart(12, "0")}`;
  }

  /** Instantes siempre crecientes (Postgres tiene microsegundos; aquí, 1 ms de paso). */
  instante(): string {
    this.ultimoInstante = Math.max(Date.now(), this.ultimoInstante + 1);
    return new Date(this.ultimoInstante).toISOString();
  }

  completar(nombre: string, v: Fila): Fila {
    const base: Fila = { id: this.nuevoId(), ...v };
    if (nombre === "envios_email_reserva") {
      return { resultado: "pendiente", intentos: 1, creado_at: this.instante(), ultimo_intento_at: this.instante(), ...base };
    }
    if (nombre === "notificaciones_dashboard" || nombre === "rate_limit_log") return { created_at: this.instante(), ...base };
    return base;
  }

  validar(nombre: string, fila: Fila, idPropio?: unknown): ErrorPg | null {
    // Como producción ANTES de 20261003184500: no existe reservas.email_verificado_at.
    if (nombre === "reservas" && this.sinColumnaVerificacion && "email_verificado_at" in fila) {
      return { code: "PGRST204", message: "Could not find the 'email_verificado_at' column of 'reservas' in the schema cache" };
    }
    if (nombre !== "envios_email_reserva") return null;
    if (!this.migracionAplicada && ("clave_aviso" in fila || "detalle" in fila)) {
      return { code: "PGRST204", message: "Could not find the 'clave_aviso' column of 'envios_email_reserva'" };
    }
    const tipos = this.migracionAplicada ? TIPOS : TIPOS.slice(0, 5);
    if (!tipos.includes(String(fila.tipo_email))) {
      return { code: "23514", message: "violates check constraint envios_email_reserva_tipo_email_check" };
    }
    if (this.migracionAplicada && (fila.tipo_email === "reserva_modificada") !== (fila.clave_aviso != null)) {
      return { code: "23514", message: "violates check constraint envios_email_reserva_clave_aviso_solo_modificada" };
    }
    const activa = (r: unknown) => r === "pendiente" || r === "enviado";
    if (!activa(fila.resultado)) return null;
    const choca = this.tabla(nombre).some(
      (o) =>
        o.id !== idPropio &&
        o.id !== fila.id &&
        activa(o.resultado) &&
        o.reserva_id === fila.reserva_id &&
        o.tipo_email === fila.tipo_email &&
        (!this.migracionAplicada || (o.clave_aviso ?? "") === (fila.clave_aviso ?? "")),
    );
    if (!choca) return null;
    this.rechazos23505++;
    return { code: "23505", message: 'duplicate key value violates unique constraint "uq_envio_email_reserva_activo"' };
  }
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
  private orden: Array<{ col: string; asc: boolean; nullsFirst: boolean }> = [];
  private limite: number | null = null;
  private op: "select" | "insert" | "update" = "select";
  private carga: Fila | Fila[] | null = null;
  private devolver = false;
  private modo: "lista" | "una" | "unaOninguna" = "lista";
  private cabeza = false;

  constructor(
    private db: BaseFalsa,
    private nombre: string,
  ) {}

  select(_columnas?: string, opciones?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.cabeza = !!opciones?.head;
    else this.devolver = true;
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
  neq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] !== v);
    return this;
  }
  /** Solo `.is(col, null)` (lo único que usa _shared/verificacion-email.ts). */
  is(c: string, v: null) {
    this.filtros.push((f) => (v === null ? f[c] == null : f[c] === v));
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[c]));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtros.push((f) => f[c] != null && comparar(f[c], v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filtros.push((f) => f[c] != null && comparar(f[c], v) <= 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filtros.push((f) => f[c] != null && comparar(f[c], v) >= 0);
    return this;
  }
  order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orden.push({ col: c, asc: o?.ascending ?? true, nullsFirst: o?.nullsFirst ?? false });
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
    const filas = this.db.tabla(this.nombre);
    if (this.op === "insert") {
      const entrada = Array.isArray(this.carga) ? this.carga : [this.carga ?? {}];
      const nuevas = entrada.map((v) => this.db.completar(this.nombre, v));
      for (const n of nuevas) {
        const error = this.db.validar(this.nombre, n);
        if (error) return { data: null, error };
      }
      filas.push(...nuevas);
      return this.forma(this.devolver ? nuevas.map((n) => ({ ...n })) : null);
    }
    const seleccion = filas.filter((f) => this.filtros.every((p) => p(f)));
    if (this.op === "update") {
      const cambios = (this.carga ?? {}) as Fila;
      for (const f of seleccion) {
        const error = this.db.validar(this.nombre, { ...f, ...cambios }, f.id);
        if (error) return { data: null, error };
      }
      for (const f of seleccion) Object.assign(f, cambios);
      return this.forma(this.devolver ? seleccion.map((f) => ({ ...f })) : null);
    }
    const ordenadas = [...seleccion].sort((x, y) => {
      for (const o of this.orden) {
        const a = x[o.col];
        const b = y[o.col];
        if (a == null && b == null) continue;
        if (a == null) return o.nullsFirst ? -1 : 1;
        if (b == null) return o.nullsFirst ? 1 : -1;
        const r = comparar(a, b);
        if (r !== 0) return o.asc ? r : -r;
      }
      return 0;
    });
    const limitadas = this.limite == null ? ordenadas : ordenadas.slice(0, this.limite);
    if (this.cabeza) return { data: null, error: null, count: limitadas.length };
    return this.forma(limitadas.map((f) => ({ ...f })));
  }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    // Un salto de microtarea, como la red: deja que dos peticiones se intercalen.
    return Promise.resolve()
      .then(() => this.ejecutar())
      .then(ok, ko);
  }
}

// ----------------------------------------------------------------------------
// Estado compartido entre el test y los dobles de los módulos https:// (que
// crea vi.mock). Va en globalThis y no en una variable del módulo: tras
// vi.resetModules() este fichero se puede volver a evaluar y no debe perderse.
// ----------------------------------------------------------------------------
export interface EstadoPrueba {
  db: BaseFalsa;
  handler: ((req: Request) => Promise<Response>) | null;
  pruebas: Array<{ to: string[]; subject: string; html: string }>;
}

export function estadoPrueba(): EstadoPrueba {
  const g = globalThis as unknown as Record<string, EstadoPrueba | undefined>;
  return (g.__emailsReservaPrueba ??= { db: new BaseFalsa(), handler: null, pruebas: [] });
}

/** `createClient(url, key, opciones)`: con Authorization de usuario, el cliente
 * de ese usuario (auth + can_write_section); si no, el de la service role. */
export function crearClienteFalso(_url: string, _key: string, opciones?: { global?: { headers?: Record<string, string> } }) {
  const authHeader = opciones?.global?.headers?.Authorization;
  if (authHeader) {
    const conUsuario = authHeader === "Bearer valido" || authHeader === "Bearer sinpermiso";
    return {
      auth: {
        getUser: async () =>
          conUsuario
            ? { data: { user: { id: "usuario-1", email: "personal@correo.test" } }, error: null }
            : { data: { user: null }, error: { message: "invalid JWT" } },
      },
      rpc: async (fn: string) =>
        fn === "can_write_section" ? { data: authHeader === "Bearer valido", error: null } : { data: null, error: { message: fn } },
    };
  }
  return {
    from: (tabla: string) => new ConsultaFalsa(estadoPrueba().db, tabla),
    rpc: async () => ({ data: null, error: { message: "rpc no soportada en el doble" } }),
  };
}
