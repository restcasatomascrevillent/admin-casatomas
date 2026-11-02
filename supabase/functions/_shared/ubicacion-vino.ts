// ============================================================================
// Ubicación de un vino leído de una foto — lógica pura (testeable con vitest)
// ----------------------------------------------------------------------------
// La web (mapa de /carta/vinos) coloca cada vino con el texto de
// `ubicacion_region`. «Galicia» o «Castilla y León» (comunidad autónoma) no
// dicen dónde está el vino; «Val do Salnés, Pontevedra» sí. Aquí se decide
// qué región se propone al formulario, sin inventar: solo se prefiere un dato
// más concreto cuando lo da la etiqueta o una ficha de la bodega.
// ============================================================================

export function normalizarUbicacion(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Comunidades autónomas españolas (y «España»): demasiado amplias para situar un vino.
const GENERICAS = new Set([
  "espana", "andalucia", "aragon", "asturias", "principado de asturias", "baleares", "islas baleares", "illes balears",
  "canarias", "islas canarias", "cantabria", "castilla y leon", "castilla-la mancha", "castilla la mancha",
  "cataluna", "catalunya", "comunidad valenciana", "comunitat valenciana", "extremadura", "galicia", "la rioja",
  "madrid", "comunidad de madrid", "murcia", "region de murcia", "navarra", "comunidad foral de navarra",
  "pais vasco", "euskadi",
]);

/** ¿La región es una comunidad autónoma, el país o está vacía (no sitúa el vino)? */
export function regionEsGenerica(region: string | null | undefined, pais?: string | null): boolean {
  const r = normalizarUbicacion(region);
  if (!r) return true;
  return r === normalizarUbicacion(pais) || GENERICAS.has(r);
}

/**
 * Región que se propone al formulario: la de la etiqueta, salvo que sea
 * genérica (o falte) y la ficha de la bodega dé una más concreta.
 */
export function elegirRegion(
  lectura: string | null | undefined,
  ficha: string | null | undefined,
  pais?: string | null,
): string | null {
  const leida = lectura?.trim() || null;
  const fichada = ficha?.trim() || null;
  if (!fichada) return leida;
  if (!leida) return fichada;
  return regionEsGenerica(leida, pais) && !regionEsGenerica(fichada, pais) ? fichada : leida;
}

export interface UbicacionCarta {
  denominacion_origen: string | null;
  ubicacion_region: string | null;
  ubicacion_pais?: string | null;
}

/**
 * Ejemplos reales «región [D.O.]» de la carta para que el modelo imite el
 * formato «Localidad, Provincia»: solo regiones concretas, una por D.O. y por
 * ronda, hasta `max`.
 */
export function ejemplosUbicacion(carta: UbicacionCarta[], max = 10): string[] {
  const porDO = new Map<string, string[]>();
  for (const v of carta) {
    const region = v.ubicacion_region?.trim();
    if (!region || !v.denominacion_origen || regionEsGenerica(region, v.ubicacion_pais) || !region.includes(",")) continue;
    const lista = porDO.get(v.denominacion_origen) ?? [];
    if (!lista.includes(region)) lista.push(region);
    porDO.set(v.denominacion_origen, lista);
  }
  const salida: string[] = [];
  for (let ronda = 0; salida.length < max; ronda++) {
    let alguno = false;
    for (const [dO, regiones] of porDO) {
      if (ronda >= regiones.length) continue;
      alguno = true;
      salida.push(`${regiones[ronda]} [${dO}]`);
      if (salida.length >= max) break;
    }
    if (!alguno) break;
  }
  return salida;
}
