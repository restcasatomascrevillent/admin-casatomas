/**
 * Copia del cálculo de gastos de gestión de casa-tomas-story
 * (`supabase/functions/_shared/cheques-regalo/gastos-gestion.ts`), que es el
 * que cobra de verdad. Aquí solo sirve para enseñar ejemplos al configurarlos:
 * si cambia allí, cambia aquí.
 *
 * total = (importe + fijo) / (1 − porcentaje / 100), redondeado al céntimo
 * hacia arriba, para que tras la comisión al restaurante le quede el cheque.
 */
export interface ConfigGastosGestion {
  activos: boolean;
  porcentaje: number;
  fijo_eur: number;
}

/** Mismos límites que los CHECK de `plantilla_cheques_regalo`. */
export const LIMITES_GASTOS = { porcentajeMax: 10, fijoMax: 5 } as const;

export function configGastosValida(c: Pick<ConfigGastosGestion, "porcentaje" | "fijo_eur">): boolean {
  return Number.isFinite(c.porcentaje) && Number.isFinite(c.fijo_eur)
    && c.porcentaje >= 0 && c.porcentaje < LIMITES_GASTOS.porcentajeMax
    && c.fijo_eur >= 0 && c.fijo_eur <= LIMITES_GASTOS.fijoMax;
}

export function calcularGastosGestion(importeEur: number, config: ConfigGastosGestion): number {
  if (!config.activos || !configGastosValida(config) || !Number.isFinite(importeEur) || importeEur <= 0) return 0;
  const importe = Math.round(importeEur * 100);
  const fijo = Math.round(config.fijo_eur * 100);
  const total = Math.ceil((importe + fijo) / (1 - config.porcentaje / 100) - 1e-9);
  return (total - importe) / 100;
}
