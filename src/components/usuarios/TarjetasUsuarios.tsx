import { useState } from "react";
import type { ManagedUser } from "@/hooks/useUsersManagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ShieldCheck, User, X } from "lucide-react";
import { VisorPermisosUsuario } from "./VisorPermisosUsuario";

export interface ResumenUsuario {
  user: ManagedUser;
  nombre: string;
  accessCount: number;
  editCount: number;
}

const textoBusqueda = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

/** Consulta móvil: una sola tarjeta por usuario, sin controles de gestión. */
export function TarjetasUsuarios({ usuarios }: { usuarios: ResumenUsuario[] }) {
  const [busqueda, setBusqueda] = useState("");
  const consulta = textoBusqueda(busqueda.trim());
  const visibles = usuarios.filter(({ user, nombre }) =>
    textoBusqueda(`${nombre} ${user.email ?? ""}`).includes(consulta),
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Buscar usuarios por nombre o correo"
            placeholder="Buscar por nombre o correo"
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            className="h-11 min-w-0 pl-9 pr-11 text-base [&::-webkit-search-cancel-button]:appearance-none"
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
        <p className="text-xs text-muted-foreground" role="status">
          {consulta ? `${visibles.length} de ${usuarios.length} usuarios` : `${usuarios.length} usuarios`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {visibles.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            <p>No hay usuarios que coincidan con la búsqueda.</p>
            <Button variant="link" className="mt-1 h-11" onClick={() => setBusqueda("")}>
              Ver todos los usuarios
            </Button>
          </div>
        ) : (
          <ul aria-label="Usuarios" className="space-y-3 pb-1">
            {visibles.map(({ user, nombre, accessCount, editCount }) => (
              <li key={user.id} className="min-w-0 rounded-xl border bg-card p-3.5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${user.is_super_admin ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                    {user.is_super_admin ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <User className="h-5 w-5" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h4 className="break-words text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{nombre}</h4>
                    {user.email && user.email !== nombre && !user.email.endsWith("@staff.local") && (
                      <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{user.email}</p>
                    )}
                  </div>
                </div>

                <div className="my-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {user.access_blocked ? (
                    <>
                      <Badge variant="destructive">Acceso bloqueado</Badge>
                      <span>Permisos conservados</span>
                    </>
                  ) : user.is_super_admin ? (
                    <span>Acceso completo</span>
                  ) : (
                    <>
                      <Badge variant="secondary">{accessCount} secciones</Badge>
                      {editCount > 0 && <Badge variant="secondary">{editCount} con edición</Badge>}
                    </>
                  )}
                </div>
                <VisorPermisosUsuario user={user} nombre={nombre} className="w-full" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
