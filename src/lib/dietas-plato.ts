/**
 * Casilla «Vegetariano» de los platos (04/11/2026, dueño: «sí que tienen que haber productos
 * vegetarianos»). Se guarda en Platos.etiquetas_dieteticas (migración 20261104151000): un array con
 * 'vegetariano' y/o 'vegano', o NULL = sin confirmar. La web (web-casatomas, src/lib/filtros-carta.ts)
 * solo enseña en el filtro «Vegetariano» los platos que lo llevan; un plato vegano cuenta también.
 */
export type EtiquetaDietetica = "vegetariano" | "vegano";

function leer(valor: unknown): EtiquetaDietetica[] {
  const lista = Array.isArray(valor) ? valor : typeof valor === "string" && valor.trim().startsWith("[") ? safeParse(valor) : [];
  return lista.filter((e): e is EtiquetaDietetica => e === "vegetariano" || e === "vegano");
}

function safeParse(texto: string): unknown[] {
  try {
    const v = JSON.parse(texto);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** ¿El restaurante lo tiene marcado como vegetariano (o vegano)? */
export function esVegetariano(etiquetas: unknown): boolean {
  return leer(etiquetas).length > 0;
}

/**
 * Lo que hay que guardar al marcar o desmarcar la casilla. Marcarla añade 'vegetariano' (y conserva
 * 'vegano' si estaba); desmarcarla quita las dos (un vegano también es vegetariano). Sin ninguna,
 * NULL. Devuelve `{}` si no cambia nada: así el panel no manda la columna mientras no se toque (sigue
 * guardando aunque la migración aún no esté aplicada).
 */
export function cambioVegetariano(etiquetas: unknown, vegetariano: boolean): { etiquetas_dieteticas?: EtiquetaDietetica[] | null } {
  if (esVegetariano(etiquetas) === vegetariano) return {};
  if (!vegetariano) return { etiquetas_dieteticas: null };
  const actuales = leer(etiquetas);
  return { etiquetas_dieteticas: actuales.includes("vegetariano") ? actuales : ["vegetariano", ...actuales] };
}

/**
 * «Apto para celíacos» y «Apto sin lactosa» decididos a mano (10/11/2026; columnas
 * Platos.apto_celiacos / apto_sin_lactosa, migración 20261122093000). NULL = automático: lo
 * deciden los alérgenos.
 */
export type AptitudManual = boolean | null;

/** Lee lo guardado: solo true/false cuentan como decidido a mano; lo demás es automático. */
export function leerAptitudManual(valor: unknown): AptitudManual {
  return typeof valor === "boolean" ? valor : null;
}

/**
 * Valor que deja el interruptor al pulsarlo: si coincide con lo que dirían los alérgenos, vuelve
 * a automático (NULL) para que siga a los alérgenos si cambian; si no, queda decidido a mano.
 */
export function aptitudTrasPulsar(nuevo: boolean, automatico: boolean): AptitudManual {
  return nuevo === automatico ? null : nuevo;
}

/**
 * Lo que hay que guardar de las dos aptitudes a mano. Solo manda la columna que cambia: sin la
 * migración aplicada (columna ausente) el plato se sigue guardando mientras no se toque.
 */
export function cambiosAptitudesManuales(
  anterior: { apto_celiacos?: unknown; apto_sin_lactosa?: unknown } | null | undefined,
  nuevo: { apto_celiacos: AptitudManual; apto_sin_lactosa: AptitudManual },
): { apto_celiacos?: AptitudManual; apto_sin_lactosa?: AptitudManual } {
  const cambios: { apto_celiacos?: AptitudManual; apto_sin_lactosa?: AptitudManual } = {};
  if (leerAptitudManual(anterior?.apto_celiacos) !== nuevo.apto_celiacos) cambios.apto_celiacos = nuevo.apto_celiacos;
  if (leerAptitudManual(anterior?.apto_sin_lactosa) !== nuevo.apto_sin_lactosa) cambios.apto_sin_lactosa = nuevo.apto_sin_lactosa;
  return cambios;
}

/** ¿La BD ya tiene las columnas? select('*') no las trae antes de aplicar la migración. */
export function aptitudesManualesDisponibles(plato: object | null | undefined): boolean {
  return !!plato && "apto_celiacos" in plato;
}
