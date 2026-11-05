// ============================================================================
//  Facturas › Compras — copia de la lista en el dispositivo (05/11/2026)
// ----------------------------------------------------------------------------
//  La respuesta compacta de `documentos_lista()` (≈ 0,5 MB) se guarda en
//  localStorage por usuario, con versión y caducidad: al reabrir Facturas la
//  lista se pinta al instante con ella y se refresca por detrás. Se borra al
//  cerrar sesión o cambiar de usuario (useAuth → vaciarCache). Sin
//  dependencias: useAuth la importa y no debe arrastrar nada más.
// ============================================================================

const PREFIJO = "compras-lista:";
/** Usuarios con copia guardada (para borrarlas aunque el almacén no se pueda recorrer). */
const INDICE = "compras-lista-usuarios";
/** Sube este número si cambia el formato de `documentos_lista()`: las copias viejas se ignoran. */
export const VERSION_COPIA = 1;
/** Más vieja que esto no se enseña (aunque se refrescaría enseguida). */
export const CADUCIDAD_COPIA_MS = 7 * 24 * 60 * 60 * 1000;

interface CopiaLista {
  v: number;
  guardado: number;
  crudo: unknown;
}

const almacen = (): Storage | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** La copia guardada de este usuario (la respuesta tal cual) o null: no hay, caducada, de otra versión o rota. */
export function leerCopiaLista(usuario: string | null, ahora = Date.now()): { crudo: unknown; guardado: number } | null {
  const ls = almacen();
  if (!usuario || !ls) return null;
  try {
    const bruto = ls.getItem(PREFIJO + usuario);
    if (!bruto) return null;
    const c = JSON.parse(bruto) as CopiaLista;
    if (c.v !== VERSION_COPIA || typeof c.guardado !== "number" || ahora - c.guardado > CADUCIDAD_COPIA_MS) return null;
    return { crudo: c.crudo, guardado: c.guardado };
  } catch {
    return null;
  }
}

/** Guarda la respuesta de `documentos_lista()` (si no cabe, no pasa nada). */
export function guardarCopiaLista(usuario: string | null, crudo: unknown, ahora = Date.now()): void {
  const ls = almacen();
  if (!usuario || !ls) return;
  try {
    ls.setItem(PREFIJO + usuario, JSON.stringify({ v: VERSION_COPIA, guardado: ahora, crudo } satisfies CopiaLista));
    const usuarios = usuariosConCopia(ls);
    if (!usuarios.includes(usuario)) ls.setItem(INDICE, JSON.stringify([...usuarios, usuario]));
  } catch {
    // Sin sitio (cuota) o modo privado: se sigue sin copia.
  }
}

function usuariosConCopia(ls: Storage): string[] {
  try {
    const v = JSON.parse(ls.getItem(INDICE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Borra las copias de TODOS los usuarios (al cerrar sesión o cambiar de cuenta). */
export function borrarCopiasLista(): void {
  const ls = almacen();
  if (!ls) return;
  try {
    // Recorriendo el almacén y, por si no se puede (dobles de pruebas), con el índice de usuarios.
    const todas: string[] = [];
    if (typeof ls.length === "number" && typeof ls.key === "function") {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k) todas.push(k);
      }
    }
    todas.push(...usuariosConCopia(ls).map((u) => PREFIJO + u));
    todas.filter((k) => k.startsWith(PREFIJO)).forEach((k) => ls.removeItem(k));
    ls.removeItem(INDICE);
  } catch {
    // nada que hacer
  }
}
