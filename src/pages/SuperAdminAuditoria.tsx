import { useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollText, Loader2 } from "lucide-react";
import {
  useAuditLog,
  agruparEntradas,
  TABLAS_AUDITADAS,
  TABLA_LABEL,
  type AuditLogFiltros,
  type RangoMesesAuditoria,
} from "@/hooks/useAuditLog";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { ACCION_UI, TablaEntradasAuditoria } from "@/components/auditoria/TablaEntradasAuditoria";
import { VistaPorMes } from "@/components/auditoria/VistaPorMes";
import { VistaPorDia } from "@/components/auditoria/VistaPorDia";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_AUDITORIA = 480;

const FILTROS_VACIOS: AuditLogFiltros = {};

export default function SuperAdminAuditoria() {
  const [filtrosPendientes, setFiltrosPendientes] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(0);
  // Compartido por las tres pestañas: la clave es siempre el ID de una fila de `audit_log`,
  // así que no hay colisión entre lo que despliega "Lista" y lo que despliega "Por mes"/"Por día".
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  // Rango de las vistas agrupadas ("Por mes" / "Por día"); se mantiene al cambiar de pestaña.
  const [rangoMeses, setRangoMeses] = useState<RangoMesesAuditoria>(3);
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
            <CardDescription>Combínalos como haga falta; se aplican todos a la vez, en las tres pestañas de abajo.</CardDescription>
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
          <Tabs defaultValue="lista" className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 gap-3">
              <TabsList className="self-start">
                <TabsTrigger value="lista">Lista</TabsTrigger>
                <TabsTrigger value="mes">Por mes</TabsTrigger>
                <TabsTrigger value="dia">Por día</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <TabsContent value="lista" className="mt-0">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {total} registro{total === 1 ? "" : "s"}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>Actualizar</Button>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive py-4">Error al cargar la auditoría: {error}</p>
                ) : grupos.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No hay registros con estos filtros.</p>
                ) : (
                  <>
                    <TablaEntradasAuditoria grupos={grupos} expandidas={expandidas} onToggle={alternarExpandida} />
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
                  </>
                )}
              </TabsContent>

              <TabsContent value="mes" className="mt-0">
                <VistaPorMes
                  filtros={filtros}
                  rango={rangoMeses}
                  onRangoChange={setRangoMeses}
                  expandidasFilas={expandidas}
                  onToggleFila={alternarExpandida}
                />
              </TabsContent>

              <TabsContent value="dia" className="mt-0">
                <VistaPorDia
                  filtros={filtros}
                  rango={rangoMeses}
                  onRangoChange={setRangoMeses}
                  expandidasFilas={expandidas}
                  onToggleFila={alternarExpandida}
                />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
