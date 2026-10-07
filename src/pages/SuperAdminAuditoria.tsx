import { Fragment, useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText, ChevronDown, ChevronRight, Loader2, LogIn, LogOut, Plus, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useAuditLog, TABLAS_AUDITADAS, type AuditLogFiltros } from "@/hooks/useAuditLog";

const ACCION_UI: Record<string, { label: string; icon: typeof LogIn; className: string }> = {
  login: { label: "Inicio de sesión", icon: LogIn, className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  logout: { label: "Cierre de sesión", icon: LogOut, className: "bg-muted text-muted-foreground border-border" },
  crear: { label: "Creación", icon: Plus, className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  actualizar: { label: "Cambio", icon: Pencil, className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  eliminar: { label: "Borrado", icon: Trash2, className: "bg-destructive/10 text-destructive border-destructive/20" },
};

const FILTROS_VACIOS: AuditLogFiltros = {};

export default function SuperAdminAuditoria() {
  const [filtrosPendientes, setFiltrosPendientes] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(0);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const { entradas, total, pageSize, loading, error } = useAuditLog(filtros, pagina);

  const alternarExpandida = (id: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const aplicarFiltros = () => {
    setFiltros(filtrosPendientes);
    setPagina(0);
  };

  const limpiarFiltros = () => {
    setFiltrosPendientes(FILTROS_VACIOS);
    setFiltros(FILTROS_VACIOS);
    setPagina(0);
  };

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ScrollText className="h-8 w-8 text-destructive" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Auditoría</h1>
            <p className="text-muted-foreground">
              Quién entró al panel y qué cambió en la configuración y los permisos sensibles.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Combínalos como haga falta; se aplican todos a la vez.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="auditoria-actor">Email de quién actuó</Label>
              <Input
                id="auditoria-actor"
                placeholder="nombre@dominio.com"
                value={filtrosPendientes.actor ?? ""}
                onChange={(e) => setFiltrosPendientes((prev) => ({ ...prev, actor: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Acción</Label>
              <Select
                value={filtrosPendientes.accion ?? "todas"}
                onValueChange={(v) => setFiltrosPendientes((prev) => ({ ...prev, accion: v === "todas" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {Object.entries(ACCION_UI).map(([valor, { label }]) => (
                    <SelectItem key={valor} value={valor}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tabla</Label>
              <Select
                value={filtrosPendientes.tabla ?? "todas"}
                onValueChange={(v) => setFiltrosPendientes((prev) => ({ ...prev, tabla: v === "todas" ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {TABLAS_AUDITADAS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auditoria-desde">Desde</Label>
              <Input
                id="auditoria-desde"
                type="date"
                value={filtrosPendientes.desde ?? ""}
                onChange={(e) => setFiltrosPendientes((prev) => ({ ...prev, desde: e.target.value || undefined }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="auditoria-hasta">Hasta</Label>
              <Input
                id="auditoria-hasta"
                type="date"
                value={filtrosPendientes.hasta ?? ""}
                onChange={(e) => setFiltrosPendientes((prev) => ({ ...prev, hasta: e.target.value || undefined }))}
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-5 flex gap-2">
              <Button onClick={aplicarFiltros}>Aplicar filtros</Button>
              <Button variant="outline" onClick={limpiarFiltros}>
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {total} registro{total === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive py-4">Error al cargar la auditoría: {error}</p>
            ) : entradas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No hay registros con estos filtros.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Cuándo</TableHead>
                      <TableHead>Quién</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Tabla</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entradas.map((entrada) => {
                      const ui = ACCION_UI[entrada.accion] ?? ACCION_UI.actualizar;
                      const Icon = ui.icon;
                      const tieneDetalles = entrada.detalles && Object.keys(entrada.detalles).length > 0;
                      const abierta = expandidas.has(entrada.id);

                      return (
                        <Fragment key={entrada.id}>
                          <TableRow
                            className={tieneDetalles ? "cursor-pointer" : undefined}
                            onClick={tieneDetalles ? () => alternarExpandida(entrada.id) : undefined}
                          >
                            <TableCell>
                              {tieneDetalles &&
                                (abierta ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                ))}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {format(new Date(entrada.created_at), "d MMM yyyy, HH:mm:ss", { locale: es })}
                            </TableCell>
                            <TableCell className="text-sm">{entrada.actor_email ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`gap-1 ${ui.className}`}>
                                <Icon className="h-3 w-3" />
                                {ui.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm font-mono text-muted-foreground">{entrada.tabla ?? "—"}</TableCell>
                          </TableRow>
                          {tieneDetalles && abierta && (
                            <TableRow>
                              <TableCell colSpan={5} className="border-0 p-0">
                                <pre className="m-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                                  {JSON.stringify(entrada.detalles, null, 2)}
                                </pre>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Página {pagina + 1} de {totalPaginas}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagina + 1 >= totalPaginas}
                      onClick={() => setPagina((p) => p + 1)}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
