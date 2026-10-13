import { useMemo, useState } from "react";
import { FiltrosAuditoria } from "@/components/auditoria/FiltrosAuditoria";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollText, Loader2 } from "lucide-react";
import {
  useAuditLog,
  agruparEntradas,
  TABLAS_AUDITADAS,
  type AuditLogFiltros,
  type RangoMesesAuditoria,
} from "@/hooks/useAuditLog";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { TablaEntradasAuditoria } from "@/components/auditoria/TablaEntradasAuditoria";
import { VistaPorMes } from "@/components/auditoria/VistaPorMes";
import { VistaPorDia } from "@/components/auditoria/VistaPorDia";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_AUDITORIA = 480;

const FILTROS_VACIOS: AuditLogFiltros = { origen: "sin_servidor" };
const FILTROS_RAPIDOS = [
  ["", "Todos"],
  ["grupo_cambios", "Cambios"],
  ["grupo_ia", "IA facturas"],
  ["grupo_accesos", "Accesos"],
  ["reversion", "Reversiones"],
] as const;

export default function SuperAdminAuditoria() {
  const [filtrosPendientes, setFiltrosPendientes] =
    useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(0);
  // Compartido por las tres pestañas: la clave es siempre el ID de una fila de `audit_log`,
  // así que no hay colisión entre lo que despliega "Lista" y lo que despliega "Por mes"/"Por día".
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  // Rango de las vistas agrupadas ("Por mes" / "Por día"); se mantiene al cambiar de pestaña.
  const [rangoMeses, setRangoMeses] = useState<RangoMesesAuditoria>(3);
  const {
    entradas,
    total,
    tablas = TABLAS_AUDITADAS,
    pageSize,
    loading,
    error,
    refetch,
    accesosActivos,
  } = useAuditLog(filtros, pagina);
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

  const filtroRapido = (accion: string) => {
    const siguientes = { ...filtros, accion: accion || undefined };
    setFiltros(siguientes);
    setFiltrosPendientes(siguientes);
    setPagina(0);
  };

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex min-w-0 flex-col gap-3 sm:gap-6"
        style={alto ? { height: alto } : undefined}
      >
        <div className="flex shrink-0 items-center gap-3">
          <ScrollText className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" />
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              Auditoría
            </h1>
            <p className="hidden text-muted-foreground sm:block">
              Accesos, intentos y acciones de todas las personas y dispositivos.
            </p>
          </div>
        </div>

        {accesosActivos === false && (
          <p
            role="status"
            className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
          >
            Pendiente de activar el registro completo de accesos en el servidor.
            Todavía no se recogen todos los intentos ni las sesiones
            restauradas.
          </p>
        )}
        <FiltrosAuditoria
          pendientes={filtrosPendientes}
          activos={filtros}
          tablas={tablas}
          onChange={setFiltrosPendientes}
          onAplicar={aplicarFiltros}
          onLimpiar={limpiarFiltros}
        />

        <div className="shrink-0 space-y-2">
          <div
            className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"
            role="group"
            aria-label="Filtros rápidos por tipo de acción"
          >
            {FILTROS_RAPIDOS.map(([valor, label]) => (
              <Button
                key={valor || "todos"}
                type="button"
                size="sm"
                className="h-10 px-2 sm:px-3"
                variant={
                  (filtros.accion ?? "") === valor ? "default" : "outline"
                }
                aria-pressed={(filtros.accion ?? "") === valor}
                onClick={() => filtroRapido(valor)}
              >
                {label}
              </Button>
            ))}
          </div>
          {filtros.origen === "sin_servidor" && (
            <p className="text-xs text-muted-foreground">
              Procesos del servidor ocultos
            </p>
          )}
        </div>

        {/* Conserva espacio para los registros incluso al desplegar los filtros. */}
        <Card className="flex min-h-48 min-w-0 flex-1 flex-col">
          <Tabs defaultValue="lista" className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 gap-3 p-3 sm:p-6">
              <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:self-start">
                <TabsTrigger value="lista">Lista</TabsTrigger>
                <TabsTrigger value="mes">Por mes</TabsTrigger>
                <TabsTrigger value="dia">Por día</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-6 sm:pb-6">
              <TabsContent value="lista" className="mt-0">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {total} registro{total === 1 ? "" : "s"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refetch()}
                    disabled={loading}
                  >
                    Actualizar
                  </Button>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive py-4">
                    Error al cargar la auditoría: {error}
                  </p>
                ) : grupos.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No hay registros con estos filtros.
                  </p>
                ) : (
                  <>
                    <TablaEntradasAuditoria
                      grupos={grupos}
                      expandidas={expandidas}
                      onToggle={alternarExpandida}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                      <p className="text-sm text-muted-foreground">
                        Página {pagina + 1} de {totalPaginas}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pagina === 0}
                          onClick={() => setPagina((p) => p - 1)}
                        >
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
