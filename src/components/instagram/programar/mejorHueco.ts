/**
 * «Mejor hueco» para programar (evaluación de diseño C2, 05/11/2026): el día
 * y la hora que se proponen al abrir «Programar», a partir de «Qué funciona»
 * (RPC instagram_que_funciona, ejes «dia» y «franja»). Sin datos claros, un
 * valor razonable: mañana a las 13:00 de Madrid (como hasta ahora).
 *
 * Pura (sin React): probada en __tests__/mejorHueco.test.ts.
 */
import type { QueFunciona } from "@/components/instagram/metricas/tipos";
import { DIAS_CORTOS, diaSemana, hoyMadrid, madridAUtc, MARGEN_MINIMO_MIN, sumarDias, utcAMadrid } from "./logica";

/** Nombres de día de la RPC (es-ES, en minúscula) → índice lunes = 0. */
const DIAS: Record<string, number> = { lunes: 0, martes: 1, "miércoles": 2, miercoles: 2, jueves: 3, viernes: 4, "sábado": 5, sabado: 5, domingo: 6 };

const HORA_POR_DEFECTO = "13:00";

export interface MejorHueco {
  /** Día (AAAA-MM-DD, Madrid). */
  fecha: string;
  /** Hora (HH:MM, Madrid). */
  hora: string;
  instante: Date;
  /** «jue 12 nov · 13:00». */
  texto: string;
  /** Por qué se propone; null si es el valor por defecto. */
  motivo: string | null;
}

/** Hora de una franja «12-14» → «13:00» (en medio, redondeada a la hora). */
export function horaDeFranja(clave: string): string | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(clave.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a >= 0 && a <= 23 && b > a && b <= 24)) return null;
  const h = Math.min(23, Math.floor((a + b) / 2));
  return `${String(h).padStart(2, "0")}:00`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

export function textoHueco(fecha: string, hora: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  return `${DIAS_CORTOS[diaSemana(fecha)]} ${d} ${MESES_CORTOS[m - 1]} · ${hora}`;
}

/**
 * El primer instante válido (≥ 10 min desde ahora) en el mejor día de la
 * semana y a la mejor hora. `desde` (AAAA-MM-DD) fuerza el día de partida
 * (p. ej. «Nueva pieza este día» del calendario): ese día si aún se llega, a la mejor hora.
 */
export function mejorHueco(qf: QueFunciona | null | undefined, ahora: Date = new Date(), desde?: string | null): MejorHueco {
  const claras = qf?.suficiente ? qf.conclusiones.filter((c) => c.estado === "mejor" && c.clave) : [];
  const diaMejor = claras.find((c) => c.eje === "dia")?.clave?.toLocaleLowerCase("es") ?? null;
  const franja = claras.find((c) => c.eje === "franja")?.clave ?? null;
  const horaMejor = franja ? horaDeFranja(franja) : null;
  const hora = horaMejor ?? HORA_POR_DEFECTO;
  const indiceDia = diaMejor !== null && diaMejor in DIAS ? DIAS[diaMejor] : null;

  const valido = (fecha: string) => {
    const i = madridAUtc(fecha, hora);
    return i && i.getTime() > ahora.getTime() + MARGEN_MINIMO_MIN * 60_000 ? i : null;
  };

  const hoy = hoyMadrid(ahora);
  let fecha: string;
  if (desde && desde >= hoy) {
    fecha = valido(desde) ? desde : sumarDias(desde, 1);
  } else if (indiceDia !== null) {
    // El próximo «jueves» (hoy incluido si aún se llega a la hora).
    fecha = hoy;
    for (let i = 0; i < 8; i++) {
      const f = sumarDias(hoy, i);
      if (diaSemana(f) === indiceDia && valido(f)) {
        fecha = f;
        break;
      }
    }
    if (!valido(fecha)) fecha = sumarDias(hoy, 1);
  } else {
    fecha = sumarDias(hoy, 1);
  }
  const instante = valido(fecha) ?? (madridAUtc(fecha, hora) as Date);

  const partes: string[] = [];
  if (indiceDia !== null && !desde) partes.push(`los ${diaMejor === "sábado" || diaMejor === "sabado" ? "sábados" : diaMejor === "domingo" ? "domingos" : diaMejor} funcionan mejor`);
  if (horaMejor && franja) partes.push(`la franja de ${franja.replace("-", " a ")} h funciona mejor`);
  const motivo = partes.length ? `Según «Qué funciona»: ${partes.join(" y ")}.` : null;
  const { fecha: f, hora: h } = utcAMadrid(instante);
  return { fecha: f, hora: h, instante, texto: textoHueco(f, h), motivo };
}
