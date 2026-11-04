import { compararOrden, type ValorOrden } from "@/lib/orden-carta";
import { origenVinoClaro, type OrigenVino } from "@/lib/origen-vino";
import {
  categoriaCorta,
  esCategoriaOrigenPendiente,
  ETIQUETA_ORIGEN_POR_CONFIRMAR,
  ETIQUETA_TIPO_VINO,
  NOMBRE_TIPO_VINO,
  TIPOS_VINO,
  tipoVino,
  type TipoVino,
} from "@/lib/tipos-vino";

/**
 * Filtro de Gestor Web › Carta › Vinos con las píldoras de la carta de la web
 * (04/11/2026): fila por tipo (Todos · Tintos · Blancos…) y, con un tipo
 * elegido, fila por denominación (Todas · Ribera del Duero · Rioja…), cada una
 * con su contador. Además, «Origen por confirmar» junta los vinos que no se
 * pueden publicar hasta completar su origen, para corregirlos.
 *
 * Valor del filtro (texto):
 *   "todos" · "sin-origen" · "tipo:<tinto|blanco|…>" · "categoria:<categoría exacta>"
 */
export type FiltroVinos = string;

export const FILTRO_TODOS: FiltroVinos = "todos";
export const FILTRO_SIN_ORIGEN: FiltroVinos = "sin-origen";
export const filtroTipo = (tipo: TipoVino): FiltroVinos => `tipo:${tipo}`;
export const filtroCategoria = (categoria: string): FiltroVinos => `categoria:${categoria}`;

/** Categoría exacta elegida (fila de denominaciones) o null. */
export function categoriaDelFiltro(filtro: FiltroVinos): string | null {
  return filtro.startsWith("categoria:") ? filtro.slice("categoria:".length) : null;
}

/** Tipo elegido (directamente o por la denominación) o null. */
export function tipoDelFiltro(filtro: FiltroVinos): TipoVino | null {
  const categoria = categoriaDelFiltro(filtro);
  if (categoria !== null) return tipoVino(categoria);
  const tipo = filtro.startsWith("tipo:") ? filtro.slice("tipo:".length) : "";
  return (TIPOS_VINO as readonly string[]).includes(tipo) ? (tipo as TipoVino) : null;
}

type VinoFiltrable = OrigenVino & { categoria?: string | null };

export function filtrarVinos<T extends VinoFiltrable>(vinos: readonly T[], filtro: FiltroVinos): T[] {
  if (filtro === FILTRO_SIN_ORIGEN) return vinos.filter((v) => !origenVinoClaro(v));
  const categoria = categoriaDelFiltro(filtro);
  if (categoria !== null) return vinos.filter((v) => v.categoria === categoria);
  const tipo = tipoDelFiltro(filtro);
  if (tipo) return vinos.filter((v) => tipoVino(v.categoria) === tipo);
  return [...vinos];
}

/**
 * Con varias categorías a la vez (Todos, un tipo, «Origen por confirmar») se
 * agrupan como en la carta: por tipo (tintos, blancos, espumosos, rosados), por
 * categoría y, dentro, por su orden.
 */
export function ordenarVinosPorCategoria<T extends { categoria?: string | null; orden?: ValorOrden }>(vinos: readonly T[]): T[] {
  return vinos
    .map((vino, indice) => ({ vino, indice }))
    .sort(
      (a, b) =>
        TIPOS_VINO.indexOf(tipoVino(a.vino.categoria)) - TIPOS_VINO.indexOf(tipoVino(b.vino.categoria)) ||
        (a.vino.categoria ?? "").localeCompare(b.vino.categoria ?? "", "es", { sensitivity: "base" }) ||
        compararOrden(a.vino.orden, b.vino.orden) ||
        a.indice - b.indice,
    )
    .map(({ vino }) => vino);
}

export interface OpcionFiltroVino {
  valor: FiltroVinos;
  /** Texto de la píldora. */
  etiqueta: string;
  /** Nombre completo (título y nombre accesible) si es distinto. */
  nombreAccesible?: string;
  cantidad: number;
  /** Se pinta en ámbar: vinos que hay que corregir. */
  aviso?: boolean;
}

/**
 * Fila de tipos: Todos · Tintos · Blancos · Espumosos · Rosados · Otros ·
 * Origen por confirmar (este, solo si hay alguno o está elegido).
 */
export function opcionesTipoVino(vinos: readonly VinoFiltrable[], seleccionado?: FiltroVinos): OpcionFiltroVino[] {
  const cantidades = new Map<TipoVino, number>();
  let sinOrigen = 0;
  for (const vino of vinos) {
    const tipo = tipoVino(vino.categoria);
    cantidades.set(tipo, (cantidades.get(tipo) ?? 0) + 1);
    if (!origenVinoClaro(vino)) sinOrigen++;
  }
  // Como en la web: «Rosados» y «Otros» solo si hay alguno.
  const tipos = TIPOS_VINO.filter((tipo) => (tipo !== "rosado" && tipo !== "otro") || cantidades.get(tipo));
  return [
    { valor: FILTRO_TODOS, etiqueta: "Todos", cantidad: vinos.length },
    ...tipos.map((tipo) => ({
      valor: filtroTipo(tipo),
      etiqueta: ETIQUETA_TIPO_VINO[tipo],
      nombreAccesible: NOMBRE_TIPO_VINO[tipo],
      cantidad: cantidades.get(tipo) ?? 0,
    })),
    ...(sinOrigen > 0 || seleccionado === FILTRO_SIN_ORIGEN
      ? [
          {
            valor: FILTRO_SIN_ORIGEN,
            etiqueta: ETIQUETA_ORIGEN_POR_CONFIRMAR,
            nombreAccesible: "Vinos sin origen claro: no se pueden publicar hasta completarlo",
            cantidad: sinOrigen,
            aviso: true,
          },
        ]
      : []),
  ];
}

/**
 * Fila de denominaciones de un tipo: «Todas» y una por categoría, con las de
 * origen por confirmar delante (para corregirlas) y el resto por nombre. La
 * categoría elegida sale siempre, aunque la búsqueda la deje a 0.
 */
export function opcionesDenominacionVino(
  vinos: readonly VinoFiltrable[],
  tipo: TipoVino,
  seleccionado: FiltroVinos,
): OpcionFiltroVino[] {
  const cantidades = new Map<string, number>();
  let total = 0;
  for (const vino of vinos) {
    if (!vino.categoria || tipoVino(vino.categoria) !== tipo) continue;
    total++;
    cantidades.set(vino.categoria, (cantidades.get(vino.categoria) ?? 0) + 1);
  }
  const elegida = categoriaDelFiltro(seleccionado);
  if (elegida && tipoVino(elegida) === tipo && !cantidades.has(elegida)) cantidades.set(elegida, 0);
  const denominaciones = Array.from(cantidades, ([categoria, cantidad]) => ({
    valor: filtroCategoria(categoria),
    etiqueta: categoriaCorta(categoria),
    nombreAccesible: categoria,
    cantidad,
    aviso: esCategoriaOrigenPendiente(categoria) || undefined,
  })).sort(
    (a, b) => Number(Boolean(b.aviso)) - Number(Boolean(a.aviso)) || a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }),
  );
  return [
    { valor: filtroTipo(tipo), etiqueta: "Todas", nombreAccesible: `Todos los ${NOMBRE_TIPO_VINO[tipo].toLocaleLowerCase("es")}`, cantidad: total },
    ...denominaciones,
  ];
}
