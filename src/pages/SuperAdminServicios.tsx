import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Bot, Loader2, RefreshCw, Server, Settings2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { calcularAvisosCostes, DIAS_SIN_REGISTRO } from "@/components/costes/calculos";
import { useVentanaModelos } from "@/components/costes/CostesIa";
import { DialogoEditarServicio } from "@/components/servicios/DialogoEditarServicio";
import { PestanaConfigurar } from "@/components/servicios/PestanaConfigurar";
import { PestanaCostes } from "@/components/servicios/PestanaCostes";
import { PestanaEstado } from "@/components/servicios/PestanaEstado";
import { PestanaModelos } from "@/components/servicios/PestanaModelos";
import { PestanaServicios } from "@/components/servicios/PestanaServicios";
import { PESTANA_POR_DEFECTO, type PestanaServicios as Pestana, pestanaDeUrl } from "@/components/servicios/pestanas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useCostePorModelo, useFuncionesSinRegistro } from "@/hooks/useCostes";
import { useActualizarLecturas, useConfigServicios, useLecturasServicios, useServiciosContratados } from "@/hooks/useServicios";
import {
  CAMBIO_POR_DEFECTO,
  type DestinoPendiente,
  type LecturaServicio,
  type ServicioContratado,
  estadoInstalacion,
  haceCuanto,
  ordenarServicios,
  pendientesServicios,
  proximasRenovaciones,
  resumirCostes,
  servicioNuevo,
} from "@/lib/servicios";
import { cn } from "@/lib/utils";

/** Suelo (px) del alto: por debajo (teclado abierto, ventana muy baja) vuelve el scroll de página. */
const ALTURA_MINIMA_SERVICIOS = 360;

/**
 * Contenido de cada pestaña: ocupa el alto que queda bajo la barra y hace scroll por dentro.
 * `data-[state=inactive]:hidden` imprescindible (como en Tienda/Cheques): una clase `flex` le gana al
 * atributo `hidden` con el que Radix deja las pestañas inactivas.
 */
const CONTENIDO_PESTANA = "mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

/**
 * Super Admin › Servicios: el sitio único de lo contratado y de lo que cuesta
 * (desde el 04/11/2026 también la antigua pantalla «Costes»; su ruta redirige
 * a la pestaña Costes). Cuatro pestañas, en la URL (`?tab=`):
 *   · Estado (06/11/2026, antes «Resumen»): el semáforo de toda la instalación,
 *     una ficha visual por servicio y, si hay algo, una línea por cosa que mirar.
 *   · Servicios: una tarjeta por servicio en uso con su consumo.
 *   · Costes: coste del mes por proveedor y la IA por proceso (tope, mes
 *     anterior, sincronizar con OpenAI).
 *   · Modelos (07/11/2026): qué modelo de OpenAI usa cada función, cambiarlo
 *     y probarlo; modelos de la cuenta (nuevos marcados) e historial.
 *   · Configurar: añadir, quitar, borrar y editar servicios; tipo de cambio.
 * Las lecturas las hace la Edge Function `servicios-uso` (caché de 15 min);
 * «Actualizar» (arriba) la fuerza para todos.
 */
export default function SuperAdminServicios() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pestana = pestanaDeUrl(searchParams.get("tab"));
  const cambiarPestana = useCallback(
    (v: string) => {
      setSearchParams(
        (actual) => {
          const next = new URLSearchParams(actual);
          if (v === PESTANA_POR_DEFECTO) next.delete("tab");
          else next.set("tab", v);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const servicios = useServiciosContratados();
  const disponible = servicios.data?.disponible === true;
  const costes = servicios.data?.disponible === true ? servicios.data.costes : false;
  const lecturas = useLecturasServicios(disponible);
  const config = useConfigServicios(disponible && costes);
  const actualizar = useActualizarLecturas();
  // Avisos de la IA para el Resumen (mismas consultas, y misma caché, que la pestaña Costes).
  const { desde, hasta } = useVentanaModelos();
  const sinRegistroQ = useFuncionesSinRegistro(DIAS_SIN_REGISTRO);
  const porModeloQ = useCostePorModelo(desde, hasta);

  const [editando, setEditando] = useState<ServicioContratado | null>(null);
  const [creando, setCreando] = useState<ServicioContratado | null>(null);
  const [actualizando, setActualizando] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const quitarFoco = useCallback(() => setFoco(null), []);
  // Alto de la pantalla (regla del dueño, 2026-10-07): la cabecera y las pestañas quedan fijas y cada pestaña
  // hace scroll por dentro. Sin medida (jsdom, primer pintado) cae al layout con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_SERVICIOS);

  const todos = useMemo(() => (servicios.data?.disponible ? ordenarServicios(servicios.data.servicios) : []), [servicios.data]);
  const enUso = useMemo(() => todos.filter((s) => s.activo !== false), [todos]);
  const quitados = useMemo(
    () => todos.filter((s) => s.activo === false).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [todos],
  );
  const porProveedor = useMemo(() => new Map<string, LecturaServicio>((lecturas.data?.lecturas ?? []).map((l) => [l.proveedor, l])), [lecturas.data]);
  const sinLector = useMemo(() => new Set(lecturas.data?.sinLector ?? []), [lecturas.data]);
  const eurPorUsd = config.data?.eurPorUsd ?? CAMBIO_POR_DEFECTO;
  const resumen = useMemo(() => resumirCostes(enUso, porProveedor, eurPorUsd), [enUso, porProveedor, eurPorUsd]);
  const renovaciones = useMemo(() => proximasRenovaciones(enUso, porProveedor), [enUso, porProveedor]);
  const estadoGeneral = useMemo(() => estadoInstalacion({ servicios: enUso, lecturas: porProveedor, renovaciones, sinLector }), [enUso, porProveedor, renovaciones, sinLector]);
  const avisosIa = useMemo(() => {
    const a = calcularAvisosCostes({ sinRegistro: sinRegistroQ.data, modelos: porModeloQ.data, fijos: [], fijosSinVerificarRpc: null });
    return { sinRegistro: a.sinInstrumentar.length + a.instrumentadasMudas.length, modelosSinTarifa: a.modelosSinTarifa.length };
  }, [sinRegistroQ.data, porModeloQ.data]);
  const pendientes = useMemo(
    () => pendientesServicios({ servicios: enUso, lecturas: porProveedor, renovaciones, resumen, sinLector, ia: avisosIa }),
    [enUso, porProveedor, renovaciones, resumen, sinLector, avisosIa],
  );
  const urgentes = pendientes.filter((p) => p.gravedad === "rojo").length;
  const ultima = useMemo(() => {
    const fechas = (lecturas.data?.lecturas ?? []).map((l) => l.tomado_en).filter(Boolean).sort();
    return fechas.length ? fechas[fechas.length - 1] : null;
  }, [lecturas.data]);

  const pedirActualizacion = async (servicio?: ServicioContratado) => {
    setActualizando(servicio?.proveedor ?? "todos");
    try {
      const r = await actualizar.mutateAsync(servicio?.proveedor);
      if (r.errorFuncion) toast.error(r.errorFuncion);
      else toast.success(servicio ? `${servicio.nombre}: consumo actualizado` : "Consumo actualizado");
    } catch {
      toast.error("No se pudo actualizar el consumo.");
    } finally {
      setActualizando(null);
    }
  };

  const irA = (d: DestinoPendiente) => {
    cambiarPestana(d.pestana);
    setFoco(d.pestana === "servicios" && d.proveedor ? d.proveedor : null);
  };
  const abrirServicio = (proveedor: string) => irA({ pestana: "servicios", proveedor });
  const anadir = () => setCreando(servicioNuevo(Math.max(0, ...todos.map((s) => s.orden ?? 0)) + 10));

  // Cargando, error o sin migración: lo dicen las pestañas que dependen de los servicios.
  let estado: ReactNode = null;
  if (servicios.isLoading) {
    estado = (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Cargando los servicios…
      </p>
    );
  } else if (servicios.isError) {
    estado = (
      <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <p>No se pudieron cargar los servicios: {servicios.error instanceof Error ? servicios.error.message : "error desconocido"}.</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => void servicios.refetch()}>Reintentar</Button>
      </div>
    );
  } else if (!disponible) {
    estado = (
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Falta aplicar en Supabase la migración de Servicios (20261103120000_servicios_contratados). Cuando esté, aquí saldrán los servicios.
      </p>
    );
  }

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} data-testid="servicios" className="flex min-w-0 flex-col gap-3" style={alto ? { height: alto } : undefined}>
        <header className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Server className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" aria-hidden="true" />
            <h1 className="min-w-0 text-2xl font-bold text-foreground">Servicios</h1>
          </div>
          {disponible && (
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2"
              onClick={() => void pedirActualizacion()}
              disabled={actualizando !== null || lecturas.isLoading}
              title={lecturas.isLoading ? "Leyendo el consumo…" : `Última lectura ${haceCuanto(ultima)}`}
            >
              <RefreshCw className={cn("h-4 w-4", actualizando === "todos" && "animate-spin")} aria-hidden="true" />
              Actualizar
            </Button>
          )}
        </header>

        {lecturas.data?.errorFuncion && (
          <p role="alert" className="flex shrink-0 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {lecturas.data.errorFuncion}
              {lecturas.data.lecturas.length > 0 ? " Se muestran las últimas lecturas guardadas." : ""}
            </span>
          </p>
        )}

        <Tabs value={pestana} onValueChange={(v) => cambiarPestana(v as Pestana)} className="flex min-h-0 flex-1 flex-col">
          {/* Sin iconos en el móvil: así caben a 320 px sin hacer scroll. */}
          <PestanasPagina
            iconosSoloEscritorio
            pestanas={[
              { valor: "estado", etiqueta: "Estado", icono: <Activity />, contador: urgentes, tonoContador: "dorado", etiquetaContador: `${urgentes} ${urgentes === 1 ? "urgente" : "urgentes"}` },
              { valor: "servicios", etiqueta: "Servicios", icono: <Server />, contador: disponible ? enUso.length : undefined },
              { valor: "costes", etiqueta: "Costes", icono: <Wallet /> },
              { valor: "modelos", etiqueta: "Modelos", icono: <Bot /> },
              { valor: "configurar", etiqueta: "Configurar", icono: <Settings2 /> },
            ]}
          />
          <TabsContent value="estado" className={CONTENIDO_PESTANA}>
            {estado ?? (
              <PestanaEstado
                estado={estadoGeneral}
                resumen={resumen}
                pendientes={pendientes}
                ultima={ultima}
                cargandoLecturas={lecturas.isLoading}
                onAbrir={abrirServicio}
                onIr={irA}
              />
            )}
          </TabsContent>
          <TabsContent value="servicios" className={CONTENIDO_PESTANA}>
            {estado ?? (
              <PestanaServicios
                enUso={enUso}
                quitados={quitados.length}
                porProveedor={porProveedor}
                sinLector={sinLector}
                eurPorUsd={eurPorUsd}
                cargando={lecturas.isLoading}
                actualizando={actualizando}
                onActualizar={(s) => void pedirActualizacion(s)}
                onEditar={setEditando}
                foco={foco}
                onFocoHecho={quitarFoco}
                onIrConfigurar={() => cambiarPestana("configurar")}
              />
            )}
          </TabsContent>
          <TabsContent value="costes" className={CONTENIDO_PESTANA}>
            <PestanaCostes resumen={estado ? null : resumen} estadoServicios={estado} eurPorUsd={eurPorUsd} costesDisponibles={costes} />
          </TabsContent>
          <TabsContent value="modelos" className={CONTENIDO_PESTANA}>
            {pestana === "modelos" && <PestanaModelos />}
          </TabsContent>
          <TabsContent value="configurar" className={CONTENIDO_PESTANA}>
            {estado ?? (
              <PestanaConfigurar
                enUso={enUso}
                quitados={quitados}
                costes={costes}
                config={config.data ?? null}
                onEditar={setEditando}
                onAnadir={anadir}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
      <DialogoEditarServicio servicio={editando} onCerrar={() => setEditando(null)} costes={costes} />
      <DialogoEditarServicio servicio={creando} onCerrar={() => setCreando(null)} costes={costes} nuevo existentes={todos.map((s) => s.proveedor)} />
    </SuperAdminLayout>
  );
}
