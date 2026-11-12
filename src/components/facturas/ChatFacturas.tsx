// Pestaña «Análisis» de Facturas: TABLERO que sale hecho al abrirla, un
// EXPLORADOR para cambiar la gráfica al instante sin la IA, «Ver documentos»
// desde cualquier cifra y el copiloto de IA PLEGADO en un panel lateral.
//
//   · Barra: periodo [Mes · Trimestre · Año · Todo · 📅 Elegir fechas], local
//     [Todos · Casa Tomás · Touza], «Personalizar el tablero» y «Pregúntale a
//     la IA»; periodo y local van a la URL (`?tab=chat&desde=…&hasta=…&local=…`)
//     para volver o compartir. Desde el 07/11/2026 (barra única) la página
//     Facturas le deja un hueco en SU barra de pestañas (`ranuraBarra`) y los
//     controles se pintan allí con un portal: una sola fila arriba.
//   · Tablero en UNA pantalla (sin scroll de página): cuatro cifras que son
//     navegación y una vista a la vez (`?vista=`, recordada también en
//     localStorage; ver TableroCompras). Datos: `tablero_compras`,
//     `facturas_decision` y `explorar_compras` (el explorador).
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
import { createPortal } from "react-dom";
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
import type { PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import { EstadoVacio } from "@/components/facturas/compras/estilo";
import { TableroCompras } from "./analisis/TableroCompras";
import { SelectorPeriodo } from "./analisis/SelectorPeriodo";
import { DocumentosDeCifra } from "./analisis/DocumentosDeCifra";
import { ErrorTablero, EsqueletoTablero, Segmentado } from "./analisis/piezas";
import { CopilotoLateral } from "./copiloto/CopilotoLateral";
import { ChatPantallaCompleta } from "./copiloto/ChatPantallaCompleta";
import { enlacePantallaCompleta, destinoVolver, type EstadoPantallaCompleta } from "@/lib/facturas/copilotoCompleto";
import { guardarVista, leerVistaGuardada, PARAM_VISTA, vistaInicial, type IdVista } from "@/lib/facturas/vistasAnalisis";
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
  /**
   * Hueco en la barra de pestañas de la página para los controles de Análisis
   * (barra única); `null` mientras no está. Sin él (`undefined`: pruebas, otra página), la barra va encima del tablero.
   */
  ranuraBarra?: HTMLElement | null;
}

const NOMBRE_PERIODO: Record<PeriodoAnalisis, string> = { mes: "este mes", trimestre: "este trimestre", anio: "este año", todo: "el histórico" };

/** Para «Volver …» tras «Ver solo este tramo»: «al año 2026», «a este mes», «a 1 mar – 15 abr 2026». */
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

export const ChatFacturas = forwardRef<ChatFacturasRef, ChatFacturasProps>(({ onIrA, activa = true, pantallaCompleta: pidePantallaCompleta = false, conIa = false, puedeEditar = false, ranuraBarra }, ref) => {
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
  const [peticionDocs, setPeticionDocs] = useState<PeticionDocumentos | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  // «Personalizar» el tablero (el diálogo lo monta TableroCompras).
  const [personalizando, setPersonalizando] = useState(false);
  // La vista del tablero (una a la vez): la de la URL; si no, la última de este navegador.
  const [vista, setVista] = useState<IdVista>(() => vistaInicial(params, leerVistaGuardada()));
  const vistaUrl = params.get(PARAM_VISTA);
  useEffect(() => {
    // Atrás/Adelante o un enlace con `?vista=`.
    if (!vistaUrl) return;
    const v = vistaInicial(new URLSearchParams({ [PARAM_VISTA]: vistaUrl }), null);
    setVista((actual) => (actual === v ? actual : v));
  }, [vistaUrl]);
  const elegirVista = useCallback(
    (v: IdVista) => {
      setVista(v);
      guardarVista(v);
      const prev = paramsRef.current;
      if (prev.get(PARAM_VISTA) === v) return;
      const sig = new URLSearchParams(prev);
      sig.set(PARAM_VISTA, v);
      setParams(sig, { replace: true });
    },
    [setParams],
  );
  // Lo último que hay (o se ha escrito) en la URL: solo se escribe lo que CAMBIA aquí.
  const escrito = useRef({ seleccion, local, dia: isoLocal(hoy) });

  // URL → estado (Atrás/Adelante, un enlace compartido).
  useEffect(() => {
    const p = deUrl.periodo;
    const l = deUrl.local;
    if (p) {
      setSeleccion((s) => (mismaSeleccion(s, p) ? s : p));
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

  /** El periodo que elige el dueño (barra, «Ver todo el histórico»). */
  const elegirPeriodo = useCallback((s: SeleccionPeriodo) => {
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
    valorarRespuesta,
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

  // ─── Pantalla completa (`/facturas/ia`) ───
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const enlaceCompleta = enlacePantallaCompleta(conversacionActiva?.id);
  const irAPantallaCompleta = () => {
    const estado: EstadoPantallaCompleta = { volverA: `${ubicacion.pathname}${ubicacion.search}` };
    navegar(enlaceCompleta, { state: estado });
  };
  /** Al salir de pantalla completa: de vuelta al panel de Análisis. */
  const salirDePantallaCompleta = () => {
    const estado = ubicacion.state as Partial<EstadoPantallaCompleta> | null;
    // Vino de Análisis en esta pestaña: «Atrás», a la misma URL (periodo y local) y sin apilar historial.
    if (estado?.volverA) navegar(-1);
    else navegar(destinoVolver(estado));
  };
  const estabaCompleta = useRef(pantallaCompleta);
  useEffect(() => {
    if (estabaCompleta.current && !pantallaCompleta) {
      // De vuelta, el panel lateral abierto con la misma conversación.
      setVerHistorial(false);
      setAbierto(true);
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
        vista={vista}
        onVista={elegirVista}
        onDocumentos={setPeticionDocs}
        onIrA={irA}
        fijadasIa={fijadas}
        onQuitarFijadaIa={quitar}
        fijadasExplorador={exploraciones.fijadas}
        onQuitarFijadaExplorador={exploraciones.quitar}
      />
    );

  const copilotoVisible = conIa && abierto && activa && !pantallaCompleta;
  // Barra única (07/11/2026): periodo, local, «Personalizar» (icono) y la IA, en una
  // línea con las pestañas de la página. En tablet vertical o móvil puede partir en dos.
  const barra = (
    // 11/11/2026 (dueño: móvil): en el móvil la barra «se disuelve» (`contents`) en la fila de acciones de la
    // página y se reparte por `order`: local + personalizar + IA arriba; periodo + avisos/ayuda debajo (dos filas;
    // antes eran tres, 12/11/2026).
    <div className="contents min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex 2xl:gap-2" data-tour="facturas-analisis-barra" data-testid="barra-analisis">
      <div className="order-3 max-w-full sm:order-none">
        <SelectorPeriodo valor={seleccion} onCambio={elegirPeriodo} hoy={hoy} compacto />
      </div>
      <div className="order-1 max-w-full sm:order-none">
        <Segmentado<FiltroLocal> etiqueta="Local" opciones={FILTROS_LOCAL} valor={local} onCambio={setLocal} compacto />
      </div>
      {tablero.isFetching && !tablero.isLoading && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> <span className="sr-only">Actualizando…</span>
        </span>
      )}
      <div className="order-2 ml-auto flex items-center gap-1.5 sm:order-none">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={() => setPersonalizando(true)}
          disabled={!datos || datos.sinDatos}
          aria-haspopup="dialog"
          aria-label="Personalizar el tablero"
          title="Personalizar el tablero: qué módulos salen en cada vista"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
        </Button>
        {conIa && (
          <Button
            type="button"
            className="h-9 gap-1.5 px-2.5 pointer-coarse:h-11 2xl:px-3"
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
            {/* Con poco sitio, «IA» a secas (el nombre accesible sigue entero). */}
            <span className="hidden 2xl:inline">Pregúntale a la</span> IA
          </Button>
        )}
      </div>
    </div>
  );
  const barraEnRanura = !!ranuraBarra && activa && !pantallaCompleta;
  return (
    // Con el copiloto abierto (360 px, no modal) el contenido deja su hueco a la
    // derecha (desde lg, 1024 px): si no, el panel tapaba el botón y la franja
    // derecha (QA 05/11/2026). En la tablet vertical no: quedarían ~440 px y las
    // tarjetas, a 2 columnas, se aplastaban; ahí el panel va por encima.
    <div className={cn("flex h-full min-h-0 w-full flex-col gap-2 transition-[padding] motion-reduce:transition-none", copilotoVisible && "lg:pr-[360px]")}>
      {ranuraBarra === undefined ? !pantallaCompleta && <div className="flex shrink-0 flex-wrap">{barra}</div> : barraEnRanura && createPortal(barra, ranuraBarra as HTMLElement)}

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
          onValorar={valorarRespuesta}
          fijadas={idsFijadas}
          onFijar={fijar}
          onQuitarFijada={quitar}
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
        onValorar={valorarRespuesta}
        fijadas={idsFijadas}
        onFijar={fijar}
        onQuitarFijada={quitar}
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
