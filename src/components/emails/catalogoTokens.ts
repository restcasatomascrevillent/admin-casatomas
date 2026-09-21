// ============================================================================
// CATÁLOGO DE TOKENS + DATOS DE EJEMPLO — para la ayuda de variables y la
// vista previa en vivo del editor de plantillas.
// ----------------------------------------------------------------------------
// Los 7 tokens y su significado están fijados por el contrato en
// supabase/functions/emails-reserva/plantillas.ts (cabecera, punto 3). Están
// disponibles en los 5 tipos de plantilla aunque `hora_solicitada` y
// `espacio_solicitado` solo tengan sentido real en 'propuesta' (el propio
// contrato lo advierte: usarlos fuera de 'propuesta' es válido pero
// probablemente no lo que se quiere).
// ============================================================================

import type { DatosReservaParaCorreo, TipoPlantilla } from "./motorPlantilla";

export interface TokenInfo {
  /** Clave tal y como se escribe dentro de {{ }} */
  clave: string;
  etiqueta: string;
  descripcion: string;
  /** Si se define, el token solo tiene sentido real en estos tipos (sigue siendo válido en el resto, ver contrato). */
  soloRelevanteEn?: TipoPlantilla[];
}

export const TOKENS_DISPONIBLES: TokenInfo[] = [
  { clave: "nombre", etiqueta: "Nombre", descripcion: "Nombre del cliente que hizo la reserva." },
  { clave: "fecha", etiqueta: "Fecha", descripcion: 'Fecha de la reserva, ya formateada. Ejemplo: "16 de marzo de 2026".' },
  { clave: "hora", etiqueta: "Hora", descripcion: 'Hora VIGENTE de la reserva (la ofrecida, si hubo contraoferta). Ejemplo: "21:00".' },
  { clave: "comensales", etiqueta: "Comensales", descripcion: 'Número de comensales, ya formateado. Ejemplo: "4 personas".' },
  { clave: "espacio", etiqueta: "Espacio", descripcion: "Espacio VIGENTE asignado (Comedor, Terraza...). Vacío si todavía no hay ninguno asignado." },
  {
    clave: "hora_solicitada",
    etiqueta: "Hora solicitada",
    descripcion: "Hora tal y como la pidió el cliente al crear la reserva. Solo aporta algo en «Propuesta»: en el resto de correos coincide con {{hora}}.",
    soloRelevanteEn: ["propuesta"],
  },
  {
    clave: "espacio_solicitado",
    etiqueta: "Espacio solicitado",
    descripcion: "Espacio tal y como lo pidió el cliente al crear la reserva. Solo aporta algo en «Propuesta».",
    soloRelevanteEn: ["propuesta"],
  },
];

export const ETIQUETA_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida: "Solicitud recibida",
  propuesta: "Propuesta / contraoferta",
  confirmada: "Confirmada",
  rechazada: "Rechazada",
  recordatorio: "Recordatorio",
};

export const DESCRIPCION_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida: "Se envía en cuanto llega una reserva nueva, antes de que nadie la revise.",
  propuesta: "Se envía cuando el restaurante ofrece una hora o espacio distinto al pedido y el cliente tiene que confirmar o rechazar.",
  confirmada: "Se envía en cuanto la reserva queda confirmada (directamente o tras aceptar una propuesta).",
  rechazada: "Se envía cuando la solicitud no se puede atender.",
  recordatorio: "Se envía automáticamente 2 días antes de la reserva confirmada.",
};

export interface FlagBloque {
  clave: string;
  etiqueta: string;
  descripcion: string;
  porDefecto: true;
}

/** Los 3 interruptores editoriales del contrato (punto 4 de la cabecera de plantillas.ts). */
export const BLOQUES_DISPONIBLES: FlagBloque[] = [
  {
    clave: "mostrar_tabla_detalles",
    etiqueta: "Tabla de detalles",
    descripcion: "Fecha, hora, comensales y espacio en una tabla destacada.",
    porDefecto: true,
  },
  {
    clave: "mostrar_boton_secundario",
    etiqueta: "Botón secundario",
    descripcion: "El segundo botón (p.ej. «No puedo, cancelar»), si esta plantilla tiene texto para él.",
    porDefecto: true,
  },
  {
    clave: "mostrar_pie_contacto",
    etiqueta: "Pie de contacto",
    descripcion: "La franja oscura final con el texto del pie.",
    porDefecto: true,
  },
];

/** Lee un flag de `bloques` con el mismo criterio que el backend (leerBloque en plantillas.ts). */
export function leerBloque(bloques: Record<string, unknown> | null | undefined, clave: string, porDefecto = true): boolean {
  if (!bloques || !(clave in bloques)) return porDefecto;
  return bloques[clave] !== false;
}

/**
 * Datos de ejemplo realistas para la vista previa. Para 'propuesta' se fuerza
 * una diferencia entre lo solicitado y lo ofrecido para que se vea también el
 * bloque de comparación automático (hayContraoferta) — es el único tipo donde
 * ese bloque puede aparecer en un caso real.
 */
export function datosEjemploPara(tipo: TipoPlantilla): DatosReservaParaCorreo {
  const base = {
    nombre: "Laura Martínez",
    fecha: "2026-03-16",
    comensales: 4,
    botonPrincipalUrl: "#vista-previa-boton-principal",
    botonSecundarioUrl: "#vista-previa-boton-secundario",
  };

  if (tipo === "propuesta") {
    return {
      ...base,
      hora: "21:30",
      espacio: "Terraza",
      horaSolicitada: "21:00",
      espacioSolicitado: "Comedor",
    };
  }

  return {
    ...base,
    hora: "21:00",
    espacio: "Comedor",
    horaSolicitada: "21:00",
    espacioSolicitado: "Comedor",
  };
}
