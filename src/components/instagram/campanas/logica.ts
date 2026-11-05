/**
 * Lógica pura de la pantalla «Campañas» (sin React ni Supabase): textos de
 * fechas, posiciones en la línea de tiempo y parámetros de «Proponer de
 * nuevo». Las fechas son "AAAA-MM-DD" del calendario de Madrid.
 */
import { DIAS_CORTOS, diaSemana, hoyMadrid, sumarDias } from "@/components/instagram/programar/logica";
import type { CampanaInstagram, PeticionCampana, PiezaCampanaIA } from "./api";

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «lun 9 nov». */
export function textoDia(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  if (!m || !d) return dia;
  return `${DIAS_CORTOS[diaSemana(dia)]} ${d} ${MESES_CORTOS[m - 1]}`;
}

/** «9 – 29 nov» o «16 nov – 13 dic». */
export function textoRango(desde: string, hasta: string): string {
  const [, m1, d1] = desde.split("-").map(Number);
  const [, m2, d2] = hasta.split("-").map(Number);
  if (!m1 || !m2) return `${desde} – ${hasta}`;
  return m1 === m2 ? `${d1} – ${d2} ${MESES_CORTOS[m2 - 1]}` : `${d1} ${MESES_CORTOS[m1 - 1]} – ${d2} ${MESES_CORTOS[m2 - 1]}`;
}

function aDias(dia: string): number {
  return Math.round(Date.parse(`${dia}T00:00:00Z`) / 86_400_000);
}

/** Días entre dos fechas (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  return aDias(hasta) - aDias(desde);
}

/** Posición (0-100 %) de una fecha en la línea de tiempo de la campaña. */
export function posicionEnRiel(fecha: string, desde: string, hasta: string): number {
  const total = Math.max(diasEntre(desde, hasta), 1);
  return Math.min(100, Math.max(0, (diasEntre(desde, fecha) / total) * 100));
}

/** «2 semanas», «3 semanas»… */
export function textoDuracion(desde: string, hasta: string): string {
  const semanas = Math.max(1, Math.round((diasEntre(desde, hasta) + 1) / 7));
  return `${semanas} ${semanas === 1 ? "semana" : "semanas"}`;
}

/** Piezas agrupadas por fase (las que apuntan a una fase que no existe van a la primera). */
export function piezasPorFase(piezas: readonly PiezaCampanaIA[], fases: number): Array<Array<{ pieza: PiezaCampanaIA; indice: number }>> {
  const grupos = Array.from({ length: Math.max(fases, 1) }, () => [] as Array<{ pieza: PiezaCampanaIA; indice: number }>);
  piezas.forEach((pieza, indice) => {
    const f = pieza.fase >= 0 && pieza.fase < grupos.length ? pieza.fase : 0;
    grupos[f].push({ pieza, indice });
  });
  return grupos;
}

/** Lo mismo que se pidió, para «Proponer de nuevo» (si la fecha de inicio ya pasó, desde mañana). */
export function peticionDeNuevo(c: CampanaInstagram, ahora: Date = new Date()): PeticionCampana {
  const manana = sumarDias(hoyMadrid(ahora), 1);
  const semanas = Math.min(4, Math.max(2, Math.round((diasEntre(c.desde, c.hasta) + 1) / 7)));
  const piezas = c.propuesta.piezas.length || semanas * 3;
  return {
    marca: c.marca,
    desde: c.desde >= manana ? c.desde : manana,
    semanas,
    piezasPorSemana: Math.min(5, Math.max(1, Math.ceil(piezas / semanas))),
    objetivo: c.peticion ?? undefined,
  };
}
