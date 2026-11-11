/**
 * Doble en memoria de lo poco de PostgREST que usa la pantalla Usuarios: leer
 * `user_roles`, `user_permissions` y `super_admins`, y ESCRIBIR `user_permissions`.
 *
 * Para qué sirve: comprobar el ORDEN y el EFECTO de las escrituras del guardado de
 * permisos (`useUsersManagement.setAllPermissions`), no solo el payload. Aplica cada
 * escritura a las filas como la BD:
 *   · `upsert(filas, { onConflict })`: con la UNIQUE real (user_id, section_key). Si
 *     la fila existe cambia SOLO las columnas que vienen (el `ON CONFLICT DO UPDATE`
 *     de PostgREST); si no, la crea con los DEFAULT (can_view y can_edit a false).
 *   · `insert(filas)`: las crea; si alguna pareja ya existe, 23505 y no entra ninguna.
 *   · `delete()` + `eq` / `in`: borra las que cumplen todos los filtros.
 *   · `update(cambios)` + `eq` / `in` (11/11/2026, sección de inicio en `user_roles`): cambia
 *     las que cumplen los filtros y las devuelve (como `.select()`).
 * Cada escritura queda en `operaciones`, en orden. `fallos[tipo]` hace fallar la
 * SIGUIENTE escritura de ese tipo sin tocar nada (red caída, RLS…), y se consume.
 * `borradoFiltradoPorRls` emula el DELETE de quien no es super admin: la política
 * (USING is_super_admin) no le deja ver ninguna fila, así que borra 0 y NO da error.
 * Nada sale de aquí.
 */

export type Fila = Record<string, unknown>;
export type TipoEscritura = "insert" | "upsert" | "delete" | "update";

export interface OperacionDoble {
  tabla: string;
  tipo: TipoEscritura;
  payload?: Fila[];
  opciones?: unknown;
  /** `[operador, columna, valor]` en el orden en que se encadenaron. */
  filtros: Array<["eq" | "in", string, unknown]>;
}

export interface ErrorDoble {
  code?: string;
  message: string;
}

export function crearDoblePermisos() {
  const bd = {
    tablas: {} as Record<string, Fila[]>,
    operaciones: [] as OperacionDoble[],
    fallos: {} as Partial<Record<TipoEscritura, ErrorDoble>>,
    borradoFiltradoPorRls: false,
  };

  const clave = (f: Fila) => `${String(f.user_id)}|${String(f.section_key)}`;

  function from(tabla: string) {
    const filtros: OperacionDoble["filtros"] = [];
    let escritura: Pick<OperacionDoble, "tipo" | "payload" | "opciones"> | null = null;
    const cumple = (f: Fila) =>
      filtros.every(([op, columna, valor]) => (op === "eq" ? f[columna] === valor : (valor as unknown[]).includes(f[columna])));

    const ejecutar = (): { data: unknown; error: ErrorDoble | null } => {
      const filas = (bd.tablas[tabla] ??= []);
      if (!escritura) return { data: filas.filter(cumple).map((f) => ({ ...f })), error: null };

      bd.operaciones.push({ tabla, ...escritura, filtros: [...filtros] });
      const fallo = bd.fallos[escritura.tipo];
      if (fallo) {
        delete bd.fallos[escritura.tipo];
        return { data: null, error: fallo };
      }
      if (escritura.tipo === "update") {
        const cambiadas = filas.filter(cumple);
        for (const f of cambiadas) Object.assign(f, escritura.payload?.[0]);
        return { data: cambiadas.map((f) => ({ ...f })), error: null };
      }
      if (escritura.tipo === "delete") {
        if (!bd.borradoFiltradoPorRls) bd.tablas[tabla] = filas.filter((f) => !cumple(f));
        return { data: null, error: null };
      }
      const nuevas = escritura.payload ?? [];
      if (escritura.tipo === "insert" && nuevas.some((n) => filas.some((f) => clave(f) === clave(n)))) {
        return {
          data: null,
          error: { code: "23505", message: 'duplicate key value violates unique constraint "user_permissions_user_id_section_key_key"' },
        };
      }
      for (const nueva of nuevas) {
        const existente = filas.find((f) => clave(f) === clave(nueva));
        if (existente) Object.assign(existente, nueva);
        else filas.push({ can_view: false, can_edit: false, ...nueva });
      }
      return { data: null, error: null };
    };

    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (columna: string, valor: unknown) => {
        filtros.push(["eq", columna, valor]);
        return q;
      },
      in: (columna: string, valores: unknown[]) => {
        filtros.push(["in", columna, valores]);
        return q;
      },
      delete: () => {
        escritura = { tipo: "delete" };
        return q;
      },
      insert: (payload: Fila | Fila[]) => {
        escritura = { tipo: "insert", payload: ([] as Fila[]).concat(payload).map((f) => ({ ...f })) };
        return q;
      },
      update: (cambios: Fila) => {
        escritura = { tipo: "update", payload: [{ ...cambios }] };
        return q;
      },
      upsert: (payload: Fila | Fila[], opciones?: unknown) => {
        escritura = { tipo: "upsert", payload: ([] as Fila[]).concat(payload).map((f) => ({ ...f })), opciones };
        return q;
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(ejecutar).then(ok, ko),
    };
    return q;
  }

  /** Escrituras a una tabla, en orden. */
  const escriturasEn = (tabla: string) => bd.operaciones.filter((o) => o.tabla === tabla);
  /** Copia de las filas de un usuario en una tabla. */
  const filasDe = (tabla: string, userId: string) =>
    (bd.tablas[tabla] ?? []).filter((f) => f.user_id === userId).map((f) => ({ ...f }));

  return { bd, from, escriturasEn, filasDe };
}
