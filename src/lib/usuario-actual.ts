import type { User } from "@supabase/supabase-js";
import type { AppRole } from "@/hooks/useUserRole";

/**
 * Cómo se presenta al usuario que ha iniciado sesión (pie del menú y «Mi cuenta»).
 * Mismo criterio que la lista de Usuarios (`getUserDisplayName` de ListaUsuarios):
 * nombre guardado en Auth (`user_metadata.display_name`); si no hay, el email; y si
 * el email es el interno `usuario@staff.local`, solo el nombre de usuario.
 */
export function nombreVisible(user: Pick<User, "email" | "user_metadata" | "id"> | null | undefined): string {
  if (!user) return "";
  const guardado = user.user_metadata?.display_name;
  if (typeof guardado === "string" && guardado.trim()) return guardado.trim();
  const email = user.email ?? "";
  if (email.endsWith("@staff.local")) return email.slice(0, -"@staff.local".length);
  return email || `${user.id.slice(0, 8)}…`;
}

/** Email «de verdad» (no el interno de @staff.local), para enseñarlo debajo del nombre. */
export function emailVisible(user: Pick<User, "email"> | null | undefined): string | null {
  const email = user?.email ?? "";
  if (!email || email.endsWith("@staff.local")) return null;
  return email;
}

/**
 * Iniciales para el avatar: primera letra de las dos primeras palabras; con una sola
 * palabra (o un email), sus dos primeras letras. Sin letras, «?».
 */
export function iniciales(nombre: string): string {
  const base = nombre.includes("@") ? nombre.split("@")[0] : nombre;
  const palabras = base
    .replace(/[._\-+]+/g, " ")
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (palabras.length === 0) return "?";
  const letras = palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : palabras[0].slice(0, 2);
  return letras.toLocaleUpperCase("es");
}

const ROLES: Record<AppRole, string> = { admin: "Admin", manager: "Manager", staff: "Staff" };

/** Etiqueta del rol, con los mismos nombres que «Roles preconfigurados» (Admin, Manager, Staff). */
export function etiquetaRol({ esSuperAdmin, rol }: { esSuperAdmin: boolean; rol: AppRole | null }): string {
  if (esSuperAdmin) return "Super Admin";
  return rol ? ROLES[rol] : "Sin rol";
}

/** Fecha y hora legibles («3 nov 2026, 14:05»), o null si no hay fecha válida. */
export function fechaHoraLegible(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
