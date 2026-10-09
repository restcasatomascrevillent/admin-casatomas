import { Fragment } from "react";
import { describeDevice } from "@/lib/audit-device";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, LogIn, LogOut, Plus, Pencil, Trash2, Activity } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { resumirCambios, TABLA_LABEL, type AuditLogEntry, type AuditLogGrupo } from "@/hooks/useAuditLog";

/**
 * Tabla de registros de auditoría: la usan la pestaña "Lista" y, dentro de
 * cada día, las pestañas "Por mes" y "Por día" — misma fila, mismos colores
 * y el mismo desplegable de detalle en las tres, para no tener tres estéticas
 * distintas de la misma tabla.
 */

export const ACCION_UI: Record<string, { label: string; icon: typeof LogIn; className: string }> = {
  login: { label: "Inicio de sesión", icon: LogIn, className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  intento_login: { label: "Intento pendiente", icon: LogIn, className: "bg-amber-500/10 text-amber-600" },
  login_fallido: { label: "Acceso fallido", icon: LogIn, className: "bg-destructive/10 text-destructive" },
  acceso: { label: "Acceso con sesión", icon: LogIn, className: "bg-emerald-500/10 text-emerald-600" },
  acceso_denegado: { label: "Acceso denegado", icon: LogIn, className: "bg-destructive/10 text-destructive" },
  logout: { label: "Cierre de sesión", icon: LogOut, className: "bg-muted text-muted-foreground border-border" },
  crear: { label: "Creación", icon: Plus, className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  actualizar: { label: "Cambio", icon: Pencil, className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  eliminar: { label: "Eliminación", icon: Trash2, className: "bg-destructive/10 text-destructive border-destructive/20" },
  ejecutar: { label: "Acción", icon: Activity, className: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
};

/** Valor de un campo del diff, recortado para que una fila nunca se dispare de alto. */
function formatearValorCampo(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  return texto.length > 80 ? `${texto.slice(0, 80)}…` : texto;
}

function DetalleEntrada({ entrada }: { entrada: AuditLogEntry }) {
  if (entrada.detalles?.credenciales_actualizadas) {
    return <p className="text-sm">Credenciales actualizadas. La contraseña no se guarda en la auditoría.</p>;
  }
  if (entrada.detalles?.operacion && entrada.tabla === "acciones_servidor") {
    return <p className="text-sm">{String(entrada.detalles.operacion)} · {String(entrada.detalles.resultado ?? "completada")}</p>;
  }
  const cambios = entrada.accion === "actualizar" ? resumirCambios(entrada.detalles) : [];

  if (entrada.accion === "actualizar" && cambios.length > 0) {
    return (
      <ul className="space-y-1 text-xs">
        {cambios.map((c) => (
          <li key={c.campo} className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono font-medium text-foreground">{c.campo}:</span>
            <span className="text-muted-foreground line-through">{formatearValorCampo(c.antes)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="text-foreground">{formatearValorCampo(c.despues)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (!entrada.detalles || Object.keys(entrada.detalles).length === 0) return null;

  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(entrada.detalles, null, 2)}</pre>
  );
}

export interface TablaEntradasAuditoriaProps {
  grupos: AuditLogGrupo[];
  expandidas: Set<string>;
  onToggle: (key: string) => void;
  /**
   * "Por mes" y "Por día" ya muestran la fecha en la cabecera del día: repetirla en cada
   * fila sobra y hace más estrecha la columna útil. En esas vistas solo se ve la hora.
   */
  columnaCuando?: "fecha-hora" | "solo-hora";
}

export function TablaEntradasAuditoria({ grupos, expandidas, onToggle, columnaCuando = "fecha-hora" }: TablaEntradasAuditoriaProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className={columnaCuando === "solo-hora" ? "w-20" : undefined}>
              {columnaCuando === "solo-hora" ? "Hora" : "Cuándo"}
            </TableHead>
            <TableHead>Quién</TableHead>
            <TableHead>Acción</TableHead>
            <TableHead>Tabla</TableHead>
            <TableHead>Dispositivo / conexión</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.map((grupo) => {
            const ui = ACCION_UI[grupo.accion] ?? ACCION_UI.actualizar;
            const Icon = ui.icon;
            const esGrupo = grupo.entradas.length > 1;
            const abierta = expandidas.has(grupo.key);

            return (
              <Fragment key={grupo.key}>
                <TableRow className="cursor-pointer" onClick={() => onToggle(grupo.key)}>
                  <TableCell>
                    {abierta ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums text-muted-foreground">
                    {columnaCuando === "solo-hora"
                      ? format(new Date(grupo.created_at), "HH:mm:ss", { locale: es })
                      : format(new Date(grupo.created_at), "d MMM yyyy, HH:mm:ss", { locale: es })}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="break-all">{grupo.actor_label}</span>
                    {(grupo.actor_origin === "historico" || (!grupo.actor_email && !grupo.actor_user_id && !grupo.actor_origin)) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        El registro original no conservó el autor.
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`gap-1 ${ui.className}`}>
                      <Icon className="h-3 w-3" />
                      {ui.label}
                      {esGrupo && <span className="ml-0.5 font-semibold">× {grupo.entradas.length}</span>}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {grupo.tabla ? TABLA_LABEL[grupo.tabla] ?? grupo.tabla : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <p>{describeDevice(grupo.entradas[0].user_agent)}</p>
                    {grupo.entradas[0].device_id && <p className="font-mono">{grupo.entradas[0].device_id}</p>}
                    {grupo.entradas[0].ip_address && <p>IP: {grupo.entradas[0].ip_address}</p>}
                  </TableCell>
                </TableRow>
                {abierta && (
                  <TableRow>
                    <TableCell colSpan={6} className="border-0 p-0">
                      <div className="m-3 space-y-2">
                        {grupo.entradas.map((entrada) => (
                          <div key={entrada.id} className="rounded-md border border-border/60 p-2">
                            <p className="mb-1 break-all font-mono text-[11px] text-muted-foreground">
                              Registro de auditoría: {entrada.id}
                            </p>
                            {entrada.actor_user_id && (
                              <p className="mb-1 break-all font-mono text-[11px] text-muted-foreground">
                                Usuario: {entrada.actor_user_id}
                              </p>
                            )}
                            {entrada.registro_id && (
                              <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                                {entrada.registro_id}
                              </p>
                            )}
                            {entrada.user_agent && <p className="text-xs break-all">Navegador: {entrada.user_agent}</p>}
                            {entrada.session_id && <p className="text-xs break-all">Sesión: {entrada.session_id}</p>}
                            {entrada.request_id && <p className="text-xs break-all">Petición: {entrada.request_id}</p>}
                            <DetalleEntrada entrada={entrada} />
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
