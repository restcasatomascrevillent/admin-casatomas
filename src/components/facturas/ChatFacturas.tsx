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
//
// Facturas la deja MONTADA al ir a otra pestaña (`activa = false`): al volver
// siguen el explorador, la conversación y el copiloto como estaban. Por eso la
// URL solo se escribe cuando cambia el periodo o el local AQUÍ (no al montar ni
// al navegar a Compras), y el copiloto se esconde mientras no se ve Análisis.
//
// `pantallaCompleta` (ruta `/facturas/ia`, 06/11/2026): el chat ocupa el sitio
// del tablero (ChatPantallaCompleta) con este mismo estado; el tablero y el
// explorador siguen montados (ocultos) y al volver están como se dejaron.
//
// Permisos (06/11/2026, dueño): la IA (botón, panel lateral y pantalla
// completa) solo con «Editar» en Facturas (`conIa`); con solo «Ver» se consulta
// el tablero y el explorador, y lo que cambia datos (p. ej. «Clasificar con
// IA») no sale (`puedeEditar`, por EdicionFacturasContext). Las dos, por
// defecto, no: la página Facturas las pasa según el permiso.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarSearch, LayoutGrid, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatFacturas, type Conversacion } from "@/hooks/useChatFacturas";
import { consultaTablero, useTableroCompras } from "@/hooks/useTableroCompras";
import { useGraficasFijadas } from "@/hooks/useGraficasFijadas";
import { useExploracionesFijadas } from "@/hooks/useExplorarCompras";
import { FILTROS_LOCAL, type FiltroLocal } from "@/lib/facturas/resumenCompras";
import { fechasPeriodo, localRpc, sugerenciasDeTablero, type PeriodoAnalisis } from "@/lib/facturas/tableroCompras";
import {
  escribirAnalisisEnUrl,
  fechasSeleccion,
  isoLocal,
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
import { ChatPantallaCompleta } from "./copiloto/ChatPantallaCompleta";
import { enlacePantallaCompleta, destinoVolver, type EstadoPantallaCompleta } from "@/lib/facturas/copilotoCompleto";
import { desplazarDentro, esMovil } from "./analisis/desplazar";
import { EdicionFacturasContext } from "./analisis/edicionFacturas";

export interface ChatFacturasRef {
  enviarConsulta: (texto: string) => void;
}

interface ChatFacturasProps {
  /** Abre otra vista del panel con estos parámetros de URL (`?tab=compras&…`). */
  onIrA?: (enlace: string) => void;
  /** ¿Se está viendo la pestaña? (sigue montada aunque no). Por defecto, sí. */
  activa?: boolean;
  /** `/facturas/ia`: el chat a pantalla completa en lugar del tablero. */
  pantallaCompleta?: boolean;
  /** La IA de Facturas (botón, panel y pantalla completa): solo con «Editar». Por defecto, no. */
  conIa?: boolean;
  /** «Editar» en Facturas: enseña los accesos que cambian datos («Clasificar con IA»). Por defecto, no. */
  puedeEditar?: boolean;
}

const NOMBRE_PERIODO: Record<PeriodoAnalisis, string> = { mes: "este mes", trimestre: "este trimestre", anio: "este año", todo: "el histórico" };

/** Para «Volver …» tras «Ver solo este tramo»: «al año 2026», «a este mes», «a 1 mar – 15 abr 2026». */
function textoVolver(sel: SeleccionPeriodo, hoy: Date): string {
  if (sel.tipo === "personalizado") return `a ${textoRango(sel.desde, sel.hasta)}`;
  if (sel.tipo === "anio") return `al año ${hoy.getFullYear()}`;
  return sel.tipo === "todo" ? "a todo el histórico" : `a ${NOMBRE_PERIODO[sel.tipo]}`;
}

/** «Ver solo este tramo» se puede deshacer: el periodo y el eje de antes. */
interface TramoAnterior {
  seleccion: SeleccionPeriodo;
  agrupar: ConfigExplorador["agrupar"];
}

/** «Hoy», que cambia si la tablet se queda encendida pasada la medianoche (cada minuto y al volver a la pestaña). */
function useHoy(): Date {
  const [hoy, setHoy] = useState(() => new Date());
  useEffect(() => {
    const mirar = () => {
      const ahora = new Date();
      setHoy((h) => (isoLocal(h) === isoLocal(ahora) ? h : ahora));
    };
    const id = window.setInterval(mirar, 60_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") mirar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);
  return hoy;
}

/** «este año», «1 mar – 15 abr 2026», «el histórico». */
function textoSeleccion(sel: SeleccionPeriodo, hoy: Date): string {
  if (sel.tipo === "personalizado") return textoRango(sel.desde, sel.hasta);
  if (sel.tipo === "todo") return "Todo el histórico";
  const f = fechasPeriodo(sel.tipo, hoy);
  return f.desde && f.hasta ? textoRango(f.desde, f.hasta) : NOMBRE_PERIODO[sel.tipo];
}

export const ChatFacturas = forwardRef<ChatFacturasRef, ChatFacturasProps>(({ onIrA, activa = true, pantallaCompleta: pidePantallaCompleta = false, conIa = false, puedeEditar = false }, ref) => {
  // Sin IA no hay pantalla completa (la página ya lleva a /facturas): se queda el tablero.
  const pantallaCompleta = pidePantallaCompleta && conIa;
  const hoy = useHoy();
  const hoyRef = useRef(hoy);
  hoyRef.current = hoy;
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const qc = useQueryClient();
  // Solo depende de la URL: que cambie «hoy» no reinterpreta las fechas que ya hay en ella.
  const deUrl = useMemo(() => leerAnalisisDeUrl(params, hoyRef.current), [params]);
  const [seleccion, setSeleccion] = useState<SeleccionPeriodo>(() => deUrl.periodo ?? SELECCION_POR_DEFECTO);
  const [local, setLocal] = useState<FiltroLocal>(() => deUrl.local ?? "todos");
  const [config, setConfig] = useState<ConfigExplorador>(CONFIG_POR_DEFECTO);
  const [peticionDocs, setPeticionDocs] = useState<PeticionDocumentos | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  // «Personalizar» el tablero (el diálogo lo monta TableroCompras).
  const [personalizando, setPersonalizando] = useState(false);
  const [tramos, setTramos] = useState<TramoAnterior[]>([]);
  // Lo último que hay (o se ha escrito) en la URL: solo se escribe lo que CAMBIA aquí.
  const escrito = useRef({ seleccion, local, dia: isoLocal(hoy) });

  // URL → estado (Atrás/Adelante, un enlace compartido).
  useEffect(() => {
    const p = deUrl.periodo;
    const l = deUrl.local;
    if (p) {
      setSeleccion((s) => (mismaSeleccion(s, p) ? s : p));
      if (!mismaSeleccion(escrito.current.seleccion, p)) setTramos([]);
    }
    if (l) setLocal(l);
    escrito.current = { ...escrito.current, ...(p ? { seleccion: p } : {}), ...(l ? { local: l } : {}) };
  }, [deUrl]);
  // Estado → URL (sin apilar historial). Solo cuando el periodo o el local
  // cambian AQUÍ (o cambia el día y la URL lleva las fechas de Análisis): si
  // no, al estar montada en Compras le reescribía el periodo (F21, QA 05/11/2026).
  useEffect(() => {
    const e = escrito.current;
    const dia = isoLocal(hoy);
    const cambio = !mismaSeleccion(e.seleccion, seleccion) || e.local !== local;
    const nuevoDia = e.dia !== dia;
    escrito.current = { seleccion, local, dia };
    const prev = paramsRef.current;
    if (!cambio && !(nuevoDia && (prev.has("desde") || prev.has("periodo")))) return;
    const sig = escribirAnalisisEnUrl(prev, seleccion, local, hoy);
    if (sig.toString() !== prev.toString()) setParams(sig, { replace: true });
  }, [seleccion, local, hoy, setParams]);

  /** El periodo que elige el dueño (barra, «Ver todo el histórico»): olvida los tramos. */
  const elegirPeriodo = useCallback((s: SeleccionPeriodo) => {
    setTramos([]);
    setSeleccion(s);
  }, []);

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
    abrirConversacionPorId,
    nuevaConversacion,
    enviarMensaje,
    regenerarRespuesta,
    eliminarConversacion,
  } = useChatFacturas({ activo: conIa });
  // Lo escrito en la caja vive aquí: sigue al pasar del panel a pantalla completa y al volver.
  const [borrador, setBorrador] = useState("");

  const periodoSugerencias: PeriodoAnalisis = seleccion.tipo === "personalizado" ? "todo" : seleccion.tipo;
  const sugerencias = useMemo(() => sugerenciasDeTablero(tablero.data, periodoSugerencias), [tablero.data, periodoSugerencias]);

  useImperativeHandle(ref, () => ({
    enviarConsulta: (texto: string) => {
      if (!conIa) return;
      setVerHistorial(false);
      setAbierto(true);
      void enviarMensaje(texto);
    },
  }));

  // Enseña el explorador desplazando SOLO el tablero (scrollIntoView movía también la página).
  const verExplorador = () => requestAnimationFrame(() => desplazarDentro(document.querySelector<HTMLElement>("[data-testid='explorador']"), "start"));
  const explorar = useCallback((parcial: Partial<ConfigExplorador>) => {
    setConfig((c) => ajustarConfig({ ...c, ...parcial }).config);
    verExplorador();
  }, []);
  const explorarGraficaIa = (g: GraficaIa) => {
    // En el móvil el copiloto ocupa toda la pantalla: se cierra para ver el explorador.
    if (esMovil()) setAbierto(false);
    explorar({
      medida: "precio",
      agrupar: "mes",
      desglose: "proveedor",
      grafica: "auto",
      filtros: { ...FILTROS_VACIOS, productos: [g.serie.producto], unidad: g.serie.unidad ? g.serie.unidad.toLowerCase() : null },
    });
  };
  // ─── Pantalla completa (`/facturas/ia`) ───
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const enlaceCompleta = enlacePantallaCompleta(conversacionActiva?.id);
  const irAPantallaCompleta = () => {
    const estado: EstadoPantallaCompleta = { volverA: `${ubicacion.pathname}${ubicacion.search}` };
    navegar(enlaceCompleta, { state: estado });
  };
  /** Al salir de pantalla completa: al panel lateral (por defecto) o al explorador con una gráfica de la IA. */
  const alSalir = useRef<GraficaIa | null>(null);
  const salirDePantallaCompleta = (explorarGrafica?: GraficaIa) => {
    alSalir.current = explorarGrafica ?? null;
    const estado = ubicacion.state as Partial<EstadoPantallaCompleta> | null;
    // Vino de Análisis en esta pestaña: «Atrás», a la misma URL (periodo y local) y sin apilar historial.
    if (estado?.volverA) navegar(-1);
    else navegar(destinoVolver(estado));
  };
  const estabaCompleta = useRef(pantallaCompleta);
  useEffect(() => {
    if (estabaCompleta.current && !pantallaCompleta) {
      const g = alSalir.current;
      alSalir.current = null;
      if (g) explorarGraficaIa(g);
      // De vuelta, el panel lateral abierto con la misma conversación (en el móvil, para ver la gráfica, no).
      if (!g || !esMovil()) {
        setVerHistorial(false);
        setAbierto(true);
      }
    }
    estabaCompleta.current = pantallaCompleta;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar o salir de pantalla completa
  }, [pantallaCompleta]);

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
  // «Ver solo este tramo»: se apunta el periodo y el eje de antes para poder volver.
  const verTramo = (desde: string, hasta: string) => {
    setTramos((t) => [...t, { seleccion, agrupar: config.agrupar }]);
    setSeleccion({ tipo: "personalizado", desde, hasta });
  };
  const ultimoTramo = tramos[tramos.length - 1];
  const volverTramo = ultimoTramo
    ? {
        texto: textoVolver(ultimoTramo.seleccion, hoy),
        volver: () => {
          setTramos((t) => t.slice(0, -1));
          setSeleccion(ultimoTramo.seleccion);
          setConfig((c) => ajustarConfig({ ...c, agrupar: ultimoTramo.agrupar }).config);
        },
      }
    : null;

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
          accion={seleccion.tipo !== "todo" ? { etiqueta: "Ver todo el histórico", onClick: () => elegirPeriodo({ tipo: "todo" }) } : undefined}
        />
      </div>
    );
  else
    cuerpo = (
      <TableroCompras
        datos={datos}
        periodo={fechas}
        local={lrpc}
        pendiente={tablero.isPlaceholderData}
        personalizando={personalizando}
        onPersonalizando={setPersonalizando}
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
            onTramo={verTramo}
            volverTramo={volverTramo}
            hoy={hoy}
            onDocumentos={setPeticionDocs}
            onIrA={irA}
            fijadas={idsExploraciones}
            onFijar={exploraciones.fijar}
            onQuitarFijada={exploraciones.quitar}
          />
        }
      />
    );

  const copilotoVisible = conIa && abierto && activa && !pantallaCompleta;
  return (
    // Con el copiloto abierto (360 px, no modal) el contenido deja su hueco a la
    // derecha (desde lg, 1024 px): si no, el panel tapaba el botón y la franja
    // derecha (QA 05/11/2026). En la tablet vertical no: quedarían ~440 px y las
    // tarjetas, a 2 columnas, se aplastaban; ahí el panel va por encima.
    <div className={cn("flex h-full min-h-0 w-full flex-col gap-2 transition-[padding] motion-reduce:transition-none", copilotoVisible && "lg:pr-[360px]")}>
      <div className={cn("flex shrink-0 flex-wrap items-center gap-2", pantallaCompleta && "hidden")} data-tour="facturas-analisis-barra">
        <SelectorPeriodo valor={seleccion} onCambio={elegirPeriodo} hoy={hoy} />
        {/* Local, «Actualizando…» y la IA van juntos: si la barra no cabe (tablet en
            vertical), bajan juntos a la segunda fila y el botón no se queda solo. */}
        <div className="flex flex-auto flex-wrap items-center gap-2 sm:flex-nowrap">
          <Segmentado<FiltroLocal> etiqueta="Local" opciones={FILTROS_LOCAL} valor={local} onCambio={setLocal} />
          {tablero.isFetching && !tablero.isLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Actualizando…
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            // En el móvil no cabe junto al local sin dejar sola a la IA: allí se personaliza
            // desde el final del tablero («Añadir o quitar módulos»).
            className="ml-auto hidden h-11 gap-1.5 sm:inline-flex"
            onClick={() => setPersonalizando(true)}
            disabled={!datos || datos.sinDatos}
            aria-haspopup="dialog"
            aria-label="Personalizar el tablero"
            title="Elegir qué cifras y módulos se ven, en qué orden y de qué tamaño"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
            <span className="hidden xl:inline">Personalizar</span>
          </Button>
          {conIa && (
          <Button
            type="button"
            className="ml-auto h-11 gap-1.5 sm:ml-0"
            // Abre y cierra el panel (no es modal: el botón sigue a mano con él abierto).
            onClick={() => {
              setVerHistorial(false);
              setAbierto((v) => !v);
            }}
            aria-expanded={copilotoVisible}
            aria-controls={copilotoVisible ? "copiloto-lateral" : undefined}
            data-tour="facturas-ia-abrir"
            aria-label="Pregúntale a la IA"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {/* En tablet vertical la barra no cabe entera: «IA» a secas (el nombre accesible sigue entero). */}
            <span className="hidden lg:inline">Pregúntale a la</span> IA
          </Button>
          )}
        </div>
      </div>

      {/* `relative`: los `sr-only` (absolute) de dentro se quedan en el tablero y no
          alargan la PÁGINA (scroll de 1063 px a 1180×820, QA 05/11/2026). */}
      <div
        className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain", pantallaCompleta && "hidden")}
        role="region"
        aria-label="Tablero de compras"
        data-testid="tablero-analisis"
        data-tour="facturas-analisis-tablero"
      >
        <EdicionFacturasContext.Provider value={puedeEditar}>{cuerpo}</EdicionFacturasContext.Provider>
      </div>

      {pantallaCompleta && (
        <ChatPantallaCompleta
          conversaciones={conversaciones}
          conversacionActiva={conversacionActiva}
          onSeleccionarConversacion={(c) => void seleccionarConversacion(c)}
          onNuevaConversacion={() => void nuevaConversacion()}
          onEliminarConversacion={eliminarConversacion}
          abrirConversacionPorId={abrirConversacionPorId}
          onVolver={() => salirDePantallaCompleta()}
          mensajes={mensajes}
          isLoading={isLoading}
          isSending={isSending}
          sugerencias={sugerencias}
          onEnviar={(texto) => void enviarMensaje(texto)}
          onRegenerar={regenerarRespuesta}
          fijadas={idsFijadas}
          onFijar={fijar}
          onQuitarFijada={quitar}
          onExplorar={(g) => salirDePantallaCompleta(g)}
          borrador={borrador}
          onBorrador={setBorrador}
        />
      )}

      <DocumentosDeCifra peticion={peticionDocs} onCerrar={() => setPeticionDocs(null)} onIrA={onIrA} />

      {conIa && (
      <CopilotoLateral
        abierto={copilotoVisible}
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
        enlacePantallaCompleta={enlaceCompleta}
        onPantallaCompleta={irAPantallaCompleta}
        borrador={borrador}
        onBorrador={setBorrador}
      />
      )}
    </div>
  );
});

ChatFacturas.displayName = "ChatFacturas";
