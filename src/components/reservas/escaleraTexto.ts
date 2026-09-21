// ============================================================
// TEXTOS Y HELPERS DE LA ESCALERA DE NIVELES — solo para la pantalla
// ============================================================
// Este fichero NO decide comportamiento. Toda la lógica de negocio (qué
// escalón se abre, cómo se normaliza, qué es inválido) vive y se calcula
// SIEMPRE en `supabase/functions/_shared/disponibilidad.ts`, importado
// directamente por `EscaleraTurnoEditor.tsx`. Aquí solo hay:
//   - traducción de los avisos del motor a lenguaje llano para el dueño,
//   - un par de lecturas/formatos cosméticos para la pantalla de edición.
// ============================================================

import type { NivelEscalera } from "../../../supabase/functions/_shared/disponibilidad";
import {
  AVISO_DESAJUSTE_TURNO,
  AVISO_UMBRALES_NO_MONOTONOS,
  AVISO_NIVEL_INVALIDO,
  AVISO_PERIODO_INVALIDO,
  AVISO_PERIODO_SIN_HUECOS,
  AVISO_OCULTAR_ANULADO,
  AVISO_CRUZA_MEDIANOCHE,
  AVISO_SIN_CAPACIDAD,
  AVISO_TOPE_HUECOS,
  AVISO_UMBRAL_FUERA_DE_RANGO,
} from "../../../supabase/functions/_shared/disponibilidad";

/** Límites de la escalera. Copian el CHECK de la migración `20260921000000`. */
export const MIN_NIVELES = 1;
export const MAX_NIVELES = 8;

/**
 * Etiqueta de un nivel por su paso en minutos.
 *
 * Copia deliberada de la función privada `etiquetaNivel` de
 * `disponibilidad.ts` (no está exportada). Es una función de 4 líneas y
 * puramente cosmética: si el motor cambiara esta regla, cambiaría también
 * `etiqueta_nivel` en los huecos calculados, que es lo que de verdad se
 * pinta en la previsualización — esta copia solo se usa para las filas del
 * editor ANTES de calcular nada.
 */
export function etiquetaNivelLocal(minutos: number): string {
  if (minutos === 60) return "hora en punto";
  if (minutos === 30) return "media hora";
  if (minutos === 15) return "cuarto de hora";
  return `cada ${minutos} min`;
}

/** "1 persona" / "35 personas". */
export function formatoPersonas(n: number): string {
  const v = Math.max(0, Math.round(n));
  return `${v} persona${v === 1 ? "" : "s"}`;
}

/**
 * Lee `niveles_escalera` TAL CUAL está guardado, sin normalizar ni
 * corregir nada — para sembrar el editor con los valores exactos que hay
 * en base de datos (incluido si están "mal": desordenados, con umbrales no
 * monótonos, etc.). El comportamiento real de esos valores lo decide
 * SIEMPRE `resolverEscalera`/`normalizarEscalera` del motor; esto es solo
 * para que la pantalla de edición no le reescriba a nadie lo que escribió.
 *
 * Devuelve `null` si no hay nada aprovechable (NULL, vacío, roto) — en ese
 * caso la pantalla ofrece derivar de las columnas antiguas.
 */
export function leerNivelesCrudos(bruto: unknown): NivelEscalera[] | null {
  let valor: unknown = bruto;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return null;
    try {
      valor = JSON.parse(texto);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(valor) || valor.length === 0) return null;

  const niveles: NivelEscalera[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const minutos = Number(obj.minutos);
    const umbral = Number(obj.umbral);
    if (!Number.isFinite(minutos) || minutos <= 0) continue;
    niveles.push({ minutos: Math.round(minutos), umbral: Number.isFinite(umbral) ? umbral : 0 });
  }
  return niveles.length > 0 ? niveles : null;
}

/** Escalera por defecto para un turno nuevo: la que ya usa producción hoy. */
export const NIVELES_POR_DEFECTO: NivelEscalera[] = [
  { minutos: 60, umbral: 0 },
  { minutos: 30, umbral: 70 },
  { minutos: 15, umbral: 85 },
];

/**
 * Traducción de los avisos del motor (`AVISO_*`) a lenguaje llano.
 *
 * El motor los documenta en su cabecera y en los comentarios de la
 * migración; este diccionario es la versión "para el dueño del
 * restaurante" de ese mismo texto. Si aparece un código que no está aquí
 * (no debería, pero por si el motor añade uno nuevo) se muestra el propio
 * código en vez de romper la pantalla.
 */
const TEXTO_AVISOS: Record<string, string> = {
  [AVISO_DESAJUSTE_TURNO]:
    "Este turno pisa la franja 16:00–17:00, donde el sistema tiene dos formas distintas de decidir si una reserva es de comida o de cena. No es grave, pero mejor que ningún turno empiece o termine justo ahí.",
  [AVISO_UMBRALES_NO_MONOTONOS]:
    "Hay un nivel fino con un umbral más bajo que el del nivel más grueso del que depende. Al calcular, se sube automáticamente al umbral del nivel anterior — un escalón nunca se abre antes que el de encima.",
  [AVISO_NIVEL_INVALIDO]:
    "Algún nivel tiene un intervalo en minutos que no es válido (cero, negativo o con decimales) y se ignora al calcular.",
  [AVISO_PERIODO_INVALIDO]:
    "La hora de inicio y la de fin de este turno no son válidas, o el turno dura 0 minutos. Revísalas.",
  [AVISO_PERIODO_SIN_HUECOS]:
    "Con esta configuración el turno no ofrece ninguna hora. Revisa el horario y los niveles.",
  [AVISO_OCULTAR_ANULADO]:
    "\"Ocultar nivel anterior\" se ha desactivado solo para este cálculo: si se aplicara, el turno se quedaría sin ninguna hora visible, y eso nunca se permite.",
  [AVISO_CRUZA_MEDIANOCHE]:
    "Este turno cruza la medianoche (la hora de fin es anterior a la de inicio). Está soportado, es solo para que lo confirmes.",
  [AVISO_SIN_CAPACIDAD]:
    "No hay aforo activo (0 plazas entre los espacios activos), así que ningún umbral puede llegar nunca a su porcentaje. Revisa el aforo en Espacios.",
  [AVISO_TOPE_HUECOS]:
    "Esta configuración generaría demasiadas horas (más de 400) y se ha cortado. Es señal de que algún nivel tiene un intervalo demasiado pequeño para lo que dura el turno.",
  [AVISO_UMBRAL_FUERA_DE_RANGO]:
    "Algún umbral estaba fuera de 0–100% y se ha ajustado al límite más cercano.",
};

export function traducirAviso(codigo: string): string {
  return TEXTO_AVISOS[codigo] ?? `Aviso del motor: ${codigo}`;
}

/**
 * Puntos de ocupación a los que se simula la previsualización.
 *
 * En vez de una rejilla fija (0/25/50/75/100) se construye A PARTIR de los
 * umbrales configurados: justo antes y justo en cada umbral, más 0% y
 * 100%. Así la previsualización enseña exactamente el "antes / después" de
 * cada escalón en vez de puntos arbitrarios que podrían no cruzar ninguno.
 */
export function construirEscenarios(niveles: NivelEscalera[]): number[] {
  const puntos = new Set<number>([0, 100]);
  for (const n of niveles) {
    if (n.umbral <= 0) continue;
    const u = Math.round(Math.min(100, Math.max(0, n.umbral)));
    puntos.add(u);
    puntos.add(Math.max(0, u - 1));
  }
  return Array.from(puntos).sort((a, b) => a - b);
}

/** Fecha fija (un lunes cualquiera) usada solo como ancla para la previsualización. */
export const FECHA_REFERENCIA_PREVIEW = "2026-01-12";
