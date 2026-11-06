/**
 * Secciones en las que «Ver» no sirve por sí solo: sin «Puede editar» no se entra.
 *
 * «Reservas · Configuración» (06/11/2026, decisión del dueño): con solo «Ver» no se ve la pestaña
 * (Reservas.tsx exige «Ver» y «Puede editar»). Por eso en Usuarios esa fila solo ofrece el
 * interruptor de «Puede editar», que activa los dos a la vez (editar implica ver), y al quitarlo
 * se quitan los dos. Los visores de permisos la enseñan igual: «Ver» = «Editar».
 */
export const SECCIONES_SOLO_EDICION: ReadonlySet<string> = new Set(["reservas_configuracion"]);

/** ¿En esta sección «Ver» va con «Puede editar» (no hay interruptor propio de «Ver»)? */
export const esSeccionSoloEdicion = (sectionKey: string): boolean => SECCIONES_SOLO_EDICION.has(sectionKey);
