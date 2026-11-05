// Pestaña «Análisis» de Facturas: TABLERO que sale hecho al abrirla, un
// EXPLORADOR para cambiar la gráfica al instante sin la IA, «Ver documentos»
// desde cualquier cifra y el copiloto de IA PLEGADO en un panel lateral.
//
//   · Barra: periodo [Mes · Trimestre · Año · Todo · Personalizado] y local
//     [Todos · Casa Tomás · Touza]; los dos van a la URL
//     (`?tab=chat&desde=…&hasta=…&local=…`) para volver o compartir.
//   · Tablero (lo único que hace scroll): indicadores, «Explorar», tarjetas de
//     detalle y gráficas fijadas. Datos: `tablero_compras` (una llamada) y
//     `explorar_compras` (la gráfica del explorador).
//   · Cualquier cifra → «Ver documentos» (DocumentosDeCifra) → su PDF.
//   · Copiloto: panel lateral con el historial dentro; sus gráficas se pueden
//     fijar en el tablero o abrir en el explorador.
//
// Se sigue llamando ChatFacturas y expone `enviarConsulta`: el «Preguntar a la
// IA» de una factura en Compras abre el panel y pregunta.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarSearch, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatFacturas, type Conversacion } from "@/hooks/useChatFacturas";
import { consultaTablero, useTableroCompras } from "@/hooks/useTableroCompras";
import { useGraficasFijadas } from "@/hooks/useGraficasFijadas";
import { useExploracionesFijadas } from "@/hooks/useExplorarCompras";
import { FILTROS_LOCAL, type FiltroLocal } from "@/lib/facturas/resumenCompras";
import { fechasPeriodo, localRpc, sugerenciasDeTablero, type PeriodoAnalisis } from "@/lib/facturas/tableroCompras";
import {
  escribirAnalisisEnUrl,
  fechasSeleccion,
  leerAnalisisDeUrl,
  mismaSeleccion,
  SELECCION_POR_DEFECTO,
  textoRango,
  type SeleccionPeriodo,
} from "@/lib/facturas/periodoAnalisis";
import { ajustarConfig, CONFIG_POR_DEFECTO, FILTROS_VACIOS, type ConfigExplorador } from "@/lib/facturas/explorador";
import type { PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import type { GraficaIa } from "@/lib/facturas/graficasCopiloto";
import { EstadoVacio } from "@/components/facturas/compras/estilo";
import { TableroCompras } from "./analisis/TableroCompras";
import { Explorador } from "./analisis/Explorador";
import { SelectorPeriodo } from "./analisis/SelectorPeriodo";
import { DocumentosDeCifra } from "./analisis/DocumentosDeCifra";
import { ErrorTablero, EsqueletoTablero, Segmentado } from "./analisis/piezas";
import { CopilotoLateral } from "./copiloto/CopilotoLateral";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

interface ChatFacturasProps {
  /** Abre otra vista del panel con estos parámetros de URL (`?tab=compras&…`). */
  onIrA?: (enlace: string) => void;
}

const NOMBRE_PERIODO: Record<PeriodoAnalisis, string> = { mes: "este mes", trimestre: "este trimestre", anio: "este año", todo: "el histórico" };

/** «este año», «1 mar – 15 abr 2026», «el histórico». */
function textoSeleccion(sel: SeleccionPeriodo, hoy: Date): string {
  if (sel.tipo === "personalizado") return textoRango(sel.desde, sel.hasta);
  if (sel.tipo === "todo") return "Todo el histórico";
  const f = fechasPeriodo(sel.tipo, hoy);
  return f.desde && f.hasta ? textoRango(f.desde, f.hasta) : NOMBRE_PERIODO[sel.tipo];
}

export const ChatFacturas = forwardRef<ChatFacturasRef, ChatFacturasProps>(({ onIrA }, ref) => {
  const [hoy] = useState(() => new Date());
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const deUrl = useMemo(() => leerAnalisisDeUrl(params, hoy), [params, hoy]);
  const [seleccion, setSeleccion] = useState<SeleccionPeriodo>(() => deUrl.periodo ?? SELECCION_POR_DEFECTO);
  const [local, setLocal] = useState<FiltroLocal>(() => deUrl.local ?? "todos");
  const [config, setConfig] = useState<ConfigExplorador>(CONFIG_POR_DEFECTO);
  const [peticionDocs, setPeticionDocs] = useState<PeticionDocumentos | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  // URL → estado (Atrás/Adelante, un enlace compartido).
  useEffect(() => {
    if (deUrl.periodo) setSeleccion((s) => (mismaSeleccion(s, deUrl.periodo as SeleccionPeriodo) ? s : (deUrl.periodo as SeleccionPeriodo)));
    if (deUrl.local) setLocal(deUrl.local);
  }, [deUrl]);
  // Estado → URL (sin apilar historial).
  useEffect(() => {
    setParams((prev) => {
      const sig = escribirAnalisisEnUrl(prev, seleccion, local, hoy);
      return sig.toString() === prev.toString() ? prev : sig;
    }, { replace: true });
  }, [seleccion, local, hoy, setParams]);

  const fechas = useMemo(() => fechasSeleccion(seleccion, hoy), [seleccion, hoy]);
  const lrpc = localRpc(local);
  const tablero = useTableroCompras(fechas.desde, fechas.hasta, lrpc);

  // Precarga de lo más probable tras el primer tablero: el mes y el trimestre en curso.
  useEffect(() => {
    if (!tablero.isSuccess) return;
    const t = setTimeout(() => {
      for (const p of ["mes", "trimestre"] as PeriodoAnalisis[]) {
        const f = fechasPeriodo(p, hoy);
        void qc.prefetchQuery(consultaTablero(f.desde, f.hasta, lrpc));
      }
    }, 800);
    return () => clearTimeout(t);
  }, [tablero.isSuccess, qc, hoy, lrpc]);

  const { fijadas, fijar, quitar } = useGraficasFijadas();
  const idsFijadas = useMemo(() => new Set(fijadas.map((g) => g.id)), [fijadas]);
  const exploraciones = useExploracionesFijadas();
  const idsExploraciones = useMemo(() => new Set(exploraciones.fijadas.map((g) => g.id)), [exploraciones.fijadas]);

  const {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    nuevaConversacion,
    enviarMensaje,
    regenerarRespuesta,
    eliminarConversacion,
  } = useChatFacturas();

  const periodoSugerencias: PeriodoAnalisis = seleccion.tipo === "personalizado" ? "todo" : seleccion.tipo;
  const sugerencias = useMemo(() => sugerenciasDeTablero(tablero.data, periodoSugerencias), [tablero.data, periodoSugerencias]);

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      setVerHistorial(false);
      setAbierto(true);
      void enviarMensaje(texto);
    },
  }));

  const verExplorador = () =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-testid='explorador']")?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
  const explorar = useCallback((parcial: Partial<ConfigExplorador>) => {
    setConfig((c) => ajustarConfig({ ...c, ...parcial }).config);
    verExplorador();
  }, []);
  const explorarGraficaIa = (g: GraficaIa) => {
    explorar({
      medida: "precio",
      agrupar: "mes",
      desglose: "proveedor",
      grafica: "auto",
      filtros: { ...FILTROS_VACIOS, productos: [g.serie.producto], unidad: g.serie.unidad ? g.serie.unidad.toLowerCase() : null },
    });
  };
  const abrirConversacion = (c: Conversacion) => {
    setVerHistorial(false);
    return seleccionarConversacion(c);
  };
  const nueva = () => {
    setVerHistorial(false);
    return nuevaConversacion();
  };
  const irA = (enlace: string) => onIrA?.(enlace);
  const textoPeriodo = textoSeleccion(seleccion, hoy);

  const datos = tablero.data;
  let cuerpo;
  if (tablero.isLoading) cuerpo = <EsqueletoTablero />;
  else if (tablero.isError && !datos)
    cuerpo = <ErrorTablero mensaje={(tablero.error as Error)?.message ?? ""} onReintentar={() => void tablero.refetch()} />;
  else if (!datos || datos.sinDatos)
    cuerpo = (
      <div className="rounded-xl border border-dashed border-border">
        <EstadoVacio
          icono={<CalendarSearch />}
          titulo={`No hay documentos en ${seleccion.tipo === "personalizado" ? textoPeriodo : NOMBRE_PERIODO[seleccion.tipo]}${local !== "todos" ? ` de ${local === "touza" ? "Touza" : "Casa Tomás"}` : ""}.`}
          texto="Prueba con otro periodo o con los dos locales."
          accion={seleccion.tipo !== "todo" ? { etiqueta: "Ver todo el histórico", onClick: () => setSeleccion({ tipo: "todo" }) } : undefined}
        />
      </div>
    );
  else
    cuerpo = (
      <TableroCompras
        datos={datos}
        periodo={fechas}
        local={lrpc}
        onDocumentos={setPeticionDocs}
        onIrA={irA}
        onExplorar={explorar}
        fijadasIa={fijadas}
        onQuitarFijadaIa={quitar}
        fijadasExplorador={exploraciones.fijadas}
        onQuitarFijadaExplorador={exploraciones.quitar}
        explorador={
          <Explorador
            config={config}
            onConfig={setConfig}
            periodo={fechas}
            textoPeriodo={textoPeriodo}
            local={lrpc}
            onLocal={setLocal}
            onTramo={(desde, hasta) => setSeleccion({ tipo: "personalizado", desde, hasta })}
            onDocumentos={setPeticionDocs}
            onIrA={irA}
            fijadas={idsExploraciones}
            onFijar={exploraciones.fijar}
            onQuitarFijada={exploraciones.quitar}
          />
        }
      />
    );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2" data-tour="facturas-analisis-barra">
        <SelectorPeriodo valor={seleccion} onCambio={setSeleccion} hoy={hoy} />
        <Segmentado<FiltroLocal> etiqueta="Local" opciones={FILTROS_LOCAL} valor={local} onCambio={setLocal} />
        {tablero.isFetching && !tablero.isLoading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Actualizando…
          </span>
        )}
        <Button
          type="button"
          className="ml-auto h-11 gap-1.5"
          // Abre y cierra el panel (no es modal: el botón sigue a mano con él abierto).
          onClick={() => {
            setVerHistorial(false);
            setAbierto((v) => !v);
          }}
          aria-expanded={abierto}
          aria-controls={abierto ? "copiloto-lateral" : undefined}
          data-tour="facturas-ia-abrir"
          aria-label="Pregúntale a la IA"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {/* En tablet vertical la barra no cabe entera: «IA» a secas (el nombre accesible sigue entero). */}
          <span className="hidden lg:inline">Pregúntale a la</span> IA
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="region"
        aria-label="Tablero de compras"
        data-testid="tablero-analisis"
        data-tour="facturas-analisis-tablero"
      >
        {cuerpo}
      </div>

      <DocumentosDeCifra peticion={peticionDocs} onCerrar={() => setPeticionDocs(null)} onIrA={onIrA} />

      <CopilotoLateral
        abierto={abierto}
        onAbiertoCambia={setAbierto}
        verHistorial={verHistorial}
        onVerHistorial={setVerHistorial}
        conversaciones={conversaciones}
        conversacionActiva={conversacionActiva}
        onSeleccionarConversacion={abrirConversacion}
        onNuevaConversacion={nueva}
        onEliminarConversacion={eliminarConversacion}
        mensajes={mensajes}
        isLoading={isLoading}
        isSending={isSending}
        sugerencias={sugerencias}
        onEnviar={(texto) => void enviarMensaje(texto)}
        onRegenerar={regenerarRespuesta}
        fijadas={idsFijadas}
        onFijar={fijar}
        onQuitarFijada={quitar}
        onExplorar={explorarGraficaIa}
      />
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
