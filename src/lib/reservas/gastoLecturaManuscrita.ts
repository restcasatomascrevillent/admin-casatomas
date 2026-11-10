// Gasto de leer las reservas escritas a mano (libro de reservas, 10/11/2026, petición del dueño:
// «monitorizar el gasto de las fotos de IA para analizar bien lo de las reservas escritas a mano»).
// Cada «Interpretar» llama a la Edge Function `interpretar-reserva-manuscrita`, que apunta su consumo
// en `ia_uso` (funcion = FUNCION_LECTURA_MANUSCRITA). Aquí solo se resume: sin React, se prueba suelto.

export const FUNCION_LECTURA_MANUSCRITA = "interpretar-reserva-manuscrita";

export interface FilaGastoFuncion {
  funcion: string;
  llamadas: number;
  peticiones: number;
  errores: number;
  coste_usd: number | null;
}

export interface ResumenLecturaManuscrita {
  /** Veces que se ha pulsado «Interpretar» (peticiones a la función). */
  lecturas: number;
  errores: number;
  usd: number;
  eur: number;
  /** Coste medio de una lectura en euros; null sin lecturas. */
  eurPorLectura: number | null;
}

export function resumirLecturaManuscrita(filas: FilaGastoFuncion[] | undefined, eurPorUsd: number): ResumenLecturaManuscrita {
  const f = (filas ?? []).find((x) => x.funcion === FUNCION_LECTURA_MANUSCRITA);
  const lecturas = Math.max(0, Number(f?.peticiones) || Number(f?.llamadas) || 0);
  const usd = Math.max(0, Number(f?.coste_usd) || 0);
  const eur = usd * eurPorUsd;
  return {
    lecturas,
    errores: Math.max(0, Number(f?.errores) || 0),
    usd,
    eur,
    eurPorLectura: lecturas > 0 ? eur / lecturas : null,
  };
}

/** «0,004 €» con los decimales que hagan falta para que no salga 0,00 en importes de céntimos. */
export function formatearEurPequeno(eur: number): string {
  const decimales = eur > 0 && eur < 0.1 ? 4 : 2;
  return `${eur.toLocaleString("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} €`;
}
