// ============================================================================
// CATÁLOGO DE TOKENS + DATOS DE EJEMPLO — para la ayuda de variables y la
// vista previa en vivo del editor de plantillas.
// ----------------------------------------------------------------------------
// Los tokens y su significado están fijados por el contrato en
// supabase/functions/emails-reserva/plantillas.ts (cabecera, punto 3). Están
// disponibles en los 5 tipos de plantilla aunque `hora_solicitada` solo tenga
// sentido real en 'propuesta' (el propio contrato lo advierte: usarlo fuera de
// 'propuesta' es válido pero probablemente no lo que se quiere).
//
// {{espacio}} y {{espacio_solicitado}} YA NO SE OFRECEN en este catálogo
// (2026-09-29). Siguen siendo tokens válidos —`construirTokens` los conoce en
// los dos motores— pero desde el punto 7 del contrato se sustituyen SIEMPRE
// por cadena vacía: la sala es información interna y no sale en el correo del
// cliente. Ofrecerlos en el selector era una trampa: el dueño insertaba una
// variable que no pinta nada. Comprobado en la BD del proyecto el 2026-09-29
// que ninguna de las 5 plantillas vigentes los usa, así que quitarlos del
// selector no cambia ningún correo. Revertir la decisión = devolverles su
// valor en los dos `construirTokens` y volver a listarlos aquí.
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
  { clave: "hora", etiqueta: "Hora", descripcion: 'Hora VIGENTE de la reserva: la que se le confirma al cliente, que puede no ser la que pidió. Ejemplo: "21:00".' },
  { clave: "comensales", etiqueta: "Comensales", descripcion: 'Número de comensales, ya formateado. Ejemplo: "4 personas".' },
  {
    clave: "hora_solicitada",
    etiqueta: "Hora solicitada",
    descripcion: "Hora tal y como la pidió el cliente al crear la reserva. Solo aporta algo en «Propuesta»: en el resto de correos coincide con {{hora}}.",
    soloRelevanteEn: ["propuesta"],
  },
  {
    clave: "negocio",
    etiqueta: "Negocio",
    descripcion:
      'Nombre del negocio de la reserva: "Casa Tomás" (desde el 1 de octubre de 2026 Touza no admite reservas; las que se hicieron antes dicen "Touza"). Úsalo en vez de escribir el nombre a mano.',
  },
];

export const ETIQUETA_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida: "Solicitud recibida",
  propuesta: "Propuesta",
  confirmada: "Confirmada",
  rechazada: "Rechazada",
  recordatorio: "Recordatorio",
  reserva_modificada: "Reserva modificada",
};

// OJO al editar estos textos: son lo único que le dice al dueño CUÁNDO sale
// cada correo. Si describen un envío que ya no ocurre, el panel miente.
// `solicitud_recibida` es el caso vivo: desde el 2026-09-28
// (`CANALES_SIN_SOLICITUD_RECIBIDA = ["web"]` en plantillas.ts) el canal web
// ya no lo manda — el cliente web recibía dos correos seguidos y el primero
// sobraba, porque el propio formulario ya le dice en pantalla que se le
// contactará. El tipo NO está muerto: sigue saliendo por teléfono y en altas
// manuales, así que la plantilla se sigue pudiendo editar.
export const DESCRIPCION_TIPO: Record<TipoPlantilla, string> = {
  solicitud_recibida:
    "El canal WEB ya no envía este correo: quien reserva por la web recibe directamente «Propuesta» y nada más. Sigue enviándose cuando la reserva nace pendiente por otra vía — sobre todo por teléfono, cuando un cliente acepta una propuesta desde el correo y su reserva queda pendiente de revisión — y en altas manuales que se pasen a pendiente.",
  propuesta:
    "Se envía en cuanto alguien revisa la reserva y la deja lista para que el cliente la confirme o la rechace. Es el PRIMER y ÚNICO correo que recibe quien reserva por la web. Si la hora ofrecida no es la que pidió, el correo añade solo él un bloque «Pediste / Te ofrecemos» con las dos horas.",
  confirmada: "Se envía en cuanto la reserva queda confirmada (directamente o tras aceptar una propuesta).",
  rechazada: "Se envía cuando la solicitud no se puede atender.",
  recordatorio: "Se envía automáticamente 2 días antes de la reserva confirmada.",
  reserva_modificada:
    "Se envía cuando alguien cambia el día, la hora o los comensales de una reserva desde «Editar» con la casilla «Avisar al cliente del cambio» marcada (pendiente, verificada o confirmada; nunca si ya pasó, sin email o en lista negra). El correo añade solo un bloque «Cambios en tu reserva» con lo de antes y lo de ahora (solo lo que cambió) y una frase según el estado. Los botones solo salen si la reserva aún está pendiente de que el cliente la confirme: llevan un enlace nuevo «Confirma tu reserva». Si ya está confirmada, solo informa.",
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
    // Tres filas, no cuatro: la fila "Espacio" salió del correo el 2026-09-28.
    descripcion: "Fecha, hora y comensales en una tabla destacada.",
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
 * una diferencia de HORA entre lo solicitado y lo ofrecido para que se vea
 * también el bloque de comparación automático (hayContraoferta) — es el único
 * tipo donde ese bloque puede aparecer en un caso real.
 *
 * `espacio` / `espacioSolicitado` se siguen rellenando A PROPÓSITO aunque el
 * correo ya no los pinte: así la vista previa demuestra justo lo que hay que
 * demostrar — que una reserva CON sala asignada, e incluso con cambio de sala
 * (Comedor -> Terraza en 'propuesta'), no enseña la sala por ningún lado.
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

  // 'reserva_modificada': cambian los tres datos para ver el bloque entero, y la
  // reserva está 'verificada' (el caso con más piezas: frase + botones con el
  // enlace nuevo). Sin horaSolicitada: el aviso de cambio no lleva contraoferta.
  if (tipo === "reserva_modificada") {
    return {
      ...base,
      hora: "21:30",
      espacio: "Comedor",
      horaSolicitada: null,
      espacioSolicitado: null,
      modificacion: { antes: { fecha: "2026-03-14", hora: "21:00", comensales: 2 }, estado: "verificada" },
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
