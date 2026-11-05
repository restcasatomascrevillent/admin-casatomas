/**
 * Respuesta de la Edge Function instagram-metricas («leer»). El contrato está
 * en supabase/functions/instagram-metricas/leer.ts y resumen.ts.
 */

export interface Comparacion {
  actual: number | null;
  anterior: number | null;
  /** % frente al periodo anterior (1 decimal); null si no hay base. */
  variacion: number | null;
}

export interface ComparacionSeguidores extends Comparacion {
  cambio: number | null;
}

export type ClaveSuma = "alcance" | "visualizaciones" | "interacciones" | "cuentasInteraccion" | "visitasPerfil" | "toquesEnlaces";

export interface ResumenPeriodo {
  dias: number;
  desde: string;
  hasta: string;
  diasConDatos: number;
  diasConDatosAnterior: number;
  metricas: Record<ClaveSuma, Comparacion> & { seguidores: ComparacionSeguidores };
}

export interface PuntoSerie {
  fecha: string;
  alcance: number | null;
  seguidores: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export interface Publicacion {
  mediaId: string;
  piezaId: string | null;
  marca: string | null;
  plantilla: string | null;
  formato: string | null;
  foto: string | null;
  tipoFoto: string | null;
  tipoMedio: string | null;
  producto: string | null;
  publicadoAt: string | null;
  permalink: string | null;
  miniaturaUrl: string | null;
  caption: string | null;
  fechaCaptura: string;
  alcance: number | null;
  meGusta: number | null;
  comentarios: number | null;
  guardados: number | null;
  compartidos: number | null;
  visualizaciones: number | null;
  interacciones: number | null;
}

export interface Captura {
  inicio: string;
  fin: string | null;
  ok: boolean;
  origen: string;
  errorTipo: string | null;
  error: string | null;
  avisos: string[];
}

/** Cuenta de Instagram distinta y las marcas que publican en ella. */
export interface CuentaMetricas {
  igUserId: string;
  marcas: string[];
}

export interface DatosMetricas {
  igUserId: string | null;
  /** Cuentas distintas (hoy, una para las dos marcas). Falta si la función es anterior. */
  cuentas?: CuentaMetricas[];
  hoy: string;
  ultimoDia: string | null;
  resumen: { d7: ResumenPeriodo; d28: ResumenPeriodo } | null;
  serie: PuntoSerie[];
  publicaciones: Publicacion[];
  ultimaCaptura: Captura | null;
  ultimaCorrecta: Captura | null;
}

export interface ResultadoCaptura {
  fechaCaptura: string;
  dias: string[];
  publicaciones: number;
  avisos: string[];
}
