import { useEffect, useMemo, useRef, useState } from "react";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { FiltrosAuditoria, sinBusquedaCorta } from "@/components/auditoria/FiltrosAuditoria";
import {
  CATEGORIA_PROCESOS,
  CategoriasAuditoria,
} from "@/components/auditoria/CategoriasAuditoria";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ScrollText,
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
    accesosActivos,
  } = useAuditLog(filtros, pagina);
  const grupos = useMemo(() => agruparEntradas(entradas), [entradas]);
  // Alto de la pantalla (regla del dueño, 2026-10-07): cabecera y filtros fijos
  // arriba; la tabla de registros hace scroll dentro de su tarjeta, la página
  // no. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_AUDITORIA);
  // Al cambiar de página o de filtros, la lista vuelve arriba (si no, la página 2 se abre a media altura).
  const listaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listaRef.current) listaRef.current.scrollTop = 0;
  }, [pagina, filtros, vista]);
  // «Actualizar»: las dos cargas (lista y vistas agrupadas) escuchan este evento. El icono gira un momento para
  // que se note que ha hecho algo (la lista se refresca sin parpadear).
  const [girando, setGirando] = useState(false);
  useEffect(() => {
    if (!girando) return;
    const t = window.setTimeout(() => setGirando(false), 700);
    return () => window.clearTimeout(t);
  }, [girando]);
  const actualizar = () => {
    window.dispatchEvent(new Event("auditoria-actualizada"));
    setGirando(true);
  };

  const alternarExpandida = (key: string) => {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Una búsqueda de 1 o 2 letras no se manda (sería lenta); el borrador se queda en el campo con su aviso.
  const aplicarFiltros = () => {
    setFiltros(sinBusquedaCorta(filtrosPendientes));
    setPagina(0);
  };

  const limpiarFiltros = () => {
    setFiltrosPendientes(FILTROS_VACIOS);
    setFiltros(FILTROS_VACIOS);
    setPagina(0);
  };

  // La «×» de un chip quita ese filtro al momento (el origen vuelve a «sin procesos del servidor»).
  const quitarFiltros = (campos: (keyof AuditLogFiltros)[]) => {
    const siguientes: AuditLogFiltros = { ...filtros };
    for (const campo of campos) delete siguientes[campo];
    if (campos.includes("origen")) siguientes.origen = "sin_servidor";
    setFiltros(siguientes);
    setFiltrosPendientes(siguientes);
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
  const elegirCategoria = (id: string) => {
    if (id === CATEGORIA_PROCESOS) return filtroRapido(undefined, undefined, true);
    const categoria = FILTROS_RAPIDOS.find((c) => c.id === id);
    if (categoria) filtroRapido(categoria.accion, categoria.tabla);
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
  // Lo que ya dice la categoría elegida no se repite en los chips de filtros.
  const ocultarEnResumen: (keyof AuditLogFiltros)[] = procesosActivos
    ? ["origen"]
    : categoriaActiva
      ? ["accion", "tabla"]
      : [];
  const hayFiltros =
    Object.entries(filtros).some(
      ([campo, valor]) =>
        Boolean(valor) && !(campo === "origen" && valor === "sin_servidor"),
    ) || !filtros.origen;

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  const primero = pagina * pageSize + 1;
  const ultimo = Math.min(total, (pagina + 1) * pageSize);

  return (
    <SuperAdminLayout>
      <div
        ref={setRaiz}
        className="flex min-w-0 flex-col gap-3 lg:gap-4"
        style={alto ? { height: alto } : undefined}
      >
        <div className="flex shrink-0 items-center gap-3">
          <ScrollText className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">
              Auditoría
            </h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Quién ha hecho qué en el panel, cuándo y desde qué dispositivo.
            </p>
          </div>
        </div>

        {accesosActivos === false && (
          <p
            role="status"
            className="shrink-0 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
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
          onQuitar={quitarFiltros}
          ocultarEnResumen={ocultarEnResumen}
        />

        <CategoriasAuditoria
          categorias={FILTROS_RAPIDOS}
          activa={categoriaActiva?.id}
          procesos={procesosActivos}
          onElegir={elegirCategoria}
          descripcion={
            procesosActivos
              ? "Procesos automáticos del servidor y de la base de datos"
              : (categoriaActiva?.descripcion ??
                (filtros.origen === "sin_servidor"
                  ? "Procesos del servidor ocultos"
                  : "Filtros personalizados"))
          }
        />

        {/* Conserva espacio para los registros incluso al desplegar los filtros. */}
        <Card className="flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden">
          <Tabs value={vista} onValueChange={setVista} className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-2 lg:px-4">
              <ChipsSubnivel
                aria-label="Vista"
                className="min-w-0"
                chips={[
                  { valor: "lista", etiqueta: "Lista" },
                  { valor: "dia", etiqueta: "Por día" },
                  { valor: "mes", etiqueta: "Por mes" },
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-9 shrink-0 gap-2 px-2.5 text-muted-foreground hover:text-foreground pointer-coarse:h-11 pointer-coarse:min-w-11"
                onClick={actualizar}
                aria-label="Actualizar"
                title="Actualizar"
              >
                <RefreshCw
                  className={cn("h-4 w-4", girando && "animate-spin motion-reduce:animate-none")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Actualizar</span>
              </Button>
            </div>
            <div
              ref={listaRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <TabsContent value="lista" className="mt-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : error ? (
                  <p className="m-3 rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive">
                    Error al cargar la auditoría: {error}
                  </p>
                ) : grupos.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                    <SearchX className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                      No hay registros con estos filtros.
                    </p>
                    {hayFiltros && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Prueba con otra categoría o quita algún filtro.
                        </p>
                        <Button variant="outline" size="sm" className="mt-1" onClick={limpiarFiltros}>
                          Ver toda la actividad
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <TablaEntradasAuditoria
                    grupos={grupos}
                    expandidas={expandidas}
                    onToggle={alternarExpandida}
                    separarPorDia
                  />
                )}
              </TabsContent>

              <TabsContent value="dia" className="mt-0 p-3 lg:p-4">
                <VistaPorDia
                  filtros={filtros}
                  rango={rangoMeses}
                  onRangoChange={setRangoMeses}
                  expandidasFilas={expandidas}
                  onToggleFila={alternarExpandida}
                />
              </TabsContent>

              <TabsContent value="mes" className="mt-0 p-3 lg:p-4">
                <VistaPorMes
                  filtros={filtros}
                  rango={rangoMeses}
                  onRangoChange={setRangoMeses}
                  expandidasFilas={expandidas}
                  onToggleFila={alternarExpandida}
                />
              </TabsContent>
            </div>
            {vista === "lista" && !error && total > 0 && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-2 lg:px-4">
                <p className="text-xs text-muted-foreground tabular-nums sm:text-sm">
                  {primero.toLocaleString("es-ES")}–{ultimo.toLocaleString("es-ES")} de{" "}
                  {total.toLocaleString("es-ES")}
                  <span className="hidden sm:inline"> registro{total === 1 ? "" : "s"}</span>
                </p>
                {totalPaginas > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1 px-2.5 pointer-coarse:h-11 pointer-coarse:min-w-11"
                      disabled={pagina === 0 || loading}
                      onClick={() => setPagina((p) => p - 1)}
                      aria-label="Anterior"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Anterior</span>
                    </Button>
                    <span className="min-w-12 text-center text-xs text-muted-foreground tabular-nums">
                      {pagina + 1} / {totalPaginas}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1 px-2.5 pointer-coarse:h-11 pointer-coarse:min-w-11"
                      disabled={pagina + 1 >= totalPaginas || loading}
                      onClick={() => setPagina((p) => p + 1)}
                      aria-label="Siguiente"
                    >
                      <span className="hidden sm:inline">Siguiente</span>
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Tabs>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}
