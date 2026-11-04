import { cn } from "@/lib/utils";
import { iniciales } from "@/lib/usuario-actual";

const TONOS = {
  /** Dorado del menú del Admin Panel. */
  panel: "bg-sidebar-primary text-sidebar-primary-foreground",
  /** Rojo del área de Super Admin. */
  superadmin: "bg-destructive text-destructive-foreground",
} as const;

const TAMANOS = {
  sm: "size-8 text-xs",
  lg: "size-14 text-lg",
} as const;

/**
 * Círculo con las iniciales del usuario. Es un `div` (no `span`) a propósito: el
 * botón del menú oculta sus `span` en modo iconos y el avatar tiene que seguir.
 * Decorativo: el nombre lo da el botón o el texto de al lado.
 */
export function AvatarUsuario({
  nombre,
  tono = "panel",
  tamano = "sm",
  className,
}: {
  nombre: string;
  tono?: keyof typeof TONOS;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="avatar-usuario"
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase leading-none tracking-wide",
        TONOS[tono],
        TAMANOS[tamano],
        className,
      )}
    >
      {iniciales(nombre)}
    </div>
  );
}
