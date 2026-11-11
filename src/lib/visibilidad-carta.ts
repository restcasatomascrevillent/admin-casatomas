// Filtro «Visibilidad» del Gestor web › Carta (11/11/2026, petición del dueño: «el desplegable de
// visibilidad no funciona, pones que salgan solo los visibles y no cambia»).
//
// Antes «Visibles» miraba solo `restaurante` (en qué carta va), y en Platos está a `true` en todos:
// lo que de verdad oculta un plato es `activado`. Ahora la regla es LA MISMA que la web (CartaPlatos,
// CartaVinos y CartaBebidas de web-casatomas: `.eq("activado", true).is("restaurante", true)`): se
// ve si está activado Y marcado para esa carta.

export type FiltroVisibilidad = "todos" | "activos" | "inactivos_rest" | "activos_touza" | "inactivos_touza";

export interface ItemConVisibilidad {
  activado?: boolean | null;
  restaurante?: boolean | null;
  touza?: boolean | null;
}

/** ¿Sale en la carta de Casa Tomás de la web? */
export const visibleEnCasaTomas = (i: ItemConVisibilidad): boolean => i.activado === true && i.restaurante === true;
/** ¿Sale en la carta de Touza? */
export const visibleEnTouza = (i: ItemConVisibilidad): boolean => i.activado === true && i.touza === true;

export function filtrarPorVisibilidad<T extends ItemConVisibilidad>(items: T[], filtro: FiltroVisibilidad): T[] {
  switch (filtro) {
    case "activos":
      return items.filter(visibleEnCasaTomas);
    case "inactivos_rest":
      return items.filter((i) => !visibleEnCasaTomas(i));
    case "activos_touza":
      return items.filter(visibleEnTouza);
    case "inactivos_touza":
      return items.filter((i) => !visibleEnTouza(i));
    default:
      return items;
  }
}
