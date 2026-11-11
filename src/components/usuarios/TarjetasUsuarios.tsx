import { useState } from "react";
import type { ReactNode } from "react";
import type { ManagedUser } from "@/hooks/useUsersManagement";
import { Badge } from "@/components/ui/badge";
import { tipoQueCoincide } from "@/components/usuarios/tiposUsuario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, LockKeyhole, Pencil, Search, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisorPermisosUsuario } from "./VisorPermisosUsuario";

export interface ResumenUsuario {
  user: ManagedUser;
  nombre: string;
  accessCount: number;
  editCount: number;
}

const textoBusqueda = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «6 usuarios · 2 super admins · 1 con acceso bloqueado» (los ceros no se dicen). */
export function textoResumenUsuarios(usuarios: ResumenUsuario[]): string {
  const superAdmins = usuarios.filter(({ user }) => user.is_super_admin).length;
  const bloqueados = usuarios.filter(({ user }) => user.access_blocked).length;
  return [
    plural(usuarios.length, "usuario", "usuarios"),
    superAdmins > 0 && plural(superAdmins, "super admin", "super admins"),
    bloqueados > 0 && `${bloqueados} con acceso bloqueado`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** El correo solo si aporta algo: no el interno de las cuentas de sala (@staff.local) ni si ya es el nombre. */
export const correoVisible = (user: ManagedUser, nombre: string) =>
  user.email && user.email !== nombre && !user.email.endsWith("@staff.local") ? user.email : null;

/** Fecha de alta de la cuenta: «3 oct 2025» (corta) y «3 de octubre de 2025» (para el `title`). */
function fechaAlta(iso: string | null | undefined): { corta: string; larga: string } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return {
    corta: d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }),
    larga: d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }),
  };
}

/** Dos iniciales del nombre («María López» → «ML»; «camarero1» → «CA»). */
function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  const letras = palabras.length > 1
    ? `${Array.from(palabras[0])[0]}${Array.from(palabras[1])[0]}`
    : Array.from(palabras[0]).slice(0, 2).join("");
  return letras.toLocaleUpperCase("es");
}

/** Marca la fila o tarjeta de quien ha iniciado sesión. */
export function MarcaTu() {
  return (
    <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/5 px-2 py-0 text-xs font-semibold text-primary" title="Es tu cuenta">
      Tú
    </Badge>
  );
}

/** Círculo con las iniciales; el de un super admin lleva el escudo en rojo (el color del área Super Admin). */
export function AvatarUsuario({ user, nombre, className }: { user: ManagedUser; nombre: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold",
        user.is_super_admin ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/70",
        user.access_blocked && "opacity-60",
        className,
      )}
    >
      {user.is_super_admin ? <ShieldCheck className="h-5 w-5" /> : iniciales(nombre)}
    </span>
  );
}

/** Correo (si aporta) y fecha de alta, en gris y pequeño, bajo el nombre. */
export function DatosUsuario({ user, nombre, className }: { user: ManagedUser; nombre: string; className?: string }) {
  const correo = correoVisible(user, nombre);
  const alta = fechaAlta(user.created_at);
  if (!correo && !alta) return null;
  return (
    // Sin «·» entre los dos: si no caben en una línea, el alta baja limpia a la siguiente.
    <p className={cn("flex min-w-0 flex-wrap gap-x-3 text-xs leading-relaxed text-muted-foreground", className)}>
      {correo && <span className="min-w-0 break-words [overflow-wrap:anywhere]">{correo}</span>}
      {alta && (
        <span className="whitespace-nowrap" title={`Cuenta creada el ${alta.larga}`}>
          Alta: {alta.corta}
        </span>
      )}
    </p>
  );
}

const CHIP = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0";
const CHIP_NEUTRO = cn(CHIP, "border-border bg-muted/50 text-foreground/80");

/**
 * Qué acceso tiene: bloqueado (conserva los permisos), super admin (todo) o cuántas
 * secciones ve y en cuántas edita. Sin el rol base (admin/manager/staff): manda el permiso.
 */
export function AccesoUsuario({ user, accessCount, editCount, className }: Omit<ResumenUsuario, "nombre"> & { className?: string }) {
  if (user.access_blocked) {
    return (
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
        <Badge variant="destructive" className="gap-1 px-2 font-medium [&_svg]:h-3 [&_svg]:w-3">
          <LockKeyhole aria-hidden="true" />
          Acceso bloqueado
        </Badge>
        <span className="text-xs text-muted-foreground">Permisos conservados</span>
      </div>
    );
  }
  if (user.is_super_admin) {
    return (
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
        <span className={cn(CHIP, "border-destructive/25 bg-destructive/10 text-destructive")}>
          <ShieldCheck aria-hidden="true" />
          Super Admin
        </span>
        <span className="text-xs text-muted-foreground">Acceso completo</span>
      </div>
    );
  }
  // Tipo de usuario fijo (10/11/2026): «Reservas» o «Albaranes» dicen más que «2 secciones».
  const tipo = tipoQueCoincide(user.permissions ?? []);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {tipo && (
        <span className={cn(CHIP, "border-primary/30 bg-primary/5 text-primary")} title={tipo.descripcion} data-testid="chip-tipo-usuario">
          {`Tipo: ${tipo.nombre}`}
        </span>
      )}
      {accessCount === 0 ? (
        <span className={cn(CHIP, "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200")}>
          Sin secciones
        </span>
      ) : (
        <span className={CHIP_NEUTRO}>
          <Eye aria-hidden="true" />
          {plural(accessCount, "sección", "secciones")}
        </span>
      )}
      {editCount > 0 && (
        <span className={CHIP_NEUTRO}>
          <Pencil aria-hidden="true" />
          {`${editCount} con edición`}
        </span>
      )}
    </div>
  );
}

/** Una tarjeta por usuario; la gestión la proporciona el área autorizada. */
export function TarjetasUsuarios({
  usuarios,
  renderAcciones,
  idActual,
}: {
  usuarios: ResumenUsuario[];
  renderAcciones?: (user: ManagedUser) => ReactNode;
  /** Id de quien ha iniciado sesión: su tarjeta lleva «Tú». */
  idActual?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const consulta = textoBusqueda(busqueda.trim());
  const visibles = usuarios.filter(({ user, nombre }) =>
    textoBusqueda(`${nombre} ${user.email ?? ""}`).includes(consulta),
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Buscar usuarios por nombre o correo"
            placeholder="Buscar por nombre o correo"
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            className="h-11 min-w-0 bg-card pl-9 pr-11 text-base [&::-webkit-search-cancel-button]:appearance-none"
          />
          {busqueda && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-11 w-11"
              aria-label="Limpiar búsqueda de usuarios"
              onClick={() => setBusqueda("")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="px-1 text-xs text-muted-foreground" role="status">
          {consulta ? `${visibles.length} de ${usuarios.length} usuarios` : textoResumenUsuarios(usuarios)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed bg-card/60 px-5 py-6 text-center text-sm text-muted-foreground">
            <Search className="mb-1 h-6 w-6 opacity-50" aria-hidden="true" />
            <p>No hay usuarios que coincidan con la búsqueda.</p>
            <Button variant="link" className="h-11" onClick={() => setBusqueda("")}>
              Ver todos los usuarios
            </Button>
          </div>
        ) : (
          <ul aria-label="Usuarios" className="space-y-3 pb-1">
            {visibles.map(({ user, nombre, accessCount, editCount }) => (
              <li
                key={user.id}
                className={cn(
                  "min-w-0 rounded-xl border bg-card p-3.5 shadow-sm",
                  user.access_blocked && "border-destructive/30",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AvatarUsuario user={user} nombre={nombre} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="min-w-0 break-words text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{nombre}</h4>
                      {user.id === idActual && <MarcaTu />}
                    </div>
                    <DatosUsuario user={user} nombre={nombre} className="mt-0.5" />
                  </div>
                </div>

                <AccesoUsuario user={user} accessCount={accessCount} editCount={editCount} className="mt-3" />

                <div className="mt-3 border-t border-border/60 pt-3">
                  {renderAcciones ? renderAcciones(user) : <VisorPermisosUsuario user={user} nombre={nombre} className="w-full" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
