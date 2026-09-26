import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, Download, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useActualizarMesasSilent, useEliminarMesa } from "@/hooks/useMesas";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ToolbarDibujo, ToolType } from "./ToolbarDibujo";
import { CanvasPlano, CanvasPlanoRef } from "./CanvasPlano";
import { PanelLateral } from "./PanelLateral";
import { usePlanoHistory, type PlanoSnapshot } from "./store/usePlanoHistory";
import { decidirModoSnapshot } from "./store/historySnapshotMode";
import {
  esMesaTemporal,
  esMesaGrupoNueva,
  esMesaNoPersistida,
  planRepuntarAsignaciones,
  detectarPoligonoCerrado,
  areaShoelace,
  bboxPoligono,
  PIXELS_PER_METER,
} from "./planoUtils";
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

  // Mesas fusionadas YA guardadas en BBDD que el usuario ha desagrupado en esta
  // sesión de edición: hay que repuntar sus asignaciones_mesa a la primera mesa
  // resultante y borrar la fila de la mesa fusionada al pulsar "Guardar"
  // (mientras tanto solo viven en el canvas/estado local).
  const [pendingUnmerges, setPendingUnmerges] = useState<Array<{ mesaId: string; nuevosMesaIds: string[] }>>([]);

  // Recuento de asignaciones_mesa afectadas, para mostrar en los diálogos de
  // confirmación de "Limpiar" y "Eliminar mesa" antes de borrar nada.
  const [clearCounts, setClearCounts] = useState<{ total: number; futuras: number } | null>(null);
  const [clearConfirmChecked, setClearConfirmChecked] = useState(false);
  const [asignacionesSeleccionada, setAsignacionesSeleccionada] = useState(0);

  const canvasRef = useRef<CanvasPlanoRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Escala FIJA: 50 píxeles por metro (no cambia con el tamaño del contenedor).
  // Centralizada en planoUtils.ts (antes era una constante local aquí).

  // Escala: dimensiones reales en metros
  const [realDimensions, setRealDimensions] = useState({ width: 12, height: 8 });

  const { data: plano, isLoading: loadingPlano } = usePlanoEspacio(espacioId);
  const { data: mesas = [], isLoading: loadingMesas, refetch: refetchMesas } = useMesas(espacioId);
  const guardarPlano = useCrearOActualizarPlano();
  const actualizarMesas = useActualizarMesasSilent();
  const eliminarMesa = useEliminarMesa();

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
  useEffect(() => { elementosRef.current = elementos; }, [elementos]);
  useEffect(() => { mesasCanvasRef.current = mesasCanvas; }, [mesasCanvas]);
  useEffect(() => { pendingUnmergesRef.current = pendingUnmerges; }, [pendingUnmerges]);

  const history = usePlanoHistory({ elementos: [], mesasCanvas: [], pendingUnmerges: [] });

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

    const snapshot: PlanoSnapshot = { elementos, mesasCanvas, pendingUnmerges };

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

    setElementos(snapshotElementos);
    setMesasCanvas(snapshotMesas);
    setPendingUnmerges(snapshotPendingUnmerges);
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

  // Repunta las asignaciones_mesa de `mesaOrigenId` hacia `mesaDestinoId` (fusión:
  // originales -> mesa fusionada; desagrupar: mesa fusionada eliminada -> primera
  // mesa resultante). Si la reserva ya está asignada en destino, la de origen se
  // elimina en vez de actualizarse para no violar el UNIQUE(reserva_id, mesa_id).
  const repuntarAsignacionesMesa = useCallback(async (mesaOrigenId: string, mesaDestinoId: string) => {
    const { data: asignacionesOrigen, error: errOrigen } = await supabase
      .from("asignaciones_mesa")
      .select("id, reserva_id, mesa_id")
      .eq("mesa_id", mesaOrigenId);
    if (errOrigen) throw errOrigen;
    if (!asignacionesOrigen || asignacionesOrigen.length === 0) return;

    const { data: asignacionesDestino, error: errDestino } = await supabase
      .from("asignaciones_mesa")
      .select("reserva_id")
      .eq("mesa_id", mesaDestinoId);
    if (errDestino) throw errDestino;

    const reservaIdsDestino = new Set((asignacionesDestino || []).map((a) => a.reserva_id));
    const { aActualizar, aEliminar } = planRepuntarAsignaciones(asignacionesOrigen, reservaIdsDestino);

    if (aEliminar.length > 0) {
      const { error } = await supabase.from("asignaciones_mesa").delete().in("id", aEliminar);
      if (error) throw error;
    }
    if (aActualizar.length > 0) {
      const { error } = await supabase
        .from("asignaciones_mesa")
        .update({ mesa_id: mesaDestinoId })
        .in("id", aActualizar);
      if (error) throw error;
    }
  }, []);

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

  // Aplicar nuevas dimensiones reales
  const handleApplyDimensions = useCallback((width: number, height: number) => {
    setRealDimensions({ width, height });
    toast.success(`Escala aplicada: ${width}m × ${height}m`);
  }, []);

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

  // Guardar plano
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    // Guardar renombra ids temporales -> reales en varios pasos (uno por
    // mesa, cada uno tras su propio await de inserción) y vacía
    // pendingUnmerges: nada de eso debe registrarse como pasos de historial
    // deshacibles. Se ignoran todos hasta el reset final (ver saveGeneration).
    suppressHistoryRef.current = true;
    try {
      // Calcular tamaño del canvas en píxeles
      const canvasWidth = realDimensions.width * PIXELS_PER_METER;
      const canvasHeight = realDimensions.height * PIXELS_PER_METER;
      
      // Guardar configuración del plano con dimensiones reales en metros
      await guardarPlano.mutateAsync({
        espacio_id: espacioId,
        ancho: canvasWidth,
        alto: canvasHeight,
        ancho_metros: realDimensions.width,
        alto_metros: realDimensions.height,
        pixels_per_meter: PIXELS_PER_METER,
        metros_cuadrados: realDimensions.width * realDimensions.height,
        configuracion: {
          elementos,
          realDimensions,
        },
      });

      // Recopilar IDs de mesas originales que forman parte de mesas fusionadas
      // (id de la mesa fusionada -> ids de sus originales ya persistidos)
      const idsOriginalesFusionadasPorGrupo = new Map<string, string[]>();
      mesasCanvas.forEach(m => {
        if (m.isMerged && m.originalMesas) {
          const originalesPersistidos = m.originalMesas
            .map(orig => orig.id)
            .filter(id => !esMesaNoPersistida(id));
          if (originalesPersistidos.length > 0) {
            idsOriginalesFusionadasPorGrupo.set(m.id, originalesPersistidos);
          }
        }
      });
      const idsOriginalesFusionadas = new Set<string>(
        Array.from(idsOriginalesFusionadasPorGrupo.values()).flat()
      );

      // Actualizar posiciones de mesas (solo las que no son temporales, no agrupadas nuevas, y no son originales de fusiones)
      const mesasToUpdate = mesasCanvas.filter(m =>
        !esMesaNoPersistida(m.id) &&
        !idsOriginalesFusionadas.has(m.id)
      );
      if (mesasToUpdate.length > 0) {
        const updates = mesasToUpdate.map((mesa) => ({
          id: mesa.id,
          pos_x: mesa.posX,
          pos_y: mesa.posY,
          ancho: mesa.ancho,
          alto: mesa.alto,
          rotacion: mesa.rotacion ?? 0,
          is_merged: mesa.isMerged || false,
          original_mesas: mesa.originalMesas || null,
          etiqueta: mesa.etiqueta || null,
        }));
        await actualizarMesas.mutateAsync(updates);
      }

      // Mapa de ids temporales (mesa-temp-.../mesa-grupo-...) -> id real de BBDD,
      // para poder resolver los pendingUnmerges y renombrar en canvas/estado.
      const idTemporalAReal = new Map<string, string>();

      // Insertar mesas sueltas nuevas: creadas con la herramienta del lienzo
      // ("mesa-temp-...") o resultantes de desagrupar una mesa fusionada.
      // Antes se descartaban al guardar y la mesa desaparecía en el próximo
      // recargado del plano.
      const mesasTempNuevas = mesasCanvas.filter(m => esMesaTemporal(m.id));
      for (const mesaTemp of mesasTempNuevas) {
        const { data: nuevaMesa, error } = await supabase
          .from('mesas')
          .insert({
            espacio_id: espacioId,
            nombre: mesaTemp.nombre,
            capacidad: mesaTemp.capacidad,
            forma: mesaTemp.forma,
            ancho: mesaTemp.ancho,
            alto: mesaTemp.alto,
            pos_x: mesaTemp.posX,
            pos_y: mesaTemp.posY,
            rotacion: mesaTemp.rotacion ?? 0,
            is_merged: false,
            etiqueta: mesaTemp.etiqueta || null,
          })
          .select()
          .single();

        if (error) throw error;

        if (nuevaMesa) {
          idTemporalAReal.set(mesaTemp.id, nuevaMesa.id);
          setMesasCanvas(prev => prev.map(m => (m.id === mesaTemp.id ? { ...m, id: nuevaMesa.id } : m)));
          // Sin esto, el objeto en el lienzo se queda con el id temporal: en el
          // siguiente ciclo de carga no se reconoce como "ya en canvas" y se
          // duplicaría la mesa al re-renderizar desde el estado ya actualizado.
          canvasRef.current?.renameMesaId(mesaTemp.id, nuevaMesa.id);
        }
      }

      // Crear mesas agrupadas nuevas (las que empiezan con mesa-grupo-)
      const mesasGrupoNuevas = mesasCanvas.filter(m => esMesaGrupoNueva(m.id));
      for (const mesaGrupo of mesasGrupoNuevas) {
        // Crear la nueva mesa agrupada
        const { data: nuevaMesa, error } = await supabase
          .from('mesas')
          .insert({
            espacio_id: espacioId,
            nombre: mesaGrupo.nombre,
            capacidad: mesaGrupo.capacidad,
            forma: mesaGrupo.forma,
            ancho: mesaGrupo.ancho,
            alto: mesaGrupo.alto,
            pos_x: mesaGrupo.posX,
            pos_y: mesaGrupo.posY,
            rotacion: mesaGrupo.rotacion ?? 0,
            is_merged: true,
            original_mesas: mesaGrupo.originalMesas as any,
          })
          .select()
          .single();

        if (error) throw error;

        if (nuevaMesa) {
          idTemporalAReal.set(mesaGrupo.id, nuevaMesa.id);
          // Actualizar el ID en el estado local
          setMesasCanvas(prev => prev.map(m =>
            m.id === mesaGrupo.id
              ? { ...m, id: nuevaMesa.id }
              : m
          ));
          // Igual que con las mesas sueltas: el objeto en el lienzo debe
          // pasar a usar el id real para no duplicarse en el próximo render.
          canvasRef.current?.renameMesaId(mesaGrupo.id, nuevaMesa.id);
        }
      }

      // Repuntar las asignaciones_mesa de cada mesa original hacia su mesa
      // fusionada (resolviendo el id real si la fusión se creó en esta misma
      // sesión) ANTES de borrar la fila original — si no, el ON DELETE CASCADE
      // de asignaciones_mesa.mesa_id se llevaba por delante las reservas.
      for (const [grupoId, originalesIds] of idsOriginalesFusionadasPorGrupo) {
        const grupoIdReal = idTemporalAReal.get(grupoId) ?? grupoId;
        for (const originalId of originalesIds) {
          await repuntarAsignacionesMesa(originalId, grupoIdReal);
        }
      }
      // Eliminar mesas originales que ahora forman parte de mesas fusionadas
      for (const originalId of idsOriginalesFusionadas) {
        await supabase.from('mesas').delete().eq('id', originalId);
      }

      // Resuelve el id final (ya real en BBDD) de una mesa resultante de un
      // desagrupe. Puede no estar ni en `idTemporalAReal` ni sobrevivir tal
      // cual en `mesasCanvas` si el usuario la volvió a fusionar con otra
      // ANTES de guardar (desagrupar -> re-fusionar en el mismo editado): en
      // ese caso quedó absorbida como "original" dentro de otro grupo nuevo,
      // así que seguimos la cadena hasta el grupo que sí sobrevive.
      const resolverMesaFinal = (id: string, visitados = new Set<string>()): string => {
        if (visitados.has(id)) return id; // corta si hubiera un ciclo
        visitados.add(id);
        const real = idTemporalAReal.get(id);
        if (real) return real;
        if (mesasCanvas.some(m => m.id === id)) return id; // sigue viva tal cual
        const grupoQueLaAbsorbio = mesasCanvas.find(
          m => m.isMerged && m.originalMesas?.some(o => o.id === id)
        );
        if (grupoQueLaAbsorbio) return resolverMesaFinal(grupoQueLaAbsorbio.id, visitados);
        return id;
      };

      // Resolver los desagrupes pendientes de mesas fusionadas que YA estaban
      // en BBDD: repuntar sus asignaciones a la primera mesa resultante y
      // borrar la fila de la mesa fusionada (si no, quedaba como fila huérfana
      // y sus reservas asignadas se perdían al no repuntarlas antes de borrar).
      if (pendingUnmerges.length > 0) {
        for (const pending of pendingUnmerges) {
          const primerNuevoId = pending.nuevosMesaIds[0];
          if (!primerNuevoId) continue;
          const primerNuevoIdReal = resolverMesaFinal(primerNuevoId);
          await repuntarAsignacionesMesa(pending.mesaId, primerNuevoIdReal);
          await supabase.from('mesas').delete().eq('id', pending.mesaId);
        }
        setPendingUnmerges([]);
      }

      toast.success("Plano guardado correctamente");
      refetchMesas();
    } catch (error) {
      console.error("Error al guardar:", error);
      toast.error("Error al guardar el plano");
    } finally {
      setIsSaving(false);
      // Siempre (éxito o error): asienta el estado actual como nueva base no
      // deshacible y reactiva el registro de historial. Si se hiciera solo en
      // el camino de éxito, un error a mitad de guardado dejaría
      // suppressHistoryRef atascado en `true` para siempre.
      setSaveGeneration((v) => v + 1);
    }
  }, [espacioId, elementos, mesasCanvas, realDimensions, guardarPlano, actualizarMesas, refetchMesas, pendingUnmerges, repuntarAsignacionesMesa]);

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
        setClearCounts({ total: 0, futuras: 0 });
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

      setClearCounts({ total, futuras });
      setClearConfirmChecked(false);
      setShowClearDialog(true);
    } catch (error) {
      console.error("Error al comprobar asignaciones antes de limpiar:", error);
      toast.error("No se pudieron comprobar las reservas asociadas a las mesas");
    }
  }, [espacioId]);

  // Limpiar canvas (incluyendo mesas de la BBDD)
  const handleClear = useCallback(async () => {
    try {
      // Eliminar todas las mesas del espacio de la BBDD
      const { error } = await supabase
        .from("mesas")
        .delete()
        .eq("espacio_id", espacioId);

      if (error) throw error;

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

      setShowClearDialog(false);
      setClearCounts(null);
      setClearConfirmChecked(false);
      toast.success("Plano y mesas eliminados correctamente");
    } catch (error) {
      console.error("Error al limpiar:", error);
      toast.error("Error al eliminar las mesas");
    }
  }, [espacioId, refetchMesas, marcarNoDeshacible]);

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
        setAsignacionesSeleccionada(0);
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
          onMesasChange={setMesasCanvas}
          onSelectionChange={setSelectedElement}
          marcarNoDeshacible={marcarNoDeshacible}
          onUnmergeMesa={(mesaId) => {
            const nuevasMesas = canvasRef.current?.unmergeMesa(mesaId);
            if (nuevasMesas && nuevasMesas.length > 0 && !esMesaNoPersistida(mesaId)) {
              // La mesa fusionada ya estaba guardada en BBDD: al pulsar
              // "Guardar" hay que repuntar sus asignaciones y borrar su fila
              // (antes se perdía sin más al no rastrearse este caso).
              setPendingUnmerges(prev => [
                ...prev,
                { mesaId, nuevosMesaIds: nuevasMesas.map(m => m.id) },
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
