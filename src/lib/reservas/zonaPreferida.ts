// «¿Dentro o fuera?» (dueño, 10/11/2026): «ponme también un seleccionable antes de asignación de mesas de
// dentro y fuera» y, después, «es como no poner nada dentro o fuera, y si es dentro que se pueda elegir
// comedor o salón». Puro, sin I/O.
//
// · `reservas.zona_preferida` (migración 20261122200000): 'dentro' | 'fuera' | NULL (= no se ha dicho nada).
// · Qué sala es «de fuera»: `espacios_reserva.caracteristicas.exterior` (la Terraza ya lo tiene a `true`).
//   Si una sala no trae esa clave, se deduce por el nombre («Terraza…» = fuera). Todo lo demás es «dentro».
// · Se combina con la regla del menú del día (`menuDelDia.ts`): menú → Comedor o Terraza; carta → Salón,
//   Comedor o Terraza. P. ej. menú + dentro → solo Comedor; menú + fuera → Terraza.
// · NO es «Sentar fuera» (`sentarFuera.ts`, Touza): eso es dónde se sentó al llegar, fuera de las salas.

import { salaAdmiteServicio, type ServicioComida } from "./menuDelDia";

export type ZonaPreferida = "dentro" | "fuera";

export const ZONAS_PREFERIDAS: readonly ZonaPreferida[] = ["dentro", "fuera"];

/** Lo que venga de la BD o del formulario → 'dentro' | 'fuera' | null. */
export function normalizarZona(valor: unknown): ZonaPreferida | null {
  return valor === "dentro" || valor === "fuera" ? valor : null;
}

/** «Dentro» / «Fuera» (o null sin zona). */
export function textoZona(zona: unknown): string | null {
  const z = normalizarZona(zona);
  return z === "dentro" ? "Dentro" : z === "fuera" ? "Fuera" : null;
}

/** Lo mínimo de una sala para saber si es de fuera. */
export interface SalaConZona {
  nombre?: string | null;
  /** Ya calculado (p. ej. por `useOcupacionSalasDia`). Manda sobre lo demás. */
  exterior?: boolean | null;
  caracteristicas?: unknown;
}

/**
 * ¿Es una sala de fuera? `exterior` ya calculado; si no, `caracteristicas.exterior` (true/"true" o
 * false/"false"); si no trae esa clave, por el nombre («Terraza»).
 */
export function esSalaExterior(sala: SalaConZona | null | undefined): boolean {
  if (!sala) return false;
  if (typeof sala.exterior === "boolean") return sala.exterior;
  const c = sala.caracteristicas;
  if (c && typeof c === "object" && !Array.isArray(c) && "exterior" in c) {
    const v = (c as Record<string, unknown>).exterior;
    return v === true || v === "true";
  }
  return /terraza/i.test(sala.nombre ?? "");
}

/** ¿Casa la sala con la zona pedida? Sin zona, cualquiera. */
export function salaCasaConZona(sala: SalaConZona | null | undefined, zona: unknown): boolean {
  const z = normalizarZona(zona);
  if (!z) return true;
  return esSalaExterior(sala) === (z === "fuera");
}

export interface OpcionSalaZona<S> {
  sala: S;
  habilitada: boolean;
  /** Por qué no se puede elegir (p. ej. «El menú del día es en Comedor o Terraza»). */
  motivo: string | null;
}

/**
 * Las salas de una zona para la segunda elección del formulario (Dentro → Comedor | Salón…; Fuera →
 * Terraza), en orden: primero las normales y después las privadas (Reservado). Con menú del día o carta,
 * las que no valen salen deshabilitadas con el motivo.
 */
export function opcionesSalaDeZona<S extends SalaConZona & { privada?: boolean | null }>(
  salas: readonly S[],
  zona: ZonaPreferida,
  servicio: ServicioComida | null | undefined,
): OpcionSalaZona<S>[] {
  const deLaZona = salas.filter((s) => salaCasaConZona(s, zona));
  const ordenadas = [...deLaZona.filter((s) => !s.privada), ...deLaZona.filter((s) => !!s.privada)];
  return ordenadas.map((sala) => {
    const vale = salaAdmiteServicio(sala.nombre, servicio ?? null);
    return {
      sala,
      habilitada: vale,
      motivo: vale
        ? null
        : servicio === "menu_del_dia"
          ? "El menú del día es en Comedor o Terraza"
          : "La carta es en Salón, Comedor o Terraza",
    };
  });
}

/** La sala que se pone sola al elegir la zona: la única que se puede elegir (p. ej. Fuera → Terraza). */
export function salaUnicaDeZona<S extends SalaConZona & { id: string; privada?: boolean | null }>(
  salas: readonly S[],
  zona: ZonaPreferida,
  servicio: ServicioComida | null | undefined,
): S | null {
  const validas = opcionesSalaDeZona(salas, zona, servicio).filter((o) => o.habilitada && !o.sala.privada);
  return validas.length === 1 ? validas[0].sala : null;
}

/** Aviso si la sala elegida no es de la zona: «Has dicho Fuera y el Comedor es de dentro». */
export function avisoZonaSala(sala: SalaConZona | null | undefined, zona: unknown): string | null {
  const z = normalizarZona(zona);
  if (!z || !sala || salaCasaConZona(sala, z)) return null;
  return `Has dicho ${z === "fuera" ? "fuera" : "dentro"} y ${sala.nombre ?? "esa sala"} es de ${z === "fuera" ? "dentro" : "fuera"}.`;
}

/**
 * La sala que queda al tocar «Dentro» / «Fuera» en el formulario:
 *   · Sin zona (se ha quitado): la que hubiera, sin tocar.
 *   · La sala que ya tenía casa con la zona y con el menú/carta: se queda.
 *   · Si no, la única que vale (Fuera → Terraza; menú del día + Dentro → Comedor) o ninguna (a elegir).
 */
export function salaAlElegirZona<S extends SalaConZona & { id: string; privada?: boolean | null }>(
  salas: readonly S[],
  zona: ZonaPreferida | null,
  servicio: ServicioComida | null | undefined,
  espacioActual: string | null,
): string | null {
  if (!zona) return espacioActual;
  const actual = espacioActual ? salas.find((s) => s.id === espacioActual) : undefined;
  if (actual && salaCasaConZona(actual, zona) && salaAdmiteServicio(actual.nombre, servicio ?? null)) return actual.id;
  return salaUnicaDeZona(salas, zona, servicio)?.id ?? null;
}

/** Salas en el orden del desplegable «Sala»: primero las de la zona elegida (sin zona, como vienen). */
export function ordenarSalasPorZona<S extends SalaConZona>(salas: readonly S[], zona: unknown): S[] {
  if (!normalizarZona(zona)) return [...salas];
  return [...salas.filter((s) => salaCasaConZona(s, zona)), ...salas.filter((s) => !salaCasaConZona(s, zona))];
}
