// ============================================================================
// ALTA DE MESAS EN LOTE — lógica pura (sin I/O, sin React, sin toasts)
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-28): tiene CUATRO espacios con CERO mesas y no
// consigue cargarlos. El alta en lote anterior pedía un rango «desde–hasta»
// con UNA forma y UNA capacidad para todo el rango, así que una sala real
// —12 mesas de 2, 5 de 4 y 3 redondas de 6, numeradas 1-8, 11-16 y T1-T6—
// obligaba a tres o cuatro lotes distintos y a corregir mesa por mesa después.
//
// Aquí vive SOLO lo que se puede probar sin navegador:
//   1. `parsearListaNumerosMesa`: convierte lo que teclea el dueño
//      ("1-8, 11-16, T1-T6, 20") en la lista ordenada de números de mesa.
//   2. Los PRESETS de tipo de mesa (forma + tamaño + capacidad sugerida).
//   3. Las filas editables del lote y las operaciones sobre ellas.
//   4. El resumen del alta: qué se creó, qué falló y por qué, en español.
//
// No toca Supabase ni el estado de React: eso lo hace `PanelLateral.tsx`.
// La unicidad de nombres NO se decide aquí — se delega en `nombresMesa.ts`,
// que a su vez replica el índice `uq_mesas_espacio_nombre_real` de Postgres.
//
// ----------------------------------------------------------------------------
// POR QUÉ NO SE INVENTAN FORMAS NUEVAS ("cuadrada", "alargada", "barra")
// ----------------------------------------------------------------------------
// `mesas.forma` es un `VARCHAR(20)` SIN CHECK y SIN enum (única migración que
// lo define: `supabase/migrations/20251207090324_...sql:7`, cuyo comentario
// dice "rectangular, circular, cuadrada"). Es decir: un valor nuevo NO
// necesitaría migración ninguna.
//
// Pero el PINTADO es binario en los dos sitios que dibujan mesas:
//   - editor: `CanvasPlano.tsx` (~2571) -> `Circle` si `forma === "circular"`,
//     y si no un `Rect` con esquinas redondeadas;
//   - visor de reservas: `src/components/reservas/PlanoEspacio2D.tsx:491`
//     (y otra vez en :1433) -> `rounded-full` si `forma === "circular"`, y si
//     no `rounded-lg`.
// Cualquier valor que no sea exactamente "circular" se pinta IGUAL: un
// rectángulo redondeado. Añadir "cuadrada" o "barra" no cambiaría el dibujo y
// obligaría a tocar `PlanoEspacio2D.tsx` para darle un pintor propio.
//
// Por eso los tipos de mesa que pedía el dueño se expresan como TAMAÑO +
// CAPACIDAD sobre la forma "rectangular" que ya existe: una cuadrada es un
// rectángulo con ancho == alto, una mesa de banquete es un rectángulo largo y
// una barra es un rectángulo largo y estrecho. Cero migraciones, cero riesgo
// para el visor.
// ============================================================================

import { MAX_MESAS_POR_LOTE, normalizarNombreMesa } from "./nombresMesa";

export type FormaMesa = "rectangular" | "circular";

/** Tope de caracteres de un nombre de mesa escrito en la lista del lote.
 *  `mesas.nombre` es `text` y aguanta cualquier cosa; el tope está para que
 *  pegar un párrafo por error no acabe creando una mesa con un párrafo
 *  de nombre. */
export const MAX_LARGO_NOMBRE_MESA = 30;

/** Capacidad mínima y máxima por mesa (las mismas que aceptan los campos del
 *  panel lateral desde siempre). */
export const MIN_CAPACIDAD_MESA = 1;
export const MAX_CAPACIDAD_MESA = 20;

/** Ancho/alto mínimo y máximo de una mesa en cm (los mismos que ya validaban
 *  los campos de «Añadir Mesa»). */
export const MIN_LADO_MESA_CM = 30;
export const MAX_LADO_MESA_CM = 300;

// ---------------------------------------------------------------------------
// 1. Lista libre de números ("1-8, 11-16, T1-T6, 20")
// ---------------------------------------------------------------------------

export interface ListaNumerosMesa {
  /** Números en el orden en que los escribió el dueño. Vacío si hay error. */
  numeros: string[];
  /** Motivo por el que la lista no sirve, listo para mostrar. `null` si sirve. */
  error: string | null;
  /** Avisos que NO impiden crear (p.ej. repetidos que se han quitado solos). */
  avisos: string[];
}

/** Separadores entre elementos de la lista: coma, punto y coma, salto de línea
 *  o tabulador (para que pegar una columna de una hoja de cálculo funcione). */
const SEPARADORES_LISTA = /[,;\n\r\t]+/;

/**
 * Un tramo "A-B". Los dos extremos tienen que acabar en dígitos y compartir
 * prefijo. El prefijo se captura con `[^\d]*` GOLOSO (no perezoso) a propósito:
 * así "Mesa 1-Mesa 4" conserva el espacio del prefijo ("Mesa 1" ... "Mesa 4")
 * en vez de comérselo y generar "Mesa1".
 *
 * Lo que NO casa aquí se trata como un nombre literal, y eso es justo lo que
 * salva a los nombres con guion: "7-bis" no es un rango (el segundo extremo no
 * acaba en dígitos), así que entra tal cual como una mesa llamada "7-bis".
 */
const TRAMO_RANGO = /^([^\d]*)(\d+)\s*(?:-{1,2}|–|—|\.{2,})\s*([^\d]*)(\d+)$/;

/** Rellena con ceros a la izquierda si el dueño numeró con ceros ("01-12"). */
function formatearNumeroRango(valor: number, digitosDesde: string, digitosHasta: string): string {
  const texto = String(valor);
  const conCeros = digitosDesde.length > 1 && digitosDesde.startsWith("0");
  if (!conCeros) return texto;
  return texto.padStart(Math.max(digitosDesde.length, digitosHasta.length), "0");
}

/**
 * Convierte lo que el dueño escribe en la lista ordenada de números de mesa.
 *
 * Acepta, separados por comas / puntos y coma / saltos de línea:
 *   - valores sueltos: `20`, `Barra`, `T7`
 *   - rangos numéricos: `1-8`, `1 .. 8`
 *   - rangos con prefijo: `T1-T6` (o `T1-6`, que hereda el prefijo del primero)
 *
 * POR QUÉ existe, habiendo ya `generarNumerosMesaEnRango` (que sigue viva y en
 * uso): las salas reales SALTAN números (la 9 y la 10 no existen porque ahí
 * está la barra) y usan prefijos por zona. Con un único «desde–hasta» cada
 * salto obligaba a crear las mesas de una en una, que es exactamente lo que
 * tiene al dueño con cuatro salas vacías.
 *
 * Los repetidos DENTRO de la propia lista (rangos que se solapan, un número
 * escrito dos veces) no son un error: se quitan y se avisa. Los choques contra
 * mesas que YA existen en el espacio no se miran aquí — de eso se encarga
 * `nombresMesaDuplicadosEnLote`, que es quien conoce las mesas del espacio.
 */
export function parsearListaNumerosMesa(
  entrada: string,
  maximo: number = MAX_MESAS_POR_LOTE,
): ListaNumerosMesa {
  const vacio = (error: string | null): ListaNumerosMesa => ({ numeros: [], error, avisos: [] });

  const tokens = (entrada ?? "")
    .split(SEPARADORES_LISTA)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return vacio("Escribe al menos un número de mesa. Por ejemplo: 1-8, 11-16, T1-T6, 20.");
  }

  const numeros: string[] = [];
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  const repetidosReportados = new Set<string>();

  const anadir = (nombre: string): string | null => {
    if (nombre.length > MAX_LARGO_NOMBRE_MESA) {
      return `El nombre «${nombre.slice(0, MAX_LARGO_NOMBRE_MESA)}…» es demasiado largo (máximo ${MAX_LARGO_NOMBRE_MESA} caracteres).`;
    }
    const normalizado = normalizarNombreMesa(nombre);
    if (!normalizado) return null; // solo espacios: se ignora sin ruido
    if (vistos.has(normalizado)) {
      if (!repetidosReportados.has(normalizado)) {
        repetidosReportados.add(normalizado);
        repetidos.push(nombre);
      }
      return null;
    }
    if (numeros.length >= maximo) {
      return `No se pueden crear más de ${maximo} mesas de una vez. Quita algunas y haz otra tanda después.`;
    }
    vistos.add(normalizado);
    numeros.push(nombre);
    return null;
  };

  for (const token of tokens) {
    const tramo = TRAMO_RANGO.exec(token);

    if (!tramo) {
      const error = anadir(token);
      if (error) return vacio(error);
      continue;
    }

    const [, prefijoDesde, digitosDesde, prefijoHasta, digitosHasta] = tramo;
    // "T1-6": el segundo extremo hereda el prefijo del primero. Si los dos
    // traen prefijo y no coinciden, es un error de dedo que hay que ver.
    const prefijo2 = prefijoHasta === "" ? prefijoDesde : prefijoHasta;
    if (prefijoDesde !== prefijo2) {
      return vacio(
        `En «${token}» los dos extremos usan prefijos distintos («${prefijoDesde}» y «${prefijoHasta}»). Escribe el rango con el mismo prefijo, por ejemplo T1-T6.`,
      );
    }

    const desde = Number(digitosDesde);
    const hasta = Number(digitosHasta);
    if (hasta < desde) {
      return vacio(`En el rango «${token}» el segundo número tiene que ser mayor o igual que el primero.`);
    }

    const cantidad = hasta - desde + 1;
    if (numeros.length + cantidad > maximo) {
      return vacio(
        `No se pueden crear más de ${maximo} mesas de una vez (con «${token}» salen ${numeros.length + cantidad}). Parte la carga en varias tandas.`,
      );
    }

    for (let n = desde; n <= hasta; n += 1) {
      const error = anadir(`${prefijoDesde}${formatearNumeroRango(n, digitosDesde, digitosHasta)}`);
      if (error) return vacio(error);
    }
  }

  if (numeros.length === 0) {
    return vacio("Escribe al menos un número de mesa. Por ejemplo: 1-8, 11-16, T1-T6, 20.");
  }

  const avisos: string[] = [];
  if (repetidos.length > 0) {
    avisos.push(
      `Se ${repetidos.length === 1 ? "ha quitado 1 número repetido" : `han quitado ${repetidos.length} números repetidos`}: ${repetidos.join(", ")}.`,
    );
  }

  return { numeros, error: null, avisos };
}

// ---------------------------------------------------------------------------
// 2. Presets de tipo de mesa
// ---------------------------------------------------------------------------

export interface PresetMesa {
  id: string;
  /** Nombre corto para el botón ("Redonda 6p"). */
  etiqueta: string;
  forma: FormaMesa;
  anchoCm: number;
  altoCm: number;
  /** Capacidad SUGERIDA. El dueño la puede cambiar mesa a mesa. */
  capacidad: number;
  /** Medidas en texto para la interfaz ("Ø150 cm", "120×80 cm"). */
  medidas: string;
}

/** Hueco por taburete en una barra, en cm. */
export const SEPARACION_TABURETE_CM = 60;

/**
 * Plazas que caben en una barra según su largo. Una barra no tiene una
 * capacidad "de catálogo": depende de cuántos taburetes caben.
 */
export function capacidadSugeridaBarra(
  largoCm: number,
  separacionCm: number = SEPARACION_TABURETE_CM,
): number {
  if (!Number.isFinite(largoCm) || largoCm <= 0) return MIN_CAPACIDAD_MESA;
  if (!Number.isFinite(separacionCm) || separacionCm <= 0) return MIN_CAPACIDAD_MESA;
  const plazas = Math.floor(largoCm / separacionCm);
  return Math.min(MAX_CAPACIDAD_MESA, Math.max(MIN_CAPACIDAD_MESA, plazas));
}

/** Medidas en texto: una circular se describe por su diámetro. */
export function medidasMesaTexto(forma: FormaMesa, anchoCm: number, altoCm: number): string {
  return forma === "circular" ? `Ø${anchoCm} cm` : `${anchoCm}×${altoCm} cm`;
}

function preset(
  id: string,
  etiqueta: string,
  forma: FormaMesa,
  anchoCm: number,
  altoCm: number,
  capacidad: number,
): PresetMesa {
  return { id, etiqueta, forma, anchoCm, altoCm, capacidad, medidas: medidasMesaTexto(forma, anchoCm, altoCm) };
}

/**
 * Tipos de mesa que pidió el dueño. TODOS son `forma: "rectangular"` salvo la
 * redonda — ver la cabecera del fichero: el visor `PlanoEspacio2D.tsx:491`
 * pinta como rectángulo redondeado cualquier forma que no sea "circular", así
 * que un valor de forma nuevo no dibujaría nada distinto.
 *
 * Ojo con la capacidad: hay tres valores por defecto distintos conviviendo en
 * el sistema (el editor propone 2, la columna `mesas.capacidad` tiene DEFAULT
 * 4 y el visor asume 4 cuando falta). Aquí NO se unifica nada: cada preset
 * lleva su capacidad explícita, así que la mesa siempre se crea con un número
 * escrito a mano y nunca cae en el default de nadie.
 */
export const PRESETS_MESA: readonly PresetMesa[] = [
  preset("rect-2p", "Rectangular 2p", "rectangular", 80, 80, 2),
  preset("cuadrada-4p", "Cuadrada 4p", "rectangular", 80, 80, 4),
  preset("rect-4p", "Rectangular 4p", "rectangular", 120, 80, 4),
  preset("redonda-6p", "Redonda 6p", "circular", 150, 150, 6),
  preset("banquete-8p", "Alargada 8p", "rectangular", 240, 90, 8),
  preset("barra", "Barra", "rectangular", 300, 50, capacidadSugeridaBarra(300)),
];

/** El que trae marcado el formulario: es el mismo tamaño y capacidad que
 *  proponía «Añadir Mesa» antes de existir los presets (80×80, 2 plazas). */
export const PRESET_MESA_POR_DEFECTO: PresetMesa = PRESETS_MESA[0];

export function presetMesaPorId(id: string | null | undefined): PresetMesa | null {
  if (!id) return null;
  return PRESETS_MESA.find((p) => p.id === id) ?? null;
}

/** Preset que encaja exactamente con una forma/tamaño/capacidad dados, o `null`
 *  si el dueño lo ha retocado a mano ("Personalizada"). */
export function presetMesaQueEncaja(mesa: {
  forma: FormaMesa;
  anchoCm: number;
  altoCm: number;
  capacidad: number;
}): PresetMesa | null {
  return (
    PRESETS_MESA.find(
      (p) =>
        p.forma === mesa.forma &&
        p.anchoCm === mesa.anchoCm &&
        p.altoCm === mesa.altoCm &&
        p.capacidad === mesa.capacidad,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 3. Filas editables del lote
// ---------------------------------------------------------------------------

export interface FilaLoteMesa {
  /** Clave estable para React: no cambia aunque se renombre la fila. */
  clave: string;
  nombre: string;
  forma: FormaMesa;
  anchoCm: number;
  altoCm: number;
  capacidad: number;
  /** Preset del que salió, o `null` si se ha retocado a mano. */
  presetId: string | null;
}

/** Capacidad válida: entero dentro de los topes, sin reventar con basura. */
export function normalizarCapacidadMesa(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10);
  if (!Number.isFinite(numero)) return MIN_CAPACIDAD_MESA;
  return Math.min(MAX_CAPACIDAD_MESA, Math.max(MIN_CAPACIDAD_MESA, Math.round(numero)));
}

/** Lado válido (ancho o alto) en cm: entero dentro de los topes. */
export function normalizarLadoMesaCm(valor: unknown, porDefecto = 80): number {
  const numero = typeof valor === "number" ? valor : Number.parseInt(String(valor ?? ""), 10);
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(MAX_LADO_MESA_CM, Math.max(MIN_LADO_MESA_CM, Math.round(numero)));
}

function claveUnica(base: string, usadas: Set<string>): string {
  let clave = base;
  let intento = 1;
  while (usadas.has(clave)) {
    intento += 1;
    clave = `${base}#${intento}`;
  }
  usadas.add(clave);
  return clave;
}

/** Filas nuevas a partir de los números de la lista, todas con el mismo preset. */
export function filasLoteDesdeNombres(
  nombres: readonly string[],
  preset: PresetMesa = PRESET_MESA_POR_DEFECTO,
): FilaLoteMesa[] {
  const usadas = new Set<string>();
  return (nombres ?? []).map((nombre, indice) => ({
    clave: claveUnica(`mesa-${normalizarNombreMesa(nombre) || indice}`, usadas),
    nombre,
    forma: preset.forma,
    anchoCm: preset.anchoCm,
    altoCm: preset.altoCm,
    capacidad: preset.capacidad,
    presetId: preset.id,
  }));
}

export interface AltaNombresEnLote {
  /** La lista resultante (las filas que ya había + las nuevas). */
  filas: FilaLoteMesa[];
  /** Cuántas filas nuevas han entrado. */
  anadidas: number;
  /** Números que ya estaban en la lista y no se han duplicado. */
  yaEstaban: string[];
  /** Motivo por el que no ha entrado todo (tope del lote), o `null`. */
  error: string | null;
}

/**
 * Añade los números recién escritos a la lista que ya se estaba editando,
 * SIN tocar las filas anteriores.
 *
 * Es lo que permite cargar la sala en varias tandas ("1-8" con el preset de 2
 * plazas, luego "T1-T6" con el de redonda) sin perder lo ya ajustado, y lo que
 * evita el problema de reparsear el texto con cada tecla: el cuadro de texto
 * propone números, la tabla es la que manda.
 *
 * Los números que ya están en la lista NO se duplican (se comparan con el
 * mismo normalizado que usa el índice de Postgres) y se devuelven en
 * `yaEstaban` para poder avisar.
 */
export function anadirNombresAlLote(
  filas: readonly FilaLoteMesa[],
  nombres: readonly string[],
  preset: PresetMesa = PRESET_MESA_POR_DEFECTO,
  maximo: number = MAX_MESAS_POR_LOTE,
): AltaNombresEnLote {
  const resultado: FilaLoteMesa[] = [...(filas ?? [])];
  const usadas = new Set(resultado.map((f) => f.clave));
  const presentes = new Set(
    resultado.map((f) => normalizarNombreMesa(f.nombre)).filter((n) => n.length > 0),
  );
  const yaEstaban: string[] = [];
  const pendientes = [...(nombres ?? [])];
  let anadidas = 0;
  let error: string | null = null;

  while (pendientes.length > 0) {
    const nombre = pendientes.shift() as string;
    const normalizado = normalizarNombreMesa(nombre);
    if (!normalizado) continue;
    if (presentes.has(normalizado)) {
      yaEstaban.push(nombre);
      continue;
    }
    if (resultado.length >= maximo) {
      const fuera = pendientes.length + 1;
      error = `La lista no puede pasar de ${maximo} mesas de una vez: ${fuera === 1 ? "ha quedado 1 número fuera" : `han quedado ${fuera} números fuera`}. Crea estas y haz otra tanda con el resto.`;
      break;
    }
    presentes.add(normalizado);
    resultado.push({
      clave: claveUnica(`mesa-${normalizado}`, usadas),
      nombre,
      forma: preset.forma,
      anchoCm: preset.anchoCm,
      altoCm: preset.altoCm,
      capacidad: preset.capacidad,
      presetId: preset.id,
    });
    anadidas += 1;
  }

  return { filas: resultado, anadidas, yaEstaban, error };
}

/** Aplica un preset a TODAS las filas (el «aplicar a todas» del formulario). */
export function aplicarPresetAFilas(
  filas: readonly FilaLoteMesa[],
  preset: PresetMesa,
): FilaLoteMesa[] {
  return (filas ?? []).map((fila) => ({
    ...fila,
    forma: preset.forma,
    anchoCm: preset.anchoCm,
    altoCm: preset.altoCm,
    capacidad: preset.capacidad,
    presetId: preset.id,
  }));
}

/** Pone la misma capacidad en todas las filas, sin tocar forma ni tamaño. */
export function aplicarCapacidadAFilas(
  filas: readonly FilaLoteMesa[],
  capacidad: number,
): FilaLoteMesa[] {
  const valor = normalizarCapacidadMesa(capacidad);
  return (filas ?? []).map((fila) => ({
    ...fila,
    capacidad: valor,
    presetId: presetMesaQueEncaja({ ...fila, capacidad: valor })?.id ?? null,
  }));
}

/** Cambia una sola fila (por clave). `presetId` se recalcula solo. */
export function actualizarFilaLote(
  filas: readonly FilaLoteMesa[],
  clave: string,
  cambios: Partial<Omit<FilaLoteMesa, "clave" | "presetId">>,
): FilaLoteMesa[] {
  return (filas ?? []).map((fila) => {
    if (fila.clave !== clave) return fila;
    const siguiente: FilaLoteMesa = { ...fila, ...cambios };
    if (siguiente.forma === "circular") siguiente.altoCm = siguiente.anchoCm;
    return { ...siguiente, presetId: presetMesaQueEncaja(siguiente)?.id ?? null };
  });
}

/** Aplica un preset a UNA fila (el desplegable de tipo de cada línea). */
export function aplicarPresetAFila(
  filas: readonly FilaLoteMesa[],
  clave: string,
  preset: PresetMesa,
): FilaLoteMesa[] {
  return (filas ?? []).map((fila) =>
    fila.clave === clave
      ? {
          ...fila,
          forma: preset.forma,
          anchoCm: preset.anchoCm,
          altoCm: preset.altoCm,
          capacidad: preset.capacidad,
          presetId: preset.id,
        }
      : fila,
  );
}

export function quitarFilaLote(filas: readonly FilaLoteMesa[], clave: string): FilaLoteMesa[] {
  return (filas ?? []).filter((fila) => fila.clave !== clave);
}

/** Totales para la línea de resumen del formulario. */
export function resumenFilasLote(filas: readonly FilaLoteMesa[]): {
  total: number;
  plazas: number;
  circulares: number;
} {
  const lista = filas ?? [];
  return {
    total: lista.length,
    plazas: lista.reduce((suma, f) => suma + normalizarCapacidadMesa(f.capacidad), 0),
    circulares: lista.filter((f) => f.forma === "circular").length,
  };
}

// ---------------------------------------------------------------------------
// 4. Resultado del alta: qué se creó, qué falló y por qué
// ---------------------------------------------------------------------------

export interface ResultadoAltaMesa {
  nombre: string;
  ok: boolean;
  /** Motivo en minúsculas, pensado para leerse DENTRO de una frase. */
  motivo?: string;
}

export const MOTIVO_NUMERO_REPETIDO = "ya hay otra mesa con ese número en este espacio";
export const MOTIVO_FALLO_GENERICO = "no se ha podido guardar";
/**
 * La colocación automática no ha encontrado NI UN hueco libre para esa mesa:
 * la rejilla ya estaba llena de mesas o el hueco que quedaba pisaba una pared.
 *
 * Es un fallo "de sitio", no de base de datos: la mesa NO se llega a insertar.
 * Antes de esto se colocaba igualmente en el primer hueco de la rejilla, que
 * podía quedar encima de otra mesa o partido por un muro, y el dueño solo se
 * enteraba al mirar el plano.
 */
export const MOTIVO_SIN_SITIO = "no cabe en el plano sin pisar una pared u otra mesa";

/**
 * ¿Es el choque del índice único de nombres de mesa?
 *
 * Es la MISMA comprobación que `esNumeroDeMesaRepetido` de
 * `src/hooks/useMesas.ts:143-151` (código `23505` de Postgres, o el nombre del
 * índice en el texto del error). Está duplicada aquí y no importada porque
 * aquélla no se exporta y `useMesas.ts` es de otro componente; si algún día se
 * exporta, esta copia debería desaparecer. El criterio tiene que seguir siendo
 * idéntico: es lo que convierte un error opaco de Supabase en "ese número ya
 * está cogido".
 */
export function esNumeroDeMesaRepetido(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const texto = [e.message, e.details].filter((t) => typeof t === "string").join(" ");
  return /uq_mesas_espacio_nombre_real/i.test(texto) || e.code === "23505";
}

/** Motivo legible del fallo de UNA mesa del lote. */
export function motivoFalloAltaMesa(error: unknown): string {
  return esNumeroDeMesaRepetido(error) ? MOTIVO_NUMERO_REPETIDO : MOTIVO_FALLO_GENERICO;
}

/** Cuántos nombres como mucho se enumeran en un mensaje antes de resumir. */
export const MAX_NOMBRES_EN_MENSAJE = 12;

function listaNombres(nombres: readonly string[], maximo = MAX_NOMBRES_EN_MENSAJE): string {
  if (nombres.length <= maximo) return nombres.join(", ");
  return `${nombres.slice(0, maximo).join(", ")} y ${nombres.length - maximo} más`;
}

export interface ResumenAltaLoteMesas {
  creadas: string[];
  fallidas: { nombre: string; motivo: string }[];
  /** Mensaje completo en español, listo para el toast y para el panel. */
  mensaje: string;
  hayFallos: boolean;
}

/**
 * Resumen del alta en lote.
 *
 * El alta ANTIGUA paraba en el primer fallo: si reventaba la mesa 13, quedaban
 * 12 creadas, 8 sin crear y un mensaje que no decía cuáles. Ahora el llamador
 * sigue adelante con todas y trae aquí el resultado de cada una, para poder
 * decir exactamente cuántas se crearon, cuáles no y por qué motivo.
 */
export function resumenAltaLoteMesas(
  resultados: readonly ResultadoAltaMesa[],
): ResumenAltaLoteMesas {
  const lista = (resultados ?? []).filter((r) => !!r);
  const creadas = lista.filter((r) => r.ok).map((r) => r.nombre);
  const fallidas = lista
    .filter((r) => !r.ok)
    .map((r) => ({ nombre: r.nombre, motivo: r.motivo || MOTIVO_FALLO_GENERICO }));

  if (lista.length === 0) {
    return { creadas, fallidas, mensaje: "No había ninguna mesa que crear.", hayFallos: false };
  }

  // Los fallos se agrupan por motivo: "ya hay otra mesa con ese número: 13, 14"
  // se lee mucho mejor que repetir el motivo mesa a mesa.
  const porMotivo = new Map<string, string[]>();
  for (const fallo of fallidas) {
    const nombres = porMotivo.get(fallo.motivo) ?? [];
    nombres.push(fallo.nombre);
    porMotivo.set(fallo.motivo, nombres);
  }
  const detalleFallos = [...porMotivo.entries()]
    .map(([motivo, nombres]) => `${motivo}: ${listaNombres(nombres)}`)
    .join("; ");

  if (fallidas.length === 0) {
    return {
      creadas,
      fallidas,
      hayFallos: false,
      mensaje:
        creadas.length === 1
          ? `Se ha creado 1 mesa: ${listaNombres(creadas)}.`
          : `Se han creado ${creadas.length} mesas: ${listaNombres(creadas)}.`,
    };
  }

  if (creadas.length === 0) {
    return {
      creadas,
      fallidas,
      hayFallos: true,
      mensaje: `No se ha podido crear ninguna mesa — ${detalleFallos}.`,
    };
  }

  return {
    creadas,
    fallidas,
    hayFallos: true,
    mensaje:
      `Se han creado ${creadas.length} de ${lista.length} mesas (${listaNombres(creadas)}). ` +
      `No se ${fallidas.length === 1 ? "ha creado 1" : `han creado ${fallidas.length}`} — ${detalleFallos}. ` +
      `En la lista se han dejado solo las que fallaron para que las corrijas y lo vuelvas a intentar.`,
  };
}
