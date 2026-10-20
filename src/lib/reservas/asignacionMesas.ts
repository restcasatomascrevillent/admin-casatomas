// ============================================================================
// ASIGNACIÓN DE MESAS A RESERVAS — lógica pura (sin React, sin Supabase)
// ----------------------------------------------------------------------------
// El encargado cierra el día EN DOS GRADOS, y esto manda sobre cualquier
// intuición técnica:
//   1. Primero reparte las reservas por SALA (`reservas.espacio_id`). Eso ya
//      existe: se hace arrastrando tarjetas en el kanban.
//   2. Más tarde, cuando ya sabe cómo viene el día, baja al detalle de MESA
//      concreta (`asignaciones_mesa`).
//
// UNA RESERVA CON SALA Y SIN MESA ES UN ESTADO LEGÍTIMO Y NORMAL, no un error:
// es justo el estado en el que pasa la mayor parte de su vida. La mesa NUNCA es
// obligatoria. Aquí no hay -ni puede haber- ninguna función que trate "falta
// mesa" como fallo: lo único que se hace es MEDIR en qué grado está cada
// reserva (`sin_sala` → `sin_mesa` → `con_mesa`) para poder pintarlo.
//
// La única coherencia que sí es regla: si una reserva tiene mesa, esa mesa
// tiene que ser de SU sala. Eso lo impone la base de datos (el RPC
// `asignar_mesas_reserva` lanza `MESA_OTRA_SALA:`), no la interfaz.
//
// TURNO: `hora < '17:00:00'` → comida, si no → cena. Es la MISMA regla que el
// trigger de aforo `validar_capacidad_reserva` (migración
// 20260922190000_aforo_por_marca.sql) y la que usa la vista
// `vista_asignacion_dia`. `configuracion_turnos` existe y tiene horarios por
// día, pero el aforo NO la usa: si aquí se partiera por esa configuración, el
// panel contaría un turno distinto del que cuenta la base de datos. Por eso el
// corte va a pelo a las 17:00 — es deliberado, no un atajo.
// ============================================================================

export type Turno = "comida" | "cena";
export type GradoAsignacion = "sin_sala" | "sin_mesa" | "con_mesa";

/** Minuto del día en el que parte el turno (17:00). Mismo corte que el SQL. */
const CORTE_TURNO_MINUTOS = 17 * 60;

/** Los dos turnos, en orden de servicio. Para pintar selectores. */
export const TURNOS: readonly Turno[] = ["comida", "cena"];

/** Los tres grados, del más abierto al más cerrado. Para pintar leyendas. */
export const GRADOS_ASIGNACION: readonly GradoAsignacion[] = ["sin_sala", "sin_mesa", "con_mesa"];

/** ¿Es un turno válido? La vista y la tabla lo traen como `text`. */
export function esTurno(valor: unknown): valor is Turno {
  return valor === "comida" || valor === "cena";
}

/** ¿Es un grado válido? La vista lo trae como `text`. */
export function esGradoAsignacion(valor: unknown): valor is GradoAsignacion {
  return valor === "sin_sala" || valor === "sin_mesa" || valor === "con_mesa";
}

/**
 * 'HH:MM' o 'HH:MM:SS' → turno. Coherente con `validar_capacidad_reserva`
 * (corte 17:00): 16:59 es comida, 17:00 en punto ya es cena.
 *
 * Los segundos NO cambian nunca el resultado (el corte cae en un minuto
 * exacto), así que basta comparar horas y minutos.
 *
 * Con basura o vacío devuelve "cena" A PROPÓSITO: en SQL la regla es
 * `CASE WHEN hora < '17:00:00' THEN 'comida' ELSE 'cena' END`, y una
 * comparación con NULL no es verdadera, así que cae en el ELSE. Devolver
 * "comida" ante un dato ilegible discreparía de la base de datos.
 */
export function turnoDeHora(hora: string): Turno {
  const texto = typeof hora === "string" ? hora.trim() : "";
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(texto);
  if (!m) return "cena";

  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  // `time` de Postgres admite hasta 24:00:00; cualquier cosa fuera de rango es
  // un dato roto y se trata como el ELSE del SQL.
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return "cena";
  if (horas < 0 || horas > 24 || minutos < 0 || minutos > 59) return "cena";

  return horas * 60 + minutos < CORTE_TURNO_MINUTOS ? "comida" : "cena";
}

/**
 * En qué grado de cierre está una reserva.
 *
 * `sin_sala` MANDA sobre el resto: si no hay sala da igual lo que diga el
 * contador de mesas (no debería poder pasar -el RPC lanza `RESERVA_SIN_SALA:`-
 * pero si un dato antiguo llega así, lo que hay que arreglar es la sala).
 */
export function gradoDeReserva(input: { espacio_id: string | null; mesas_asignadas: number }): GradoAsignacion {
  const espacioId = input?.espacio_id;
  if (!espacioId || !String(espacioId).trim()) return "sin_sala";
  const mesas = Number(input?.mesas_asignadas);
  return Number.isFinite(mesas) && mesas > 0 ? "con_mesa" : "sin_mesa";
}

/**
 * Cómo encaja el grupo en las plazas que tiene asignadas.
 *
 * `diferencia` = plazasAsignadas - comensales (positiva: sobran plazas;
 * negativa: faltan). Se calcula SIEMPRE con la misma fórmula, también en
 * `sin_mesa`, donde vale -comensales; así la interfaz nunca tiene que adivinar
 * el signo según el estado.
 *
 * Criterio de los estados:
 *   · `sin_mesa`  → no hay plazas asignadas (0 o dato roto). No es un fallo: es
 *                   el estado normal de una reserva que todavía no ha bajado al
 *                   grado de mesa.
 *   · `excede`    → el grupo no cabe (6 comensales en una mesa de 4). Es el
 *                   único caso que merece AVISO en pantalla, y es un aviso, no
 *                   un bloqueo: juntar sillas lo decide el encargado.
 *   · `justo`     → las plazas son exactamente las que hacen falta.
 *   · `holgado`   → sobra al menos una plaza. Sin umbrales: "sobra 1" y
 *                   "sobran 8" son el mismo estado y la interfaz decide si
 *                   enseña la cifra; un umbral inventado aquí sería una regla
 *                   de negocio que nadie ha pedido.
 */
export type AjusteCapacidad = { estado: "sin_mesa" | "excede" | "justo" | "holgado"; diferencia: number };

export function ajusteCapacidad(comensales: number, plazasAsignadas: number): AjusteCapacidad {
  const personas = enteroNoNegativo(comensales);
  const plazas = enteroNoNegativo(plazasAsignadas);
  const diferencia = plazas - personas;

  if (plazas === 0) return { estado: "sin_mesa", diferencia };
  if (diferencia < 0) return { estado: "excede", diferencia };
  if (diferencia === 0) return { estado: "justo", diferencia };
  return { estado: "holgado", diferencia };
}

export type ResumenDia = {
  total: number;
  sinSala: number;
  sinMesa: number;
  conMesa: number;
  /** 0..100, cuánto del día está cerrado a nivel de mesa */
  porcentajeCerrado: number;
};

/**
 * Cuenta las reservas de un día por grado.
 *
 * `porcentajeCerrado` = con_mesa / TOTAL, y las `sin_sala` CUENTAN en el
 * denominador: una reserva sin sala es lo menos cerrado que hay, sacarla del
 * cálculo haría que el día pareciese cerrado cuando no lo está.
 *
 * Dos guardas contra porcentajes que mienten:
 *   · lista vacía → 0 (no se divide por cero).
 *   · solo da 100 si TODAS tienen mesa y solo da 0 si NINGUNA la tiene; en
 *     medio el redondeo se queda en 1..99 (199 de 200 no puede decir "100%
 *     cerrado" cuando queda una reserva por colocar).
 */
export function resumenDia(filas: Array<{ grado: GradoAsignacion }>): ResumenDia {
  const lista = (filas ?? []).filter(Boolean);
  const total = lista.length;
  let sinSala = 0;
  let sinMesa = 0;
  let conMesa = 0;

  for (const fila of lista) {
    // Un grado desconocido (vista antigua, dato roto) cuenta como lo menos
    // cerrado posible: nunca puede inflar el porcentaje.
    if (fila.grado === "con_mesa") conMesa++;
    else if (fila.grado === "sin_mesa") sinMesa++;
    else sinSala++;
  }

  return { total, sinSala, sinMesa, conMesa, porcentajeCerrado: porcentaje(conMesa, total) };
}

export type FilaResumenEspacio = {
  grado: GradoAsignacion;
  espacio_id: string | null;
  espacio_nombre?: string | null;
  numero_comensales?: number | null;
};

export type ResumenEspacio = {
  /** `null` en el grupo de las reservas sin sala. */
  espacio_id: string | null;
  espacio_nombre: string;
  total: number;
  /** Tiene sala y le falta mesa: lo que queda por cerrar en esa sala. */
  sinMesa: number;
  conMesa: number;
  /** Comensales sumados del grupo (para ver el peso real de cada sala). */
  comensales: number;
  porcentajeCerrado: number;
};

/** Nombre del grupo de las reservas que aún no tienen sala. */
export const ETIQUETA_SIN_SALA = "Sin sala";

/** Nombre de respaldo cuando la vista trae la sala sin nombre. */
export const ETIQUETA_SALA_SIN_NOMBRE = "Sala sin nombre";

/**
 * Desglose por sala + el grupo aparte de las que no tienen sala, para que el
 * calendario pueda pintar "cada sala con lo que tiene y lo que le falta".
 *
 * El grupo se decide por GRADO, no por `espacio_id`: cualquier fila `sin_sala`
 * cae en `sinSala` aunque traiga un `espacio_id` incoherente, y una fila sin
 * `espacio_id` también (no hay sala bajo la que agruparla). Así los totales del
 * desglose siempre suman lo mismo que `resumenDia`.
 *
 * Orden: por nombre de sala (es-ES). El grupo `sinSala` va aparte y nunca
 * mezclado, porque no es "una sala más": es trabajo pendiente del grado 1.
 */
export function resumenPorEspacio(filas: readonly FilaResumenEspacio[]): {
  porEspacio: ResumenEspacio[];
  sinSala: ResumenEspacio;
} {
  const grupos = new Map<string, ResumenEspacio>();
  const sinSala: ResumenEspacio = grupoVacio(null, ETIQUETA_SIN_SALA);

  for (const fila of (filas ?? []).filter(Boolean)) {
    const espacioId = fila.espacio_id && String(fila.espacio_id).trim() ? String(fila.espacio_id) : null;
    const sinSalaEstaFila = fila.grado === "sin_sala" || espacioId === null;

    let destino: ResumenEspacio;
    if (sinSalaEstaFila) {
      destino = sinSala;
    } else {
      const nombre =
        fila.espacio_nombre && String(fila.espacio_nombre).trim()
          ? String(fila.espacio_nombre)
          : ETIQUETA_SALA_SIN_NOMBRE;
      destino = grupos.get(espacioId as string) ?? grupoVacio(espacioId, nombre);
      grupos.set(espacioId as string, destino);
    }

    destino.total++;
    destino.comensales += enteroNoNegativo(fila.numero_comensales);
    if (fila.grado === "con_mesa") destino.conMesa++;
    else if (fila.grado === "sin_mesa") destino.sinMesa++;
  }

  const porEspacio = Array.from(grupos.values())
    .map((g) => ({ ...g, porcentajeCerrado: porcentaje(g.conMesa, g.total) }))
    .sort((a, b) => a.espacio_nombre.localeCompare(b.espacio_nombre, "es"));

  // El grupo sin sala no puede estar "cerrado a nivel de mesa" por definición.
  return { porEspacio, sinSala: { ...sinSala, porcentajeCerrado: 0 } };
}

// ----------------------------------------------------------------------------
// ERRORES DEL RPC `asignar_mesas_reserva`
// ----------------------------------------------------------------------------
// La base de datos lanza excepciones con PREFIJOS fijos en el mensaje. Aquí se
// traducen a una frase que un camarero entienda, y se le pega el detalle que
// venga detrás del prefijo (normalmente el nombre de la mesa: sin eso, "esa
// mesa ya está ocupada" no dice CUÁL cuando se asignan varias de golpe).

const MENSAJES_POR_PREFIJO: ReadonlyArray<readonly [string, string]> = [
  ["MESA_OCUPADA", "Esa mesa ya está ocupada a esa hora por otra reserva."],
  ["MESA_OTRA_SALA", "Esa mesa no es de la sala de la reserva. Cambia primero la reserva de sala."],
  ["RESERVA_SIN_SALA", "Antes de asignar mesa hay que darle sala a la reserva."],
  ["RESERVA_CANCELADA", "La reserva está cancelada: no se le pueden asignar mesas."],
  ["MESA_INACTIVA", "Esa mesa está desactivada. Actívala en el plano o elige otra."],
];

/** Los prefijos del contrato SQL, por si la interfaz quiere distinguirlos. */
export const PREFIJOS_ERROR_ASIGNACION: readonly string[] = MENSAJES_POR_PREFIJO.map(([p]) => p);

const MENSAJE_GENERICO = "No se pudieron guardar las mesas. Vuelve a intentarlo.";

/**
 * Traduce el error crudo de Postgres a un mensaje en español para el camarero.
 *
 * Reconoce, por orden:
 *   1. Los 5 prefijos del contrato (`MESA_OCUPADA:` y compañía), buscándolos en
 *      `message`, `details` y `hint`: PostgREST no siempre deja el texto de la
 *      excepción en el mismo campo según cómo se levante.
 *   2. Dos fallos de infraestructura que, sin traducir, mandan al usuario a
 *      mirar logs:
 *      · 23505 / "duplicate key" → era la restricción
 *        `unique (mesa_id, fecha, turno)` (retirada en 20261005130000, que
 *        valida por franjas de tiempo); se conserva por si se vuelve atrás con
 *        el rollback. Para el camarero eso es exactamente "mesa ocupada".
 *      · PGRST202 / 42883 / 42P01 → el RPC o la vista todavía no existen
 *        (migración sin aplicar). Decirlo ahorra media hora de búsqueda.
 *   3. Fallback: la frase genérica, con el texto original detrás si es legible,
 *      porque un error sin pistas es imposible de reportar.
 */
export function mensajeErrorAsignacion(error: unknown): string {
  const blob = textoDeError(error).join(" | ");
  const mayus = blob.toUpperCase();

  for (const [prefijo, mensaje] of MENSAJES_POR_PREFIJO) {
    const pos = mayus.indexOf(prefijo + ":");
    if (pos === -1) continue;
    const detalle = detalleLegible(blob.slice(pos + prefijo.length + 1));
    // Desde 20261005130000 la base de datos ya da la frase entera («La mesa 3
    // está ocupada de 14:00 a 16:00 por Oscar»): se enseña tal cual.
    if (prefijo === "MESA_OCUPADA" && /^la mesa .+ está ocupada de /i.test(detalle)) {
      return detalle + ". Elige otra mesa o quítasela primero.";
    }
    return detalle ? mensaje + " (" + detalle + ")" : mensaje;
  }

  if (mayus.includes("23505") || mayus.includes("DUPLICATE KEY")) {
    return MENSAJES_POR_PREFIJO[0][1];
  }

  if (mayus.includes("PGRST202") || mayus.includes("42883") || mayus.includes("42P01")) {
    return "La asignación de mesas aún no está disponible en la base de datos: falta aplicar la migración.";
  }

  const resto = detalleLegible(blob);
  return resto ? MENSAJE_GENERICO + " (" + resto + ")" : MENSAJE_GENERICO;
}

/**
 * ¿Tiene esta mesa alguna asignación de OTRA reserva en la lista? Comprobación
 * SIN horas: «aparece o no aparece». Para decidir si una mesa está libre para
 * una reserva concreta (por franjas de tiempo, que es la regla desde
 * 20261005130000) usa `conflictoDeMesa` de `./ocupacionMesa`.
 *
 * `reservaIdExcluida` es la reserva que se está editando, que no se "ocupa a sí
 * misma". Devuelve la asignación que estorba o `null`. Filtrar la lista es de
 * quien la pasa: este módulo no adivina qué hay dentro.
 */
export function mesaOcupadaPor<T extends { mesa_id: string; reserva_id: string }>(
  asignaciones: T[],
  mesaId: string,
  reservaIdExcluida?: string | null,
): T | null {
  if (!mesaId) return null;
  const lista = (asignaciones ?? []).filter(Boolean);
  return lista.find((a) => a.mesa_id === mesaId && a.reserva_id !== reservaIdExcluida) ?? null;
}

/** Segunda frase del aviso de cambio de sala: decir que el cliente no recibe nada. */
export const TEXTO_CAMBIO_INTERNO = "Es un cambio interno: al cliente no se le envía nada.";

/**
 * Frase del aviso «¿Cambiar de sala y quitar sus mesas?». El trigger
 * `trg_reservas_sincronizar_asignaciones` BORRA las mesas asignadas de una
 * reserva cuando cambia su sala (no bloquea el movimiento, para no romper el
 * kanban), así que quien va a cambiar la sala lo pregunta antes. Lo usan el panel
 * de Asignación y el kanban de Hoy: una sola frase para las dos pantallas.
 */
export function textoQuitarMesas(input: {
  nombre: string | null | undefined;
  cantidad: number;
  mesasNombres: readonly string[];
  /** Nombre de la sala de la que sale, si se conoce. */
  salaActual: string | null | undefined;
  destinoNombre: string;
}): string {
  const { nombre, cantidad, mesasNombres, salaActual, destinoNombre } = input;
  const cuantas = cantidad === 1 ? "1 mesa asignada" : `${cantidad} mesas asignadas`;
  const cuales = mesasNombres.length > 0 ? ` (${mesasNombres.join(", ")})` : "";
  const enSala = salaActual ? ` en ${salaActual}` : "";
  return `${nombre || "Esta reserva"} tiene ${cuantas}${cuales}${enSala}. Al pasarla a ${destinoNombre} se quitarán esas mesas y habrá que asignarlas de nuevo.`;
}

// ----------------------------------------------------------------------------
// Ayudas internas
// ----------------------------------------------------------------------------

/** Números que llegan de un `select` sin validar: basura, null, NaN → 0. */
function enteroNoNegativo(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** 0..100 sin dividir por cero y sin 100% falsos (ver `resumenDia`). */
function porcentaje(parte: number, total: number): number {
  if (!total || total <= 0) return 0;
  if (parte <= 0) return 0;
  if (parte >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((parte / total) * 100)));
}

const grupoVacio = (espacioId: string | null, nombre: string): ResumenEspacio => ({
  espacio_id: espacioId,
  espacio_nombre: nombre,
  total: 0,
  sinMesa: 0,
  conMesa: 0,
  comensales: 0,
  porcentajeCerrado: 0,
});

/** Textos útiles de cualquier forma de error (string, Error, PostgrestError). */
function textoDeError(error: unknown): string[] {
  if (error == null) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [String(error)];

  const e = error as Record<string, unknown>;
  return ["message", "details", "hint", "code", "error_description", "error"]
    .map((campo) => e[campo])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Limpia el detalle para poder pegarlo al mensaje. Se descartan los volcados de
 * identificadores (uuid pelado, `mesa_id=...`) y las palabras sueltas sin
 * espacios: a un camarero no le dicen nada y ensucian el aviso.
 */
function detalleLegible(texto: string): string {
  const limpio = (texto ?? "")
    .split("|")[0]
    .replace(/[\s.;,]+$/, "")
    .trim();
  if (!limpio) return "";
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(limpio)) return "";
  if (!/\s/.test(limpio)) return "";
  return limpio.length > 120 ? limpio.slice(0, 117) + "..." : limpio;
}
