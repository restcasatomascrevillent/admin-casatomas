// ============================================================================
// LIBRO DE RESERVAS («Escribir reserva», 10/11/2026, petición del dueño)
// ----------------------------------------------------------------------------
// Una hoja por día: arriba las reservas ya apuntadas, debajo se escribe a mano
// la nueva con el lápiz. «Interpretar» manda el trazo a la Edge Function
// `interpretar-reserva-manuscrita` y la lectura se convierte en campos con el
// normalizador compartido (supabase/functions/_shared/reserva-manuscrita.ts):
// salas reales, año, «2px», «noviempre»… Sin fecha escrita vale la de la hoja.
// Lo interpretado prellena el alta manual de siempre (FormularioReserva).
// ============================================================================
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorFuncion } from "@/hooks/useEnviarNewsletter";
import {
  normalizarReservaManuscrita,
  type EspacioRef,
  type LecturaModelo,
  type ReservaInterpretada,
} from "../../../supabase/functions/_shared/reserva-manuscrita";

export type { ReservaInterpretada };

/** Date local → "yyyy-MM-dd". */
export function claveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "yyyy-MM-dd" → Date local a medianoche (como el calendario del formulario). */
export function diaDeClave(clave: string): Date {
  const [a, m, d] = clave.split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** Pasa hojas: `delta` días desde la hoja abierta. */
export function pasarHoja(clave: string, delta: number): string {
  const d = diaDeClave(clave);
  d.setDate(d.getDate() + delta);
  return claveDia(d);
}

/** Título de la hoja: «Martes 10 de noviembre 2026». */
export function tituloHoja(clave: string): string {
  const t = format(diaDeClave(clave), "EEEE d 'de' MMMM yyyy", { locale: es });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Lo que espera `FormularioReserva` en `datosPreseleccionados` (alta manual). */
export interface DatosAltaManual {
  fecha?: Date;
  hora?: string;
  nombre?: string;
  telefono?: string;
  email?: string;
  numero_comensales?: number;
  notas_cliente?: string;
  espacio_id?: string | null;
  canal: "manual";
}

/** Campos interpretados → formulario de alta. Lo que no se leyó queda vacío. */
export function datosAltaDesdeInterpretada(r: ReservaInterpretada): DatosAltaManual {
  const notas = [r.notas, r.espacio_texto && !r.espacio_id ? `Sala escrita: «${r.espacio_texto}»` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    fecha: r.fecha ? diaDeClave(r.fecha) : undefined,
    hora: r.hora ?? undefined,
    nombre: r.nombre ?? undefined,
    telefono: r.telefono ?? undefined,
    email: r.email ?? undefined,
    numero_comensales: r.comensales ?? undefined,
    notas_cliente: notas || undefined,
    espacio_id: r.espacio_id,
    canal: "manual",
  };
}

/** Manda lo escrito (PNG) a la Edge Function y lo normaliza. Lanza Error con el motivo real. */
export async function interpretarReservaEscrita(
  imagen: string,
  espacios: EspacioRef[],
  fechaPagina: string,
): Promise<ReservaInterpretada> {
  const { data, error } = await supabase.functions.invoke("interpretar-reserva-manuscrita", {
    body: { imagen, espacios: espacios.map((e) => e.nombre), fecha_pagina: fechaPagina },
  });
  if (error) throw new Error(await mensajeErrorFuncion(error, "No se pudo interpretar lo escrito"));
  if (!data?.ok || !data?.lectura) throw new Error(String(data?.error ?? "La IA no ha devuelto datos"));
  return normalizarReservaManuscrita(data.lectura as LecturaModelo, { espacios, fechaPorDefecto: fechaPagina });
}
