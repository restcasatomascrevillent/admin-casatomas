/**
 * Tienda de vinos (Panel › Tienda): lógica sin pantalla, para probarla aparte.
 *
 * La tienda es un ESCAPARATE (decisión del dueño, 03/11/2026: «no puede
 * permitir pago por internet, solo vista»): la web enseña los vinos con su
 * precio de carta y el de tienda, y se compran en el restaurante. El panel
 * decide qué vinos salen, el descuento y los textos (migración
 * 20261103150000_tienda_vinos).
 *
 * Contrato (el mismo en la base de datos, el panel y la web):
 *  - Sale un vino si `activado = true`, `restaurante IS TRUE` (el filtro de la
 *    carta de vinos de la web), `precio_eur > 0` y no está en
 *    `configuracion_tienda.vinos_excluidos`.
 *  - Precio de tienda = `round(precio_eur * (1 - descuento_pct / 100), 2)`.
 *    Se hace con céntimos enteros: en coma flotante `3.35 * 0.7` da
 *    2,3449999…, que saldría 2,34 € aquí y 2,35 € en Postgres y en la web. Los
 *    casos compartidos con la prueba de Postgres están en
 *    `src/lib/__tests__/fixtures/tienda-precios.json`.
 */
import type { VersionApp } from "@/lib/version";

export const LIMITES_TIENDA = {
  descuentoMin: 0,
  descuentoMax: 90,
  texto: 500,
} as const;

export interface ConfiguracionTienda {
  activa: boolean;
  descuento_pct: number;
  vinos_excluidos: string[];
  aviso: string | null;
  /** Cómo comprar en el restaurante (horario, dónde preguntar…). */
  recogida: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Valores de la semilla de la migración. */
export const CONFIGURACION_TIENDA_POR_DEFECTO: ConfiguracionTienda = {
  activa: true,
  descuento_pct: 30,
  vinos_excluidos: [],
  aviso: null,
  recogida: null,
  updated_at: null,
  updated_by: null,
};

/** Una fila de `configuracion_tienda` (numeric llega como texto o número) a tipos del panel. */
export function normalizarConfiguracionTienda(fila: Record<string, unknown> | null | undefined): ConfiguracionTienda {
  if (!fila) return { ...CONFIGURACION_TIENDA_POR_DEFECTO };
  const num = (v: unknown, defecto: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : defecto;
  };
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    activa: fila.activa !== false,
    descuento_pct: num(fila.descuento_pct, CONFIGURACION_TIENDA_POR_DEFECTO.descuento_pct),
    vinos_excluidos: Array.isArray(fila.vinos_excluidos) ? fila.vinos_excluidos.map(String) : [],
    aviso: texto(fila.aviso),
    recogida: texto(fila.recogida),
    updated_at: typeof fila.updated_at === "string" ? fila.updated_at : null,
    updated_by: typeof fila.updated_by === "string" ? fila.updated_by : null,
  };
}

/**
 * Precio de tienda en céntimos: como `round(numeric, 2)` de Postgres (mitad
 * hacia arriba), con enteros. `precio_eur` lleva como mucho dos decimales
 * (CHECK de Vinos: 0–9.999,99) y `descuento_pct` también (numeric(5,2)).
 */
export function centimosTienda(precioCarta: number, descuentoPct: number): number {
  const centimos = Math.round(precioCarta * 100);
  const factor = 10000 - Math.round(descuentoPct * 100);
  return Math.floor((centimos * factor + 5000) / 10000);
}

/** Precio de tienda en euros, o `null` si el vino no tiene precio de carta. */
export function precioTienda(precioCarta: number | null | undefined, descuentoPct: number): number | null {
  if (precioCarta == null || !Number.isFinite(precioCarta) || precioCarta <= 0) return null;
  return centimosTienda(precioCarta, descuentoPct) / 100;
}

/** Lo que la tienda mira de cada vino. */
export interface VinoTiendaPanel {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  activado: boolean | null;
  restaurante: boolean | null;
}

export type MotivoNoVendible = "desactivado" | "fuera_de_carta" | "sin_precio" | "excluido";

export const TEXTO_MOTIVO_NO_VENDIBLE: Record<MotivoNoVendible, string> = {
  desactivado: "Desactivado en la carta",
  fuera_de_carta: "No está en la carta de Casa Tomás",
  sin_precio: "Sin precio de carta",
  excluido: "Quitado de la tienda",
};

/**
 * Por qué un vino NO sale en la tienda (`null` = sale). El orden importa: lo
 * que se arregla en la carta va antes que el interruptor.
 */
export function motivoNoVendible(vino: VinoTiendaPanel, config: Pick<ConfiguracionTienda, "vinos_excluidos">): MotivoNoVendible | null {
  if (vino.activado !== true) return "desactivado";
  if (vino.restaurante !== true) return "fuera_de_carta";
  // Exactamente el criterio de la web: precio_eur > 0 (no se mira el precio ya rebajado).
  if (!(typeof vino.precio_eur === "number" && vino.precio_eur > 0)) return "sin_precio";
  if (config.vinos_excluidos.includes(vino.id)) return "excluido";
  return null;
}

/** ¿Se puede poner a la venta con el interruptor? (Lo demás se arregla en Gestor Web › Carta.) */
export const puedeVenderse = (vino: VinoTiendaPanel, config: Pick<ConfiguracionTienda, "descuento_pct" | "vinos_excluidos">) => {
  const motivo = motivoNoVendible(vino, config);
  return motivo === null || motivo === "excluido";
};

const FORMATO_EURO = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const euro = (n: number | string | null | undefined) => FORMATO_EURO.format(Number(n ?? 0));

/** «30 %», «27,5 %». */
export const porcentaje = (n: number) => `${String(n).replace(".", ",")} %`;

// ─── Enlace a la tienda de la web ───────────────────────────────────────────

/** Webs públicas de cada entorno (docs/PROCESO-DE-CAMBIOS.md › Entornos). */
export const URL_WEB_PRODUCCION = "https://web-casatomas.vercel.app";
export const URL_WEB_DEMO = "https://web-casatomas-git-staging-casa-tomas.vercel.app";

/**
 * `/tienda` de la web del mismo entorno que el panel: producción enlaza a
 * producción y la demo (o un preview, o local) a la demo. `VITE_WEB_URL`, si
 * existe, manda (p. ej. un dominio propio).
 */
export function urlTiendaWeb(entorno: VersionApp["entorno"], urlConfigurada?: string | null): string {
  const base = (urlConfigurada?.trim() || (entorno === "produccion" ? URL_WEB_PRODUCCION : URL_WEB_DEMO)).replace(/\/+$/, "");
  return `${base}/tienda`;
}

// ─── Ajustes ────────────────────────────────────────────────────────────────

export interface FormularioAjustesTienda {
  activa: boolean;
  /** Texto del campo (admite coma decimal). */
  descuento: string;
  aviso: string;
  recogida: string;
}

export type CambiosAjustesTienda = Pick<ConfiguracionTienda, "activa" | "descuento_pct" | "aviso" | "recogida">;

export const formularioDesdeConfiguracion = (c: ConfiguracionTienda): FormularioAjustesTienda => ({
  activa: c.activa,
  descuento: String(c.descuento_pct).replace(".", ","),
  aviso: c.aviso ?? "",
  recogida: c.recogida ?? "",
});

/**
 * Valida el formulario de Ajustes con las mismas reglas que los CHECK de la
 * tabla. Devuelve los errores por campo o los cambios listos para guardar.
 */
export function validarAjustes(f: FormularioAjustesTienda):
  | { ok: true; cambios: CambiosAjustesTienda }
  | { ok: false; errores: Partial<Record<keyof FormularioAjustesTienda, string>> } {
  const errores: Partial<Record<keyof FormularioAjustesTienda, string>> = {};
  // numeric(5,2): como mucho dos decimales.
  const textoDescuento = f.descuento.trim();
  const descuento = /^\d{1,3}([.,]\d{1,2})?$/.test(textoDescuento) ? Number(textoDescuento.replace(",", ".")) : null;
  if (descuento === null) {
    errores.descuento = "Escribe un número, con dos decimales como mucho (p. ej. 30 o 27,5).";
  } else if (descuento < LIMITES_TIENDA.descuentoMin || descuento > LIMITES_TIENDA.descuentoMax) {
    errores.descuento = `Pon un descuento entre ${LIMITES_TIENDA.descuentoMin} y ${LIMITES_TIENDA.descuentoMax} %.`;
  }
  if (f.aviso.trim().length > LIMITES_TIENDA.texto) errores.aviso = `Como mucho ${LIMITES_TIENDA.texto} caracteres.`;
  if (f.recogida.trim().length > LIMITES_TIENDA.texto) errores.recogida = `Como mucho ${LIMITES_TIENDA.texto} caracteres.`;
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return {
    ok: true,
    cambios: {
      activa: f.activa,
      descuento_pct: Math.round((descuento as number) * 100) / 100,
      aviso: f.aviso.trim() || null,
      recogida: f.recogida.trim() || null,
    },
  };
}

/** Ejemplos de la vista previa de Ajustes: unos cuantos precios de carta reales (o redondos si no hay). */
export function ejemplosPrecio(vinos: readonly VinoTiendaPanel[], cuantos = 3): number[] {
  const precios = [...new Set(vinos.map((v) => v.precio_eur).filter((p): p is number => typeof p === "number" && p > 0))].sort((a, b) => a - b);
  if (precios.length === 0) return [12, 24, 45].slice(0, cuantos);
  if (precios.length <= cuantos) return precios;
  // Uno barato, uno mediano y uno caro.
  return Array.from({ length: cuantos }, (_, i) => precios[Math.round(((i + 0.5) / cuantos) * (precios.length - 1))]);
}
