// ============================================================================
// NOMBRES DE MESA ÚNICOS POR ESPACIO — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26): en producción el Salón tiene DOS mesas
// llamadas "9" porque nada impedía repetir el nombre al crearlas desde la
// pantalla de Configuración (ahora de solo lectura, ver
// `GestionMesasEspacios.tsx`) ni desde el editor de plano.
//
// Este archivo es SOLO el helper de comparación: decide si un nombre ya
// existe en un espacio, sin tocar Supabase ni el estado de React. Quien lo
// usa (hoy: `PanelLateral.tsx`, al crear una mesa nueva con "Añadir Mesa")
// decide qué hacer con el resultado — aquí no se lanza ningún toast.
//
// NORMALIZACIÓN: espacios y mayúsculas no cuentan. "Mesa 9" y "mesa  9" son
// el mismo nombre a efectos de esta comprobación, porque para quien mira el
// plano son indistinguibles.
// ============================================================================

export interface MesaParaNombre {
  id: string;
  nombre: string | null | undefined;
}

/** Nombre normalizado para comparar: recortado, en minúsculas, sin espacios repetidos. */
export function normalizarNombreMesa(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * ¿Ya existe una mesa con ese nombre en el mismo espacio?
 *
 * `excluirId` sirve para renombrar: al editar la mesa X, X no cuenta como
 * "otra mesa" aunque conserve el mismo nombre.
 *
 * Un nombre vacío (tras recortar espacios) nunca se considera duplicado aquí:
 * ese caso ya lo bloquea la validación de "nombre obligatorio" de quien
 * llama, y no tiene sentido decir "ya hay otra mesa sin nombre".
 */
export function nombreMesaDuplicado(
  nombre: string,
  mesasExistentes: readonly MesaParaNombre[],
  excluirId?: string,
): boolean {
  const normalizado = normalizarNombreMesa(nombre);
  if (!normalizado) return false;
  return (mesasExistentes ?? []).some(
    (m) => m && m.id !== excluirId && normalizarNombreMesa(m.nombre) === normalizado,
  );
}

/** Mensaje de aviso listo para un toast/error, con el nombre tal cual lo escribió el usuario. */
export function mensajeNombreMesaDuplicado(nombre: string): string {
  return `Ya hay una mesa llamada "${nombre.trim()}" en este espacio. Usa un nombre distinto.`;
}
