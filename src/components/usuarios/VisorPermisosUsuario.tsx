import type { ManagedUser } from "@/hooks/useUsersManagement";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Eye, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { seccionesConPermisos, type DatosPermisos } from "./permisosSecciones";
import { esSeccionSoloEdicion } from "./seccionesSoloEdicion";

/**
 * Lista de solo lectura de los permisos por sección (Sí / No). La usan este visor y
 * «Mi cuenta» (los permisos de quien ha iniciado sesión).
 */
export function ListaPermisosUsuario({ user }: { user: DatosPermisos }) {
  const secciones = seccionesConPermisos(user);
  return (
    <div className="rounded-lg border">
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_4rem_4rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
        <span>Sección</span><span className="text-center">Ver</span><span className="text-center">Editar</span>
      </div>
      <ul aria-label="Permisos por sección" className="divide-y">
        {secciones.map(({ key, label, ayuda, ver: verGuardado, editar, unInterruptor }) => {
          // «Reservas · Configuración»: «Ver» sin «Editar» no da acceso, así que se enseña como «No».
          const ver = esSeccionSoloEdicion(key) ? editar : verGuardado;
          return (
          <li key={key} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_4rem_4rem] sm:items-center sm:gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{ayuda}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:contents">
              {unInterruptor ? (
                // «Facturas · Subida»: un solo permiso («Puede subir»), en la columna «Ver».
                <>
                  <span aria-label={`${unInterruptor} ${label}: ${ver ? "Sí" : "No"}`} className={cn("rounded-md px-2 py-1 text-center text-xs font-medium", ver ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                    <span className="sm:sr-only">{unInterruptor}: </span>{ver ? "Sí" : "No"}
                  </span>
                  <span aria-hidden="true" className="hidden text-center text-xs text-muted-foreground sm:block">—</span>
                </>
              ) : (
                <>
                  <span aria-label={`Ver ${label}: ${ver ? "Sí" : "No"}`} className={cn("rounded-md px-2 py-1 text-center text-xs font-medium", ver ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                    <span className="sm:sr-only">Ver: </span>{ver ? "Sí" : "No"}
                  </span>
                  <span aria-label={`Editar ${label}: ${editar ? "Sí" : "No"}`} className={cn("rounded-md px-2 py-1 text-center text-xs font-medium", editar ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                    <span className="sm:sr-only">Editar: </span>{editar ? "Sí" : "No"}
                  </span>
                </>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Visor sin controles de escritura, también para superadmins que visitan el panel normal. */
export function VisorPermisosUsuario({ user, nombre, className }: { user: ManagedUser; nombre: string; className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-11 px-4", className)}>
          <Eye className="mr-1.5 h-4 w-4" />
          Ver permisos
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl p-4 sm:p-6 [&>button]:h-11 [&>button]:w-11 [&>button]:right-2 [&>button]:top-2">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="flex min-w-0 items-start gap-2 text-base leading-snug sm:text-lg">
            <Shield className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">Permisos de {nombre}</span>
          </DialogTitle>
          <DialogDescription>
            Consulta de permisos. Los usuarios, roles y accesos se gestionan desde el superadmin.
          </DialogDescription>
        </DialogHeader>
        <div className="shrink-0">
          {user.access_blocked && <p className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Acceso bloqueado. Se conservan los permisos indicados.</p>}
          {user.is_super_admin && <p className="mb-3 text-sm text-muted-foreground">Super Admin: acceso completo al panel y al área de superadmin.</p>}
          <ListaPermisosUsuario user={user} />
        </div>
        <div className="flex shrink-0 justify-end border-t pt-3">
          <DialogClose asChild><Button variant="outline" className="h-11 w-full sm:w-auto">Cerrar</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
