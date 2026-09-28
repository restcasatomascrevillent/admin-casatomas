import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Square, Circle, Users, Trash2, ChevronDown, ChevronRight, Info, List, Unlink, Tag, X, Check, Hash, Rows3, Ruler } from "lucide-react";
import { useActualizarMesa, useCrearMesa, useEliminarMesa } from "@/hooks/useMesas";
import { MesaCanvas } from "./EditorPlanoEspacio";
import { calcularRejillaMesas, esMesaNoPersistida, rectanguloDeMesa, type RectanguloOcupado } from "./planoUtils";
import {
  MAX_MESAS_POR_LOTE,
  mensajeChoquesLoteNombresMesa,
  mensajeNombreMesaDuplicado,
  mesasCanvasParaNombre,
  nombreMesaDuplicado,
  nombresMesaDuplicadosEnLote,
  normalizarNombreMesa,
  siguienteNumeroMesaLibre,
} from "./nombresMesa";
import {
  MAX_CAPACIDAD_MESA,
  MAX_LADO_MESA_CM,
  MIN_CAPACIDAD_MESA,
  MIN_LADO_MESA_CM,
  PRESETS_MESA,
  PRESET_MESA_POR_DEFECTO,
  actualizarFilaLote,
  anadirNombresAlLote,
  aplicarCapacidadAFilas,
  aplicarPresetAFila,
  aplicarPresetAFilas,
  medidasMesaTexto,
  motivoFalloAltaMesa,
  normalizarCapacidadMesa,
  normalizarLadoMesaCm,
  parsearListaNumerosMesa,
  presetMesaPorId,
  presetMesaQueEncaja,
  quitarFilaLote,
  resumenAltaLoteMesas,
  resumenFilasLote,
  type FilaLoteMesa,
  type FormaMesa,
  type PresetMesa,
  type ResultadoAltaMesa,
  type ResumenAltaLoteMesas,
} from "./lotesMesa";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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

interface PanelLateralProps {
  espacioId: string;
  selectedElement: any;
  mesasCanvas: MesaCanvas[];
  pixelsPerMeter: number;
  /** Dimensiones del espacio en metros: las necesita el alta en lote para repartir las mesas sin apilarlas. */
  realDimensions?: { width: number; height: number };
  onMesasChange: (mesas: MesaCanvas[]) => void;
  onSelectionChange: (element: any) => void;
  onUnmergeMesa?: (mesaId: string) => void;
  onRemoveElement?: (id: string) => void;
  onUpdateMesaEtiqueta?: (mesaId: string, etiqueta: string | null) => void;
  /** Repinta en el lienzo el número de una mesa ya dibujada (su etiqueta se rehace). */
  onRenombrarMesaEnCanvas?: (mesaId: string, nombre: string) => void;
  /**
   * Id de la mesa que se acaba de dibujar en el lienzo: su número es solo el
   * primer número libre PROPUESTO, así que el campo del número se enfoca solo
   * para que el dueño escriba el real de la sala sin buscar nada.
   */
  mesaRecienCreadaId?: string | null;
  /** Se llama tras enfocar el campo, para que el padre olvide `mesaRecienCreadaId`. */
  onMesaRecienCreadaAtendida?: () => void;
  /**
   * Marca el PRÓXIMO cambio de mesasCanvas como "no deshacible": llamar justo
   * antes de un `onMesasChange` que refleja una escritura en BBDD ya
   * ejecutada (crear/eliminar mesa), para que ese cambio se convierta en la
   * nueva base del historial en vez de un paso de undo/redo más.
   */
  marcarNoDeshacible?: () => void;
}

export function PanelLateral({
  espacioId,
  selectedElement,
  mesasCanvas,
  pixelsPerMeter,
  realDimensions,
  onMesasChange,
  onSelectionChange,
  onUnmergeMesa,
  onRemoveElement,
  onUpdateMesaEtiqueta,
  onRenombrarMesaEnCanvas,
  mesaRecienCreadaId,
  onMesaRecienCreadaAtendida,
  marcarNoDeshacible,
}: PanelLateralProps) {
  const [newMesa, setNewMesa] = useState({
    nombre: "",
    capacidad: 2,
    forma: "rectangular" as "rectangular" | "circular",
    ancho: 80,
    alto: 80,
  });
  const [etiquetaInput, setEtiquetaInput] = useState("");
  // Estados para secciones colapsables
  const [openAddMesa, setOpenAddMesa] = useState(true);
  const [openAddLote, setOpenAddLote] = useState(false);
  const [openMesasList, setOpenMesasList] = useState(true);
  const [openLeyenda, setOpenLeyenda] = useState(false);

  // --- Número de mesa ------------------------------------------------------
  // El número (que vive en `mesas.nombre`) es el dato con el que el personal
  // identifica la mesa en la sala ("la 7"), así que tiene que poder editarse y
  // no puede repetirse dentro del espacio. Se compara contra las mesas del
  // canvas —que incluyen las persistidas y las recién dibujadas sin guardar—,
  // ignorando fusionadas e inactivas igual que el índice de Postgres
  // `uq_mesas_espacio_nombre_real` (ver `nombresMesa.ts`).
  const mesasParaNombre = useMemo(() => mesasCanvasParaNombre(mesasCanvas), [mesasCanvas]);
  const siguienteLibre = useMemo(() => siguienteNumeroMesaLibre(mesasParaNombre), [mesasParaNombre]);

  const [numeroEdit, setNumeroEdit] = useState("");
  const numeroInputRef = useRef<HTMLInputElement>(null);

  const mesaSeleccionada = selectedElement?.tipo === "mesa" ? selectedElement : null;
  const mesaSeleccionadaEsFusionada = mesaSeleccionada?.isMerged === true;

  // Sincronizar el campo del número con la mesa seleccionada
  useEffect(() => {
    setNumeroEdit(mesaSeleccionada ? String(mesaSeleccionada.nombre ?? "") : "");
  }, [mesaSeleccionada?.id, mesaSeleccionada?.nombre]);

  // Enfocar (y seleccionar) el número de la mesa recién dibujada: el que trae
  // es solo el primer número libre propuesto, así que se puede sobrescribir
  // escribiendo directamente.
  useEffect(() => {
    if (!mesaRecienCreadaId) return;
    if (!mesaSeleccionada || mesaSeleccionada.id !== mesaRecienCreadaId) return;
    const input = numeroInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    onMesaRecienCreadaAtendida?.();
  }, [mesaRecienCreadaId, mesaSeleccionada, onMesaRecienCreadaAtendida]);

  const numeroEditTrim = numeroEdit.trim();
  const nuevoNombreDuplicado =
    newMesa.nombre.trim().length > 0 && nombreMesaDuplicado(newMesa.nombre, mesasParaNombre);
  const puedeCrearMesa = newMesa.nombre.trim().length > 0 && !nuevoNombreDuplicado;
  const numeroEditDuplicado =
    !!mesaSeleccionada &&
    numeroEditTrim.length > 0 &&
    nombreMesaDuplicado(numeroEdit, mesasParaNombre, mesaSeleccionada.id);
  const numeroEditSinCambios =
    !!mesaSeleccionada && numeroEditTrim === String(mesaSeleccionada.nombre ?? "").trim();
  const puedeGuardarNumero =
    !!mesaSeleccionada &&
    !mesaSeleccionadaEsFusionada &&
    numeroEditTrim.length > 0 &&
    !numeroEditDuplicado &&
    !numeroEditSinCambios;

  // Actualizar dimensiones al cambiar forma
  const handleFormaChange = (forma: "rectangular" | "circular") => {
    if (forma === "circular") {
      setNewMesa({ ...newMesa, forma, ancho: 150, alto: 150, capacidad: 6 });
    } else {
      setNewMesa({ ...newMesa, forma, ancho: 80, alto: 80, capacidad: 2 });
    }
  };
  const [mesaToDelete, setMesaToDelete] = useState<{ id: string; nombre: string } | null>(null);
  const [asignacionesMesaToDelete, setAsignacionesMesaToDelete] = useState(0);

  // --- Capacidad y tamaño de la mesa SELECCIONADA -------------------------
  // Hasta ahora de una mesa ya creada solo se podía cambiar el número y la
  // etiqueta: la capacidad y las medidas se elegían al crearla y no había
  // forma de corregirlas sin borrarla y volverla a crear.
  const [mesaEdit, setMesaEdit] = useState({
    capacidad: "2",
    ancho: "80",
    alto: "80",
    forma: "rectangular" as FormaMesa,
  });

  // --- ALTA EN LOTE (rehecho 2026-09-28) -----------------------------------
  // Antes: un rango «desde–hasta» con UNA forma y UNA capacidad para todo.
  // Una sala de verdad (12 de 2 plazas, 5 de 4 y 3 redondas de 6, numeradas
  // 1-8, 11-16 y T1-T6) necesitaba tres o cuatro lotes y corregirlo a mano.
  // Ahora: el cuadro de texto PROPONE números (lista libre con rangos y
  // prefijos) y la tabla de abajo es la que manda — cada fila se puede
  // ajustar por separado antes de tocar la base de datos.
  const [loteTexto, setLoteTexto] = useState("");
  const [presetLote, setPresetLote] = useState<PresetMesa>(PRESET_MESA_POR_DEFECTO);
  const [capacidadParaTodas, setCapacidadParaTodas] = useState("");
  const [filasLote, setFilasLote] = useState<FilaLoteMesa[]>([]);
  const [creandoLote, setCreandoLote] = useState(false);
  const [progresoLote, setProgresoLote] = useState(0);
  const [resumenLote, setResumenLote] = useState<ResumenAltaLoteMesas | null>(null);

  const crearMesa = useCrearMesa();
  const actualizarMesa = useActualizarMesa();
  const eliminarMesa = useEliminarMesa();
  const queryClient = useQueryClient();

  // Los números que el dueño está tecleando, ya interpretados (para el aviso
  // en vivo). No son todavía el lote: al lote entran al pulsar «Añadir».
  const listaLote = useMemo(() => parsearListaNumerosMesa(loteTexto), [loteTexto]);

  // Se validan TODOS los números del lote antes de insertar ninguno.
  const nombresLote = useMemo(() => filasLote.map((f) => f.nombre), [filasLote]);
  const loteChoques = useMemo(
    () => nombresMesaDuplicadosEnLote(nombresLote, mesasParaNombre),
    [nombresLote, mesasParaNombre],
  );
  const loteAvisoChoques = mensajeChoquesLoteNombresMesa(loteChoques);
  /** Nombres normalizados que hay que marcar en rojo fila a fila. */
  const nombresLoteConProblema = useMemo(() => {
    const conflictivos = new Set<string>();
    [...loteChoques.yaExisten, ...loteChoques.repetidosEnLote].forEach((n) =>
      conflictivos.add(normalizarNombreMesa(n)),
    );
    return conflictivos;
  }, [loteChoques]);
  const hayFilasSinNumero = useMemo(
    () => filasLote.some((f) => normalizarNombreMesa(f.nombre).length === 0),
    [filasLote],
  );
  const totalesLote = useMemo(() => resumenFilasLote(filasLote), [filasLote]);
  const puedeCrearLote =
    !creandoLote && filasLote.length > 0 && !loteChoques.hayChoques && !hayFilasSinNumero;

  /** Sitio que ya ocupan las mesas dibujadas, para no colocar las nuevas encima.
   *  (Las paredes y áreas no llegan a este panel: ver `calcularRejillaMesas`.) */
  const rectangulosMesasCanvas = useMemo<RectanguloOcupado[]>(
    () =>
      mesasCanvas.map((m) =>
        rectanguloDeMesa({ posX: m.posX, posY: m.posY, ancho: m.ancho, alto: m.alto }),
      ),
    [mesasCanvas],
  );

  // Sincronizar los campos de capacidad/tamaño con la mesa seleccionada.
  useEffect(() => {
    if (!mesaSeleccionada) return;
    setMesaEdit({
      capacidad: String(mesaSeleccionada.capacidad ?? 2),
      ancho: String(mesaSeleccionada.ancho ?? 80),
      alto: String(mesaSeleccionada.alto ?? 80),
      forma: mesaSeleccionada.forma === "circular" ? "circular" : "rectangular",
    });
  }, [
    mesaSeleccionada?.id,
    mesaSeleccionada?.capacidad,
    mesaSeleccionada?.ancho,
    mesaSeleccionada?.alto,
    mesaSeleccionada?.forma,
  ]);

  /** Lo que se guardaría: siempre valores válidos, nunca un NaN en la base. */
  const mesaEditNormalizada = useMemo(() => {
    const ancho = normalizarLadoMesaCm(mesaEdit.ancho);
    return {
      capacidad: normalizarCapacidadMesa(mesaEdit.capacidad),
      forma: mesaEdit.forma,
      // Una circular se describe por su diámetro: ancho y alto van juntos.
      ancho,
      alto: mesaEdit.forma === "circular" ? ancho : normalizarLadoMesaCm(mesaEdit.alto),
    };
  }, [mesaEdit]);

  const mesaEditSinCambios =
    !!mesaSeleccionada &&
    mesaEditNormalizada.capacidad === mesaSeleccionada.capacidad &&
    mesaEditNormalizada.forma ===
      (mesaSeleccionada.forma === "circular" ? "circular" : "rectangular") &&
    mesaEditNormalizada.ancho === mesaSeleccionada.ancho &&
    mesaEditNormalizada.alto === mesaSeleccionada.alto;

  const puedeGuardarMedidasMesa =
    !!mesaSeleccionada &&
    !mesaSeleccionadaEsFusionada &&
    !mesaEditSinCambios &&
    !actualizarMesa.isPending;

  const presetMesaSeleccionada = presetMesaQueEncaja({
    forma: mesaEditNormalizada.forma,
    anchoCm: mesaEditNormalizada.ancho,
    altoCm: mesaEditNormalizada.alto,
    capacidad: mesaEditNormalizada.capacidad,
  });

  // Cambiar el NÚMERO de una mesa ya existente. Si la mesa está en BBDD se
  // escribe al momento (igual que "Añadir Mesa"), así que ese cambio no puede
  // ser un paso de deshacer; si es una mesa dibujada y sin guardar, se queda
  // solo en el estado local y sí es deshacible.
  const handleRenombrarMesa = async () => {
    if (!mesaSeleccionada) return;
    if (mesaSeleccionadaEsFusionada) return;

    const nuevo = numeroEditTrim;
    if (!nuevo) {
      toast.error("Introduce el número de la mesa");
      return;
    }
    if (nombreMesaDuplicado(nuevo, mesasParaNombre, mesaSeleccionada.id)) {
      toast.error(mensajeNombreMesaDuplicado(nuevo));
      return;
    }
    if (normalizarNombreMesa(nuevo) === normalizarNombreMesa(mesaSeleccionada.nombre) && numeroEditSinCambios) {
      return;
    }

    try {
      if (!esMesaNoPersistida(mesaSeleccionada.id)) {
        await actualizarMesa.mutateAsync({ id: mesaSeleccionada.id, nombre: nuevo });
        marcarNoDeshacible?.();
      }
      onMesasChange(
        mesasCanvas.map((m) => (m.id === mesaSeleccionada.id ? { ...m, nombre: nuevo } : m)),
      );
      onRenombrarMesaEnCanvas?.(mesaSeleccionada.id, nuevo);
      onSelectionChange({ ...mesaSeleccionada, nombre: nuevo });
      setNumeroEdit(nuevo);
      numeroInputRef.current?.blur();
      toast.success(`Mesa ${nuevo}`);
    } catch (error) {
      // useActualizarMesa ya traduce el choque del índice único a un mensaje
      // legible; aquí solo se cubre el resto de fallos.
      console.error("Error al cambiar el número de la mesa:", error);
    }
  };

  /**
   * Guarda la capacidad / la forma / el tamaño de la mesa seleccionada.
   * Mismo camino que el renombrado: validar -> escribir en BBDD ->
   * `marcarNoDeshacible` -> actualizar el estado del canvas.
   */
  const handleGuardarMedidasMesa = async () => {
    if (!mesaSeleccionada || mesaSeleccionadaEsFusionada) return;
    const cambios = mesaEditNormalizada;

    try {
      if (!esMesaNoPersistida(mesaSeleccionada.id)) {
        await actualizarMesa.mutateAsync({ id: mesaSeleccionada.id, ...cambios });
        marcarNoDeshacible?.();
      }
      onMesasChange(
        mesasCanvas.map((m) => (m.id === mesaSeleccionada.id ? { ...m, ...cambios } : m)),
      );
      onSelectionChange({ ...mesaSeleccionada, ...cambios });
      toast.success(
        `Mesa ${mesaSeleccionada.nombre}: ${cambios.capacidad} plaza(s) · ${medidasMesaTexto(cambios.forma, cambios.ancho, cambios.alto)}`,
      );
    } catch (error) {
      // useActualizarMesa ya avisa por toast; aquí solo queda el rastro.
      console.error("Error al cambiar la capacidad o el tamaño de la mesa:", error);
    }
  };

  /** Mete en el lote los números que el dueño acaba de teclear. */
  const handleAnadirNumerosALote = () => {
    if (listaLote.error) {
      toast.error(listaLote.error);
      return;
    }
    const resultado = anadirNombresAlLote(filasLote, listaLote.numeros, presetLote);
    setFilasLote(resultado.filas);
    setResumenLote(null);
    setLoteTexto("");
    listaLote.avisos.forEach((aviso) => toast.info(aviso));
    if (resultado.yaEstaban.length > 0) {
      toast.info(`Ya estaban en la lista: ${resultado.yaEstaban.join(", ")}.`);
    }
    if (resultado.error) toast.warning(resultado.error);
  };

  /**
   * Alta del lote entero.
   *
   * DOS DECISIONES QUE NO SON OBVIAS:
   *
   * 1. NO PARA EN EL PRIMER FALLO. Antes, si reventaba la mesa 13 quedaban 12
   *    creadas, 8 sin crear y un mensaje que no decía cuáles: el dueño tenía
   *    que ir adivinando. Ahora se intentan todas, se recoge el resultado de
   *    cada una y al final se dice exactamente qué se creó y qué no.
   * 2. INSERTA CONTRA SUPABASE DIRECTAMENTE en vez de usar `useCrearMesa`.
   *    Esa mutación lanza un toast de error POR CADA fallo, y en un lote de 40
   *    eso son 40 toasts tapando la pantalla. El error se traduce aquí con
   *    `motivoFalloAltaMesa`, que replica la traducción del 23505 de
   *    `useMesas.ts:143-151`, y la caché se invalida UNA sola vez al final
   *    (que es lo que hace que el lienzo repinte las mesas nuevas).
   */
  const handleAddLote = async () => {
    if (filasLote.length === 0) {
      toast.error("Añade primero los números de las mesas.");
      return;
    }
    if (hayFilasSinNumero) {
      toast.error("Hay mesas sin número en la lista: ponles uno o quítalas.");
      return;
    }
    if (loteChoques.hayChoques) {
      toast.error(loteAvisoChoques ?? "Hay números repetidos.");
      return;
    }

    setCreandoLote(true);
    setProgresoLote(0);
    setResumenLote(null);

    // Se va ocupando sitio sobre la marcha: cada mesa creada estorba a la
    // siguiente, igual que las que ya estaban dibujadas.
    const ocupadas: RectanguloOcupado[] = [...rectangulosMesasCanvas];
    const creadas: MesaCanvas[] = [];
    const resultados: ResultadoAltaMesa[] = [];
    const clavesFallidas = new Set<string>();
    let avisoDesborde = false;

    try {
      for (let i = 0; i < filasLote.length; i += 1) {
        const fila = filasLote[i];
        const nombre = fila.nombre.trim();
        const capacidad = normalizarCapacidadMesa(fila.capacidad);
        const ancho = normalizarLadoMesaCm(fila.anchoCm);
        const alto = fila.forma === "circular" ? ancho : normalizarLadoMesaCm(fila.altoCm);

        const rejilla = calcularRejillaMesas({
          cantidad: 1,
          anchoCm: ancho,
          altoCm: alto,
          espacio: realDimensions ?? { width: 12, height: 8 },
          ocupadas,
        });
        const posicion = rejilla.posiciones[0] ?? { x: 0.3, y: 0.3 };
        if (rejilla.desborda) avisoDesborde = true;

        try {
          const { data, error } = await supabase
            .from("mesas")
            .insert({
              espacio_id: espacioId,
              nombre,
              capacidad,
              forma: fila.forma,
              ancho,
              alto,
              pos_x: posicion.x,
              pos_y: posicion.y,
            })
            .select()
            .single();
          if (error) throw error;
          if (!data) throw new Error(`La base no ha devuelto la mesa ${nombre}`);

          creadas.push({
            id: data.id,
            nombre: data.nombre,
            capacidad: data.capacidad,
            forma: data.forma as FormaMesa,
            ancho: data.ancho || ancho,
            alto: data.alto || alto,
            // OJO con `??` y no `||`: x=0 o y=0 (pegada al borde) es válido.
            posX: data.pos_x ?? posicion.x,
            posY: data.pos_y ?? posicion.y,
          });
          ocupadas.push({
            x: posicion.x,
            y: posicion.y,
            width: ancho / 100,
            height: alto / 100,
          });
          resultados.push({ nombre, ok: true });
        } catch (error) {
          console.error(`Error al crear la mesa ${nombre}:`, error);
          resultados.push({ nombre, ok: false, motivo: motivoFalloAltaMesa(error) });
          clavesFallidas.add(fila.clave);
        }

        setProgresoLote(i + 1);
      }
    } finally {
      setCreandoLote(false);
      setProgresoLote(0);
    }

    const resumen = resumenAltaLoteMesas(resultados);
    setResumenLote(resumen);

    if (creadas.length > 0) {
      // Las filas ya están en BBDD: este cambio de estado no puede ser un
      // paso de deshacer.
      marcarNoDeshacible?.();
      onMesasChange([...mesasCanvas, ...creadas]);
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    }

    if (resumen.hayFallos) {
      toast.error(resumen.mensaje, { duration: 12000 });
      // En la lista se dejan SOLO las que fallaron, con el tipo y la capacidad
      // que ya tenían: el mismo botón sirve para reintentar justo esas.
      setFilasLote((prev) => prev.filter((f) => clavesFallidas.has(f.clave)));
    } else {
      toast.success(resumen.mensaje);
      setFilasLote([]);
    }

    if (avisoDesborde) {
      toast.warning(
        "No caben todas en el plano sin solaparse: recolócalas arrastrándolas o agranda el espacio.",
      );
    }
  };

  // Antes de pedir confirmación para eliminar, si la mesa ya está persistida
  // en BBDD comprobamos cuántas reservas tiene asignadas para avisar: antes
  // se podía borrar sin darse cuenta de que había reservas con esa mesa.
  const handleAbrirEliminarMesa = async (mesa: { id: string; nombre: string }) => {
    if (!esMesaNoPersistida(mesa.id)) {
      try {
        const { count, error } = await supabase
          .from("asignaciones_mesa")
          .select("id", { count: "exact", head: true })
          .eq("mesa_id", mesa.id);
        if (error) throw error;
        setAsignacionesMesaToDelete(count || 0);
      } catch (error) {
        console.error("Error al comprobar asignaciones de la mesa:", error);
        setAsignacionesMesaToDelete(0);
      }
    } else {
      setAsignacionesMesaToDelete(0);
    }
    setMesaToDelete(mesa);
  };

  /**
   * DOS CAMINOS PARA CREAR UNA MESA (inconsistencia conocida, a propósito)
   *
   * - Aquí ("Añadir Mesa" / "Añadir varias"): se INSERTA en `mesas` al pulsar
   *   el botón. Por eso hay que llamar a `marcarNoDeshacible()`: deshacer no
   *   resucitaría/borraría la fila, así que el cambio se convierte en la nueva
   *   base del historial.
   * - Con la herramienta del lienzo (M/C): la mesa vive como `mesa-temp-...` y
   *   solo llega a la BBDD al pulsar "Guardar" (`EditorPlanoEspacio.handleSave`),
   *   así que sí es deshacible.
   *
   * Unificar los dos caminos (p.ej. hacer que esto también sea diferido)
   * rompería el historial de deshacer/rehacer y el renombrado de ids
   * temporales del guardado, así que NO se toca: lo único que se ha hecho es
   * que ambos pidan el número, comprueben duplicados y dejen claro en la
   * interfaz cuándo se guarda cada uno.
   */
  const handleAddMesa = async () => {
    if (!newMesa.nombre.trim()) {
      toast.error("Introduce el número de la mesa");
      return;
    }

    // Nombres únicos por espacio (2026-09-26): en producción el Salón acabó
    // con dos mesas llamadas "9" porque nada lo impedía. La comprobación es
    // contra las mesas ya en el canvas de este espacio (`mesasCanvas`), que
    // incluye tanto las persistidas como las que se acaban de dibujar y aún
    // no se han guardado. Las fusionadas y las inactivas no reservan número
    // (igual que el índice `uq_mesas_espacio_nombre_real`), de eso se encarga
    // `mesasCanvasParaNombre`.
    if (nombreMesaDuplicado(newMesa.nombre, mesasParaNombre)) {
      toast.error(mensajeNombreMesaDuplicado(newMesa.nombre));
      return;
    }

    const altoMesa = newMesa.forma === "circular" ? newMesa.ancho : newMesa.alto;

    // POSICIÓN INICIAL: antes TODAS las mesas creadas desde aquí nacían en
    // (1, 1) metros, así que dar de alta varias seguidas las apilaba una encima
    // de otra y no se veían. Luego se pasó a coger el hueco número
    // `mesasCanvas.length` de la rejilla, que tampoco garantizaba nada si el
    // dueño había arrastrado mesas. Ahora se pide el PRIMER hueco libre de
    // verdad, pasando las mesas ya colocadas como ocupadas. La posición
    // definitiva la sigue poniendo él arrastrando.
    const hueco =
      calcularRejillaMesas({
        cantidad: 1,
        anchoCm: newMesa.ancho,
        altoCm: altoMesa,
        espacio: realDimensions ?? { width: 12, height: 8 },
        ocupadas: rectangulosMesasCanvas,
      }).posiciones[0] ?? { x: 1, y: 1 };

    try {
      const result = await crearMesa.mutateAsync({
        espacio_id: espacioId,
        nombre: newMesa.nombre,
        capacidad: newMesa.capacidad,
        forma: newMesa.forma,
        ancho: newMesa.ancho,
        alto: altoMesa,
        pos_x: hueco.x, // Posición inicial en metros
        pos_y: hueco.y, // Posición inicial en metros
      });

      // Añadir inmediatamente al estado local para que aparezca en el canvas
      if (result) {
        const nuevaMesa: MesaCanvas = {
          id: result.id,
          nombre: result.nombre,
          capacidad: result.capacidad,
          forma: result.forma as "rectangular" | "circular",
          ancho: result.ancho || newMesa.ancho,
          alto: result.alto || altoMesa,
          // OJO con `??` y no `||`: una mesa en x=0 o y=0 (pegada al borde) es
          // una posición válida, no "sin posición".
          posX: result.pos_x ?? hueco.x,
          posY: result.pos_y ?? hueco.y,
        };
        // La mesa ya se insertó en BBDD (arriba): este cambio no puede ser un
        // paso de historial deshacible.
        marcarNoDeshacible?.();
        onMesasChange([...mesasCanvas, nuevaMesa]);
      }

      setNewMesa({
        nombre: "",
        capacidad: 2,
        forma: "rectangular",
        ancho: 80,
        alto: 80,
      });
    } catch (error) {
      toast.error("Error al crear la mesa");
    }
  };

  const handleDeleteMesa = async () => {
    if (!mesaToDelete) return;

    try {
      // Si es una mesa temporal, solo quitarla del estado local
      if (esMesaNoPersistida(mesaToDelete.id)) {
        onMesasChange(mesasCanvas.filter((m) => m.id !== mesaToDelete.id));
        onRemoveElement?.(mesaToDelete.id);
        onSelectionChange(null);
      } else {
        // Eliminar de la base de datos
        await eliminarMesa.mutateAsync(mesaToDelete.id);
        // El DELETE de arriba ya se ejecutó en BBDD: no puede ser un paso de
        // historial deshacible.
        marcarNoDeshacible?.();
        onMesasChange(mesasCanvas.filter((m) => m.id !== mesaToDelete.id));
        onRemoveElement?.(mesaToDelete.id);
        onSelectionChange(null);
      }
    } catch (error) {
      console.error("Error al eliminar mesa:", error);
      toast.error("Error al eliminar la mesa");
    } finally {
      setMesaToDelete(null);
      setAsignacionesMesaToDelete(0);
    }
  };

  return (
    <div className="w-72 flex flex-col gap-2 max-h-full overflow-y-auto pr-1">
      {/* Panel de propiedades - siempre visible cuando hay selección */}
      {selectedElement && (
        <Card className="border-2 border-primary/20 bg-primary/5">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {selectedElement.tipo === "mesa" && <Square className="h-4 w-4 text-blue-500" />}
              {selectedElement.tipo === "wall" && <div className="w-4 h-1 bg-gray-700 rounded" />}
              {selectedElement.tipo === "area" && <Square className="h-4 w-4 text-blue-400" />}
              {selectedElement.tipo === "door" && <div className="w-4 h-2 bg-yellow-500 rounded" />}
              Seleccionado
            </div>
            <div className="text-xs">
              <Badge variant="secondary">
                {selectedElement.tipo === "mesa" && "Mesa"}
                {selectedElement.tipo === "wall" && "Pared"}
                {selectedElement.tipo === "area" && "Área"}
                {selectedElement.tipo === "door" && "Puerta"}
              </Badge>
            </div>

            {selectedElement.tipo === "mesa" && (
              <>
                {/* NÚMERO DE LA MESA: es como el personal la identifica en la
                    sala ("la 7"), así que se edita aquí mismo. Antes solo se
                    pintaba como texto y no había forma de corregirlo. */}
                <div className="space-y-1">
                  <Label htmlFor="numero-mesa-seleccionada" className="text-xs flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    Número de mesa
                  </Label>
                  {mesaSeleccionadaEsFusionada ? (
                    <>
                      <div className="text-xs font-medium bg-green-50 border border-green-200 rounded px-2 py-1 text-green-800">
                        {selectedElement.nombre}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Mesa agrupada: su nombre lo genera la fusión a partir de las mesas que la
                        forman, así que no se edita aquí. Desagrúpala y cambia el número de cada
                        mesa por separado.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <Input
                          id="numero-mesa-seleccionada"
                          ref={numeroInputRef}
                          value={numeroEdit}
                          onChange={(e) => setNumeroEdit(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (puedeGuardarNumero) handleRenombrarMesa();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setNumeroEdit(String(selectedElement.nombre ?? ""));
                              numeroInputRef.current?.blur();
                            }
                          }}
                          placeholder="Ej: 7"
                          className={`h-7 text-xs ${numeroEditDuplicado ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          aria-invalid={numeroEditDuplicado}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-7 text-xs shrink-0"
                          onClick={handleRenombrarMesa}
                          disabled={!puedeGuardarNumero || actualizarMesa.isPending}
                          title="Guardar el número"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                      {numeroEditDuplicado ? (
                        <p className="text-[10px] text-destructive">
                          {mensajeNombreMesaDuplicado(numeroEdit)}
                        </p>
                      ) : numeroEditTrim.length === 0 ? (
                        <p className="text-[10px] text-destructive">
                          La mesa necesita un número.
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          El número que se ve en la sala. Enter para guardar, Esc para descartar.
                        </p>
                      )}
                    </>
                  )}
                </div>
                {/* CAPACIDAD Y TAMAÑO de una mesa YA creada. Antes solo se
                    podían elegir al darla de alta: si la mesa 7 resultaba ser
                    de 4 y no de 2, había que borrarla y rehacerla. Mismo camino
                    que el renombrado de arriba (validar -> BBDD -> canvas). */}
                {mesaSeleccionadaEsFusionada ? (
                  <div className="text-xs flex items-center gap-1">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span>{selectedElement.capacidad} personas</span>
                  </div>
                ) : (
                  <div className="space-y-1 border-t pt-2">
                    <Label className="text-xs flex items-center gap-1">
                      <Ruler className="h-3 w-3" />
                      Capacidad y tamaño
                    </Label>

                    <select
                      aria-label="Tipo de mesa"
                      className="h-7 w-full rounded-md border border-input bg-background px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={presetMesaSeleccionada?.id ?? ""}
                      onChange={(e) => {
                        const preset = presetMesaPorId(e.target.value);
                        if (!preset) return;
                        setMesaEdit({
                          capacidad: String(preset.capacidad),
                          ancho: String(preset.anchoCm),
                          alto: String(preset.altoCm),
                          forma: preset.forma,
                        });
                      }}
                    >
                      {!presetMesaSeleccionada && <option value="">Personalizada</option>}
                      {PRESETS_MESA.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.etiqueta} · {p.medidas}
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-3 gap-1">
                      <div className="space-y-0.5">
                        <Label htmlFor="mesa-sel-capacidad" className="text-[10px]">
                          Plazas
                        </Label>
                        <Input
                          id="mesa-sel-capacidad"
                          type="number"
                          min={MIN_CAPACIDAD_MESA}
                          max={MAX_CAPACIDAD_MESA}
                          className="h-7 text-xs px-1"
                          value={mesaEdit.capacidad}
                          onChange={(e) => setMesaEdit({ ...mesaEdit, capacidad: e.target.value })}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label htmlFor="mesa-sel-ancho" className="text-[10px]">
                          {mesaEdit.forma === "circular" ? "Ø (cm)" : "Ancho"}
                        </Label>
                        <Input
                          id="mesa-sel-ancho"
                          type="number"
                          min={MIN_LADO_MESA_CM}
                          max={MAX_LADO_MESA_CM}
                          className="h-7 text-xs px-1"
                          value={mesaEdit.ancho}
                          onChange={(e) => setMesaEdit({ ...mesaEdit, ancho: e.target.value })}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label htmlFor="mesa-sel-alto" className="text-[10px]">
                          Largo
                        </Label>
                        <Input
                          id="mesa-sel-alto"
                          type="number"
                          min={MIN_LADO_MESA_CM}
                          max={MAX_LADO_MESA_CM}
                          className="h-7 text-xs px-1"
                          value={mesaEdit.forma === "circular" ? mesaEdit.ancho : mesaEdit.alto}
                          disabled={mesaEdit.forma === "circular"}
                          onChange={(e) => setMesaEdit({ ...mesaEdit, alto: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <div className="flex flex-1 gap-1">
                        <Button
                          variant={mesaEdit.forma === "rectangular" ? "default" : "outline"}
                          size="sm"
                          className="flex-1 h-7"
                          title="Rectangular"
                          onClick={() => setMesaEdit({ ...mesaEdit, forma: "rectangular" })}
                        >
                          <Square className="h-3 w-3" />
                        </Button>
                        <Button
                          variant={mesaEdit.forma === "circular" ? "default" : "outline"}
                          size="sm"
                          className="flex-1 h-7"
                          title="Circular"
                          onClick={() => setMesaEdit({ ...mesaEdit, forma: "circular" })}
                        >
                          <Circle className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={handleGuardarMedidasMesa}
                        disabled={!puedeGuardarMedidasMesa}
                        title="Guardar capacidad y tamaño"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      {mesaEditSinCambios ? (
                        <>
                          {selectedElement.capacidad} plaza(s) ·{" "}
                          {medidasMesaTexto(
                            selectedElement.forma === "circular" ? "circular" : "rectangular",
                            selectedElement.ancho,
                            selectedElement.alto,
                          )}
                        </>
                      ) : (
                        "Pulsa ✓ para guardar. El dibujo del plano recoge el tamaño nuevo al volver a abrirlo."
                      )}
                    </p>
                  </div>
                )}
                {selectedElement.isMerged && (
                  <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                    Mesa agrupada
                  </Badge>
                )}
                
                {/* Sección de etiqueta bocadillo */}
                <div className="border-t pt-2 mt-2 space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    Etiqueta (bocadillo)
                  </Label>
                  {selectedElement.etiqueta ? (
                    <div className="flex items-center gap-1">
                      <div className="flex-1 text-xs bg-amber-50 border border-amber-300 rounded px-2 py-1 text-amber-800">
                        {selectedElement.etiqueta}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          onUpdateMesaEtiqueta?.(selectedElement.id, null);
                          onSelectionChange({ ...selectedElement, etiqueta: null });
                        }}
                        title="Quitar etiqueta"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="Ej: Terraza, VIP..."
                        value={etiquetaInput}
                        onChange={(e) => setEtiquetaInput(e.target.value)}
                        className="h-7 text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => {
                          if (etiquetaInput.trim()) {
                            onUpdateMesaEtiqueta?.(selectedElement.id, etiquetaInput.trim());
                            onSelectionChange({ ...selectedElement, etiqueta: etiquetaInput.trim() });
                            setEtiquetaInput("");
                          }
                        }}
                        disabled={!etiquetaInput.trim()}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-1 pt-2">
                  {selectedElement.isMerged && onUnmergeMesa && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs border-orange-300 text-orange-600 hover:bg-orange-50"
                      onClick={() => onUnmergeMesa(selectedElement.id)}
                    >
                      <Unlink className="h-3 w-3 mr-1" />
                      Desagrupar
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className={`h-7 text-xs ${selectedElement.isMerged ? 'flex-1' : 'w-full'}`}
                    onClick={() => handleAbrirEliminarMesa({ id: selectedElement.id, nombre: selectedElement.nombre })}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Eliminar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Añadir mesa - colapsable */}
      <Collapsible open={openAddMesa} onOpenChange={setOpenAddMesa}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Plus className="h-4 w-4" />
                Añadir Mesa
              </div>
              {openAddMesa ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Número de mesa</Label>
                <Input
                  placeholder={`Ej: ${siguienteLibre}`}
                  value={newMesa.nombre}
                  onChange={(e) => setNewMesa({ ...newMesa, nombre: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && puedeCrearMesa) {
                      e.preventDefault();
                      handleAddMesa();
                    }
                  }}
                  className={`h-8 ${nuevoNombreDuplicado ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  aria-invalid={nuevoNombreDuplicado}
                />
                {nuevoNombreDuplicado ? (
                  <p className="text-[10px] text-destructive">
                    {mensajeNombreMesaDuplicado(newMesa.nombre)}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setNewMesa({ ...newMesa, nombre: siguienteLibre })}
                  >
                    Primer número libre: {siguienteLibre} (clic para usarlo)
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Forma</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={newMesa.forma === "rectangular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => handleFormaChange("rectangular")}
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                    <Button
                      variant={newMesa.forma === "circular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => handleFormaChange("circular")}
                    >
                      <Circle className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Capacidad</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={newMesa.capacidad}
                    onChange={(e) => setNewMesa({ ...newMesa, capacidad: parseInt(e.target.value) || 1 })}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Ancho (cm)</Label>
                  <Input
                    type="number"
                    min={30}
                    max={300}
                    value={newMesa.ancho}
                    onChange={(e) => setNewMesa({ ...newMesa, ancho: parseInt(e.target.value) || 80 })}
                    className="h-8"
                  />
                </div>
                {newMesa.forma === "rectangular" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Largo (cm)</Label>
                    <Input
                      type="number"
                      min={30}
                      max={300}
                      value={newMesa.alto}
                      onChange={(e) => setNewMesa({ ...newMesa, alto: parseInt(e.target.value) || 60 })}
                      className="h-8"
                    />
                  </div>
                )}
              </div>

              <Button
                className="w-full h-8 text-xs"
                onClick={handleAddMesa}
                disabled={crearMesa.isPending || creandoLote || !puedeCrearMesa}
              >
                <Plus className="h-3 w-3 mr-1" />
                {crearMesa.isPending ? "Creando..." : "Crear Mesa"}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Se guarda en la base de datos al instante (no hace falta pulsar «Guardar») y
                aparece en el plano para que la arrastres a su sitio. Las mesas dibujadas con la
                herramienta del lienzo, en cambio, se guardan al pulsar «Guardar».
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Alta de VARIAS mesas de golpe - colapsable, cerrado por defecto */}
      <Collapsible open={openAddLote} onOpenChange={setOpenAddLote}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Rows3 className="h-4 w-4" />
                Cargar la sala
                {filasLote.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {filasLote.length}
                  </Badge>
                )}
              </div>
              {openAddLote ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-[10px] text-muted-foreground">
                Escribe los números de la sala —admite rangos, saltos y prefijos— y ajusta
                después solo las mesas que sean distintas. Máximo {MAX_MESAS_POR_LOTE} de una vez.
              </p>

              {/* 1) Los números. El cuadro de texto solo PROPONE: manda la lista. */}
              <div className="space-y-1">
                <Label htmlFor="lote-numeros" className="text-xs">
                  Números de mesa
                </Label>
                <Textarea
                  id="lote-numeros"
                  value={loteTexto}
                  onChange={(e) => setLoteTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAnadirNumerosALote();
                    }
                  }}
                  placeholder="1-8, 11-16, T1-T6, 20"
                  rows={2}
                  className={`min-h-[52px] text-xs ${
                    loteTexto.trim() && listaLote.error
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }`}
                  aria-invalid={!!loteTexto.trim() && !!listaLote.error}
                  aria-describedby="lote-numeros-ayuda"
                />
                <p
                  id="lote-numeros-ayuda"
                  className={`text-[10px] ${
                    loteTexto.trim() && listaLote.error ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {loteTexto.trim() && listaLote.error
                    ? listaLote.error
                    : listaLote.numeros.length > 0
                      ? `${listaLote.numeros.length} número(s): ${listaLote.numeros.join(", ")}. Pulsa Enter para añadirlos.`
                      : "Rangos (1-8), saltos (11-16) y prefijos (T1-T6), separados por comas. Enter para añadir."}
                </p>
                <Button
                  variant="secondary"
                  className="w-full h-7 text-xs"
                  onClick={handleAnadirNumerosALote}
                  disabled={creandoLote || !loteTexto.trim() || !!listaLote.error}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Añadir a la lista
                </Button>
              </div>

              {/* 2) Tipo de mesa: forma + tamaño + plazas de una vez. */}
              <div className="space-y-1">
                <Label className="text-xs">Tipo de mesa</Label>
                <div className="grid grid-cols-2 gap-1">
                  {PRESETS_MESA.map((p) => (
                    <Button
                      key={p.id}
                      variant={presetLote.id === p.id ? "default" : "outline"}
                      size="sm"
                      className="h-auto flex-col items-start gap-0 py-1 px-1 text-[10px] leading-tight"
                      title={`${p.etiqueta} · ${p.medidas} · ${p.capacidad} plaza(s)`}
                      onClick={() => {
                        setPresetLote(p);
                        setFilasLote((prev) => aplicarPresetAFilas(prev, p));
                      }}
                    >
                      <span className="flex items-center gap-1 font-medium">
                        {p.forma === "circular" ? (
                          <Circle className="h-2.5 w-2.5" />
                        ) : (
                          <Square className="h-2.5 w-2.5" />
                        )}
                        {p.etiqueta}
                      </span>
                      <span className="opacity-70">{p.medidas}</span>
                    </Button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Se usa para las mesas nuevas y se aplica a todas las de la lista. Solo la
                  redonda es circular: el plano únicamente distingue redonda de rectangular.
                </p>
              </div>

              {filasLote.length > 0 && (
                <div className="flex items-end gap-1">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="lote-capacidad-todas" className="text-xs">
                      Plazas para todas
                    </Label>
                    <Input
                      id="lote-capacidad-todas"
                      type="number"
                      min={MIN_CAPACIDAD_MESA}
                      max={MAX_CAPACIDAD_MESA}
                      placeholder="Ej: 4"
                      value={capacidadParaTodas}
                      onChange={(e) => setCapacidadParaTodas(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    disabled={!capacidadParaTodas.trim()}
                    onClick={() => {
                      setFilasLote((prev) =>
                        aplicarCapacidadAFilas(prev, normalizarCapacidadMesa(capacidadParaTodas)),
                      );
                      setCapacidadParaTodas("");
                    }}
                  >
                    Aplicar
                  </Button>
                </div>
              )}

              {/* 3) La lista: una línea por mesa, para tocar solo las que cambian. */}
              {filasLote.length > 0 && (
                <div className="rounded-md border">
                  <div className="flex items-center justify-between bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
                    <span>
                      {totalesLote.total} mesa(s) · {totalesLote.plazas} plazas
                    </span>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setFilasLote([]);
                        setResumenLote(null);
                      }}
                    >
                      Vaciar lista
                    </button>
                  </div>
                  <ScrollArea className="h-52">
                    <div className="space-y-1 p-1">
                      {filasLote.map((fila) => {
                        const normalizado = normalizarNombreMesa(fila.nombre);
                        const problema =
                          normalizado.length === 0 || nombresLoteConProblema.has(normalizado);
                        return (
                          <div key={fila.clave} className="flex items-center gap-1">
                            <Input
                              aria-label={`Número de la mesa ${fila.nombre}`}
                              value={fila.nombre}
                              onChange={(e) =>
                                setFilasLote((prev) =>
                                  actualizarFilaLote(prev, fila.clave, { nombre: e.target.value }),
                                )
                              }
                              className={`h-7 min-w-0 flex-1 px-1 text-xs ${
                                problema ? "border-destructive focus-visible:ring-destructive" : ""
                              }`}
                              aria-invalid={problema}
                            />
                            <select
                              aria-label={`Tipo de la mesa ${fila.nombre}`}
                              title={medidasMesaTexto(fila.forma, fila.anchoCm, fila.altoCm)}
                              className="h-7 w-[86px] shrink-0 rounded-md border border-input bg-background px-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              value={fila.presetId ?? ""}
                              onChange={(e) => {
                                const preset = presetMesaPorId(e.target.value);
                                if (preset) {
                                  setFilasLote((prev) => aplicarPresetAFila(prev, fila.clave, preset));
                                }
                              }}
                            >
                              {fila.presetId === null && <option value="">Personalizada</option>}
                              {PRESETS_MESA.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.etiqueta}
                                </option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={MIN_CAPACIDAD_MESA}
                              max={MAX_CAPACIDAD_MESA}
                              aria-label={`Plazas de la mesa ${fila.nombre}`}
                              value={fila.capacidad}
                              onChange={(e) =>
                                setFilasLote((prev) =>
                                  actualizarFilaLote(prev, fila.clave, {
                                    capacidad: normalizarCapacidadMesa(e.target.value),
                                  }),
                                )
                              }
                              className="h-7 w-11 shrink-0 px-1 text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Quitar la mesa ${fila.nombre} de la lista`}
                              onClick={() =>
                                setFilasLote((prev) => quitarFilaLote(prev, fila.clave))
                              }
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {loteAvisoChoques && (
                <p className="text-[10px] text-destructive">{loteAvisoChoques}</p>
              )}
              {hayFilasSinNumero && (
                <p className="text-[10px] text-destructive">
                  Hay mesas sin número en la lista: ponles uno o quítalas.
                </p>
              )}

              {/* Qué ha fallado, mesa a mesa. El alta ya no para en el primer
                  error: las que fallaron se quedan en la lista para reintentar. */}
              {resumenLote?.hayFallos && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                  <p className="text-[10px] font-medium text-destructive">{resumenLote.mensaje}</p>
                  <ul className="space-y-0.5 text-[10px] text-destructive">
                    {resumenLote.fallidas.map((f) => (
                      <li key={f.nombre}>
                        Mesa {f.nombre}: {f.motivo}.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button className="w-full h-8 text-xs" onClick={handleAddLote} disabled={!puedeCrearLote}>
                <Plus className="h-3 w-3 mr-1" />
                {creandoLote
                  ? `Creando mesas… ${progresoLote}/${filasLote.length}`
                  : filasLote.length === 0
                    ? "Crear mesas"
                    : `Crear ${filasLote.length} mesa${filasLote.length === 1 ? "" : "s"} (${totalesLote.plazas} plazas)`}
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Lista de mesas - colapsable */}
      <Collapsible open={openMesasList} onOpenChange={setOpenMesasList}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <List className="h-4 w-4" />
                Mesas
                <Badge variant="secondary" className="text-xs">{mesasCanvas.length}</Badge>
              </div>
              {openMesasList ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-0">
              <ScrollArea className="h-40">
                <div className="p-2 space-y-1">
                  {mesasCanvas.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No hay mesas
                    </p>
                  ) : (
                    mesasCanvas.map((mesa) => (
                      <div
                        key={mesa.id}
                        className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors text-xs ${
                          selectedElement?.id === mesa.id 
                            ? "bg-primary/10 border border-primary/30" 
                            : "bg-muted/50 hover:bg-muted"
                        }`}
                        onClick={() => onSelectionChange({ tipo: "mesa", ...mesa })}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {mesa.forma === "circular" ? (
                            <Circle className={`h-3 w-3 ${mesa.isMerged ? "text-green-600" : "text-blue-500"}`} />
                          ) : (
                            <Square className={`h-3 w-3 ${mesa.isMerged ? "text-green-600" : "text-blue-500"}`} />
                          )}
                          {/* El número, destacado: es como se llama a la mesa en la sala. */}
                          <span className={`font-semibold truncate ${mesa.isMerged ? "text-green-700" : ""}`}>
                            {mesa.nombre}
                          </span>
                          {mesa.isMerged && (
                            <span className="text-[9px] text-green-700 shrink-0">agrupada</span>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px] py-0 h-5">
                          <Users className="h-2.5 w-2.5 mr-0.5" />
                          {mesa.capacidad}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Leyenda - colapsable, cerrado por defecto */}
      <Collapsible open={openLeyenda} onOpenChange={setOpenLeyenda}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Info className="h-4 w-4" />
                Leyenda
              </div>
              {openLeyenda ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-100 border-2 border-blue-500 rounded" />
                  <span>Mesa</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1.5 bg-slate-800 rounded-sm" />
                  <span>Pared</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500/10 border border-blue-500 border-dashed rounded" />
                  <span>Área</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-2 bg-yellow-100 border border-yellow-600 rounded" />
                  <span>Puerta</span>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground border-t pt-2">
                Atajos: S seleccionar · W pared · A área · M mesa · C mesa circular ·
                D puerta · Supr borrar · Esc cancelar. Al dibujar paredes, Shift
                desactiva el ajuste a 0/45/90°.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Dialog de confirmación para eliminar mesa */}
      <AlertDialog
        open={!!mesaToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setMesaToDelete(null);
            setAsignacionesMesaToDelete(0);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta mesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la mesa "{mesaToDelete?.nombre}". Esta acción no se puede deshacer.
              {asignacionesMesaToDelete > 0 && (
                <>
                  {" "}Tiene <strong>{asignacionesMesaToDelete}</strong> reserva(s) asignada(s) que se
                  desvincularán de la mesa.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMesa} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
