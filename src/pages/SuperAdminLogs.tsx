import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertOctagon, BarChart3, FileSearch, MousePointerClick, RefreshCw, Settings2 } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { esSinMigracionLogs, useConfigLogs, useEstadoRecogida, useIncidencias, type Entorno } from "@/hooks/useLogsWeb";
import { EstadoRecogidaAviso } from "@/components/logs-web/EstadoRecogidaAviso";
import { PestanaActividad } from "@/components/logs-web/PestanaActividad";
import { PestanaIncidencias } from "@/components/logs-web/PestanaIncidencias";
import { PestanaEstadisticas } from "@/components/logs-web/PestanaEstadisticas";
import { PestanaConfiguracion } from "@/components/logs-web/PestanaConfiguracion";
import { subpestanaConfig, type SubpestanaConfig } from "@/components/logs-web/subpestanasConfig";
import { DetalleSesion } from "@/components/logs-web/DetalleSesion";
import { DetalleIncidencia } from "@/components/logs-web/DetalleIncidencia";
import { Interruptor } from "@/components/logs-web/Controles";
import { PERIODOS, rangoPeriodo, type Periodo } from "@/components/logs-web/calculos";

const PESTANAS = ["actividad", "errores", "estadisticas", "configuracion"] as const;
type Pestana = (typeof PESTANAS)[number];
const CONTENIDO = "mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";
const ALTURA_MINIMA = 360;
/** Actualización automática controlada: cada 30 s, solo con la pestaña del navegador visible. */
const AUTO_MS = 30_000;

/**
 * Super Admin › Logs: actividad de la web (recorridos por sesión), errores e
 * incidencias (con su ticket en Linear) y estadísticas de comportamiento.
 * Ruta protegida por SuperAdminRoute; los datos, por la RLS (solo super admin).
 * Enlaces directos: ?tab=errores&incidencia=12 (el de los tickets) · ?sesion=<uuid> ·
 * ?tab=configuracion&config=linear (subpestaña de Configuración).
 */
export default function SuperAdminLogs() {
  const [params, setParams] = useSearchParams();
  const pestana: Pestana = (PESTANAS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Pestana) : params.get("incidencia") ? "errores" : "actividad";
  const incidencia = Number(params.get("incidencia")) || null;
  const sesion = params.get("sesion");
  const subConfig = subpestanaConfig(params.get("config"));
  const cambiarParam = useCallback((clave: string, valor: string | null) => {
    setParams((actual) => {
      const n = new URLSearchParams(actual);
      if (valor === null) n.delete(clave);
      else n.set(clave, valor);
      return n;
    }, { replace: clave === "tab" || clave === "config" });
  }, [setParams]);
  // Configuración con cambios sin guardar: se pregunta antes de salir a otra pestaña (el borrador se perdería).
  const [configSinGuardar, setConfigSinGuardar] = useState(false);
  const cambiarPestana = useCallback((v: string) => {
    if (pestana === "configuracion" && v !== "configuracion" && configSinGuardar
        && !window.confirm("Tienes cambios sin guardar en Configuración. ¿Salir sin guardarlos?")) return;
    cambiarParam("tab", v);
  }, [pestana, configSinGuardar, cambiarParam]);
  const cambiarSubConfig = useCallback((v: SubpestanaConfig) => cambiarParam("config", v), [cambiarParam]);

  const config = useConfigLogs();
  const [entorno, setEntorno] = useState<Entorno | null>(null);
  useEffect(() => {
    if (entorno === null && config.data) setEntorno(config.data.entorno_bd);
  }, [config.data, entorno]);
  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const [auto, setAuto] = useState(false);
  const [ancla, setAncla] = useState(() => new Date());
  // Con la actualización automática, el periodo avanza con el reloj.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => document.visibilityState === "visible" && setAncla(new Date()), AUTO_MS);
    return () => clearInterval(t);
  }, [auto]);
  useEffect(() => setAncla(new Date()), [periodo]);
  const { desde, hasta } = useMemo(() => rangoPeriodo(periodo, ancla), [periodo, ancla]);
  const autoRefresco = auto ? AUTO_MS : false;

  const estado = useEstadoRecogida(entorno, autoRefresco);
  // El número de la pestaña: solo los FALLOS DE LA WEB activos (en rojo). Los externos y lo que no depende
  // de la web se cuentan aparte dentro de la pestaña. Sin la migración del origen, todas las activas (como antes).
  const activas = useIncidencias({ entorno, estado: "activas", gravedad: null, fuente: null, texto: "", ocultarRuido: true, origen: "web" }, 0, autoRefresco);
  const fallosWeb = activas.data?.total ?? 0;
  const etiquetaFallos = activas.data?.sinOrigen ? `${fallosWeb} activas` : `${fallosWeb} ${fallosWeb === 1 ? "fallo de la web activo" : "fallos de la web activos"}`;

  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const sinMigracion = esSinMigracionLogs(config.error) || esSinMigracionLogs(estado.error);

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex min-w-0 flex-col gap-3" style={alto ? { height: alto } : undefined} data-testid="logs-web">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileSearch className="h-6 w-6 shrink-0 text-destructive sm:h-8 sm:w-8" aria-hidden />
            <h1 className="text-2xl font-bold">Logs</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Select value={entorno ?? undefined} onValueChange={(v) => setEntorno(v as Entorno)}>
              <SelectTrigger aria-label="Entorno" className="h-11 w-[150px]"><SelectValue placeholder="Entorno" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="produccion">Producción</SelectItem>
                <SelectItem value="demo">Demo</SelectItem>
                <SelectItem value="local">Local</SelectItem>
              </SelectContent>
            </Select>
            {pestana !== "estadisticas" && pestana !== "configuracion" && (
              <SelectorSubrayado aria-label="Periodo" valor={periodo} onCambio={(v) => setPeriodo(v as Periodo)} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
            )}
            <Interruptor id="logs-auto" etiqueta={<span className="inline-flex items-center gap-1"><RefreshCw className={auto ? "h-3.5 w-3.5 animate-spin [animation-duration:3s]" : "h-3.5 w-3.5"} /> Auto (30 s)</span>} valor={auto} onCambio={setAuto} />
          </div>
        </header>

        {sinMigracion ? (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            Falta aplicar en Supabase la migración de Logs (20261118100000_logs_web). Cuando esté, aquí saldrán la actividad, los errores y las estadísticas.
          </p>
        ) : (
          <>
            <div className="shrink-0"><EstadoRecogidaAviso datos={estado.data} /></div>
            <Tabs value={pestana} onValueChange={cambiarPestana} className="flex min-h-0 flex-1 flex-col">
              <PestanasPagina
                iconosSoloEscritorio
                pestanas={[
                  { valor: "actividad", etiqueta: "Actividad", icono: <MousePointerClick /> },
                  { valor: "errores", etiqueta: "Errores e incidencias", etiquetaCorta: "Errores", icono: <AlertOctagon />, contador: activas.data?.total, tonoContador: activas.data?.sinOrigen ? "dorado" : "rojo", etiquetaContador: etiquetaFallos },
                  { valor: "estadisticas", etiqueta: "Estadísticas", icono: <BarChart3 /> },
                  { valor: "configuracion", etiqueta: "Configuración", icono: <Settings2 /> },
                ]}
              />
              <TabsContent value="actividad" className={CONTENIDO}>
                {pestana === "actividad" && (
                  <PestanaActividad desde={desde} hasta={hasta} entorno={entorno} autoRefresco={autoRefresco}
                    onAbrirSesion={(id) => cambiarParam("sesion", id)} onAbrirIncidencia={(id) => cambiarParam("incidencia", String(id))} />
                )}
              </TabsContent>
              <TabsContent value="errores" className={CONTENIDO}>
                {pestana === "errores" && (
                  <PestanaIncidencias desde={desde} hasta={hasta} entorno={entorno} autoRefresco={autoRefresco}
                    onAbrirIncidencia={(id) => cambiarParam("incidencia", String(id))} onAbrirSesion={(id) => cambiarParam("sesion", id)} />
                )}
              </TabsContent>
              <TabsContent value="estadisticas" className={CONTENIDO}>
                {pestana === "estadisticas" && <PestanaEstadisticas entorno={entorno} />}
              </TabsContent>
              <TabsContent value="configuracion" className={CONTENIDO}>
                {pestana === "configuracion" && (
                  <PestanaConfiguracion estado={estado.data} sub={subConfig} onSub={cambiarSubConfig} onCambiosSinGuardar={setConfigSinGuardar} />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
      <DetalleSesion sesionId={sesion} onCerrar={() => cambiarParam("sesion", null)} onAbrirIncidencia={(id) => { cambiarParam("sesion", null); cambiarParam("incidencia", String(id)); }} />
      <DetalleIncidencia id={incidencia} onCerrar={() => cambiarParam("incidencia", null)} onAbrirSesion={(id) => { cambiarParam("incidencia", null); cambiarParam("sesion", id); }} />
    </SuperAdminLayout>
  );
}
