// ============================================================================
// CLAVES DE CACHÉ DE UNA RESERVA — qué hay que refrescar cuando cambia.
// ----------------------------------------------------------------------------
// Módulo PURO: solo nombres de claves de React Query, sin hooks ni Supabase.
//
// Hasta el paso 2 había CINCO listas repartidas y cada una distinta:
//   · `useAccionesServicioReserva` (kanban, llegada, no vino, mover): 11 claves;
//   · `useCambiarSalaReserva` (panel «Asignación»): 6, y NO las del kanban;
//   · `invalidarTodo` de `useAccionesModoServicio`: 3;
//   · `CLAVES_REFRESCO_RESERVAS` de `FormularioReserva` (alta): 15, con DOS nombres
//     que ninguna consulta usa (`ocupacion-reservas-hoy`, `resumen-ocupacion-hoy-completo`)
//     y sin `disponibilidad-calculada`;
//   · `clavesRefrescoEdicion` de `FormularioReserva` (edición): esas más 6.
// Resultado: mover una reserva desde el kanban no refrescaba el modo servicio ni la
// disponibilidad; cambiar la sala desde Asignación no refrescaba los contadores de
// Hoy; marcar la estrella solo las tres listas. Aquí hay UNA lista por TIPO de cambio
// y la leen las acciones de reserva (`useAccionesServicioReserva`), el cambio de sala
// del panel de asignación, el modo servicio y, desde el paso 4, el alta y la edición
// de `FormularioReserva` (`ocupacion`; la edición, más la fila del editor).
//
// Los nombres van como TEXTO y no importados de los hooks que los definen
// (`CLAVE_ASIGNACIONES_MESA`…): un test que monte una pantalla con un mock parcial de
// uno de esos hooks no debe reventar solo por importar este módulo. Un test comprueba
// que los textos coinciden con las constantes.
//
// `invalidateQueries` solo vuelve a pedir las consultas ACTIVAS (las que tiene
// montadas alguna pantalla); las demás quedan marcadas como caducadas. Por eso
// ampliar una lista no cuesta peticiones de más.
// ============================================================================

/**
 * Prefijos de las consultas que contienen LISTAS DE FILAS de `reservas`: las acciones
 * las parchean en local (update optimista) y las vuelven a pedir después. El orden es
 * el de los snapshots para deshacer el parche si la escritura falla.
 */
export const CLAVES_LISTAS_RESERVAS = ["reservas-kanban", "reservas-hoy", "reservas-lista"] as const;

/** Contadores, ocupación y paneles de resumen que se calculan a partir de las reservas. */
const CLAVES_CONTADORES = [
  "reservas_hoy_resumen",
  "reservas_hoy_todas",
  "ocupacion_hoy",
  "today-reservations",
  "today-confirmed-reservations",
  "dashboard-stats",
  "reservas_mes",
  // Rejilla «Ocupación de salas» (`useOcupacionSalasDia`).
  "ocupacion-salas-dia",
] as const;

/**
 * Las reservas de UN día que leen el modo servicio (`reservas-servicio-dia`) y el plano
 * de una sala (`reservas_sala_dia`): ven estado, sala e «importante».
 */
const CLAVES_VISTAS_DEL_DIA = ["reservas-servicio-dia", "reservas_sala_dia"] as const;

/**
 * Las horas que ofrece cada rejilla. Son CUATRO consultas con nombre distinto
 * (`invalidateQueries` compara la primera posición de la clave entera, así que
 * `disponibilidad` no cubre `disponibilidad-detallada`).
 */
const CLAVES_DISPONIBILIDAD = [
  "disponibilidad",
  "disponibilidad-detallada",
  "disponibilidad-rango",
  "disponibilidad-calculada",
] as const;

/**
 * Mesas asignadas y panel «Asignación». Cambiar la sala o cancelar las BORRA
 * (trigger `trg_reservas_sincronizar_asignaciones`) y `vista_asignacion_dia` solo
 * tiene las reservas vivas: cualquier cambio de estado mueve filas ahí.
 */
const CLAVES_ASIGNACION = ["resumen-asignacion-dia", "asignaciones_mesa"] as const;

/**
 * Tipos de cambio, según lo que se escribe:
 *   · `ocupacion`: estado, día, hora, sala o comensales (llegada y «No vino» incluidos):
 *     cambia quién ocupa qué y cuándo. Es el tipo por defecto (lo más amplio).
 *   · `importante`: solo la estrella. Ninguna cifra cambia; sí lo que se ve resaltado.
 *   · `salida`: solo `salida_at` (liberar mesa en el modo servicio).
 */
export type TipoCambioReserva = "ocupacion" | "importante" | "salida";

export const CLAVES_POR_CAMBIO: Readonly<Record<TipoCambioReserva, readonly string[]>> = {
  ocupacion: unicas([
    ...CLAVES_LISTAS_RESERVAS,
    ...CLAVES_CONTADORES,
    ...CLAVES_VISTAS_DEL_DIA,
    ...CLAVES_DISPONIBILIDAD,
    ...CLAVES_ASIGNACION,
  ]),
  importante: unicas([...CLAVES_LISTAS_RESERVAS, ...CLAVES_VISTAS_DEL_DIA]),
  // Exactamente lo que refrescaba `invalidarTodo` del modo servicio.
  salida: ["reservas-servicio-dia", "asignaciones_mesa", "ocupacion-salas-dia"],
};

/** Quita repetidos conservando el orden de aparición. */
function unicas(claves: readonly string[]): readonly string[] {
  return [...new Set(claves)];
}

/**
 * Tipo de cambio según las columnas escritas: solo la estrella es `importante`, solo
 * `salida_at` es `salida`; cualquier otra cosa (o una mezcla, o una columna que no
 * conocemos) es `ocupacion`.
 */
export function tipoDeCambio(cambios: object): TipoCambioReserva {
  const columnas = Object.keys(cambios ?? {});
  if (columnas.length > 0 && columnas.every((c) => c === "importante")) return "importante";
  if (columnas.length > 0 && columnas.every((c) => c === "salida_at")) return "salida";
  return "ocupacion";
}

/** Las claves a refrescar tras escribir `cambios` en una reserva: una lista, sin repetidos. */
export function clavesAInvalidar(cambios: object): readonly string[] {
  return CLAVES_POR_CAMBIO[tipoDeCambio(cambios)];
}
