import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  AYUDA_EDICION,
  SECCIONES_CONFIGURABLES,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";

interface TablaPermisosSeccionesProps {
  permisos: PermisoSeccion[];
  onCambiarVer: (sectionKey: string, ver: boolean) => void;
  onCambiarEditar: (sectionKey: string, editar: boolean) => void;
  /**
   * Solo un super admin concede o retira «Puede editar» (2026-10-01). Si no, se ve
   * el valor real guardado pero el interruptor queda bloqueado.
   */
  puedeConcederEdicion: boolean;
  className?: string;
}

/**
 * Tabla de permisos por sección («Ver» + «Puede editar») de la pantalla Usuarios:
 * la misma en el diálogo «Permisos», en el alta y en los roles preconfigurados.
 * Una sola tabla para móvil y escritorio (antes había dos copias, una oculta por CSS).
 */
export function TablaPermisosSecciones({
  permisos,
  onCambiarVer,
  onCambiarEditar,
  puedeConcederEdicion,
  className,
}: TablaPermisosSeccionesProps) {
  const idBase = useId();

  return (
    <div className={cn("space-y-2", className)}>
      {!puedeConcederEdicion && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          Solo un super admin puede conceder o retirar el permiso de edición.
        </p>
      )}
      <div className="rounded-md border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-10 px-3">Sección</TableHead>
              <TableHead className="h-10 w-14 px-2 text-center">Ver</TableHead>
              <TableHead className="h-10 w-20 px-2 text-center leading-tight">Puede editar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SECCIONES_CONFIGURABLES.map((seccion) => {
              const permiso = permisos.find((p) => p.section_key === seccion.key);
              const ver = permiso?.can_view ?? false;
              const editar = permiso?.can_edit ?? false;
              const idAyuda = `${idBase}-${seccion.key}-ayuda-edicion`;

              return (
                <TableRow key={seccion.key}>
                  <TableCell className="px-3 py-2.5">
                    <p className="font-medium">{seccion.label}</p>
                    <p id={idAyuda} className="mt-0.5 text-xs text-muted-foreground">
                      Editar: {AYUDA_EDICION[seccion.key]}
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-center">
                    <Switch
                      checked={ver}
                      onCheckedChange={(valor) => onCambiarVer(seccion.key, valor)}
                      aria-label={`Ver ${seccion.label}`}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-center">
                    <Switch
                      checked={editar}
                      disabled={!ver || !puedeConcederEdicion}
                      onCheckedChange={(valor) => onCambiarEditar(seccion.key, valor)}
                      aria-label={`Puede editar ${seccion.label}`}
                      aria-describedby={idAyuda}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        «Puede editar» solo se activa si la sección tiene «Ver»; al quitar «Ver» se quita también.
      </p>
    </div>
  );
}
