import { describeDevice } from "@/lib/audit-device";
import { Fragment, useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText, ChevronDown, ChevronRight, Loader2, LogIn, LogOut, Plus, Pencil, Trash2, Activity } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useAuditLog,
  agruparEntradas,
  resumirCambios,
  TABLAS_AUDITADAS,
  TABLA_LABEL,
  type AuditLogEntry,
  type AuditLogFiltros,
} from "@/hooks/useAuditLog";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_AUDITORIA = 480;

const ACCION_UI: Record<string, { label: string; icon: typeof LogIn; className: string }> = {
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

const FILTROS_VACIOS: AuditLogFiltros = {};

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

export default function SuperAdminAuditoria() {
  const [filtrosPendientes, setFiltrosPendientes] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(0);
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const { entradas, total, tablas = TABLAS_AUDITADAS, pageSize, loading, error, refetch, accesosActivos } = useAuditLog(filtros, pagina);
  const grupos = useMemo(() => agruparEntradas(entradas), [entradas]);
  // Alto de la pantalla (regla del dueño, 2026-10-07): cabecera y filtros fijos
  // arriba; la tabla de registros hace scroll dentro de su tarjeta, la página
  // no. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_AUDITORIA);

  const alternarExpandida = (key: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
      <div ref={setRaiz} className="flex flex-col gap-6" style={alto ? { height: alto } : undefined}>
        <div className="flex shrink-0 items-center gap-3">
          <ScrollText className="h-8 w-8 text-destructive" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Auditoría</h1>
            <p className="text-muted-foreground">
              Accesos, intentos y acciones de todas las personas y dispositivos.
            </p>
          </div>
        </div>

        {accesosActivos === false && <p role="status" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          Pendiente de activar el registro completo de accesos en el servidor. Todavía no se recogen todos los intentos ni las sesiones restauradas.
        </p>}
        <Card className="shrink-0">
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Combínalos como haga falta; se aplican todos a la vez.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label htmlFor="auditoria-actor">Quién actuó / origen</Label>
              <Input
                id="auditoria-actor"
                placeholder="Email, ID de usuario u origen"
                value={filtrosPendientes.actor ?? ""}
                onChange={(e) => setFiltrosPendientes((prev) => ({ ...prev, actor: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="auditoria-dispositivo">Dispositivo</Label>
              <Input id="auditoria-dispositivo" placeholder="ID del dispositivo"
                value={filtrosPendientes.dispositivo ?? ""}
                onChange={(e) => setFiltrosPendientes(prev => ({ ...prev, dispositivo: e.target.value }))} />
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
                  {tablas.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TABLA_LABEL[t] ?? t}
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

        {/* Nunca por debajo de 12rem: en un móvil, con los filtros apilados,
            antes que una tabla de 0 px vuelve el scroll de página. */}
        <Card className="flex min-h-48 flex-1 flex-col">
          <CardHeader className="shrink-0 flex-row items-center justify-between">
            <CardTitle>
              {total} registro{total === 1 ? "" : "s"}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>Actualizar</Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive py-4">Error al cargar la auditoría: {error}</p>
            ) : grupos.length === 0 ? (
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
                      <TableHead>Dispositivo / conexión</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grupos.map((grupo) => {
                      const ui = ACCION_UI[grupo.accion] ?? ACCION_UI.actualizar;
                      const Icon = ui.icon;
                      const esGrupo = grupo.entradas.length > 1;
                      // Cada fila permite consultar su ID y el UUID del actor.
                      const tieneDetalles = true;
                      const abierta = expandidas.has(grupo.key);

                      return (
                        <Fragment key={grupo.key}>
                          <TableRow
                            className={tieneDetalles ? "cursor-pointer" : undefined}
                            onClick={tieneDetalles ? () => alternarExpandida(grupo.key) : undefined}
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
                              {format(new Date(grupo.created_at), "d MMM yyyy, HH:mm:ss", { locale: es })}
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
                          {tieneDetalles && abierta && (
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

