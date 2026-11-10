// ============================================================================
// AVISOS EN VIVO — detección de lo nuevo (lógica pura, sin I/O)
// ----------------------------------------------------------------------------
// Pedido del dueño (10/11/2026): «hay que mejorar la notificación, que se vea
// más». Con el panel abierto todo el servicio, cuando entra algo que gestionar
// salta un aviso grande, suena y la pestaña lleva la cifra. Esta parte decide
// QUÉ es nuevo a partir de lo que ya leen las consultas existentes:
//   · «Por gestionar» (`useReservasPorGestionar`): reservas pendiente/verificada
//     y solicitudes del asistente sin resolver;
//   · cancelaciones recientes de reservas web/teléfono (las hace el cliente).
// Reglas:
//   · La primera lectura de la sesión NO avisa: es lo que ya había al abrir.
//   · Cada clave se avisa UNA vez por sesión (`avisados`).
//   · Nada de lo dado de alta en el panel (canal `manual`/`presencial`) ni de
//     lo que este panel acaba de cambiar (`esPropio`, cambiosPropios.ts).
// ============================================================================

import type { ItemPorGestionar } from "@/lib/reservas/porGestionar";

/** Canales que solo se dan de alta desde el panel: nunca avisan. */
export const CANALES_DEL_PANEL: ReadonlySet<string> = new Set(["manual", "presencial"]);

export type TipoAlerta = "reserva" | "solicitud" | "cancelacion";

export interface AlertaNueva {
  /** Única por cosa y tipo de aviso: «reserva-<id>», «solicitud-<id>», «cancelacion-<id>». */
  clave: string;
  id: string;
  tipo: TipoAlerta;
  /** «Nueva reserva», «Nueva solicitud: …», «Reserva cancelada por el cliente». */
  titulo: string;
  /** «Nombre · 12/11 21:00 · 4 pers.» */
  texto: string;
  ruta: string;
}

/** Fila de una reserva cancelada que trae la consulta de cancelaciones recientes. */
export interface CancelacionFila {
  id: string;
  nombre: string | null;
  fecha: string | null;
  hora: string | null;
  numero_comensales: number | null;
  canal: string | null;
}

export const RUTA_CANCELADAS = "/reservas?tab=reservas&status=cancelada";

/** «Nombre · 12/11 21:00 · 4 pers.» (sin las partes que falten). */
export function textoAlerta(
  nombre: string | null | undefined,
  fecha: string | null | undefined,
  hora: string | null | undefined,
  personas: number | null | undefined,
): string {
  const partes = [nombre?.trim() || "Sin nombre"];
  const dia = fecha ? fecha.split("-").reverse().slice(0, 2).join("/") : "";
  const cuando = [dia, hora ? String(hora).substring(0, 5) : ""].filter(Boolean).join(" ");
  if (cuando) partes.push(cuando);
  if (personas) partes.push(`${personas} pers.`);
  return partes.join(" · ");
}

export function alertaDeItem(item: ItemPorGestionar): AlertaNueva {
  return {
    clave: item.clave,
    id: item.id,
    tipo: item.tipo,
    titulo: item.tipo === "solicitud" ? `Nueva solicitud: ${item.detalle}` : "Nueva reserva",
    texto: textoAlerta(item.nombre, item.fecha, item.hora, item.personas),
    ruta: item.ruta,
  };
}

export function alertaDeCancelacion(fila: CancelacionFila): AlertaNueva {
  return {
    clave: `cancelacion-${fila.id}`,
    id: fila.id,
    tipo: "cancelacion",
    titulo: "Reserva cancelada por el cliente",
    texto: textoAlerta(fila.nombre, fila.fecha, fila.hora, fila.numero_comensales),
    ruta: RUTA_CANCELADAS,
  };
}

/** ¿Puede avisar? Fuera lo del panel (por canal) y lo que este panel acaba de tocar. */
function avisable(alerta: AlertaNueva, canal: string | null | undefined, esPropio: (id: string) => boolean): boolean {
  if (canal && CANALES_DEL_PANEL.has(canal)) return false;
  return !esPropio(alerta.id);
}

export interface EntradaDeteccion {
  porGestionar: readonly ItemPorGestionar[];
  canceladas: readonly CancelacionFila[];
  /** Claves ya avisadas (o ya presentes al abrir) en esta sesión. No se modifica. */
  avisados: ReadonlySet<string>;
  /** Primera lectura de la sesión: todo pasa a «avisado» sin avisar. */
  primeraVez: boolean;
  esPropio: (id: string) => boolean;
}

/** Lo que hay que avisar ahora y el nuevo conjunto de claves avisadas. */
export function detectarNuevas({ porGestionar, canceladas, avisados, primeraVez, esPropio }: EntradaDeteccion): {
  nuevas: AlertaNueva[];
  avisados: Set<string>;
} {
  const siguiente = new Set(avisados);
  const nuevas: AlertaNueva[] = [];
  const candidatas: { alerta: AlertaNueva; canal: string | null | undefined }[] = [
    ...porGestionar.map((item) => ({ alerta: alertaDeItem(item), canal: item.canal })),
    ...canceladas.map((fila) => ({ alerta: alertaDeCancelacion(fila), canal: fila.canal })),
  ];
  for (const { alerta, canal } of candidatas) {
    if (siguiente.has(alerta.clave)) continue;
    siguiente.add(alerta.clave);
    if (!primeraVez && avisable(alerta, canal, esPropio)) nuevas.push(alerta);
  }
  return { nuevas, avisados: siguiente };
}

/** «(3) Título»: quita la cifra anterior y pone la nueva (ninguna con 0). */
export function tituloConCifra(titulo: string, cifra: number): string {
  const limpio = titulo.replace(/^\(\d+\+?\)\s*/, "");
  if (cifra <= 0) return limpio;
  return `(${cifra > 99 ? "99+" : cifra}) ${limpio}`;
}
