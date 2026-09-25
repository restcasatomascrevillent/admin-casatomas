// ============================================================================
// DISPOSICIÓN HORIZONTAL DEL KANBAN DE SERVICIO (pestaña "Hoy")
// ----------------------------------------------------------------------------
// Problema que resuelve (petición del dueño, 2026-09-25: "que el kanban no
// colapse, que no quede cortado como ahora"): las columnas tenían un ancho
// FIJO (`w-[270px]`) dentro de un `overflow-x-auto`. Cuando la suma de anchos
// pasaba del ancho disponible, el navegador cortaba la última columna por la
// mitad justo en el borde del scroll: se veía medio título y media barra de
// aforo. Técnicamente era scroll normal, pero visualmente parecía un fallo.
//
// La regla de diseño es: NUNCA se ve una columna partida. Para poder
// garantizarlo hace falta que el contenido esté troceado en PÁGINAS que miden
// exactamente lo que mide el viewport del scroll. Eso es lo que calcula este
// módulo (puro, sin DOM: solo aritmética, así se testea sin navegador).
//
// Dos modos:
//   · "ajustado"    → todas las columnas caben; se reparten el ancho disponible
//                     (entre ANCHO_MIN y ANCHO_MAX). Ni scroll ni recortes.
//   · "desplazable" → no caben. Se calculan las PARADAS: los únicos
//                     desplazamientos en los que el scroll puede quedarse. En
//                     cada parada se ven K columnas ENTERAS y la siguiente
//                     empieza justo después del borde, nunca a caballo.
//
// Cómo se consigue esa garantía, según haya carriles plegados o no:
//   · Sin carriles (el caso normal): todas las columnas miden lo mismo, así que
//     se les da el ancho exacto para que K llenen el viewport
//     (K·ancho + (K−1)·hueco = ancho disponible). Las paradas van de columna en
//     columna: se avanza de una en una y siempre se ven K enteras.
//   · Con carriles (el usuario plegó alguna a mano): los anchos ya no son
//     uniformes, así que se trocea en PÁGINAS que miden exactamente el viewport
//     y el sobrante de cada una se vuelve hueco vacío tras su última columna.
//     El borde del scroll cae entonces en ese hueco, jamás sobre una columna.
//
// Por qué márgenes y no `gap`: el hueco de relleno del final de una página tiene
// que ser distinto en cada una, y con `gap` uniforme no se puede. Cada columna
// lleva su propio `margin-right` (ver `margenes`), lo que hace que las paradas
// sean exactas y no dependan de cómo redondee el navegador.
// ============================================================================

/** Separación entre columnas, en px. Debe coincidir con lo que pinte el CSS. */
export const GAP_KANBAN = 16;

/**
 * Ancho mínimo de una columna para que siga siendo legible: caben el nombre
 * del espacio, el contador, las dos barras de aforo ("15/50 pax") y una
 * tarjeta de reserva con hora + comensales sin que nada se parta.
 */
export const ANCHO_MIN_COLUMNA = 224;

/** Ancho máximo: por encima de esto las tarjetas quedan ridículamente anchas. */
export const ANCHO_MAX_COLUMNA = 320;

/** Ancho de una columna plegada (el carril vertical con el nombre girado). */
export const ANCHO_COLUMNA_PLEGADA = 52;

export interface ItemColumna {
  id: string;
  /** Plegada = carril estrecho de ANCHO_COLUMNA_PLEGADA en vez de columna. */
  plegada: boolean;
}

export interface DisposicionKanban {
  modo: "ajustado" | "desplazable";
  /** Ancho en px de cada columna NO plegada. */
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

  // Todo plegado: los carriles son estrechos, casi siempre caben de sobra.
  if (expandidas === 0) {
    if (anchoCarriles + gaps <= anchoDisponible) return ajustado(items, ANCHO_MIN_COLUMNA);
    return paginar(items, ANCHO_MIN_COLUMNA, anchoDisponible);
  }

  // ¿Caben todas repartiéndose el hueco? Es el caso normal en escritorio.
  const anchoSiCaben = (anchoDisponible - anchoCarriles - gaps) / expandidas;
  if (anchoSiCaben >= ANCHO_MIN_COLUMNA) {
    return ajustado(items, Math.floor(Math.min(anchoSiCaben, ANCHO_MAX_COLUMNA)));
  }

  // No caben. El ancho de columna es el que hace que un número entero de ellas
  // llene el viewport. En pantallas ridículamente estrechas (< ~240px) se
  // permite bajar del mínimo antes que dejar una columna más ancha que la
  // pantalla, que sí se vería cortada.
  const anchoMinimo = Math.min(ANCHO_MIN_COLUMNA, Math.max(140, anchoDisponible - GAP_KANBAN));
  const porVista = Math.min(items.length, columnasQueCaben(anchoDisponible, anchoMinimo));

  // Con carriles plegados los anchos no son uniformes y la aritmética de
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
    anchoColumna,
    paradas: [0],
    visiblesPorParada: [ids],
    margenes,
    idsConIman: ids.slice(0, 1),
    espacioFinal: 0,
  };
}

/**
 * Columnas del mismo ancho: se avanza de UNA en una. En la parada `i` se ven
 * enteras las columnas `i … i+porVista-1`, porque `porVista` columnas llenan
 * exactamente el viewport y la siguiente arranca un hueco más allá del borde.
 */
function desplazarPorColumna(
  items: readonly ItemColumna[],
  anchoDisponible: number,
  porVista: number,
): DisposicionKanban {
  const n = items.length;

  // El ancho sale de repartir el viewport entre las columnas que caben:
  //     porVista·ancho + (porVista−1)·hueco ≈ anchoDisponible
  // El paso de una parada a la siguiente es ancho+hueco, así que la columna
  // que viene detrás de las visibles arranca en porVista·(ancho+hueco), que
  // queda MÁS ALLÁ del borde: ni asoma. Se redondea hacia abajo para trabajar
  // con enteros (el sobrante es menor que `porVista`, siempre menos que un
  // hueco, así que la garantía aguanta) y que no haya polvo de coma flotante.
  //
  // Aquí NO se aplica ANCHO_MAX_COLUMNA a propósito: recortar el ancho dejaría
  // el paso más corto que el viewport y volvería a asomar media columna. En un
  // móvil, con una sola columna por vista, el ancho es el de la pantalla.
  const anchoColumna = Math.floor((anchoDisponible - GAP_KANBAN * (porVista - 1)) / porVista);
  if (porVista >= n) return ajustado(items, Math.min(anchoColumna, ANCHO_MAX_COLUMNA));

  const paso = anchoColumna + GAP_KANBAN;
  const margenes: Record<string, number> = {};
  items.forEach((item, i) => {
    margenes[item.id] = i === n - 1 ? 0 : GAP_KANBAN;
  });

  const paradas = Array.from({ length: n - porVista + 1 }, (_, i) => i * paso);
  const visiblesPorParada = paradas.map((_, i) => items.slice(i, i + porVista).map((x) => x.id));

  // Relleno para que la última parada sea EXACTAMENTE el desplazamiento máximo:
  // si sobra, el scroll puede irse un pelo más allá y asoma una rendija de la
  // columna anterior; si falta, la última parada no se alcanza y asoma media
  // columna. Al ser todo enteros, la cuenta cuadra al píxel.
  const anchoContenido = n * anchoColumna + (n - 1) * GAP_KANBAN;
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
    const ancho = anchoDe(item, anchoColumna);
    const ocupadoSiSeAnade = actual.length === 0 ? ancho : ocupado + GAP_KANBAN + ancho;
    // Una columna sola que no quepa se deja igualmente (si no, bucle infinito).
    if (actual.length > 0 && ocupadoSiSeAnade > anchoPagina) {
      cerrarPagina();
      actual = [item];
      ocupado = ancho;
    } else {
      actual.push(item);
      ocupado = ocupadoSiSeAnade;
    }
  }
  cerrarPagina();

  if (paginas.length <= 1) return ajustado(items, anchoColumna);

  // El hueco de la última página se saca del margen y se pinta como elemento
  // propio: ver comentario de `espacioFinal`.
  const ultimaPagina = paginas[paginas.length - 1];
  const ultimoId = ultimaPagina[ultimaPagina.length - 1];
  const espacioFinal = margenes[ultimoId];
  margenes[ultimoId] = 0;

  return {
    modo: "desplazable",
    anchoColumna,
    paradas: paginas.map((_, i) => i * anchoPagina),
    visiblesPorParada: paginas,
    margenes,
    idsConIman,
    espacioFinal,
  };
}

/**
 * Columnas vacías que conviene plegar para que el resto quepa sin paginar.
 * Se pliegan de derecha a izquierda (las de más a la derecha son las que se
 * salían) y solo las justas: plegar de más esconde información sin motivo.
 * Devuelve el conjunto de ids a plegar; vacío si no hace falta o si ni
 * plegándolas todas se consigue que quepan (en ese caso se pagina, que es un
 * gesto más honesto que esconder columnas y aun así no caber).
 */
export function columnasAPlegarParaQueQuepan(
  items: readonly ItemColumna[],
  vacias: ReadonlySet<string>,
  anchoDisponible: number,
): Set<string> {
  const nada = new Set<string>();
  if (items.length === 0 || !Number.isFinite(anchoDisponible) || anchoDisponible <= 0) return nada;
  if (calcularDisposicion(items, anchoDisponible).modo === "ajustado") return nada;

  const candidatas = items.filter((i) => !i.plegada && vacias.has(i.id)).map((i) => i.id);
  const plegar = new Set<string>();
  for (let i = candidatas.length - 1; i >= 0; i--) {
    plegar.add(candidatas[i]);
    const simulacion = items.map((item) => ({ ...item, plegada: item.plegada || plegar.has(item.id) }));
    if (calcularDisposicion(simulacion, anchoDisponible).modo === "ajustado") return plegar;
  }
  return nada;
}
