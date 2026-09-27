// ============================================================================
// NÚMEROS DE MESA ÚNICOS POR ESPACIO — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26/27): en la sala el personal dice "la 7". El
// número vive dentro de `mesas.nombre` (`text NOT NULL`: "1", "9", "17",
// "2+1") — NO hay columna `numero` y no se va a crear. Si el número del
// sistema no coincide con el de la sala, el plano no sirve de nada, así que
// tiene que ser fiable: en producción el Salón tiene DOS mesas llamadas "9"
// porque nada impedía repetirlo, ni desde la pantalla de Configuración (hoy de
// solo lectura, ver `GestionMesasEspacios.tsx`) ni desde el editor de plano.
//
// Este archivo es SOLO lógica de nombres: decide si un número ya existe, cuál
// es el primero libre, si un lote choca y cómo resolver choques al desagrupar.
// No toca Supabase ni el estado de React, y no lanza ningún toast — eso lo
// decide quien llama (`PanelLateral.tsx`, `CanvasPlano.tsx`, y la tarjeta de
// mesas de Configuración).
//
// ----------------------------------------------------------------------------
// ALINEACIÓN CON POSTGRES (crítico) — índice `uq_mesas_espacio_nombre_real`
// ----------------------------------------------------------------------------
// La garantía REAL de unicidad es el índice único parcial de la base
// (`supabase/migrations/20260927100000_mesas_numero_fiable.sql`):
//
//   create unique index uq_mesas_espacio_nombre_real
//     on mesas (espacio_id, lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g'))))
//     where coalesce(is_merged, false) = false
//       and coalesce(activa,    true ) = true;
//
// `normalizarNombreMesa` replica esa expresión EN EL MISMO ORDEN — colapsar
// primero, recortar después, minúsculas al final — para que la pantalla y la
// base nunca digan cosas distintas. Dos detalles que no son obvios:
//
//   1. EL ORDEN NO ES EL OBVIO. `btrim(texto)` con un solo argumento recorta
//      únicamente el espacio U+0020, no tabuladores ni saltos de línea. Si el
//      `btrim` fuera ANTES del colapso, un nombre que empieza por tabulador
//      ("\t9") quedaría como " 9" y no como "9". Colapsando primero, ese
//      tabulador ya es un espacio y el recorte sí se lo lleva. La migración
//      documenta esta misma decisión.
//   2. El `\s` de Postgres es `[[:space:]]` = espacio, tab, \n, \v, \f, \r
//      (ASCII). El `\s` de JavaScript incluye además whitespace Unicode
//      (U+00A0 —el espacio duro que pega Word—, U+2028...). Por eso el colapso
//      de aquí usa una clase ASCII explícita y NO `\s`: con `\s` el NBSP se
//      trataría como espacio en pantalla y no en la base ("9" y "9<NBSP>"
//      serían el mismo nombre para una y distintos para la otra). Esa es la
//      divergencia que la migración da por aceptada; con esta clase explícita
//      no se da.
//
// Y el `where` del índice explica por qué `nombreMesaDuplicado` ignora filas:
// las mesas fusionadas (`is_merged = true`, nombre compuesto tipo "7+8") y las
// inactivas (`activa = false`) NO reservan número. OJO: las dos columnas son
// NULLABLE, así que `null`/`undefined` significa mesa real / mesa activa
// (igual que el `coalesce` del índice) — se compara con `=== true` y
// `=== false`, nunca por truthiness.
// ============================================================================

/**
 * Mesa mínima para comprobar nombres. `is_merged` y `activa` son opcionales y
 * nullables a propósito: así encajan tanto las filas de Supabase (`Mesa`) como
 * las mesas del canvas del editor (`MesaCanvas`, que usa `isMerged` en
 * camelCase — para eso está `mesasCanvasParaNombre`).
 */
export interface MesaParaNombre {
  id: string;
  nombre: string | null | undefined;
  is_merged?: boolean | null;
  activa?: boolean | null;
}

/** Espacios que colapsa el `\s` de Postgres (`[[:space:]]`), sin whitespace Unicode. */
const ESPACIOS_POSTGRES = /[ \t\n\v\f\r]+/g;

/**
 * Nombre normalizado para comparar: mismo resultado que
 * `lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g')))` en Postgres (ver la
 * cabecera del fichero). Espacios repetidos y mayúsculas no cuentan: "Mesa 9"
 * y "mesa  9" son el mismo nombre, porque para quien mira el plano son
 * indistinguibles.
 */
export function normalizarNombreMesa(nombre: string | null | undefined): string {
  // 1) regexp_replace('\s+', ' ', 'g'): colapsar PRIMERO (ver cabecera).
  const colapsado = (nombre ?? "").replace(ESPACIOS_POSTGRES, " ");
  // 2) btrim: recortar DESPUÉS, y solo el espacio U+0020 (no `.trim()`).
  const recortado = colapsado.replace(/^ +/, "").replace(/ +$/, "");
  // 3) lower.
  return recortado.toLowerCase();
}

/**
 * ¿Esta fila reserva un número de mesa? Mismo criterio que el `where` del
 * índice `uq_mesas_espacio_nombre_real`: las fusionadas y las inactivas no.
 */
export function mesaReservaNumero(mesa: MesaParaNombre | null | undefined): boolean {
  if (!mesa) return false;
  return mesa.is_merged !== true && mesa.activa !== false;
}

/** Mesa tal como la maneja el canvas del editor de plano (`isMerged` en camelCase). */
export interface MesaCanvasParaNombre {
  id: string;
  nombre?: string | null;
  isMerged?: boolean | null;
  activa?: boolean | null;
}

/** Vista `MesaParaNombre` de las mesas del canvas del editor. */
export function mesasCanvasParaNombre(
  mesas: readonly MesaCanvasParaNombre[] | null | undefined,
): MesaParaNombre[] {
  return (mesas ?? [])
    .filter((m): m is MesaCanvasParaNombre => !!m)
    .map((m) => ({
      id: m.id,
      nombre: m.nombre,
      is_merged: m.isMerged ?? null,
      activa: m.activa ?? null,
    }));
}

/**
 * ¿Ya existe una mesa con ese nombre en el mismo espacio?
 *
 * Solo cuentan las mesas que reservan número (ni fusionadas ni inactivas, ver
 * `mesaReservaNumero`).
 *
 * `excluirId` sirve para renombrar: al editar la mesa X, X no cuenta como
 * "otra mesa" aunque conserve el mismo nombre.
 *
 * Un nombre vacío (tras normalizar) nunca se considera duplicado aquí: ese
 * caso ya lo bloquea la validación de "número obligatorio" de quien llama, y
 * no tiene sentido decir "ya hay otra mesa sin número".
 */
export function nombreMesaDuplicado(
  nombre: string,
  mesasExistentes: readonly MesaParaNombre[],
  excluirId?: string,
): boolean {
  const normalizado = normalizarNombreMesa(nombre);
  if (!normalizado) return false;
  return (mesasExistentes ?? []).some(
    (m) =>
      m &&
      m.id !== excluirId &&
      mesaReservaNumero(m) &&
      normalizarNombreMesa(m.nombre) === normalizado,
  );
}

/** Mensaje de aviso listo para un toast/error, con el nombre tal cual lo escribió el usuario. */
export function mensajeNombreMesaDuplicado(nombre: string): string {
  return `Ya hay una mesa llamada "${nombre.trim()}" en este espacio. Usa un nombre distinto.`;
}

// ---------------------------------------------------------------------------
// Primer número libre
// ---------------------------------------------------------------------------

/**
 * Primer número libre del espacio, como cadena ("1", "2", "7"...).
 *
 * Es el valor que se propone al dar de alta una mesa. NO es `mesas.length + 1`
 * (lo que hacía el lienzo hasta ahora): con tres mesas 1/2/3, borrar la 2 y
 * dibujar otra devolvía "3" — que ya existía. Así se fabricaron los duplicados
 * de producción.
 *
 * Solo bloquean número las mesas que lo reservan (ni fusionadas ni inactivas),
 * y solo los nombres que son exactamente ese número: una mesa "1A" no ocupa
 * el "1", igual que para el índice de Postgres son nombres distintos.
 */
export function siguienteNumeroMesaLibre(
  mesasExistentes: readonly MesaParaNombre[],
  excluirId?: string,
): string {
  const ocupados = new Set<string>();
  for (const m of mesasExistentes ?? []) {
    if (!m || m.id === excluirId || !mesaReservaNumero(m)) continue;
    const normalizado = normalizarNombreMesa(m.nombre);
    if (normalizado) ocupados.add(normalizado);
  }
  let numero = 1;
  while (ocupados.has(String(numero))) numero += 1;
  return String(numero);
}

// ---------------------------------------------------------------------------
// Alta en rango (varias mesas de golpe)
// ---------------------------------------------------------------------------

/**
 * Tope de mesas por lote. Existe para que un dedo torpe en el campo "hasta"
 * no cree 10.000 filas; el dueño siempre puede repetir el lote.
 */
export const MAX_MESAS_POR_LOTE = 40;

export interface RangoNumerosMesa {
  /** Números del rango, en orden ("7", "8", ... "12"). Vacío si hay error. */
  numeros: string[];
  /** Motivo por el que el rango no es válido, listo para mostrar. `null` si lo es. */
  error: string | null;
}

/**
 * Números de un rango "desde–hasta" para el alta en lote. No inventa nada: si
 * el rango no es válido devuelve el motivo y ningún número.
 */
export function generarNumerosMesaEnRango(
  desde: number,
  hasta: number,
  maximo: number = MAX_MESAS_POR_LOTE,
): RangoNumerosMesa {
  if (!Number.isInteger(desde) || !Number.isInteger(hasta)) {
    return { numeros: [], error: "Escribe números enteros en «desde» y «hasta»." };
  }
  if (desde < 1) {
    return { numeros: [], error: "El primer número tiene que ser 1 o mayor." };
  }
  if (hasta < desde) {
    return { numeros: [], error: "«Hasta» tiene que ser mayor o igual que «desde»." };
  }
  const cantidad = hasta - desde + 1;
  if (cantidad > maximo) {
    return {
      numeros: [],
      error: `No se pueden crear más de ${maximo} mesas de una vez (has pedido ${cantidad}).`,
    };
  }
  const numeros: string[] = [];
  for (let n = desde; n <= hasta; n += 1) numeros.push(String(n));
  return { numeros, error: null };
}

export interface ChoquesLoteNombresMesa {
  /** Nombres del lote que ya existen en el espacio (tal cual los escribió el usuario). */
  yaExisten: string[];
  /** Nombres repetidos dentro del propio lote. */
  repetidosEnLote: string[];
  /** Atajo: `true` si hay cualquier choque (no se debe insertar NADA). */
  hayChoques: boolean;
}

/**
 * Valida TODOS los nombres de un lote antes de insertar ninguno: devuelve
 * exactamente cuáles chocan con una mesa existente y cuáles se repiten dentro
 * del propio lote. Cada nombre se reporta una sola vez.
 */
export function nombresMesaDuplicadosEnLote(
  nombres: readonly string[],
  mesasExistentes: readonly MesaParaNombre[],
): ChoquesLoteNombresMesa {
  const yaExisten: string[] = [];
  const repetidosEnLote: string[] = [];
  const vistos = new Set<string>();
  const reportados = new Set<string>();

  for (const nombre of nombres ?? []) {
    const normalizado = normalizarNombreMesa(nombre);
    if (!normalizado) continue;
    const visible = (nombre ?? "").trim();

    if (nombreMesaDuplicado(nombre, mesasExistentes)) {
      if (!reportados.has(normalizado)) {
        reportados.add(normalizado);
        yaExisten.push(visible);
      }
      continue;
    }
    if (vistos.has(normalizado)) {
      if (!reportados.has(normalizado)) {
        reportados.add(normalizado);
        repetidosEnLote.push(visible);
      }
      continue;
    }
    vistos.add(normalizado);
  }

  return {
    yaExisten,
    repetidosEnLote,
    hayChoques: yaExisten.length > 0 || repetidosEnLote.length > 0,
  };
}

/** Mensaje de los choques de un lote, o `null` si no hay ninguno. */
export function mensajeChoquesLoteNombresMesa(choques: ChoquesLoteNombresMesa): string | null {
  if (!choques?.hayChoques) return null;
  const partes: string[] = [];
  if (choques.yaExisten.length > 0) {
    partes.push(`ya existen en este espacio: ${choques.yaExisten.join(", ")}`);
  }
  if (choques.repetidosEnLote.length > 0) {
    partes.push(`se repiten en el rango: ${choques.repetidosEnLote.join(", ")}`);
  }
  return `No se ha creado ninguna mesa. Números con problema — ${partes.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Resolución de choques (desagrupar una mesa fusionada)
// ---------------------------------------------------------------------------

export interface NombreMesaResuelto {
  /** Nombre que se pedía (recortado). */
  deseado: string;
  /** Nombre finalmente asignado: el deseado, o uno libre con sufijo. */
  asignado: string;
  /** `true` si hubo que cambiarlo porque el deseado estaba ocupado. */
  renombrado: boolean;
}

/**
 * Asigna nombres libres a una tanda de nombres deseados, respetando el orden.
 *
 * Lo necesita desagrupar (`CanvasPlano.unmergeMesa`): los nombres salen de
 * `original_mesas` y pueden chocar con mesas que YA existan con ese número —
 * exactamente el caso del Salón de producción, donde al fusionar nunca se
 * borraron las filas originales y conviven con las fusionadas. El choque se
 * resuelve con sufijo "-bis" / "-bis2" / "-bis3"... para que sea visible y el
 * dueño lo corrija, nunca en silencio ni machacando la otra mesa.
 *
 * POR QUÉ "-bis" Y NO " (revisar)": la migración
 * `20260927100000_mesas_numero_fiable.sql` marca con " (revisar)" los
 * duplicados que ya había en la base, y es el sufijo correcto ahí porque esa
 * marca se queda escrita hasta que alguien la vea. Aquí el nombre se ve DENTRO
 * de la mesa en el plano y el choque se resuelve en la misma sesión (con el
 * toast delante), así que gana lo corto: "7 (revisar)" obliga a encoger el
 * número justo en las mesas que el dueño está recuperando, "7-bis" no.
 */
export function resolverChoquesNombresMesa(
  nombresDeseados: readonly (string | null | undefined)[],
  mesasExistentes: readonly MesaParaNombre[],
): NombreMesaResuelto[] {
  const ocupados = new Set<string>();
  for (const m of mesasExistentes ?? []) {
    if (!mesaReservaNumero(m)) continue;
    const normalizado = normalizarNombreMesa(m?.nombre);
    if (normalizado) ocupados.add(normalizado);
  }

  return (nombresDeseados ?? []).map((bruto) => {
    const deseado = (bruto ?? "").trim() || "Mesa";
    let candidato = deseado;
    let intento = 1;
    while (ocupados.has(normalizarNombreMesa(candidato))) {
      intento += 1;
      candidato = intento === 2 ? `${deseado}-bis` : `${deseado}-bis${intento - 1}`;
    }
    ocupados.add(normalizarNombreMesa(candidato));
    return { deseado, asignado: candidato, renombrado: candidato !== deseado };
  });
}

/** Mensaje con los números que hubo que cambiar, o `null` si no cambió ninguno. */
export function mensajeChoquesResueltos(resueltos: readonly NombreMesaResuelto[]): string | null {
  const cambiados = (resueltos ?? []).filter((r) => r?.renombrado);
  if (cambiados.length === 0) return null;
  const lista = cambiados.map((r) => `${r.deseado} → ${r.asignado}`).join(", ");
  return `Ya había mesas con esos números, así que se han renombrado: ${lista}. REVISA esas mesas y ponles el número real de la sala antes de guardar.`;
}
