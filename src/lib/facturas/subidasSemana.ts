// ============================================================================
//  Archivos subidos en la última semana (14/11/2026)
// ----------------------------------------------------------------------------
//  «Cargar» enseña un calendario de 7 días (hoy y los 6 anteriores) con cuántos
//  archivos se subieron cada día; al tocar un día, la lista con el NOMBRE DEL
//  ARCHIVO tal y como se subió (no el proveedor ni el número de la factura).
//  Cada archivo subido es un trabajo de lectura (`ocr_trabajos`): una foto, un
//  PDF o un grupo de fotos unidas como un documento.
// ============================================================================

export const DIAS_CALENDARIO = 7;

export interface ArchivoSubido {
  id: string;
  nombre: string;
  /** ISO (timestamptz). */
  subido: string;
  estado: string;
  facturaId: number | null;
}

export interface DiaSubidas {
  /** AAAA-MM-DD (hora local). */
  clave: string;
  fecha: Date;
  esHoy: boolean;
  archivos: ArchivoSubido[];
}

const dosCifras = (n: number) => String(n).padStart(2, "0");

/** AAAA-MM-DD en hora local del navegador (el panel se usa en España). */
export const claveDia = (d: Date): string => `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;

/** Medianoche local del primer día del calendario (hoy − 6). */
export function inicioSemana(hoy: Date = new Date()): Date {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  d.setDate(d.getDate() - (DIAS_CALENDARIO - 1));
  return d;
}

/** Los 7 días (el más antiguo primero, hoy el último), cada uno con sus archivos (el más reciente primero). */
export function agruparPorDia(archivos: ArchivoSubido[], hoy: Date = new Date()): DiaSubidas[] {
  const inicio = inicioSemana(hoy);
  const dias: DiaSubidas[] = [];
  const porClave = new Map<string, DiaSubidas>();
  for (let i = 0; i < DIAS_CALENDARIO; i++) {
    const fecha = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const dia: DiaSubidas = { clave: claveDia(fecha), fecha, esHoy: i === DIAS_CALENDARIO - 1, archivos: [] };
    dias.push(dia);
    porClave.set(dia.clave, dia);
  }
  for (const a of archivos) {
    const t = new Date(a.subido);
    if (Number.isNaN(t.getTime())) continue;
    porClave.get(claveDia(t))?.archivos.push(a);
  }
  for (const d of dias) d.archivos.sort((x, y) => Date.parse(y.subido) - Date.parse(x.subido));
  return dias;
}

/** Estado del trabajo en palabras sencillas. */
export function textoEstado(estado: string): { texto: string; tono: "ok" | "aviso" | "error" | "neutro" } {
  switch (estado) {
    case "completado":
      return { texto: "Leído", tono: "ok" };
    case "duplicado":
      return { texto: "Ya estaba subido", tono: "aviso" };
    case "fallido":
      return { texto: "No se pudo leer", tono: "error" };
    case "cancelado":
      return { texto: "Cancelado", tono: "neutro" };
    default:
      return { texto: "Se está leyendo", tono: "neutro" };
  }
}
