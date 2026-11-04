/**
 * Días y horas en que la web de Casa Tomás enseña los botones «Menú del día» y
 * «Tapas» (04/11/2026, petición del dueño). Se guarda en
 * configuracion_web.horario_menu_dia_casa_tomas / horario_tapas_casa_tomas
 * (migración 20261104142000) con la forma de `HorarioWeb`; la web lo lee igual
 * (web-casatomas: src/lib/horario-web.ts). NULL = lo de siempre (los valores
 * por defecto de abajo).
 */
export interface HorarioWeb {
  /** Días ISO: 1 = lunes … 7 = domingo. */
  dias: number[];
  /** «HH:MM» de Madrid, o null los dos = todo el día. Si `hasta` < `desde`, cruza la medianoche. */
  desde: string | null;
  hasta: string | null;
}

export type BotonHorario = "menu" | "tapas";

/** Lo que hacía la web antes de poder configurarlo: menú de martes a jueves y tapas los jueves, todo el día. */
export const HORARIO_POR_DEFECTO: Record<BotonHorario, HorarioWeb> = {
  menu: { dias: [2, 3, 4], desde: null, hasta: null },
  tapas: { dias: [4], desde: null, hasta: null },
};

export const DIAS_SEMANA: { dia: number; corto: string; largo: string }[] = [
  { dia: 1, corto: "L", largo: "Lunes" },
  { dia: 2, corto: "M", largo: "Martes" },
  { dia: 3, corto: "X", largo: "Miércoles" },
  { dia: 4, corto: "J", largo: "Jueves" },
  { dia: 5, corto: "V", largo: "Viernes" },
  { dia: 6, corto: "S", largo: "Sábado" },
  { dia: 7, corto: "D", largo: "Domingo" },
];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lee lo guardado en BD; si falta o tiene otra forma, el valor por defecto. */
export function leerHorario(valor: unknown, boton: BotonHorario): HorarioWeb {
  const defecto = HORARIO_POR_DEFECTO[boton];
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return defecto;
  const v = valor as Record<string, unknown>;
  const dias = Array.isArray(v.dias) ? v.dias.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : [];
  if (dias.length === 0) return defecto;
  const desde = typeof v.desde === "string" && HORA.test(v.desde) ? v.desde : null;
  const hasta = typeof v.hasta === "string" && HORA.test(v.hasta) ? v.hasta : null;
  const conHoras = desde !== null && hasta !== null && desde !== hasta;
  return { dias: [...new Set(dias)].sort((a, b) => a - b), desde: conHoras ? desde : null, hasta: conHoras ? hasta : null };
}

/** Por qué no se puede guardar (null = se puede). Mismas reglas que el CHECK de la BD. */
export function errorHorario(h: HorarioWeb): string | null {
  if (h.dias.length === 0) return "Elige al menos un día.";
  if ((h.desde === null) !== (h.hasta === null)) return "Pon la hora de aparecer y la de desaparecer, o ninguna (todo el día).";
  if (h.desde !== null && h.hasta !== null) {
    if (!HORA.test(h.desde) || !HORA.test(h.hasta)) return "Las horas van en formato HH:MM.";
    if (h.desde === h.hasta) return "La hora de aparecer y la de desaparecer no pueden ser la misma.";
  }
  return null;
}

/** Texto corto para el panel: «Martes a jueves · 13:00–16:00». */
export function resumenHorario(h: HorarioWeb): string {
  const nombres = h.dias.map((d) => DIAS_SEMANA[d - 1].largo.toLowerCase());
  const consecutivos = h.dias.length > 2 && h.dias.every((d, i) => i === 0 || d === h.dias[i - 1] + 1);
  let dias: string;
  if (h.dias.length === 7) dias = "Todos los días";
  else if (consecutivos) dias = `${nombres[0]} a ${nombres[nombres.length - 1]}`;
  else if (nombres.length === 1) dias = nombres[0];
  else dias = `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  dias = dias.charAt(0).toUpperCase() + dias.slice(1);
  const horas = h.desde && h.hasta ? `${h.desde}–${h.hasta}${h.hasta < h.desde ? " (del día siguiente)" : ""}` : "todo el día";
  return `${dias} · ${horas}`;
}

export function mismoHorario(a: HorarioWeb, b: HorarioWeb): boolean {
  return a.desde === b.desde && a.hasta === b.hasta && a.dias.join() === b.dias.join();
}
