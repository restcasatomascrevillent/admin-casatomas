import { useMemo, useState } from "react";
import { FiltrosAuditoria } from "@/components/auditoria/FiltrosAuditoria";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollText, Loader2, Cog } from "lucide-react";
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
const FILTROS_RAPIDOS: {
  id: string;
  label: string;
  accion?: string;
  tabla?: string;
  descripcion: string;
}[] = [
  {
    id: "todos",
    label: "Todos",
    descripcion: "Actividad sin procesos del servidor",
  },
  {
    id: "login",
    label: "Inicios de sesión",
    accion: "login",
    descripcion: "Inicios de sesión de las personas",
  },
  {
    id: "platos",
    label: "Platos",
    accion: "actualizar",
    tabla: "Platos",
    descripcion: "Modificaciones de platos, incluidos precios y visibilidad",
  },
  {
    id: "bebidas",
    label: "Bebidas",
    accion: "actualizar",
    tabla: "Bebidas",
    descripcion: "Modificaciones de bebidas, incluidos precios y visibilidad",
  },
  {
    id: "novedades",
    label: "Novedades",
    accion: "grupo_cambios",
    tabla: "novedades",
    descripcion: "Creación, modificación y eliminación de novedades",
  },
  {
    id: "ia",
    label: "IA facturas",
    accion: "grupo_ia",
    descripcion: "Preguntas, respuestas y conversaciones con la IA de facturas",
  },
  {
    id: "cambios",
    label: "Cambios",
    accion: "grupo_cambios",
    descripcion: "Creación, modificación y eliminación de datos",
  },
  {
    id: "reversiones",
    label: "Reversiones",
    accion: "reversion",
    descripcion: "Cambios revertidos desde la auditoría",
  },
];

export default function SuperAdminAuditoria() {
  const [filtrosPendientes, setFiltrosPendientes] =
    useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [filtros, setFiltros] = useState<AuditLogFiltros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(0);
  const [vista, setVista] = useState("lista");
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

  // Cada acceso reemplaza acción, sección y origen para evitar combinar categorías
  // incompatibles. Conserva los filtros de fecha, persona, resultado y búsqueda.
  const filtroRapido = (accion?: string, tabla?: string, procesos = false) => {
    const siguientes: AuditLogFiltros = {
      ...filtros,
      accion,
      tabla,
      origen: procesos ? "servidor" : "sin_servidor",
    };
    setFiltros(siguientes);
    setFiltrosPendientes(siguientes);
    setPagina(0);
  };
  const procesosActivos = filtros.origen === "servidor";
  const categoriaActiva =
    filtros.origen === "sin_servidor"
      ? FILTROS_RAPIDOS.find(
          (categoria) =>
            (filtros.accion || undefined) === categoria.accion &&
            (filtros.tabla || undefined) === categoria.tabla,
        )
      : undefined;

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex min-w-0 flex-col gap-3 lg:gap-4"
        style={alto ? { height: alto } : undefined}
      >
        <div className="flex shrink-0 items-center gap-3">
          <ScrollText className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Auditoría
            </h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
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

        <div className="min-w-0 shrink-0 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <nav
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain border-b pb-1 lg:flex-wrap lg:overflow-visible lg:border-0 lg:pb-0"
              aria-label="Filtros rápidos por tipo de acción"
            >
              {FILTROS_RAPIDOS.map((categoria) => (
                <Button
                  key={categoria.id}
                  type="button"
                  size="sm"
                  className={`h-11 shrink-0 rounded-none border-b-2 px-3 lg:h-9 lg:rounded-lg lg:border ${categoriaActiva?.id === categoria.id ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground"}`}
                  variant="ghost"
                  aria-pressed={categoriaActiva?.id === categoria.id}
                  onClick={() =>
                    filtroRapido(categoria.accion, categoria.tabla)
                  }
                >
                  {categoria.label}
                </Button>
              ))}
            </nav>
            <Button
              type="button"
              size="sm"
              className="h-11 shrink-0 gap-1.5 px-3"
              variant={procesosActivos ? "default" : "outline"}
              aria-pressed={procesosActivos}
              onClick={() => filtroRapido(undefined, undefined, true)}
            >
              <Cog className="h-4 w-4" aria-hidden="true" />
              Procesos
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {procesosActivos
              ? "Procesos automáticos del servidor y de la base de datos"
              : (categoriaActiva?.descripcion ??
                (filtros.origen === "sin_servidor"
                  ? "Procesos del servidor ocultos"
                  : "Filtros personalizados"))}
          </p>
        </div>

        {/* Conserva espacio para los registros incluso al desplegar los filtros. */}
        <Card className="flex min-h-48 min-w-0 flex-1 flex-col">
          <Tabs value={vista} onValueChange={setVista} className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 gap-3 border-b bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between lg:space-y-0 lg:px-4">
              <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:self-start">
                <TabsTrigger value="lista">Lista</TabsTrigger>
                <TabsTrigger value="mes">Por mes</TabsTrigger>
                <TabsTrigger value="dia">Por día</TabsTrigger>
              </TabsList>
              {vista === "lista" && (
                <div className="flex items-center justify-between gap-3 lg:ml-auto">
                  <p className="text-sm text-muted-foreground">
                    {total.toLocaleString("es-ES")} registro{total === 1 ? "" : "s"}
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
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 lg:p-4">
              <TabsContent value="lista" className="mt-0">
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
                  <TablaEntradasAuditoria
                    grupos={grupos}
                    expandidas={expandidas}
                    onToggle={alternarExpandida}
                  />
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
            {vista === "lista" && !loading && !error && grupos.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-3 py-3 lg:px-4">
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
            )}
          </Tabs>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
