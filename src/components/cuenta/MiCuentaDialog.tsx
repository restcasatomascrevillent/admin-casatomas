import { useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { Check, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ListaPermisosUsuario } from "@/components/usuarios/VisorPermisosUsuario";
import { seccionesConPermisos } from "@/components/usuarios/permisosSecciones";
import type { AppRole, UserPermissions } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { emailVisible, etiquetaRol, fechaHoraLegible, nombreVisible } from "@/lib/usuario-actual";
import { AvatarUsuario } from "./AvatarUsuario";
import { FormularioCambioContrasena } from "./FormularioCambioContrasena";

export type PestanaMiCuenta = "datos" | "contrasena";

export interface MiCuentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  esSuperAdmin: boolean;
  rol: AppRole | null;
  permisos: UserPermissions[];
  /** Tono del avatar: el del menú desde el que se abre. */
  tono?: "panel" | "superadmin";
  pestanaInicial?: PestanaMiCuenta;
}

/** Una fila «etiqueta … valor» (el valor a la derecha; si no cabe, baja de línea). */
function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * «Mi cuenta»: quién ha iniciado sesión (nombre, email, rol, alta y último acceso),
 * a qué secciones tiene acceso y el cambio de su contraseña. Se abre desde el pie del
 * menú (Admin Panel y Super Admin). El contenido solo existe con el diálogo
 * abierto (Radix lo desmonta al cerrar): se borra lo escrito en la contraseña.
 */
export function MiCuentaDialog({ open, onOpenChange, user, esSuperAdmin, rol, permisos, tono = "panel", pestanaInicial = "datos" }: MiCuentaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-3 rounded-xl p-4 sm:max-w-xl sm:p-6">
        <ContenidoMiCuenta
          user={user}
          esSuperAdmin={esSuperAdmin}
          rol={rol}
          permisos={permisos}
          tono={tono}
          pestanaInicial={pestanaInicial}
        />
      </DialogContent>
    </Dialog>
  );
}

function ContenidoMiCuenta({ user, esSuperAdmin, rol, permisos, tono, pestanaInicial }: Omit<MiCuentaDialogProps, "open" | "onOpenChange">) {
  const [pestana, setPestana] = useState<PestanaMiCuenta>(pestanaInicial ?? "datos");
  const nombre = nombreVisible(user);
  const email = emailVisible(user);
  const rolTexto = etiquetaRol({ esSuperAdmin, rol });
  const datosPermisos = { is_super_admin: esSuperAdmin, role: rol, permissions: permisos };
  const secciones = seccionesConPermisos(datosPermisos);
  const conAcceso = secciones.filter((s) => s.ver).length;
  const alta = fechaHoraLegible(user.created_at);
  const ultimoAcceso = fechaHoraLegible(user.last_sign_in_at);
  const usuario = user.email?.endsWith("@staff.local") ? user.email.slice(0, -"@staff.local".length) : null;

  return (
    <>
      <DialogHeader className="text-left">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarUsuario nombre={nombre} tono={tono} tamano="lg" />
          <div className="min-w-0">
            <DialogTitle className="break-words text-lg leading-snug [overflow-wrap:anywhere]">{nombre}</DialogTitle>
            <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  esSuperAdmin ? "bg-destructive/10 text-destructive" : "bg-secondary/10 text-secondary",
                )}
              >
                {esSuperAdmin && <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                {rolTexto}
              </span>
              {email && <span className="min-w-0 break-words [overflow-wrap:anywhere]">{email}</span>}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Tabs value={pestana} onValueChange={(v) => setPestana(v as PestanaMiCuenta)} className="flex min-w-0 flex-col">
        <PestanasPagina
          pestanas={[
            { valor: "datos", etiqueta: "Mi cuenta", icono: <UserRound /> },
            { valor: "contrasena", etiqueta: "Contraseña", icono: <KeyRound /> },
          ]}
        />

        <TabsContent value="datos" className="mt-3 space-y-4">
          <dl className="min-w-0 divide-y rounded-lg border bg-card">
            <Dato etiqueta="Nombre">{nombre}</Dato>
            <Dato etiqueta={usuario ? "Usuario" : "Email"}>{usuario ?? email ?? "—"}</Dato>
            <Dato etiqueta="Rol">{rolTexto}</Dato>
            <Dato etiqueta="Alta en el panel">{alta ?? "Sin dato"}</Dato>
            <Dato etiqueta="Último inicio de sesión">{ultimoAcceso ?? "Sin dato"}</Dato>
          </dl>

          <section aria-labelledby="mi-cuenta-secciones" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="mi-cuenta-secciones" className="text-sm font-semibold">Secciones a las que tienes acceso</h3>
              <span className="text-xs text-muted-foreground">
                {esSuperAdmin ? "Acceso completo" : `${conAcceso} de ${secciones.length}`}
              </span>
            </div>
            {esSuperAdmin ? (
              // Para un super admin la tabla sería todo «Sí»: basta con la lista de secciones.
              <>
                <p className="text-sm text-muted-foreground">Super Admin: acceso completo al panel y al área de superadmin.</p>
                <ul aria-label="Permisos por sección" className="flex flex-wrap gap-1.5">
                  {secciones.map((s) => (
                    <li
                      key={s.key}
                      aria-label={`${s.label}: ver y editar`}
                      className="inline-flex items-center gap-1 rounded-full bg-status-confirmed/10 px-2.5 py-1 text-xs font-medium text-status-confirmed"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {s.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <ListaPermisosUsuario user={datosPermisos} />
                <p className="text-xs text-muted-foreground">Si necesitas acceso a otra sección, pídeselo a un super admin.</p>
              </>
            )}
          </section>
        </TabsContent>

        <TabsContent value="contrasena" className="mt-3">
          <FormularioCambioContrasena email={user.email} autoFocus={pestanaInicial === "contrasena"} />
        </TabsContent>
      </Tabs>
    </>
  );
}
