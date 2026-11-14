/** Peticiones y Tickets: validación del formulario, filtros y orden de la lista (sin React, para probarlo solo). */
import type { Peticion } from "@/lib/peticiones";
import {
  ESTADOS_ABIERTOS,
  MAX_CAPTURA_BYTES,
  MAX_DESCRIPCION,
  MAX_TITULO,
  MIN_DESCRIPCION,
  MIN_TITULO,
  PESO_PRIORIDAD,
  type EstadoPeticion,
  type PrioridadPeticion,
} from "../../../supabase/functions/_shared/peticiones";

export type ErroresPeticion = Partial<Record<"titulo" | "modulo" | "descripcion" | "captura", string>>;

/** Lo que se comprueba antes de enviar (los mismos límites que la base de datos). */
export function validarPeticion(d: { titulo: string; modulo: string; descripcion: string; captura?: File | null }): ErroresPeticion {
  const e: ErroresPeticion = {};
  const titulo = d.titulo.trim();
  const descripcion = d.descripcion.trim();
  if (!titulo) e.titulo = "Escribe un título corto.";
  else if (titulo.length < MIN_TITULO) e.titulo = `El título necesita al menos ${MIN_TITULO} letras.`;
  else if (titulo.length > MAX_TITULO) e.titulo = `Máximo ${MAX_TITULO} caracteres.`;
  if (!d.modulo) e.modulo = "Elige a qué parte del panel afecta (o «Otro»).";
  if (!descripcion) e.descripcion = "Cuéntanos qué pasa o qué necesitas.";
  else if (descripcion.length < MIN_DESCRIPCION) e.descripcion = `Escribe un poco más (al menos ${MIN_DESCRIPCION} caracteres).`;
  else if (descripcion.length > MAX_DESCRIPCION) e.descripcion = `Máximo ${MAX_DESCRIPCION} caracteres.`;
  if (d.captura && !d.captura.type.startsWith("image/")) e.captura = "La captura tiene que ser una imagen.";
  // Una foto grande se reduce antes de subirla; solo se rechaza lo desproporcionado.
  else if (d.captura && d.captura.size > MAX_CAPTURA_BYTES * 6) e.captura = "La imagen es demasiado grande.";
  return e;
}

export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export type FiltroEstado = "abiertas" | "todas" | EstadoPeticion;
export interface FiltrosTickets {
  estado: FiltroEstado;
  prioridad: "todas" | PrioridadPeticion;
  modulo: "todos" | string;
  /** Nombre o email de quien la envió ("todos"). */
  usuario: "todos" | string;
}
export const FILTROS_INICIALES: FiltrosTickets = { estado: "abiertas", prioridad: "todas", modulo: "todos", usuario: "todos" };

export const autorDe = (p: Pick<Peticion, "creado_por_nombre" | "creado_por_email">) => p.creado_por_nombre ?? p.creado_por_email ?? "Usuario dado de baja";

/** Filtra y ordena: abiertas primero, luego por prioridad (urgente arriba) y lo más nuevo primero. */
export function filtrarTickets(tickets: Peticion[], f: FiltrosTickets): Peticion[] {
  return tickets
    .filter((t) => {
      if (f.estado === "abiertas" ? !ESTADOS_ABIERTOS.includes(t.estado) : f.estado !== "todas" && t.estado !== f.estado) return false;
      if (f.prioridad !== "todas" && t.prioridad !== f.prioridad) return false;
      if (f.modulo !== "todos" && t.modulo !== f.modulo) return false;
      if (f.usuario !== "todos" && autorDe(t) !== f.usuario) return false;
      return true;
    })
    .sort((a, b) => {
      const abierta = Number(ESTADOS_ABIERTOS.includes(b.estado)) - Number(ESTADOS_ABIERTOS.includes(a.estado));
      if (abierta) return abierta;
      const prioridad = (PESO_PRIORIDAD[b.prioridad] ?? 0) - (PESO_PRIORIDAD[a.prioridad] ?? 0);
      if (prioridad) return prioridad;
      return b.created_at.localeCompare(a.created_at);
    });
}

/** Personas que han enviado peticiones (para el filtro «Usuario»), por orden alfabético. */
export function autores(tickets: Peticion[]): string[] {
  return [...new Set(tickets.map(autorDe))].sort((a, b) => a.localeCompare(b, "es"));
}
