import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Download, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useEliminarMesa } from "@/hooks/useMesas";
import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { ToolbarDibujo, ToolType } from "./ToolbarDibujo";
import { CanvasPlano, CanvasPlanoRef } from "./CanvasPlano";
import { PanelLateral } from "./PanelLateral";
import { usePlanoHistory, type PlanoSnapshot } from "./store/usePlanoHistory";
import { decidirModoSnapshot } from "./store/historySnapshotMode";
import {
  esMesaNoPersistida,
  mesasFueraDelPlano,
  normalizarDimensionesEspacio,
  planRepuntarAsignaciones,
  detectarPoligonoCerrado,
  areaShoelace,
  bboxPoligono,
  PIXELS_PER_METER,
  type DimensionesEspacio,
} from "./planoUtils";
import {
  aplicarRenombradosADesagrupes,
  clasificarFallo,
  construirMensajeGuardado,
  construirMensajeLimpieza,
  construirPlanGuardado,
  interpretarCeroFilas,
  resolverIdFinalMesa,
  FALLO_DESAPARECIDA,
  FALLO_PERMISOS,
  type DesagrupePlan,
  type EstadoFilaMesa,
  type MotivoFallo,
  type ResultadoOperacion,
} from "./guardadoPlano";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface EditorPlanoEspacioProps {
  espacioId: string;
  espacioNombre: string;
  onBack: () => void;
}

export interface MesaCanvas {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
  posX: number;
  posY: number;
  /** Rotación en grados (0 = sin rotar). Se persiste en mesas.rotacion. */
  rotacion?: number;
  isMerged?: boolean;
  originalMesas?: Array<{
    id: string;
    nombre: string;
    capacidad: number;
    forma: "rectangular" | "circular";
    ancho: number;
    alto: number;
  }>;
  etiqueta?: string | null;
}

export interface ElementoCanvas {
  id: string;
  tipo: "wall" | "area" | "door";
  props: Record<string, any>;
}

/**
 * Puente de tipos entre el plan de guardado y los tipos generados de Supabase:
 * `mesas.original_mesas` es `Json` en `types.ts` y el plan lo tipa como array
 * de mesas originales (que es lo que de verdad guarda esa columna). Mismo cast
 * que ya hacía el guardado anterior al insertar un grupo.
 */
function aFilaSupabase<T extends { original_mesas: unknown }>(valores: T) {
  return { ...valores, original_mesas: valores.original_mesas as Json };
}

export function EditorPlanoEspacio({ espacioId, espacioNombre, onBack }: EditorPlanoEspacioProps) {
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [elementos, setElementos] = useState<ElementoCanvas[]>([]);
  const [mesasCanvas, setMesasCanvas] = useState<MesaCanvas[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  const [showMeasurements, setShowMeasurements] = useState(true);

  // Mesa recién dibujada con la herramienta del lienzo: su número es solo el
  // PRIMER NÚMERO LIBRE propuesto, así que el panel lateral enfoca su campo de
  // número para que el dueño escriba el real de la sala sin buscar nada.
  const [mesaRecienCreadaId, setMesaRecienCreadaId] = useState<string | null>(null);

  // Mesas fusionadas YA guardadas en BBDD que el usuario ha desagrupado en esta
  // sesión de edición: hay que repuntar sus asignaciones_mesa a la primera mesa
  // resultante y borrar la fila de la mesa fusionada al pulsar "Guardar"
  // (mientras tanto solo viven en el canvas/estado local).
  const [pendingUnmerges, setPendingUnmerges] = useState<DesagrupePlan[]>([]);

  // Recuento de asignaciones_mesa afectadas, para mostrar en los diálogos de
  // confirmación de "Limpiar" y "Eliminar mesa" antes de borrar nada.
  // `mesas` es el recuento de filas que HABÍA al abrir el diálogo: es la cifra
  // contra la que `handleClear` comprueba cuántas ha borrado de verdad.
  const [clearCounts, setClearCounts] = useState<{ total: number; futuras: number; mesas: number } | null>(null);
  const [clearConfirmChecked, setClearConfirmChecked] = useState(false);
  const [asignacionesSeleccionada, setAsignacionesSeleccionada] = useState(0);

  const canvasRef = useRef<CanvasPlanoRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escala FIJA: 50 píxeles por metro (no cambia con el tamaño del contenedor).
  // Centralizada en planoUtils.ts (antes era una constante local aquí).

  // Escala: dimensiones reales en metros
  const [realDimensions, setRealDimensions] = useState<DimensionesEspacio>({ width: 12, height: 8 });

  const { data: plano, isLoading: loadingPlano } = usePlanoEspacio(espacioId);
  const { data: mesas = [], isLoading: loadingMesas, refetch: refetchMesas } = useMesas(espacioId);
  const guardarPlano = useCrearOActualizarPlano();
  const eliminarMesa = useEliminarMesa();
  // El guardado ya no pasa por `useActualizarMesasSilent`: ese hook lanza SOLO
  // el primer error de su `Promise.all` y nunca dice QUÉ filas fallaron, que es
  // justo lo que hace falta para redactar "esto se aplicó, esto no". Aquí se
  // escriben las filas una a una con `.select('id')` y se cuenta lo que vuelve,
  // así que la invalidación de caché que hacía el hook se hace a mano.
  const queryClient = useQueryClient();

  // --- Historial undo/redo -------------------------------------------------
  // Mantenemos elementos/mesasCanvas/pendingUnmerges como los únicos estados
  // "fuente de verdad" (igual que antes de esto); el historial se sincroniza
  // con ellos mediante un efecto reactivo en vez de envolver cada setter uno
  // a uno — así cualquier sitio que ya llama a setElementos/setMesasCanvas/
  // setPendingUnmerges (CanvasPlano, PanelLateral, este mismo componente)
  // queda cubierto automáticamente.
  const elementosRef = useRef(elementos);
  const mesasCanvasRef = useRef(mesasCanvas);
  const pendingUnmergesRef = useRef(pendingUnmerges);
  const realDimensionsRef = useRef(realDimensions);
  useEffect(() => { elementosRef.current = elementos; }, [elementos]);
  useEffect(() => { mesasCanvasRef.current = mesasCanvas; }, [mesasCanvas]);
  useEffect(() => { pendingUnmergesRef.current = pendingUnmerges; }, [pendingUnmerges]);
  useEffect(() => { realDimensionsRef.current = realDimensions; }, [realDimensions]);

  const history = usePlanoHistory({
    elementos: [],
    mesasCanvas: [],
    pendingUnmerges: [],
    realDimensions: { width: 12, height: 8 },
  });

  // true mientras se hidrata el estado inicial desde BBDD: ningún cambio
  // durante esta ventana debe registrarse en el historial. En cuanto se
  // asienta (ver efecto de abajo) se hace un RESET —no un commit— para que
  // ese sea el punto de partida y no se pueda deshacer más allá de él.
  const isHydratingRef = useRef(true);
  // true durante el guardado (handleSave): puede disparar varios
  // setElementos/setMesasCanvas/setPendingUnmerges en renders sucesivos
  // (renombrar ids temporales uno a uno) — se ignoran todos y al final se
  // hace un único RESET con el estado ya persistido (ver saveGeneration).
  const suppressHistoryRef = useRef(false);
  // true mientras se aplica un snapshot de undo/redo al estado de React —
  // evita que ese propio cambio de estado se registre como un commit nuevo.
  const isApplyingHistoryRef = useRef(false);
  // "commit" (normal) o "reset" (se consume una sola vez): las acciones que
  // ya escriben en BBDD de forma inmediata (Limpiar, eliminar mesa
  // persistida, "Añadir Mesa" del panel lateral) llaman a
  // `marcarNoDeshacible()` antes de su cambio de estado correspondiente, así
  // ese cambio se convierte en la nueva base no deshacible en vez de un paso
  // de historial más.
  const nextSnapshotModeRef = useRef<"commit" | "reset">("commit");
  const pendingResetToastRef = useRef(false);
  // Último snapshot ya reflejado en el historial (el que nosotros mismos
  // acabamos de commitear/resetear) — permite distinguir, en el efecto que
  // aplica undo/redo, un cambio de `history.present` causado por un undo/redo
  // real de uno causado por nuestro propio commit/reset (misma referencia).
  const lastAppliedPresentRef = useRef<PlanoSnapshot>(history.present);
  const [saveGeneration, setSaveGeneration] = useState(0);

  // Marca el PRÓXIMO cambio de elementos/mesasCanvas/pendingUnmerges como "no
  // deshacible": en vez de un paso de historial, se convierte en la nueva
  // base y se avisa con un toast. Pensado para acciones que ya escribieron en
  // BBDD de forma inmediata (no diferida a "Guardar").
  const marcarNoDeshacible = useCallback(() => {
    nextSnapshotModeRef.current = "reset";
    pendingResetToastRef.current = true;
  }, []);

  // Asienta el estado inicial cargado de BBDD como línea base del historial
  // (RESET, no commit). OJO: no basta un timeout desde el montaje — mientras
  // loadingPlano/loadingMesas sean true (la query de red puede tardar mucho
  // más que unos ms) hay que seguir considerando "hidratación" en curso, o
  // el primer undo real del usuario podría acabar borrando todo el plano
  // cargado (ver AVISO en el informe de esta fase). CanvasPlano solo se monta
  // cuando ambas ya son false (ver el `return` de más abajo), así que su
  // propia hidratación —síncrona, sobre datos ya en memoria, sin más
  // esperas de red— ocurre en los primeros efectos tras ese momento: 50ms de
  // margen desde ahí es de sobra.
  useEffect(() => {
    if (loadingPlano || loadingMesas) {
      isHydratingRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      isHydratingRef.current = false;
      const snapshot: PlanoSnapshot = {
        elementos: elementosRef.current,
        mesasCanvas: mesasCanvasRef.current,
        pendingUnmerges: pendingUnmergesRef.current,
        realDimensions: realDimensionsRef.current,
      };
      history.reset(snapshot);
      lastAppliedPresentRef.current = snapshot;
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espacioId, loadingPlano, loadingMesas]);

  // Registra en el historial cada cambio "confirmado" de elementos/mesas/
  // pendingUnmerges. object:moving (arrastre en curso) nunca llama a
  // setElementos/setMesasCanvas desde CanvasPlano, solo object:modified (al
  // soltar) lo hace — así que este efecto nunca se dispara a mitad de un
  // arrastre, solo en pasos ya confirmados.
  useEffect(() => {
    const modo = decidirModoSnapshot({
      isHydrating: isHydratingRef.current,
      suppressed: suppressHistoryRef.current,
      isApplyingHistory: isApplyingHistoryRef.current,
      modoSolicitado: nextSnapshotModeRef.current,
    });

    if (modo === "skip") {
      if (isApplyingHistoryRef.current) isApplyingHistoryRef.current = false;
      return;
    }

    // `realDimensions` viaja en el snapshot pero NO está en las dependencias
    // del efecto a propósito: dibujar una sala cambia dimensiones Y elementos
    // en el mismo manejador (React los agrupa en un render), así que el
    // snapshot ya recoge las nuevas medidas. Ponerlo en las dependencias, en
    // cambio, haría que cada refetch de `planos_espacio` —que reconstruye el
    // objeto `{width, height}` aunque los números sean los mismos— colase un
    // paso de deshacer fantasma.
    const snapshot: PlanoSnapshot = {
      elementos,
      mesasCanvas,
      pendingUnmerges,
      realDimensions: realDimensionsRef.current,
    };

    if (modo === "reset") {
      history.reset(snapshot);
      nextSnapshotModeRef.current = "commit";
      if (pendingResetToastRef.current) {
        pendingResetToastRef.current = false;
        toast.info("Esta acción no se puede deshacer.");
      }
    } else {
      history.commit(snapshot);
    }
    lastAppliedPresentRef.current = snapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementos, mesasCanvas, pendingUnmerges]);

  // Tras un guardado completo (handleSave), asienta el estado ya persistido
  // como nueva base no deshacible: los ids temporales ya renombrados a
  // reales y pendingUnmerges vaciado no deben poder "deshacerse" hacia el
  // estado pre-guardado (eso dejaría ids de canvas/BBDD desincronizados).
  useEffect(() => {
    if (saveGeneration === 0) return;
    suppressHistoryRef.current = false;
    const snapshot: PlanoSnapshot = {
      elementos: elementosRef.current,
      mesasCanvas: mesasCanvasRef.current,
      pendingUnmerges: pendingUnmergesRef.current,
      realDimensions: realDimensionsRef.current,
    };
    history.reset(snapshot);
    lastAppliedPresentRef.current = snapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveGeneration]);

  // Aplica un snapshot de undo/redo real (detectado por desigualdad de
  // referencia contra el último que nosotros mismos commiteamos/reseteamos)
  // al estado de React y reconstruye el canvas desde cero.
  useEffect(() => {
    if (isHydratingRef.current) return;
    if (history.present === lastAppliedPresentRef.current) return;

    isApplyingHistoryRef.current = true;
    lastAppliedPresentRef.current = history.present;

    const snapshotElementos = (history.present.elementos as ElementoCanvas[]) ?? [];
    const snapshotMesas = (history.present.mesasCanvas as MesaCanvas[]) ?? [];
    const snapshotPendingUnmerges =
      (history.present.pendingUnmerges as typeof pendingUnmerges) ?? [];
    const snapshotDimensiones = history.present.realDimensions as DimensionesEspacio | undefined;

    setElementos(snapshotElementos);
    setMesasCanvas(snapshotMesas);
    setPendingUnmerges(snapshotPendingUnmerges);
    // Deshacer un "dibujar sala" tiene que devolver TAMBIÉN el ancho/alto del
    // espacio: si no, las 4 paredes desaparecen y el lienzo se queda con el
    // tamaño nuevo, sin nada que lo explique.
    if (snapshotDimensiones) setRealDimensions(snapshotDimensiones);
    setSelectedElement(null);
    canvasRef.current?.reloadFromSnapshot({ elementos: snapshotElementos, mesasCanvas: snapshotMesas });
  }, [history.present]);

  // Bloquear undo/redo mientras `handleSave` está en curso: ese guardado
  // renombra ids temporales -> reales en varios pasos (uno por mesa, con
  // `setMesasCanvas(prev => ...)` leyendo el `prev` más reciente) y usa
  // `suppressHistoryRef` para que esos renombrados no generen commits — pero
  // `suppressHistoryRef` NO impide que `history.undo()/redo()` se disparen
  // igualmente. Un Ctrl+Z a mitad de guardado reemplazaría mesasCanvas/
  // elementos por un snapshot antiguo justo cuando el siguiente paso del
  // bucle de guardado va a hacer `setMesasCanvas(prev => prev.map(...))`
  // sobre ese `prev` ya desincronizado del guardado en curso, dejando canvas
  // y BBDD con ids distintos. El botón "Guardar" ya se deshabilita con
  // `isSaving`; aquí se aplica la misma condición a deshacer/rehacer.
  const handleUndo = useCallback(() => {
    if (isSaving || !history.puedeDeshacer) return;
    history.undo();
  }, [history, isSaving]);

  const handleRedo = useCallback(() => {
    if (isSaving || !history.puedeRehacer) return;
    history.redo();
  }, [history, isSaving]);

  /** Resultado uniforme de una escritura verificada. */
  // `fallo?: undefined` en la rama de éxito no es decorativo: el proyecto
  // compila con `strict: false`, y sin él TypeScript no estrecha la unión por
  // el discriminante `ok` y `escritura.fallo` ni siquiera existe como propiedad.
  type Escritura =
    | { ok: true; filas: number; fallo?: undefined }
    | { ok: false; filas?: number; fallo: MotivoFallo };

  /**
   * UPDATE sobre UNA fila concreta de `mesas`, verificado.
   *
   * Comprobar `{ error }` NO basta: cuando RLS deniega un UPDATE (o un DELETE),
   * supabase-js responde `{ data: [], error: null }` — sin excepción, sin error
   * y sin filas afectadas. La única forma de enterarse es pedir `.select('id')`
   * y comprobar que la fila que querías tocar ha vuelto. Ese agujero es el que
   * dejó la BBDD de producción rota el 2026-09-27.
   */
  const escribirFilaMesa = useCallback(
    async (mesaId: string, valores: TablesUpdate<"mesas">): Promise<Escritura> => {
      const { data, error } = await supabase
        .from("mesas")
        .update(valores)
        .eq("id", mesaId)
        .select("id");
      if (error) return { ok: false, fallo: clasificarFallo(error) };
      const filas = data?.length ?? 0;
      if (filas === 0) return { ok: false, filas: 0, fallo: FALLO_PERMISOS };
      return { ok: true, filas };
    },
    [],
  );

  /**
   * Desempata el "cero filas" de una escritura leyendo la fila: ¿no está, está
   * ya como la queríamos, o está y no se deja tocar? (ver `interpretarCeroFilas`).
   * `null` = ni siquiera se pudo leer, así que toca ser pesimista.
   */
  const leerEstadoFilaMesa = useCallback(async (mesaId: string): Promise<EstadoFilaMesa | null> => {
    const { data, error } = await supabase
      .from("mesas")
      .select("id, activa")
      .eq("id", mesaId)
      .maybeSingle();
    if (error) return null;
    if (!data) return { existe: false };
    // `coalesce(activa, true)`: la columna es nullable y null cuenta como
    // activa (es lo que hacen el índice único y las funciones de aforo).
    return { existe: true, activa: data.activa !== false };
  }, []);

  // Repunta las asignaciones_mesa de `mesaOrigenId` hacia `mesaDestinoId` (fusión:
  // originales -> mesa fusionada; desagrupar: mesa fusionada retirada -> primera
  // mesa resultante). Si la reserva ya está asignada en destino, la de origen se
  // elimina en vez de actualizarse para no violar el UNIQUE(reserva_id, mesa_id).
  //
  // Devuelve el fallo en vez de lanzarlo: el guardado necesita saber en qué paso
  // se quedó para poder contarlo, no solo que "algo" falló.
  const repuntarAsignacionesMesa = useCallback(
    async (mesaOrigenId: string, mesaDestinoId: string): Promise<{ ok: boolean; fallo?: MotivoFallo }> => {
      const { data: asignacionesOrigen, error: errOrigen } = await supabase
        .from("asignaciones_mesa")
        .select("id, reserva_id, mesa_id")
        .eq("mesa_id", mesaOrigenId);
      if (errOrigen) return { ok: false, fallo: clasificarFallo(errOrigen) };
      if (!asignacionesOrigen || asignacionesOrigen.length === 0) return { ok: true };

      const { data: asignacionesDestino, error: errDestino } = await supabase
        .from("asignaciones_mesa")
        .select("reserva_id")
        .eq("mesa_id", mesaDestinoId);
      if (errDestino) return { ok: false, fallo: clasificarFallo(errDestino) };

      const reservaIdsDestino = new Set((asignacionesDestino || []).map((a) => a.reserva_id));
      const { aActualizar, aEliminar } = planRepuntarAsignaciones(asignacionesOrigen, reservaIdsDestino);

      // Mismo criterio que en `mesas`: se pide `.select('id')` y se comprueba
      // que han vuelto TODAS las filas que se querían tocar. Y con el mismo
      // matiz: que falte una fila NO es automáticamente un problema de
      // permisos. Entre el SELECT de arriba y esta escritura, otra sesión pudo
      // cancelar la reserva y llevarse su asignación por delante — eso no deja
      // nada a medias, simplemente ya no hay nada que mover ahí.
      const faltanDeVerdad = async (pedidas: string[], devueltas: string[]) => {
        const vuelven = new Set(devueltas);
        const ausentes = pedidas.filter((id) => !vuelven.has(id));
        if (ausentes.length === 0) return false;
        const { data, error } = await supabase
          .from("asignaciones_mesa")
          .select("id")
          .in("id", ausentes);
        // Si no se puede comprobar, se lee de la forma pesimista.
        if (error) return true;
        // Si alguna sigue ahí, es que no se ha dejado tocar: eso sí es RLS.
        return (data?.length ?? 0) > 0;
      };

      if (aEliminar.length > 0) {
        const { data, error } = await supabase
          .from("asignaciones_mesa")
          .delete()
          .in("id", aEliminar)
          .select("id");
        if (error) return { ok: false, fallo: clasificarFallo(error) };
        const devueltas = (data ?? []).map((f) => f.id);
        if (devueltas.length !== aEliminar.length && (await faltanDeVerdad(aEliminar, devueltas))) {
          return { ok: false, fallo: FALLO_PERMISOS };
        }
      }
      if (aActualizar.length > 0) {
        const { data, error } = await supabase
          .from("asignaciones_mesa")
          .update({ mesa_id: mesaDestinoId })
          .in("id", aActualizar)
          .select("id");
        if (error) return { ok: false, fallo: clasificarFallo(error) };
        const devueltas = (data ?? []).map((f) => f.id);
        if (devueltas.length !== aActualizar.length && (await faltanDeVerdad(aActualizar, devueltas))) {
          return { ok: false, fallo: FALLO_PERMISOS };
        }
      }
      return { ok: true };
    },
    [],
  );

  // Medir el contenedor
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Calcular zoom para ajustar al contenedor (sin límite máximo)
  const canvasRealWidth = realDimensions.width * PIXELS_PER_METER;
  const canvasRealHeight = realDimensions.height * PIXELS_PER_METER;
  
  const fitZoom = Math.min(
    (containerSize.width - 40) / canvasRealWidth,
    (containerSize.height - 40) / canvasRealHeight
  );

  // Cargar dimensiones guardadas del plano (prioridad: columnas dedicadas, fallback: configuracion)
  useEffect(() => {
    if (plano?.ancho_metros && plano?.alto_metros) {
      setRealDimensions({ width: plano.ancho_metros, height: plano.alto_metros });
    } else if (plano?.configuracion?.realDimensions) {
      setRealDimensions(plano.configuracion.realDimensions);
    }
  }, [plano]);

  // Auto-ajustar zoom cuando cambian las dimensiones o el contenedor
  useEffect(() => {
    setZoomLevel(fitZoom);
  }, [fitZoom]);

  // Aplicar nuevas dimensiones reales.
  //
  // ÚNICO camino para cambiar el ancho/alto del espacio. No persiste por su
  // cuenta a propósito: `realDimensions` es lo que `handleSave` escribe en
  // `planos_espacio` (`ancho_metros`/`alto_metros`/`metros_cuadrados` y la
  // copia dentro de `configuracion`), así que tocar este estado ya mete el
  // cambio en el flujo de guardado normal — con su paso `guardar-plano` del
  // plan de `guardadoPlano.ts` — y el dueño sigue viendo "Guardar" pendiente.
  const handleApplyDimensions = useCallback(
    (width: number, height: number, origen: "manual" | "sala" = "manual") => {
      const normalizadas = normalizarDimensionesEspacio(width, height);
      if (!normalizadas.ok) {
        toast.error(`No se han podido aplicar las medidas: ${normalizadas.motivo}.`);
        return false;
      }
      const { width: ancho, height: alto } = normalizadas.dimensiones;
      setRealDimensions({ width: ancho, height: alto });

      // Las mesas NO se mueven solas: redibujar una sala más pequeña puede
      // dejar mesas fuera del rectángulo nuevo, y recolocarlas por su cuenta
      // le cambiaría el plano al dueño sin pedirlo. Se avisa y se recolocan
      // a mano.
      const fuera = mesasFueraDelPlano(mesasCanvasRef.current, { width: ancho, height: alto });
      if (fuera.length > 0) {
        const listado = fuera.slice(0, 8).join(", ");
        const resto = fuera.length > 8 ? ` y ${fuera.length - 8} más` : "";
        toast.warning(
          `${fuera.length === 1 ? "La mesa" : "Las mesas"} ${listado}${resto} ` +
            `${fuera.length === 1 ? "se queda" : "se quedan"} fuera del espacio de ${ancho}m × ${alto}m. ` +
            "Arrástra" + (fuera.length === 1 ? "la" : "las") + " dentro antes de guardar.",
          { duration: 10000 },
        );
      }

      if (origen === "manual") {
        toast.success(`Escala aplicada: ${ancho}m × ${alto}m`);
      }
      return true;
    },
    [],
  );

  // La herramienta "Sala rectangular" dibuja 4 paredes Y fija las medidas del
  // espacio. Antes solo hacía lo primero (`onRoomDrawn` estaba declarado en
  // CanvasPlano pero nadie se lo pasaba), así que el plano seguía midiendo lo
  // que midiera antes por mucho que dibujaras una sala de 9 × 5.
  const handleRoomDrawn = useCallback(
    (anchoMetros: number, altoMetros: number) => {
      handleApplyDimensions(anchoMetros, altoMetros, "sala");
    },
    [handleApplyDimensions],
  );

  // Área real del local: si las paredes dibujadas forman un polígono cerrado
  // (sus extremos coinciden dentro de una tolerancia de ~5px), se calcula el
  // área real con la fórmula del shoelace en vez de mostrar siempre el
  // ancho×alto "de catálogo" que venía de la BD (que podía no coincidir con
  // lo dibujado). Si no hay un lazo cerrado, se mantiene el fallback anterior.
  const areaReal = useMemo(() => {
    const paredes = elementos
      .filter((e) => e.tipo === "wall")
      .map((e) => ({
        x1: e.props?.x1 ?? 0,
        y1: e.props?.y1 ?? 0,
        x2: e.props?.x2 ?? 0,
        y2: e.props?.y2 ?? 0,
      }));
    const vertices = detectarPoligonoCerrado(paredes, 5);
    if (!vertices) return null;

    const areaPx2 = areaShoelace(vertices);
    const bbox = bboxPoligono(vertices);
    const ppm2 = PIXELS_PER_METER * PIXELS_PER_METER;
    if (areaPx2 <= 0) return null;

    return {
      areaM2: areaPx2 / ppm2,
      widthM: bbox.width / PIXELS_PER_METER,
      heightM: bbox.height / PIXELS_PER_METER,
    };
  }, [elementos]);

  // GUARDAR PLANO — contrato (el porqué de cada regla está en `guardadoPlano.ts`)
  //
  //  - NADA se borra. Lo que sale de circulación se DESACTIVA (`activa = false`):
  //    para el aforo (`fn_capacidad_efectiva_*`, `vista_capacidad_espacios`),
  //    para `useMesas` y para el índice único es equivalente a una fila
  //    borrada, pero es REVERSIBLE y no dispara el ON DELETE CASCADE de
  //    `asignaciones_mesa`, que se llevaba por delante el historial de reservas.
  //  - NINGUNA escritura se da por buena porque la promesa se resuelva:
  //    supabase-js RESUELVE cuando RLS deniega. Se comprueba `{ error }` Y se
  //    cuentan las filas que devuelve `.select('id')`.
  //  - El plan se ejecuta EN ORDEN y se para en el PRIMER fallo. Parar es
  //    deliberado: seguir adelante insertaría un nombre que la desactivación
  //    recién fallada no ha liberado, y eso encadena un 23505 contra
  //    `uq_mesas_espacio_nombre_real` al fallo original. Lo que sí se aplicó se
  //    enumera en el mensaje de error.
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    // Guardar renombra ids temporales -> reales en varios pasos (uno por
    // mesa, cada uno tras su propio await de inserción) y vacía
    // pendingUnmerges: nada de eso debe registrarse como pasos de historial
    // deshacibles. Se ignoran todos hasta el reset final (ver saveGeneration).
    suppressHistoryRef.current = true;

    const plan = construirPlanGuardado({ espacioId, mesasCanvas, pendingUnmerges });
    const resultados: ResultadoOperacion[] = plan.map((operacion) => ({
      operacion,
      estado: "pendiente",
    }));

    /** Id temporal del lienzo -> id real en BBDD (insertado o reactivado). */
    const idTemporalAReal = new Map<string, string>();
    /** Reactivaciones que SÍ encontraron su fila: su INSERT de plan B sobra. */
    const filasReactivadas = new Set<string>();
    let hayFallo = false;

    // Pasa el id temporal del lienzo al id real: estado de React + objeto del
    // canvas. Sin lo segundo, el objeto se queda con el id temporal y en el
    // siguiente ciclo de carga no se reconoce como "ya en canvas" y se duplica.
    const adoptarIdReal = (idCanvas: string, idReal: string) => {
      idTemporalAReal.set(idCanvas, idReal);
      setMesasCanvas((prev) => prev.map((m) => (m.id === idCanvas ? { ...m, id: idReal } : m)));
      canvasRef.current?.renameMesaId(idCanvas, idReal);
    };

    try {
      for (let i = 0; i < plan.length; i++) {
        const operacion = plan[i];
        let resultado: Omit<ResultadoOperacion, "operacion">;

        switch (operacion.tipo) {
          case "guardar-plano": {
            // El hook lanza si Supabase devuelve error (mutationFn -> throw),
            // así que aquí no cabe un fallo silencioso: lo recoge el catch.
            await guardarPlano.mutateAsync({
              espacio_id: espacioId,
              ancho: realDimensions.width * PIXELS_PER_METER,
              alto: realDimensions.height * PIXELS_PER_METER,
              ancho_metros: realDimensions.width,
              alto_metros: realDimensions.height,
              pixels_per_meter: PIXELS_PER_METER,
              metros_cuadrados: realDimensions.width * realDimensions.height,
              configuracion: {
                elementos,
                realDimensions,
              },
            });
            resultado = { estado: "ok" };
            break;
          }

          case "actualizar-geometria": {
            // En paralelo (como hacía `useActualizarMesasSilent`), pero
            // guardando el resultado de CADA fila para poder nombrarlas.
            const porFila = await Promise.all(
              operacion.mesas.map(async (m) => {
                const escritura = await escribirFilaMesa(m.id, aFilaSupabase(m.valores));
                // Cero filas aquí tampoco significa "sin permisos": la mesa
                // puede haberla borrado otra sesión mientras editábamos. En ese
                // caso el guardado sigue parándose (el lienzo está desfasado y
                // hay que recargar), pero al menos dice la verdad.
                if (!escritura.ok && escritura.filas === 0) {
                  const fila = await leerEstadoFilaMesa(m.id);
                  if (fila && !fila.existe) {
                    return { nombre: m.nombre, ok: false, fallo: FALLO_DESAPARECIDA };
                  }
                }
                return { nombre: m.nombre, ok: escritura.ok, fallo: escritura.fallo };
              }),
            );
            const fallidas = porFila.filter((f) => !f.ok);
            resultado =
              fallidas.length === 0
                ? { estado: "ok" }
                : {
                    estado: "fallo",
                    // Un rechazo de permisos manda sobre un "ya no existe": es
                    // el que el dueño tiene que ir a mirar.
                    fallo:
                      fallidas.find((f) => f.fallo?.clase !== "desaparecida")?.fallo ??
                      fallidas[0].fallo,
                    mesasFallidas: fallidas.map((f) => f.nombre),
                  };
            break;
          }

          case "desactivar": {
            const escritura = await escribirFilaMesa(operacion.mesaId, { activa: false });
            if (escritura.ok) {
              resultado = { estado: "ok" };
            } else if (escritura.filas === 0) {
              // "Cero filas" NO es "sin permisos" (ver `interpretarCeroFilas`).
              // Si la fila ya no existe, o ya estaba inactiva, la desactivación
              // ESTÁ CUMPLIDA y no hay nada que hacer. Dar esto por fallo hacía
              // imposible guardar la Terraza, cuyas originales se borraron de
              // verdad y solo viven dentro del JSON `original_mesas`.
              const lectura = interpretarCeroFilas(
                "desactivar",
                await leerEstadoFilaMesa(operacion.mesaId),
              );
              resultado =
                lectura === "denegada" || lectura === "sin-confirmar"
                  ? { estado: "fallo", fallo: FALLO_PERMISOS }
                  : { estado: "omitida" };
            } else {
              resultado = { estado: "fallo", fallo: escritura.fallo };
            }
            break;
          }

          case "reactivar": {
            const escritura = await escribirFilaMesa(
              operacion.mesaId,
              aFilaSupabase(operacion.valores),
            );
            if (escritura.ok) {
              filasReactivadas.add(operacion.mesaId);
              adoptarIdReal(operacion.idCanvas, operacion.mesaId);
              resultado = { estado: "ok" };
            } else if (escritura.filas === 0) {
              // Cero filas aquí puede ser lo ESPERADO —la fila original ya no
              // existe (Terraza) y la crea el INSERT de plan B que va detrás—
              // o un rechazo de RLS sobre una fila que sí está. Se distingue
              // leyéndola: reactivar no escribe solo `activa`, también el
              // nombre y la geometría, así que si la fila está ahí ese UPDATE
              // debería haberla tocado. Antes se asumía siempre lo primero y
              // el INSERT acababa chocando con un 23505 confuso.
              const lectura = interpretarCeroFilas(
                "reactivar",
                await leerEstadoFilaMesa(operacion.mesaId),
              );
              resultado =
                lectura === "fila-ausente"
                  ? { estado: "omitida" }
                  : { estado: "fallo", fallo: FALLO_PERMISOS };
            } else {
              resultado = { estado: "fallo", fallo: escritura.fallo };
            }
            break;
          }

          case "insertar": {
            if (
              operacion.soloSiNoSeReactivo &&
              filasReactivadas.has(operacion.soloSiNoSeReactivo)
            ) {
              resultado = { estado: "omitida" };
              break;
            }
            const { data, error } = await supabase
              .from("mesas")
              .insert(aFilaSupabase(operacion.valores))
              .select("id")
              .single();
            if (error || !data) {
              resultado = {
                estado: "fallo",
                fallo: error ? clasificarFallo(error) : FALLO_PERMISOS,
              };
            } else {
              adoptarIdReal(operacion.idCanvas, data.id);
              resultado = { estado: "ok" };
            }
            break;
          }

          case "repuntar": {
            const destino = resolverIdFinalMesa(
              operacion.destinoIdCanvas,
              mesasCanvas,
              idTemporalAReal,
            );
            const repunte = await repuntarAsignacionesMesa(operacion.origenId, destino);
            resultado = repunte.ok
              ? { estado: "ok" }
              : { estado: "fallo", fallo: repunte.fallo };
            break;
          }
        }

        resultados[i] = { operacion, ...resultado };
        if (resultado.estado === "fallo") {
          hayFallo = true;
          break;
        }
      }

      // Los desagrupes solo se dan por resueltos si el plan entero se aplicó.
      // Si no, se conservan —con los ids ya renombrados a los reales— para que
      // un segundo "Guardar" converja en vez de repuntar hacia ids fantasma.
      if (hayFallo) {
        setPendingUnmerges((prev) => aplicarRenombradosADesagrupes(prev, idTemporalAReal));
      } else {
        setPendingUnmerges([]);
      }

      const { exito, mensaje } = construirMensajeGuardado(resultados);
      if (exito) {
        toast.success(mensaje);
      } else {
        console.error("Guardado aplicado a medias:", resultados);
        toast.error(mensaje, { duration: 20000 });
      }
    } catch (error) {
      console.error("Error al guardar:", error);
      // Una excepción (red, o el hook del plano) deja el paso en curso como
      // fallido: el mensaje sigue enumerando lo que sí se había aplicado.
      const enCurso = resultados.findIndex((r) => r.estado === "pendiente");
      if (enCurso >= 0) {
        resultados[enCurso] = {
          ...resultados[enCurso],
          estado: "fallo",
          fallo: clasificarFallo(error),
        };
      }
      setPendingUnmerges((prev) => aplicarRenombradosADesagrupes(prev, idTemporalAReal));
      const { mensaje } = construirMensajeGuardado(resultados);
      toast.error(mensaje, { duration: 20000 });
    } finally {
      setIsSaving(false);
      // Resincronizar SIEMPRE, también tras un fallo: si no, la pantalla se
      // queda mostrando un estado de fantasía (mesas que el usuario cree
      // guardadas y no lo están, o uniones que creen haber absorbido).
      refetchMesas();
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      // Siempre (éxito o error): asienta el estado actual como nueva base no
      // deshacible y reactiva el registro de historial. Si se hiciera solo en
      // el camino de éxito, un error a mitad de guardado dejaría
      // suppressHistoryRef atascado en `true` para siempre.
      setSaveGeneration((v) => v + 1);
    }
  }, [
    espacioId,
    elementos,
    mesasCanvas,
    realDimensions,
    guardarPlano,
    refetchMesas,
    pendingUnmerges,
    repuntarAsignacionesMesa,
    escribirFilaMesa,
    leerEstadoFilaMesa,
    queryClient,
  ]);

  // Exportar imagen: PNG del contenido del plano (no del viewport con zoom/pan
  // ni del grid) a 2x, resuelto en CanvasPlano.exportImage().
  const handleExport = useCallback(() => {
    const dataUrl = canvasRef.current?.exportImage();
    if (dataUrl) {
      const link = document.createElement("a");
      link.download = `plano-${espacioNombre}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Imagen exportada");
    } else {
      toast.error("No se pudo exportar la imagen");
    }
  }, [espacioNombre]);

  // Antes de abrir el diálogo de "Limpiar", contar cuántas asignaciones_mesa
  // (reservas con mesa asignada) se perderían — antes se borraba todo sin
  // avisar y el ON DELETE CASCADE se llevaba por delante el historial completo.
  const handleAbrirClearDialog = useCallback(async () => {
    try {
      const { data: mesasEspacio, error: errMesas } = await supabase
        .from("mesas")
        .select("id")
        .eq("espacio_id", espacioId);
      if (errMesas) throw errMesas;

      const mesaIds = (mesasEspacio || []).map((m) => m.id);
      if (mesaIds.length === 0) {
        setClearCounts({ total: 0, futuras: 0, mesas: 0 });
        setClearConfirmChecked(false);
        setShowClearDialog(true);
        return;
      }

      const { data: asignaciones, error: errAsig } = await supabase
        .from("asignaciones_mesa")
        .select("id, reserva_id, reservas!inner(fecha)")
        .in("mesa_id", mesaIds);
      if (errAsig) throw errAsig;

      // "sv-SE" da directamente YYYY-MM-DD en hora LOCAL (igual que hoyLocal() en
      // EditorMenuTapasWeb/EditorNovedadesWeb) — con toISOString().slice(0,10) la
      // fecha sale en UTC y de madrugada en España queda un día por detrás/delante.
      const hoy = new Date().toLocaleDateString("sv-SE");
      const total = asignaciones?.length || 0;
      const futuras = (asignaciones || []).filter((a) => {
        // El join "reservas!inner(fecha)" de supabase-js puede tipar la
        // relación como objeto o como array según la versión; cubrimos ambos.
        const relacion = a.reservas as { fecha?: string } | { fecha?: string }[] | null;
        const fecha = Array.isArray(relacion) ? relacion[0]?.fecha : relacion?.fecha;
        return !!fecha && fecha >= hoy;
      }).length;

      setClearCounts({ total, futuras, mesas: mesaIds.length });
      setClearConfirmChecked(false);
      setShowClearDialog(true);
    } catch (error) {
      console.error("Error al comprobar asignaciones antes de limpiar:", error);
      // El diálogo NO se abre: enseñarlo sin las cifras reales invitaría a
      // confirmar un borrado en cascada a ciegas.
      toast.error(
        "No se han podido comprobar las mesas ni las reservas de este espacio, así que no se abre el diálogo de limpiar. Recarga la página e inténtalo otra vez.",
      );
    }
  }, [espacioId]);

  // Limpiar canvas (incluyendo mesas de la BBDD)
  //
  // Es la acción MÁS destructiva del editor: borra todas las filas de `mesas`
  // del espacio y, por el ON DELETE CASCADE de `asignaciones_mesa.mesa_id`, se
  // lleva por delante el historial de reservas. Comprobar `{ error }` NO basta
  // (un DELETE denegado por RLS se resuelve con `{ data: [], error: null }`),
  // así que se pide `.select('id')` y se compara con las mesas que se contaron
  // al abrir el diálogo. Un borrado parcial NUNCA se anuncia como éxito.
  const handleClear = useCallback(async () => {
    const mesasEsperadas = clearCounts?.mesas ?? 0;

    const cerrarDialogo = () => {
      setShowClearDialog(false);
      setClearCounts(null);
      setClearConfirmChecked(false);
    };

    try {
      const { data, error } = await supabase
        .from("mesas")
        .delete()
        .eq("espacio_id", espacioId)
        .select("id");

      const resultado = construirMensajeLimpieza({
        mesasEsperadas,
        mesasEliminadas: error ? undefined : data?.length ?? 0,
        fallo: error ? clasificarFallo(error) : undefined,
      });

      if (!resultado.exito) {
        console.error("Limpieza aplicada a medias:", {
          error,
          mesasEsperadas,
          mesasEliminadas: data?.length ?? 0,
        });
        // El estado local NO se toca: el lienzo tiene que seguir enseñando lo
        // que de verdad queda, no un plano vacío de mentira. Se resincroniza y
        // se cierra el diálogo para que el usuario pueda recargar.
        cerrarDialogo();
        refetchMesas();
        queryClient.invalidateQueries({ queryKey: ["mesas"] });
        toast.error(resultado.mensaje, { duration: 20000 });
        return;
      }

      // El DELETE de arriba ya se ejecutó en BBDD: este cambio de estado no
      // puede ser un paso de historial deshacible (deshacerlo no resucitaría
      // las filas ya borradas), así que se convierte en la nueva base.
      marcarNoDeshacible();

      // Limpiar estado local
      setElementos([]);
      setMesasCanvas([]);
      setSelectedElement(null);
      setPendingUnmerges([]);
      canvasRef.current?.clearCanvas();

      // Refrescar datos
      refetchMesas();
      queryClient.invalidateQueries({ queryKey: ["mesas"] });

      cerrarDialogo();
      toast.success(resultado.mensaje);
    } catch (error) {
      console.error("Error al limpiar:", error);
      cerrarDialogo();
      refetchMesas();
      const { mensaje } = construirMensajeLimpieza({
        mesasEsperadas,
        fallo: clasificarFallo(error),
      });
      toast.error(mensaje, { duration: 20000 });
    }
  }, [espacioId, refetchMesas, marcarNoDeshacible, clearCounts, queryClient]);

  // Antes de abrir el diálogo de eliminar un elemento, si es una mesa ya
  // persistida en BBDD, contar sus asignaciones_mesa para avisar al usuario.
  const handleAbrirDeleteDialog = useCallback(async () => {
    if (!selectedElement) return;
    if (selectedElement.tipo === "mesa" && !esMesaNoPersistida(selectedElement.id)) {
      try {
        const { count, error } = await supabase
          .from("asignaciones_mesa")
          .select("id", { count: "exact", head: true })
          .eq("mesa_id", selectedElement.id);
        if (error) throw error;
        setAsignacionesSeleccionada(count || 0);
      } catch (error) {
        console.error("Error al comprobar asignaciones de la mesa:", error);
        // NO se abre el diálogo con un tranquilizador "0 reservas afectadas":
        // ese cero sería precisamente la cifra falsa en el momento en el que el
        // usuario más necesita la de verdad, porque borrar la mesa arrastra sus
        // asignaciones en cascada.
        toast.error(
          "No se ha podido comprobar cuántas reservas tiene asignadas esta mesa, así que no se abre el diálogo de borrado. Recarga la página e inténtalo otra vez.",
        );
        return;
      }
    } else {
      setAsignacionesSeleccionada(0);
    }
    setShowDeleteDialog(true);
  }, [selectedElement]);

  // Eliminar elemento seleccionado
  const handleDeleteSelected = useCallback(async () => {
    if (!selectedElement) return;

    if (selectedElement.tipo === "mesa") {
      if (esMesaNoPersistida(selectedElement.id)) {
        // Mesa temporal (nunca guardada): solo hay que quitarla del estado local.
        setMesasCanvas((prev) => prev.filter((m) => m.id !== selectedElement.id));
        canvasRef.current?.removeElement(selectedElement.id);
      } else {
        // Mesa ya persistida en BBDD: antes esto solo la quitaba del canvas y
        // reaparecía en el próximo "Guardar"/recarga porque nunca se borraba
        // de verdad. Reutilizamos la misma mutación que usa PanelLateral.
        try {
          await eliminarMesa.mutateAsync(selectedElement.id);
        } catch (error) {
          console.error("Error al eliminar mesa:", error);
          toast.error("Error al eliminar la mesa");
          return;
        }
        // El DELETE de arriba ya se ejecutó en BBDD: no puede ser un paso de
        // historial deshacible.
        marcarNoDeshacible();
        setMesasCanvas((prev) => prev.filter((m) => m.id !== selectedElement.id));
        canvasRef.current?.removeElement(selectedElement.id);
        // useEliminarMesa ya muestra su propio toast de éxito: no dupliques con
        // el genérico de abajo.
        setSelectedElement(null);
        setShowDeleteDialog(false);
        return;
      }
    } else {
      setElementos((prev) => prev.filter((e) => e.id !== selectedElement.id));
      canvasRef.current?.removeElement(selectedElement.id);
    }
    setSelectedElement(null);
    setShowDeleteDialog(false);
    toast.success("Elemento eliminado");
  }, [selectedElement, eliminarMesa, marcarNoDeshacible]);

  // Atajos de teclado: coinciden con los que ya anunciaban los tooltips de la
  // barra de herramientas pero que hasta ahora no hacían nada (S/W/A/M/C/D,
  // Supr para borrar la selección con el MISMO diálogo de confirmación que el
  // botón de la papelera, Esc para volver a "seleccionar").
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      // Con cualquier diálogo (Alert)Dialog abierto — el de "Limpiar"/"Eliminar
      // elemento" de aquí mismo, o el de "Eliminar mesa" de PanelLateral, que
      // vive en su propio estado y no es visible desde este componente — no
      // debe cambiar de herramienta ni reabrir el diálogo por detrás: antes
      // escribir "d" para confirmar mentalmente "delete" mientras el diálogo
      // tenía el foco (en un botón, no en un input) cambiaba la herramienta a
      // "puerta" sin que el usuario se diera cuenta. Por el mismo motivo,
      // tampoco debe deshacer/rehacer por detrás del diálogo.
      const dialogAbierto = !!document.querySelector('[role="dialog"], [role="alertdialog"]');

      // Deshacer/rehacer: Ctrl/Cmd+Z (deshacer), Ctrl/Cmd+Shift+Z o Ctrl+Y
      // (rehacer) — antes de la comprobación genérica de Ctrl/Cmd/Alt de abajo,
      // que si no los descartaría sin hacer nada.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          if (dialogAbierto) return;
          e.preventDefault();
          if (key === "y" || (key === "z" && e.shiftKey)) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogAbierto) return;

      switch (e.key.toLowerCase()) {
        case "s":
          setActiveTool("select");
          break;
        case "w":
          setActiveTool("wall");
          break;
        case "a":
          setActiveTool("area");
          break;
        case "m":
          setActiveTool("mesa-rect");
          break;
        case "c":
          setActiveTool("mesa-circular");
          break;
        case "d":
          setActiveTool("door");
          break;
        case "escape":
          setActiveTool("select");
          break;
        case "delete":
        case "backspace":
          if (selectedElement && !e.repeat) {
            e.preventDefault();
            handleAbrirDeleteDialog();
          }
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedElement, handleAbrirDeleteDialog, handleUndo, handleRedo]);

  if (loadingPlano || loadingMesas) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-card to-card/80 rounded-xl p-4 border shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{espacioNombre}</h2>
            <p className="text-sm text-muted-foreground">
              Editor de plano •{" "}
              {areaReal
                ? `≈ ${areaReal.areaM2.toLocaleString("es-ES", { maximumFractionDigits: 1 })} m² · ${areaReal.widthM.toFixed(2)} × ${areaReal.heightM.toFixed(2)} m`
                : `${realDimensions.width}m × ${realDimensions.height}m • ${(realDimensions.width * realDimensions.height).toFixed(0)} m²`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Controles de zoom */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={() => {
                const newZoom = Math.max(0.25, zoomLevel / 1.15);
                canvasRef.current?.setZoom(newZoom);
                setZoomLevel(newZoom);
              }}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium w-12 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={() => {
                const newZoom = Math.min(3, zoomLevel * 1.15);
                canvasRef.current?.setZoom(newZoom);
                setZoomLevel(newZoom);
              }}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          
          <Button variant="outline" size="sm" onClick={handleExport} className="rounded-lg">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAbrirClearDialog}
            className="rounded-lg text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="rounded-lg">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <ToolbarDibujo
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onDeleteSelected={() => { if (selectedElement) handleAbrirDeleteDialog(); }}
        hasSelection={!!selectedElement}
        showMeasurements={showMeasurements}
        onToggleMeasurements={() => setShowMeasurements(!showMeasurements)}
        onCenterPlan={() => canvasRef.current?.centerOnContent()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        puedeDeshacer={history.puedeDeshacer && !isSaving}
        puedeRehacer={history.puedeRehacer && !isSaving}
      />

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0 h-full">
        {/* Canvas - zoom nativo de Fabric.js */}
        <div 
          ref={containerRef}
          className="flex-1 h-full rounded-xl border-2 border-border/30 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 shadow-lg relative overflow-hidden"
        >
          <CanvasPlano
            ref={canvasRef}
            pixelsPerMeter={PIXELS_PER_METER}
            activeTool={activeTool}
            elementos={elementos}
            mesasCanvas={mesasCanvas}
            mesasDB={mesas}
            realDimensions={realDimensions}
            containerSize={containerSize}
            planoConfig={plano?.configuracion}
            selectedElement={selectedElement}
            initialZoom={fitZoom}
            showMeasurements={showMeasurements}
            onElementosChange={setElementos}
            onMesasChange={setMesasCanvas}
            onSelectionChange={setSelectedElement}
            onToolChange={setActiveTool}
            onZoomChange={setZoomLevel}
            onRoomDrawn={handleRoomDrawn}
            onMesaCreada={(mesaId, nombre) => {
              setMesaRecienCreadaId(mesaId);
              toast.info(`Mesa ${nombre} (primer número libre). Escribe el número real de la sala.`);
            }}
          />
          {/* Indicador de modo pan: compacto y semitransparente por defecto para
              no tapar cotas u otros elementos cerca de la esquina inferior. */}
          <div className="absolute bottom-2 left-2 text-[10px] leading-none text-muted-foreground bg-background/70 px-1.5 py-0.5 rounded opacity-60 pointer-events-none">
            🖱️ Rueda: Zoom • Espacio+Arrastrar: Mover
          </div>
        </div>

        {/* Panel lateral */}
        <PanelLateral
          espacioId={espacioId}
          selectedElement={selectedElement}
          mesasCanvas={mesasCanvas}
          pixelsPerMeter={PIXELS_PER_METER}
          realDimensions={realDimensions}
          elementos={elementos}
          onMesasChange={setMesasCanvas}
          onSelectionChange={setSelectedElement}
          marcarNoDeshacible={marcarNoDeshacible}
          mesaRecienCreadaId={mesaRecienCreadaId}
          onMesaRecienCreadaAtendida={() => setMesaRecienCreadaId(null)}
          onRenombrarMesaEnCanvas={(mesaId, nombre) => {
            canvasRef.current?.updateMesaNombre(mesaId, nombre);
          }}
          onUnmergeMesa={(mesaId) => {
            const union = mesasCanvas.find((m) => m.id === mesaId);
            const nuevasMesas = canvasRef.current?.unmergeMesa(mesaId);
            if (nuevasMesas && nuevasMesas.length > 0 && !esMesaNoPersistida(mesaId)) {
              // La mesa fusionada ya estaba guardada en BBDD: al pulsar
              // "Guardar" hay que repuntar sus asignaciones y retirar su fila
              // (antes se perdía sin más al no rastrearse este caso).
              //
              // Además se anota DE QUÉ FILA ORIGINAL sale cada mesa nueva.
              // `unmergeMesa` recrea las mesas recorriendo `originalMesas` en
              // orden y les da ids temporales nuevos, así que el emparejamiento
              // es por posición — y es el único hilo que queda para poder
              // REACTIVAR la fila original en vez de insertar un duplicado.
              const originalesPorNuevoId: Record<string, string> = {};
              union?.originalMesas?.forEach((original, indice) => {
                const nueva = nuevasMesas[indice];
                if (nueva && original?.id) originalesPorNuevoId[nueva.id] = original.id;
              });

              setPendingUnmerges(prev => [
                ...prev,
                {
                  mesaId,
                  nombreUnion: union?.nombre,
                  nuevosMesaIds: nuevasMesas.map(m => m.id),
                  originalesPorNuevoId,
                },
              ]);
            }
            setSelectedElement(null);
          }}
          onRemoveElement={(id) => {
            canvasRef.current?.removeElement(id);
          }}
          onUpdateMesaEtiqueta={(mesaId, etiqueta) => {
            // Actualizar estado local
            setMesasCanvas(prev => prev.map(m => 
              m.id === mesaId ? { ...m, etiqueta } : m
            ));
            // Actualizar canvas
            canvasRef.current?.updateMesaBocadillo(mesaId, etiqueta);
          }}
        />
      </div>


      {/* Dialog de confirmación para limpiar */}
      <AlertDialog
        open={showClearDialog}
        onOpenChange={(open) => {
          setShowClearDialog(open);
          if (!open) {
            setClearCounts(null);
            setClearConfirmChecked(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Limpiar todo el plano?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  Esta acción eliminará TODOS los elementos del plano incluyendo paredes, áreas, puertas y{" "}
                  <strong>todas las mesas guardadas en la base de datos</strong>. Esta acción no se puede deshacer.
                </p>
                {clearCounts && clearCounts.total > 0 && (
                  <p className="mt-2">
                    Se van a perder <strong>{clearCounts.total}</strong> asignación(es) de reserva a mesa
                    {clearCounts.futuras > 0 && (
                      <>
                        , de las cuales <strong>{clearCounts.futuras}</strong> son de reservas de hoy o futuras
                      </>
                    )}
                    .
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {clearCounts && clearCounts.futuras > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <Checkbox
                id="confirmar-limpiar-futuras"
                checked={clearConfirmChecked}
                onCheckedChange={(checked) => setClearConfirmChecked(checked === true)}
              />
              <Label htmlFor="confirmar-limpiar-futuras" className="text-sm font-normal">
                Entiendo que se perderán {clearCounts.futuras} reserva(s) de hoy o futuras con mesa asignada
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              disabled={!!clearCounts && clearCounts.futuras > 0 && !clearConfirmChecked}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Limpiar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de confirmación para eliminar elemento */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este elemento?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedElement?.tipo === "mesa"
                ? `Se eliminará la mesa "${selectedElement?.nombre || 'seleccionada'}".`
                : `Se eliminará el elemento de tipo "${selectedElement?.tipo || 'seleccionado'}".`
              }
              {selectedElement?.tipo === "mesa" && asignacionesSeleccionada > 0 && (
                <>
                  {" "}Tiene <strong>{asignacionesSeleccionada}</strong> reserva(s) asignada(s) que se
                  desvincularán de la mesa.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
