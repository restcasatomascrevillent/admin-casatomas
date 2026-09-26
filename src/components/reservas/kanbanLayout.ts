// ============================================================================
// DISPOSICIÓN HORIZONTAL DEL KANBAN DE SERVICIO (pestaña "Hoy")
// ----------------------------------------------------------------------------
// Dos encargos del dueño, en este orden de prioridad:
//
//   1. (2026-09-26) TODAS LAS COLUMNAS A LA VISTA A LA VEZ. Literal: "cuando
//      abro todos se pierden, tienen que estar todos aunque ocupen menos
//      espacio de ancho por columna". Columnas estrechas, sí; columnas
//      escondidas, no. Aquí NO se pliega nada por iniciativa propia: el
//      plegado a carril de 52px existe, pero solo si el usuario lo pide con
//      el botón de la cabecera de la columna. Por defecto, todo abierto.
//
//   2. (2026-09-25) NUNCA SE VE UNA COLUMNA PARTIDA. Antes las columnas tenían
//      ancho FIJO (`w-[270px]`) dentro de un `overflow-x-auto`: cuando la suma
//      pasaba del ancho disponible, el navegador cortaba la última justo en el
//      borde del scroll y se veía medio título y media barra de aforo.
//
// Los dos encargos conviven porque el ancho mínimo por columna es bajo
// (ANCHO_MIN_COLUMNA, 160px): con las 5 columnas de Casa Tomás caben enteras a
// partir de ~864px útiles, o sea en cualquier escritorio. Solo si NI ASÍ caben
// (pantalla muy estrecha, o alguien añade muchos espacios) se recurre al
// desplazamiento con imán, que es lo que garantiza que nada quede a medias.
//
// Dos modos:
//   · "ajustado"    → TODAS las columnas a la vista. Se reparten el ancho
//                     disponible (entre ANCHO_MIN_COLUMNA y ANCHO_MAX_COLUMNA).
//                     Ni scroll ni recortes. Es el caso normal.
//   · "desplazable" → ni al mínimo caben. Se calculan las PARADAS: los únicos
//                     desplazamientos en los que el scroll puede quedarse. En
//                     cada parada se ven K columnas ENTERAS y la siguiente
//                     empieza justo después del borde, nunca a caballo.
//
// Cómo se consigue esa garantía, según haya carriles plegados a mano o no:
//   · Sin carriles (el caso normal): todas las columnas miden lo mismo, así que
//     el PASO entre paradas se calcula para que K columnas llenen el viewport
//     (K·paso = ancho disponible + hueco). Las paradas van de columna en
//     columna: se avanza de una en una y siempre se ven K enteras.
//   · Con carriles: los anchos ya no son uniformes, así que se trocea en
//     PÁGINAS que miden exactamente el viewport y el sobrante de cada una se
//     vuelve hueco vacío tras su última columna. El borde del scroll cae
//     entonces en ese hueco, jamás sobre una columna.
//
// Por qué márgenes y no `gap`: (a) el hueco de relleno del final de una página
// tiene que ser distinto en cada una, y con `gap` uniforme no se puede; (b) el
// hueco es también el que absorbe el sobrante cuando el ancho de columna toca
// el tope de ANCHO_MAX_COLUMNA (ver `desplazarPorColumna`). Cada columna lleva
// su propio `margin-right` (ver `margenes`), lo que hace que las paradas sean
// exactas y no dependan de cómo redondee el navegador.
// ============================================================================

/** Separación entre columnas, en px. Debe coincidir con lo que pinte el CSS. */
export const GAP_KANBAN = 16;

/**
 * Ancho mínimo de una columna, 160px. Sale de medir la tarjeta, no de un gusto:
 * la fila de acciones («Ha llegado» + el menú de tres puntos) necesita ~116px
 * de contenido y la columna añade ~44px de cromo (borde 2+2, `p-2` del cuerpo,
 * `p-3`/borde de la tarjeta). Por debajo de eso el botón «Ha llegado» se sale
 * de la tarjeta.
 *
 * Bajó de 224 a 160 el 2026-09-26: con 224 las 5 columnas de Casa Tomás
 * (Sin asignar + Comedor + Reservado + Salón + Terraza) pedían 1184px y a
 * 1456px de ventana solo hay ~1134 útiles (menos sidebar 256, padding 48 y el
 * marco del grupo 18). Faltaban 50px y eso disparaba toda la cascada de
 * recortes. A 160 piden 864: caben con 270px de sobra.
 */
export const ANCHO_MIN_COLUMNA = 160;

/** Ancho máximo: por encima de esto las tarjetas quedan ridículamente anchas. */
export const ANCHO_MAX_COLUMNA = 320;

/**
 * Ancho mínimo de emergencia para pantallas absurdamente estrechas (< ~176px
 * útiles), donde respetar ANCHO_MIN_COLUMNA dejaría la columna más ancha que
 * la pantalla — y eso sí se vería cortado.
 */
const ANCHO_MIN_EMERGENCIA = 130;

/** Ancho de una columna plegada A MANO (el carril vertical con el nombre girado). */
export const ANCHO_COLUMNA_PLEGADA = 52;

export interface ItemColumna {
  id: string;
  /**
   * Plegada = carril estrecho de ANCHO_COLUMNA_PLEGADA en vez de columna.
   * SIEMPRE es una decisión del usuario: este módulo no pliega nada solo.
   */
  plegada: boolean;
}

export interface DisposicionKanban {
  modo: "ajustado" | "desplazable";
  /** Ancho en px de cada columna NO plegada. Nunca pasa de ANCHO_MAX_COLUMNA. */
  anchoColumna: number;
  /** Desplazamientos (px) en los que el scroll puede pararse. */
  paradas: number[];
  /** Columnas que se ven ENTERAS en cada parada, en el mismo orden. */
  visiblesPorParada: string[][];
  /** `margin-right` en px de cada columna (incluye huecos de relleno). */
  margenes: Record<string, number>;
  /** Ids que llevan `scroll-snap-align: start` (coinciden con las paradas). */
  idsConIman: string[];
  /**
   * Relleno explícito al final de la fila. Va en un `<div>` propio y no como
   * margen de la última columna porque el margen final de un hijo flex no
   * siempre entra en el `scrollWidth`; sin él, la última parada se quedaría
   * corta y volvería a verse una columna partida por la izquierda.
   */
  espacioFinal: number;
}

const acotar = (valor: number, min: number, max: number) => Math.min(Math.max(valor, min), max);

/** Ancho que ocupa un item: carril plegado o columna. */
const anchoDe = (item: ItemColumna, anchoColumna: number) =>
  item.plegada ? ANCHO_COLUMNA_PLEGADA : anchoColumna;

/**
 * ¿Cuántas columnas de ancho mínimo entran en `ancho`? Al menos una siempre,
 * aunque la pantalla sea absurdamente estrecha.
 */
export function columnasQueCaben(ancho: number, anchoMinimo = ANCHO_MIN_COLUMNA): number {
  if (!Number.isFinite(ancho) || ancho <= 0) return 1;
  return Math.max(1, Math.floor((ancho + GAP_KANBAN) / (anchoMinimo + GAP_KANBAN)));
}

/**
 * Ancho útil mínimo para que TODAS las columnas quepan a la vez. Sirve para
 * razonar (y testear) sobre el punto exacto en el que deja de ser posible.
 */
export function anchoParaQueQuepanTodas(items: readonly ItemColumna[]): number {
  if (items.length === 0) return 0;
  const plegadas = items.filter((i) => i.plegada).length;
  const expandidas = items.length - plegadas;
  return (
    plegadas * ANCHO_COLUMNA_PLEGADA +
    expandidas * ANCHO_MIN_COLUMNA +
    GAP_KANBAN * (items.length - 1)
  );
}

/**
 * Reparte `items` en el ancho disponible. `anchoDisponible` es el ancho útil
 * del contenedor con scroll (su `clientWidth`), no el de la ventana.
 */
export function calcularDisposicion(
  items: readonly ItemColumna[],
  anchoDisponible: number,
): DisposicionKanban {
  if (items.length === 0) {
    return {
      modo: "ajustado",
      anchoColumna: ANCHO_MIN_COLUMNA,
      paradas: [],
      visiblesPorParada: [],
      margenes: {},
      idsConIman: [],
      espacioFinal: 0,
    };
  }

  // Antes del primer ResizeObserver no sabemos el ancho: se pinta con el
  // mínimo legible y sin desplazamiento; al llegar la medida se recalcula.
  if (!Number.isFinite(anchoDisponible) || anchoDisponible <= 0) {
    return ajustado(items, ANCHO_MIN_COLUMNA);
  }

  const plegadas = items.filter((i) => i.plegada).length;
  const expandidas = items.length - plegadas;
  const gaps = GAP_KANBAN * (items.length - 1);
  const anchoCarriles = plegadas * ANCHO_COLUMNA_PLEGADA;

  // Todo plegado a mano: los carriles son estrechos, casi siempre caben de sobra.
  if (expandidas === 0) {
    if (anchoCarriles + gaps <= anchoDisponible) return ajustado(items, ANCHO_MIN_COLUMNA);
    return paginar(items, ANCHO_MIN_COLUMNA, anchoDisponible);
  }

  // EL CASO QUE MANDA: ¿caben TODAS repartiéndose el hueco? Con el mínimo en
  // 160px esto es cierto en cualquier escritorio, así que el kanban se queda
  // en "ajustado" y no hay ni scroll ni columnas escondidas.
  const anchoSiCaben = (anchoDisponible - anchoCarriles - gaps) / expandidas;
  if (anchoSiCaben >= ANCHO_MIN_COLUMNA) {
    return ajustado(items, Math.floor(Math.min(anchoSiCaben, ANCHO_MAX_COLUMNA)));
  }

  // No caben ni al mínimo. Entonces sí se desplaza, y el ancho de columna es el
  // que hace que un número entero de ellas llene el viewport. En pantallas
  // ridículamente estrechas se permite bajar del mínimo antes que dejar una
  // columna más ancha que la pantalla, que sí se vería cortada.
  const anchoMinimo = Math.min(
    ANCHO_MIN_COLUMNA,
    Math.max(ANCHO_MIN_EMERGENCIA, anchoDisponible - GAP_KANBAN),
  );
  const porVista = Math.min(items.length, columnasQueCaben(anchoDisponible, anchoMinimo));

  // Con carriles plegados a mano los anchos no son uniformes y la aritmética de
  // paradas por columna deja de valer: se pagina (ver cabecera).
  if (plegadas > 0) {
    const anchoConCarriles = Math.floor(
      acotar((anchoDisponible - GAP_KANBAN * (porVista - 1)) / porVista, anchoMinimo, ANCHO_MAX_COLUMNA),
    );
    return paginar(items, anchoConCarriles, anchoDisponible);
  }
  return desplazarPorColumna(items, anchoDisponible, porVista);
}

/** Todas las columnas a la vista: sin desplazamiento y sin huecos de relleno. */
function ajustado(items: readonly ItemColumna[], anchoColumna: number): DisposicionKanban {
  const margenes: Record<string, number> = {};
  items.forEach((item, i) => {
    margenes[item.id] = i === items.length - 1 ? 0 : GAP_KANBAN;
  });
  const ids = items.map((i) => i.id);
  return {
    modo: "ajustado",
    anchoColumna: Math.min(anchoColumna, ANCHO_MAX_COLUMNA),
    paradas: [0],
    visiblesPorParada: [ids],
    margenes,
    idsConIman: ids.slice(0, 1),
    espacioFinal: 0,
  };
}

/**
 * Columnas del mismo ancho: se avanza de UNA en una. En la parada `i` se ven
 * enteras las columnas `i … i+porVista-1`, porque `porVista` PASOS llenan
 * exactamente el viewport y la siguiente arranca ya fuera del borde.
 */
function desplazarPorColumna(
  items: readonly ItemColumna[],
  anchoDisponible: number,
  porVista: number,
): DisposicionKanban {
  const n = items.length;

  // El PASO (lo que avanza el scroll entre dos paradas) sale de repartir el
  // viewport entre las columnas que caben:
  //     porVista·ancho + (porVista−1)·hueco ≈ anchoDisponible
  // Así la columna que viene detrás de las visibles arranca en porVista·paso,
  // que queda MÁS ALLÁ del borde: ni asoma. Se redondea hacia abajo para
  // trabajar con enteros (el sobrante es menor que `porVista`, siempre menos
  // que un hueco, así que la garantía aguanta).
  const anchoSinTope = Math.floor((anchoDisponible - GAP_KANBAN * (porVista - 1)) / porVista);
  if (porVista >= n) return ajustado(items, anchoSinTope);

  // Ojo: el tope de ANCHO_MAX_COLUMNA se aplica al ANCHO, nunca al PASO. Si se
  // recortase el paso, este quedaría más corto que el viewport y volvería a
  // asomar media columna (el fallo que el dueño vio el 2026-09-26: una columna
  // de ~480px, muy por encima del máximo declarado de 320). El sobrante se va
  // al hueco entre columnas, que es aire y no esconde nada.
  const anchoColumna = Math.min(anchoSinTope, ANCHO_MAX_COLUMNA);
  const paso = anchoSinTope + GAP_KANBAN;
  const hueco = paso - anchoColumna; // ≥ GAP_KANBAN

  const margenes: Record<string, number> = {};
  items.forEach((item, i) => {
    margenes[item.id] = i === n - 1 ? 0 : hueco;
  });

  const paradas = Array.from({ length: n - porVista + 1 }, (_, i) => i * paso);
  const visiblesPorParada = paradas.map((_, i) => items.slice(i, i + porVista).map((x) => x.id));

  // Relleno para que la última parada sea EXACTAMENTE el desplazamiento máximo:
  // si sobra, el scroll puede irse un pelo más allá y asoma una rendija de la
  // columna anterior; si falta, la última parada no se alcanza y asoma media
  // columna. Al ser todo enteros, la cuenta cuadra al píxel.
  const anchoContenido = n * anchoColumna + (n - 1) * hueco;
  const espacioFinal = Math.max(0, paradas[paradas.length - 1] + anchoDisponible - anchoContenido);

  return {
    modo: "desplazable",
    anchoColumna,
    paradas,
    visiblesPorParada,
    margenes,
    idsConIman: items.map((x) => x.id),
    espacioFinal,
  };
}

/**
 * Trocea en páginas de ancho exacto `anchoPagina`. Se meten columnas mientras
 * quepan enteras; el sobrante se va al `margin-right` de la última de cada
 * página, así la siguiente empieza justo en el múltiplo siguiente del ancho de
 * página y el borde del scroll nunca cae encima de una columna.
 */
function paginar(
  items: readonly ItemColumna[],
  anchoColumna: number,
  anchoPagina: number,
): DisposicionKanban {
  const ancho = Math.min(anchoColumna, ANCHO_MAX_COLUMNA);
  const paginas: string[][] = [];
  const margenes: Record<string, number> = {};
  const idsConIman: string[] = [];

  let actual: ItemColumna[] = [];
  let ocupado = 0; // ancho de la página en curso, sin el hueco final

  const cerrarPagina = () => {
    if (actual.length === 0) return;
    const hueco = Math.max(0, anchoPagina - ocupado);
    actual.forEach((item, i) => {
      margenes[item.id] = i === actual.length - 1 ? hueco : GAP_KANBAN;
    });
    paginas.push(actual.map((i) => i.id));
    idsConIman.push(actual[0].id);
    actual = [];
    ocupado = 0;
  };

  for (const item of items) {
    const anchoItem = anchoDe(item, ancho);
    const ocupadoSiSeAnade = actual.length === 0 ? anchoItem : ocupado + GAP_KANBAN + anchoItem;
    // Una columna sola que no quepa se deja igualmente (si no, bucle infinito).
    if (actual.length > 0 && ocupadoSiSeAnade > anchoPagina) {
      cerrarPagina();
      actual = [item];
      ocupado = anchoItem;
    } else {
      actual.push(item);
      ocupado = ocupadoSiSeAnade;
    }
  }
  cerrarPagina();

  if (paginas.length <= 1) return ajustado(items, ancho);

  // El hueco de la última página se saca del margen y se pinta como elemento
  // propio: ver comentario de `espacioFinal`.
  const ultimaPagina = paginas[paginas.length - 1];
  const ultimoId = ultimaPagina[ultimaPagina.length - 1];
  const espacioFinal = margenes[ultimoId];
  margenes[ultimoId] = 0;

  return {
    modo: "desplazable",
    anchoColumna: ancho,
    paradas: paginas.map((_, i) => i * anchoPagina),
    visiblesPorParada: paginas,
    margenes,
    idsConIman,
    espacioFinal,
  };
}
