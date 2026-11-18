// ============================================================================
//  Super Admin › Informes — «Informe mensual de auditoría»: los DATOS.
//  14/11/2026: por persona, cuántas cosas ha hecho, cuántos días entró, cuándo
//  fue la última vez y dónde trabaja más; lo delicado (borrados, cambios de
//  precio y de permisos) y, aparte, lo que hace el sistema solo.
//  18/11/2026: persona a persona (días, horas, todo lo que tocó, los botones
//  del servidor y sus últimas acciones). El informe se arma en
//  ../auditoria/modelo.ts y se pinta en src/components/informes/auditoria/.
//  Los datos salen de la RPC `informe_auditoria_mensual` (migraciones
//  20261201100000, 20261205100100 y 20261212100000; solo super admin), que
//  resume `audit_log_visible` en hora de Madrid.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { dondeTabla, fraseBorrado } from "../auditoria/textos";

export { dondeTabla };

// ─── Lo que devuelve la RPC ─────────────────────────────────────────────────

/** Una de sus últimas acciones (migración 20261212100000). */
export interface RecienteAuditoria {
  created_at: string;
  accion: string;
  tabla: string | null;
  nombre?: string;
  campos?: string[];
  op?: string;
  resultado?: string;
}

export interface UsuarioAuditoria {
  quien: string;
  acciones: number;
  dias: number;
  ultima: string;
  borrados: number;
  precios: number;
  secciones: { tabla: string; n: number }[];
  // Desde la migración 20261212100000 (opcionales: una base de datos sin ella no los manda).
  primera?: string;
  entradas?: number;
  por_dia?: { dia: string; n: number }[];
  por_hora?: { hora: number; n: number }[];
  tablas?: { tabla: string; crear: number; actualizar: number; eliminar: number; n: number }[];
  servidor?: { op: string; n: number; fallidas: number }[];
  recientes?: RecienteAuditoria[];
}
type Lado = Partial<Record<"nombre" | "precio_eur" | "section_key" | "can_view" | "can_edit" | "role" | "email", string>>;
export interface DelicadaAuditoria {
  created_at: string;
  actor_label: string | null;
  accion: string;
  tabla: string | null;
  tipo_evento: string;
  det: { antes?: Lado; despues?: Lado };
}
export interface DatosAuditoria {
  usuarios: UsuarioAuditoria[];
  por_dia: { dia: string; n: number }[];
  por_hora: { hora: number; n: number }[];
  delicadas_total: number;
  delicadas: DelicadaAuditoria[];
  sistema: { actor_label: string | null; tabla: string | null; accion: string; n: number }[];
  sistema_total: number;
  accesos_fallidos: number;
}

// ─── Textos ─────────────────────────────────────────────────────────────────

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const formatoFecha = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** «14/11 18:30» en hora de Madrid. */
export function cuando(iso: string): string {
  const p = Object.fromEntries(formatoFecha.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const d2 = (v: string) => v.padStart(2, "0");
  return `${d2(p.day)}/${d2(p.month)} ${d2(p.hour)}:${d2(p.minute)}`;
}

const nivel = (v?: string): string => (v === "true" ? "sí" : v === "false" ? "no" : "—");

/** Frase de una acción delicada, para leerla sin saber de informática. */
export function fraseDelicada(d: DelicadaAuditoria): string {
  const a = d.det?.antes ?? {};
  const z = d.det?.despues ?? {};
  const nombre = z.nombre ?? a.nombre;
  switch (d.tipo_evento) {
    case "cambiar_precio": {
      const de = a.precio_eur != null ? eur.format(Number(a.precio_eur)) : "—";
      const aa = z.precio_eur != null ? eur.format(Number(z.precio_eur)) : "—";
      return `Cambió el precio${nombre ? ` de «${nombre}»` : ""}: de ${de} a ${aa}`;
    }
    case "cambiar_permisos": {
      const lado = d.accion === "eliminar" ? a : z;
      const sec = lado.section_key ? `«${lado.section_key}»` : "una sección";
      return d.accion === "eliminar" ? `Quitó el permiso de ${sec} a alguien` : `Cambió permisos en ${sec}: ver ${nivel(lado.can_view)}, editar ${nivel(lado.can_edit)}`;
    }
    case "cambiar_roles":
      if (d.accion === "eliminar") return a.role ? `Quitó el rol «${a.role}» a alguien` : "Quitó un rol a alguien";
      if (!z.role) return d.tabla === "super_admins" ? "Cambió quién es super admin" : "Cambió el rol de alguien";
      return `Dio el rol «${z.role}»${a.role && a.role !== z.role ? ` (antes «${a.role}»)` : ""} a alguien`;
    case "bloquear_acceso":
      return "Bloqueó el acceso al panel de una persona";
    case "desbloquear_acceso":
      return "Volvió a dar acceso al panel a una persona";
    case "cambiar_credenciales":
      return "Cambió el correo o la contraseña de una persona";
    default:
      return fraseBorrado(d.tabla, nombre);
  }
}

export const TIPO_RESUMEN: { id: string; texto: string }[] = [
  { id: "cambiar_precio", texto: "Cambios de precio" },
  { id: "cambiar_permisos", texto: "Cambios de permisos" },
  { id: "cambiar_roles", texto: "Cambios de rol (quién es jefe, quién no)" },
  { id: "bloquear_acceso", texto: "Accesos bloqueados" },
  { id: "desbloquear_acceso", texto: "Accesos devueltos" },
  { id: "cambiar_credenciales", texto: "Cambios de correo o contraseña" },
  { id: "eliminar", texto: "Cosas borradas" },
];

// ─── Lectura ────────────────────────────────────────────────────────────────

/** Los datos del mes `YYYY-MM` (lanza el error de Supabase si no se pueden leer). */
export async function obtenerDatosAuditoria(mes: string): Promise<DatosAuditoria> {
  const { data, error } = await supabase.rpc("informe_auditoria_mensual" as never, { p_mes: mes } as never);
  if (error) throw new Error(`No se pudo leer la auditoría: ${error.message}`);
  return data as unknown as DatosAuditoria;
}
