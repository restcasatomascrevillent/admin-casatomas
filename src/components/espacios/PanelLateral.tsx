import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Square, Circle, Users, Trash2, ChevronDown, ChevronRight, Info, List, Unlink, Tag, X, Check, Hash, Rows3 } from "lucide-react";
import { useActualizarMesa, useCrearMesa, useEliminarMesa } from "@/hooks/useMesas";
import { MesaCanvas } from "./EditorPlanoEspacio";
import { calcularRejillaMesas, esMesaNoPersistida } from "./planoUtils";
import {
  MAX_MESAS_POR_LOTE,
  generarNumerosMesaEnRango,
  mensajeChoquesLoteNombresMesa,
  mensajeNombreMesaDuplicado,
  mesasCanvasParaNombre,
  nombreMesaDuplicado,
  nombresMesaDuplicadosEnLote,
  normalizarNombreMesa,
  siguienteNumeroMesaLibre,
} from "./nombresMesa";
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

  // Alta en lote: el dueño teclea TODO (desde, hasta, capacidad y forma). No se
  // pre-rellena ningún rango: cuántas mesas hay en cada sala solo lo sabe él.
  const [lote, setLote] = useState({
    desde: "",
    hasta: "",
    capacidad: 2,
    forma: "rectangular" as "rectangular" | "circular",
  });
  const [creandoLote, setCreandoLote] = useState(false);

  const crearMesa = useCrearMesa();
  const actualizarMesa = useActualizarMesa();
  const eliminarMesa = useEliminarMesa();

  const loteAncho = lote.forma === "circular" ? 150 : 80;
  const loteAlto = lote.forma === "circular" ? 150 : 80;
  const loteRango = useMemo(
    () =>
      lote.desde.trim() === "" || lote.hasta.trim() === ""
        ? { numeros: [] as string[], error: null as string | null }
        : generarNumerosMesaEnRango(Number(lote.desde), Number(lote.hasta)),
    [lote.desde, lote.hasta],
  );
  // Se validan TODOS los números antes de insertar ninguno.
  const loteChoques = useMemo(
    () => nombresMesaDuplicadosEnLote(loteRango.numeros, mesasParaNombre),
    [loteRango.numeros, mesasParaNombre],
  );
  const loteAvisoChoques = mensajeChoquesLoteNombresMesa(loteChoques);
  const puedeCrearLote =
    !creandoLote && loteRango.numeros.length > 0 && !loteRango.error && !loteChoques.hayChoques;

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

  // Alta de un RANGO de mesas ("de la 7 a la 18"). Se valida todo el lote
  // antes de tocar la BBDD y se colocan en rejilla para que no acaben las N
  // apiladas en (1,1) como hace el alta de una en una.
  const handleAddLote = async () => {
    if (loteRango.error) {
      toast.error(loteRango.error);
      return;
    }
    if (loteRango.numeros.length === 0) {
      toast.error("Indica desde qué número hasta qué número.");
      return;
    }
    if (loteChoques.hayChoques) {
      toast.error(loteAvisoChoques ?? "Hay números repetidos.");
      return;
    }

    const rejilla = calcularRejillaMesas({
      cantidad: loteRango.numeros.length,
      anchoCm: loteAncho,
      altoCm: loteAlto,
      espacio: realDimensions ?? { width: 12, height: 8 },
    });

    setCreandoLote(true);
    const creadas: MesaCanvas[] = [];
    try {
      for (let i = 0; i < loteRango.numeros.length; i += 1) {
        const posicion = rejilla.posiciones[i] ?? { x: 1, y: 1 };
        // Una a una y en secuencia: así se puede comprobar el error de cada
        // inserción y parar en el primer fallo diciendo cuántas se crearon.
        const result = await crearMesa.mutateAsync({
          espacio_id: espacioId,
          nombre: loteRango.numeros[i],
          capacidad: lote.capacidad,
          forma: lote.forma,
          ancho: loteAncho,
          alto: loteAlto,
          pos_x: posicion.x,
          pos_y: posicion.y,
        });
        if (!result) throw new Error(`No se pudo crear la mesa ${loteRango.numeros[i]}`);
        creadas.push({
          id: result.id,
          nombre: result.nombre,
          capacidad: result.capacidad,
          forma: result.forma as "rectangular" | "circular",
          ancho: result.ancho || loteAncho,
          alto: result.alto || loteAlto,
          posX: result.pos_x ?? posicion.x,
          posY: result.pos_y ?? posicion.y,
        });
      }

      toast.success(
        `${creadas.length} mesa(s) creada(s): ${creadas.map((m) => m.nombre).join(", ")}`,
      );
      if (rejilla.desborda) {
        toast.warning(
          "No caben todas en el plano sin solaparse: recolócalas arrastrándolas o agranda el espacio.",
        );
      }
      setLote((prev) => ({ ...prev, desde: "", hasta: "" }));
    } catch (error) {
      console.error("Error al crear el lote de mesas:", error);
      toast.error(
        creadas.length === 0
          ? "No se ha podido crear ninguna mesa."
          : `Se han creado ${creadas.length} mesa(s) (${creadas
              .map((m) => m.nombre)
              .join(", ")}) y ha fallado la siguiente. Revisa y vuelve a intentarlo con el resto.`,
      );
    } finally {
      setCreandoLote(false);
      if (creadas.length > 0) {
        // Las filas ya están en BBDD: este cambio de estado no puede ser un
        // paso de deshacer.
        marcarNoDeshacible?.();
        onMesasChange([...mesasCanvas, ...creadas]);
      }
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
    // de otra y no se veían. Se reutiliza la rejilla del alta en lote y se coge
    // el hueco número `mesasCanvas.length`: no garantiza que esté libre (el
    // dueño puede haber arrastrado una mesa justo ahí), pero ya no se apilan
    // todas en el mismo punto. La posición definitiva la pone él arrastrando.
    const hueco =
      calcularRejillaMesas({
        cantidad: mesasCanvas.length + 1,
        anchoCm: newMesa.ancho,
        altoCm: altoMesa,
        espacio: realDimensions ?? { width: 12, height: 8 },
      }).posiciones[mesasCanvas.length] ?? { x: 1, y: 1 };

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
                <div className="text-xs flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <span>{selectedElement.capacidad} personas</span>
                </div>
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
                Añadir varias (rango)
              </div>
              {openAddLote ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-[10px] text-muted-foreground">
                Para cargar de golpe las mesas de una sala: escribe desde qué número hasta qué
                número, con la misma capacidad y forma. Máximo {MAX_MESAS_POR_LOTE} de una vez.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    placeholder="Ej: 1"
                    value={lote.desde}
                    onChange={(e) => setLote({ ...lote, desde: e.target.value })}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    placeholder="Ej: 12"
                    value={lote.hasta}
                    onChange={(e) => setLote({ ...lote, hasta: e.target.value })}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Forma</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={lote.forma === "rectangular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => setLote({ ...lote, forma: "rectangular", capacidad: 2 })}
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                    <Button
                      variant={lote.forma === "circular" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7"
                      onClick={() => setLote({ ...lote, forma: "circular", capacidad: 6 })}
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
                    value={lote.capacidad}
                    onChange={(e) => setLote({ ...lote, capacidad: parseInt(e.target.value) || 1 })}
                    className="h-8"
                  />
                </div>
              </div>

              {loteRango.error ? (
                <p className="text-[10px] text-destructive">{loteRango.error}</p>
              ) : loteAvisoChoques ? (
                <p className="text-[10px] text-destructive">{loteAvisoChoques}</p>
              ) : loteRango.numeros.length > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  Se crearán <strong>{loteRango.numeros.length}</strong> mesa(s) de{" "}
                  {lote.capacidad} plaza(s) y{" "}
                  {lote.forma === "circular" ? `Ø${loteAncho} cm` : `${loteAncho}×${loteAlto} cm`}:{" "}
                  {loteRango.numeros.join(", ")}. Luego puedes cambiar el tamaño de cada una y
                  colocarlas arrastrándolas.
                </p>
              ) : null}

              <Button
                className="w-full h-8 text-xs"
                onClick={handleAddLote}
                disabled={!puedeCrearLote}
              >
                <Plus className="h-3 w-3 mr-1" />
                {creandoLote
                  ? "Creando mesas..."
                  : `Crear ${loteRango.numeros.length > 0 ? loteRango.numeros.length : ""} mesas`.trim()}
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
