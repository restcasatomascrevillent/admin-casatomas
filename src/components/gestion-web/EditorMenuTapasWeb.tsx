import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { AlertCircle, CalendarDays, Edit2, Loader2, RefreshCw, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { EditorSeccionesMenu } from "@/components/gestion-web/EditorSeccionesMenu";
import { InterruptorMenuTapas } from "@/components/gestion-web/InterruptorMenuTapas";
import { VistaPreviaMenu } from "@/components/gestion-web/VistaPreviaMenu";
import { indexarPlatos, usePlatosParaMenu } from "@/hooks/usePlatosParaMenu";
import {
  ETIQUETA_SECCION,
  SECCIONES_MENU,
  emparejarTraduccion,
  menuEnIdioma,
  menuTieneContenido,
  parseMenuDia,
  serializarMenuDia,
  textoDeSeccion,
  type ItemMenu,
  type MenuEstructurado,
  type SeccionMenu,
  type VarianteIdioma,
} from "@/lib/menu-dia";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

// ---------------------------------------------------------------------------
// Menús diarios y tapas (tablas `menus_diarios` y `tapas`)
//
// Cada día se guarda como TRES filas (idiom es/en/fr) con la misma fecha y
// ids distintos: la fecha es lo que las une. casa-tomas-story
// (EspaciosSection) las lee en vivo, ordenadas por fecha, y para "hoy" coge
// la primera fila con la fecha de hoy.
// ---------------------------------------------------------------------------

type SeccionEspecial = "menus_diarios" | "tapas";

const SECCION_CONFIG: Record<
  SeccionEspecial,
  {
    table: "menus_diarios" | "tapas";
    descripcion: string;
    singular: string;
    articulo: string;
    origenRebuild: string;
  }
> = {
  menus_diarios: {
    table: "menus_diarios",
    descripcion: "Se muestra en la sección «Espacios» de la web de Casa Tomás.",
    singular: "menú",
    articulo: "el",
    origenRebuild: "menu",
  },
  tapas: {
    table: "tapas",
    descripcion: "Se muestran en la sección «Espacios» de la web de Casa Tomás.",
    singular: "tapas",
    articulo: "las",
    origenRebuild: "tapas",
  },
};

interface Registro {
  /** Clave real: es/en/fr comparten fecha, no id. */
  fecha: string;
  menu?: MenuEstructurado;
  tapas?: string[];
}

/** Secciones vacías: el estado inicial del formulario de menú. */
const seccionesVacias = (): Record<SeccionMenu, ItemMenu[]> => ({
  primero: [],
  segundo: [],
  postre: [],
});

/**
 * Quita las líneas que se quedaron sin nombre (se añade «A mano» con el campo
 * en blanco y puede no llegar a rellenarse) y los alérgenos huérfanos que
 * colgaban de ellas.
 */
const limpiarSecciones = (
  secciones: Record<SeccionMenu, ItemMenu[]>,
): Record<SeccionMenu, ItemMenu[]> => {
  const limpias = seccionesVacias();
  for (const seccion of SECCIONES_MENU) {
    limpias[seccion] = secciones[seccion]
      .map((item) => ({ ...item, nombre: item.nombre.trim() }))
      .filter((item) => item.nombre !== "");
  }
  return limpias;
};

const hoyLocal = () => new Date().toLocaleDateString("sv-SE");

const formatearFechaLarga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

const parseTapasJson = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const lineas = (text: string) =>
  text
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

interface EditorMenuTapasWebProps {
  seccionActiva: SeccionEspecial;
}

export function EditorMenuTapasWeb({ seccionActiva }: EditorMenuTapasWebProps) {
  const config = SECCION_CONFIG[seccionActiva];
  const esMenu = seccionActiva === "menus_diarios";
  const queryClient = useQueryClient();

  const [registros, setRegistros] = useState<Registro[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [registroAEliminar, setRegistroAEliminar] = useState<Registro | null>(null);

  /** Fecha del registro que se está editando (null = nuevo). */
  const [editandoFecha, setEditandoFecha] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoyLocal);
  const [secciones, setSecciones] = useState<Record<SeccionMenu, ItemMenu[]>>(seccionesVacias);
  const [tapasTexto, setTapasTexto] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  // La carta solo hace falta en el editor de menú (para elegir platos y para
  // reutilizar sus traducciones al guardar): en la pestaña de tapas la consulta
  // ni se lanza.
  const { platos, isLoading: cargandoPlatos, error: errorPlatos } = usePlatosParaMenu(esMenu);
  const platosPorId = useMemo(() => indexarPlatos(platos), [platos]);

  const cargarDatos = useCallback(async () => {
    setIsLoading(true);
    setErrorCarga(null);
    try {
      if (esMenu) {
        const { data, error } = await supabase
          .from("menus_diarios")
          .select("id, fecha, menu")
          .eq("idiom", "es")
          .order("fecha", { ascending: false });
        if (error) throw error;
        // Una entrada por fecha (si hubiera duplicados antiguos, gana la primera).
        const porFecha = new Map<string, Registro>();
        (data ?? []).forEach((row) => {
          if (!porFecha.has(row.fecha)) porFecha.set(row.fecha, { fecha: row.fecha, menu: parseMenuDia(row.menu) });
        });
        setRegistros(Array.from(porFecha.values()));
      } else {
        const { data, error } = await supabase
          .from("tapas")
          .select("id, fecha, tapas")
          .eq("idiom", "es")
          .order("fecha", { ascending: false });
        if (error) throw error;
        const porFecha = new Map<string, Registro>();
        (data ?? []).forEach((row) => {
          if (!porFecha.has(row.fecha)) porFecha.set(row.fecha, { fecha: row.fecha, tapas: parseTapasJson(row.tapas) });
        });
        setRegistros(Array.from(porFecha.values()));
      }
    } catch (error) {
      console.error(error);
      setErrorCarga(mensajeUsuario(error, "Error desconocido"));
    } finally {
      setIsLoading(false);
    }
  }, [esMenu]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  const resetForm = () => {
    setEditandoFecha(null);
    setFecha(hoyLocal());
    setSecciones(seccionesVacias());
    setTapasTexto("");
  };

  const editar = (registro: Registro) => {
    setEditandoFecha(registro.fecha);
    setFecha(registro.fecha);
    // Solo se carga el español: las versiones en/fr se vuelven a derivar al
    // guardar (de la carta para los platos enlazados, del traductor para el
    // texto libre), así que no hay que leerlas ni mantenerlas a mano.
    setSecciones(registro.menu ? registro.menu.secciones : seccionesVacias());
    setTapasTexto((registro.tapas ?? []).join("\n"));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Otro registro (no el que edito) que ya ocupa esa fecha: se sustituirá. */
  const choqueFecha = registros.find((r) => r.fecha === fecha && r.fecha !== editandoFecha);
  const hoy = hoyLocal();
  const seccionesLimpias = useMemo(() => limpiarSecciones(secciones), [secciones]);
  const hayContenido = esMenu ? menuTieneContenido(seccionesLimpias) : lineas(tapasTexto).length > 0;
  /** Secciones sin ningún plato. No bloquea: solo se avisa. */
  const seccionesVaciasAviso = SECCIONES_MENU.filter((s) => seccionesLimpias[s].length === 0);

  const guardar = async () => {
    if (!fecha) {
      toast.error("Elige la fecha.");
      return;
    }
    const tapas = lineas(tapasTexto);
    if (esMenu && !menuTieneContenido(seccionesLimpias)) {
      toast.error("Añade al menos un plato.");
      return;
    }
    // Sin la carta cargada no se distingue un plato retirado de uno que sí está,
    // y se mandarían a traducir platos cuya traducción ya existe.
    if (esMenu && cargandoPlatos) {
      toast.info("Un momento: todavía se está cargando la carta.");
      return;
    }
    if (!esMenu && tapas.length === 0) {
      toast.error("Escribe al menos una tapa.");
      return;
    }

    setIsSaving(true);
    try {
      // 1) TRADUCIR. Al traductor solo va el TEXTO LIBRE: los platos elegidos
      //    de la carta ya tienen `nombre_en` / `nombre_fr`, y volver a
      //    traducirlos solo crearía una segunda versión del mismo plato (y
      //    gastaría llamadas). Si no hay texto libre, no se llama siquiera.
      // Cuenta como texto libre lo escrito a mano Y el plato cuyo `platoId` ya
      // no existe en la carta: su copia sigue siendo válida, pero su traducción
      // se fue con él, así que hay que pedirla. Si no, un plato retirado de la
      // carta se quedaría en español para siempre en las filas en/fr.
      const necesitaTraduccion = (item: ItemMenu) =>
        item.origen === "libre" || !item.platoId || !platosPorId.has(item.platoId);

      const libresPorSeccion = esMenu
        ? (Object.fromEntries(
            SECCIONES_MENU.map((s) => [s, seccionesLimpias[s].filter(necesitaTraduccion)]),
          ) as Record<SeccionMenu, ItemMenu[]>)
        : seccionesVacias();
      const hayTextoLibre = SECCIONES_MENU.some((s) => libresPorSeccion[s].length > 0);

      let traducciones: Record<string, unknown> | null = null;
      let falloTraduccion = false;
      if (!esMenu || hayTextoLibre) {
        const { data: tradRes, error: tradError } = await supabase.functions.invoke("traducir-contenido", {
          body: esMenu
            ? {
                tipo: "menu",
                datos: {
                  primero: textoDeSeccion(libresPorSeccion.primero),
                  segundo: textoDeSeccion(libresPorSeccion.segundo),
                  postre: textoDeSeccion(libresPorSeccion.postre),
                },
              }
            : { tipo: "tapas", datos: { tapas } },
        });
        traducciones = !tradError && tradRes?.ok ? tradRes.translations : null;
        falloTraduccion = traducciones === null;
      }

      if (esMenu) {
        /**
         * Variantes de un idioma: primero lo que YA sabe la carta (gratis y
         * exacto), después lo que haya devuelto el traductor para el texto
         * libre. Lo que no tenga variante se queda en español, que se lee, en
         * vez de quedarse en blanco.
         */
        const variantesDe = (idioma: "en" | "fr"): Map<string, VarianteIdioma> => {
          const variantes = new Map<string, VarianteIdioma>();

          for (const seccion of SECCIONES_MENU) {
            for (const item of seccionesLimpias[seccion]) {
              if (item.origen !== "carta" || !item.platoId) continue;
              const plato = platosPorId.get(item.platoId);
              if (!plato) continue;
              const nombre = (idioma === "en" ? plato.nombre_en : plato.nombre_fr)?.trim();
              if (!nombre) continue;
              const descripcion = (idioma === "en" ? plato.descripcion_en : plato.descripcion_fr)?.trim();
              variantes.set(item.id, { nombre, descripcion: descripcion || null });
            }
          }

          const bloque = traducciones?.[idioma === "en" ? "menu_en" : "menu_fr"];
          if (bloque && typeof bloque === "object") {
            const mapa = bloque as Record<string, unknown>;
            for (const seccion of SECCIONES_MENU) {
              const texto = typeof mapa[seccion] === "string" ? (mapa[seccion] as string) : "";
              for (const [id, variante] of emparejarTraduccion(libresPorSeccion[seccion], texto)) {
                variantes.set(id, variante);
              }
            }
          }

          return variantes;
        };

        // 2) Se escriben SIEMPRE las tres filas con `upsert` sobre
        //    (fecha, idiom), que es justo la clave única de la tabla. El código
        //    anterior insertaba antes de borrar y chocaba con esa restricción al
        //    volver a guardar el mismo día; además, si una fila no se escribía,
        //    quedaba la versión vieja de ese idioma junto a la nueva.
        const filas = [
          { fecha, idiom: "es", menu: serializarMenuDia(seccionesLimpias) },
          { fecha, idiom: "en", menu: serializarMenuDia(menuEnIdioma(seccionesLimpias, variantesDe("en"))) },
          { fecha, idiom: "fr", menu: serializarMenuDia(menuEnIdioma(seccionesLimpias, variantesDe("fr"))) },
        ];
        const { error } = await supabase
          .from("menus_diarios")
          .upsert(filas as never, { onConflict: "fecha,idiom" });
        if (error) throw error;
      } else {
        // Las tres filas siempre: si el traductor falla, en/fr se quedan con el
        // español. Antes solo se escribía `es` y las filas en/fr del día seguían
        // publicando el contenido ANTERIOR.
        const t = traducciones;
        const filas = [
          { fecha, idiom: "es", tapas },
          { fecha, idiom: "en", tapas: t?.tapas_en ?? tapas },
          { fecha, idiom: "fr", tapas: t?.tapas_fr ?? tapas },
        ];
        const { error } = await supabase.from("tapas").upsert(filas as never, { onConflict: "fecha,idiom" });
        if (error) throw error;
      }

      // 3) Si el día se ha movido, el día viejo se queda sin contenido.
      if (editandoFecha && editandoFecha !== fecha) {
        const { error: borrarError } = await supabase.from(config.table).delete().eq("fecha", editandoFecha);
        if (borrarError) {
          console.error("No se pudo borrar el día anterior:", borrarError);
          toast.warning("Guardado, pero el día anterior sigue publicado. Recarga y bórralo a mano.");
        }
      }

      if (falloTraduccion) {
        toast.warning(
          esMenu
            ? "Los platos de la carta sí llevan su traducción, pero el texto escrito a mano se ha guardado en español: el traductor automático no responde."
            : "Guardado solo en español: la traducción automática no está disponible ahora mismo.",
          { duration: 10000 },
        );
      }

      notificarGuardadoYPublicacion(
        config.origenRebuild,
        editandoFecha || choqueFecha ? "Cambios guardados" : "Guardado",
      );

      resetForm();
      await cargarDatos();
    } catch (error) {
      console.error(error);
      toast.error(`No se pudo guardar: ${mensajeUsuario(error, "error desconocido")}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!registroAEliminar) return;
    setIsDeleting(true);
    try {
      // La lista muestra solo el español, pero cada día son TRES filas: se
      // borra por fecha para no dejar huérfanas las de inglés y francés.
      const { error } = await supabase.from(config.table).delete().eq("fecha", registroAEliminar.fecha);
      if (error) throw error;

      if (editandoFecha === registroAEliminar.fecha) resetForm();
      setRegistroAEliminar(null);
      notificarGuardadoYPublicacion(config.origenRebuild, "Eliminado en los tres idiomas");
      await cargarDatos();
    } catch (error) {
      console.error(error);
      toast.error("No se pudo eliminar.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Alto de pantalla (2026-10-07): la pestaña del Gestor Web mide lo que queda
  // de pantalla (GestorWeb.tsx). Desde `xl`, lista + formulario y la vista
  // previa son dos columnas y cada una hace su propio scroll (antes la vista
  // previa era `sticky top-20` contra la ventana, que ya no se desplaza); por
  // debajo de `xl` va todo apilado y desplaza la pestaña entera.
  return (
    <div className="space-y-4 xl:flex xl:h-full xl:flex-col">
      <InterruptorMenuTapas boton={esMenu ? "menu" : "tapas"} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{config.descripcion}</p>
        <Button variant="outline" onClick={() => cargarDatos()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Recargar
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[minmax(0,1fr)] xl:flex-1 xl:min-h-0 gap-4 items-start">
        <div className="space-y-4 min-w-0 xl:h-full xl:overflow-y-auto xl:overscroll-contain">
          {/* ---------------------------------------------- Lista */}
          <Card data-tour="gw-menu-lista">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Guardados
                <Badge variant="secondary">{registros.length}</Badge>
              </CardTitle>
              <CardDescription>Pulsa uno para editarlo. Eliminar lo quita en los tres idiomas.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2 max-h-[28rem] overflow-y-auto">
              {isLoading ? (
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : errorCarga ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <p>No se pudo cargar la lista: {errorCarga}</p>
                    <Button size="sm" variant="outline" className="h-11 bg-background" onClick={() => cargarDatos()}>
                      Reintentar
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : registros.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2 py-8">
                  <UtensilsCrossed className="w-8 h-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Todavía no hay nada guardado</p>
                  <p className="text-xs text-muted-foreground">Usa el formulario de abajo para añadir el primero.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {registros.map((registro) => {
                    const detalle = registro.menu
                      ? SECCIONES_MENU.flatMap((s) => registro.menu!.secciones[s].map((i) => i.nombre)).join(" · ")
                      : (registro.tapas ?? []).join(" · ");
                    const esEditado = registro.fecha === editandoFecha;
                    const esHoy = registro.fecha === hoy;
                    const pasado = registro.fecha < hoy;
                    return (
                      <li
                        key={registro.fecha}
                        className={`flex items-center gap-2 p-2 pr-1 rounded-lg border transition-colors ${
                          esEditado ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
                        } ${pasado && !esEditado ? "opacity-70" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => editar(registro)}
                          className="min-h-11 min-w-0 flex-1 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <p className="text-sm font-medium flex items-center gap-2">
                            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate first-letter:uppercase">{formatearFechaLarga(registro.fecha)}</span>
                            {esHoy && <Badge className="text-[10px] px-1.5 py-0">Hoy</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{detalle || "Sin contenido"}</p>
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-11 w-11 shrink-0"
                          onClick={() => editar(registro)}
                          aria-label="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => setRegistroAEliminar(registro)}
                          aria-label="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          {/* ---------------------------------------------- Formulario */}
          <Card ref={formRef} className={`scroll-mt-4 ${editandoFecha ? "border-primary" : ""}`} data-tour="gw-menu-formulario">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                {editandoFecha ? `Editar ${config.singular}` : esMenu ? "Nuevo menú del día" : "Nuevas tapas del día"}
                {editandoFecha && (
                  <Badge variant="outline" className="border-primary text-primary font-normal">
                    {formatearFechaLarga(editandoFecha)}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Se escribe en español y se traduce solo al inglés y al francés al guardar.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor={`${seccionActiva}-fecha`}>Día</Label>
                <Input
                  id={`${seccionActiva}-fecha`}
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-11 text-base md:text-base"
                />
              </div>

              {choqueFecha && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Ya hay {config.articulo} {config.singular} del {formatearFechaLarga(fecha)}. Al guardar se
                    sustituirá por este.
                  </AlertDescription>
                </Alert>
              )}

              {esMenu ? (
                <div className="space-y-3">
                  {/* Sin la carta el menú SE PUEDE escribir igual (a mano), pero se
                      pierden las dos cosas por las que existe esto: elegir un plato
                      con sus alérgenos y su foto, y reaprovechar su traducción. Se
                      avisa en vez de bloquear: publicar el menú del día es urgente y
                      el texto libre sigue funcionando. */}
                  {errorPlatos && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="space-y-2">
                        <p>
                          No se ha podido cargar la carta, así que ahora mismo no se puede elegir «De la carta»:
                          los platos habrá que escribirlos a mano y se traducirán de cero.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 bg-background"
                          onClick={() => queryClient.invalidateQueries({ queryKey: ["platos-para-menu"] })}
                        >
                          Reintentar
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                  <EditorSeccionesMenu
                    secciones={secciones}
                    onChange={setSecciones}
                    platos={platos}
                    platosPorId={platosPorId}
                    cargandoPlatos={cargandoPlatos}
                  />
                  {hayContenido && seccionesVaciasAviso.length > 0 && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Sin platos en{" "}
                        {seccionesVaciasAviso.map((s) => ETIQUETA_SECCION[s].toLowerCase()).join(" ni ")}. Se puede
                        guardar igual: esa parte no saldrá en la web.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="tapas-texto">Tapas (una por línea)</Label>
                  <Textarea
                    id="tapas-texto"
                    value={tapasTexto}
                    onChange={(e) => setTapasTexto(e.target.value)}
                    placeholder={"Ensaladilla rusa\nCroquetas de jamón\nPulpo a feira"}
                    className="min-h-40 text-base md:text-base"
                  />
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t">
                {(editandoFecha || hayContenido) && (
                  <Button variant="ghost" onClick={resetForm} disabled={isSaving}>
                    {editandoFecha ? "Cancelar edición" : "Vaciar"}
                  </Button>
                )}
                <Button onClick={guardar} disabled={isSaving} className="sm:min-w-40">
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      Traduciendo y guardando...
                    </>
                  ) : editandoFecha ? (
                    "Guardar cambios"
                  ) : (
                    "Guardar y publicar"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* ---------------------------------------------- Vista previa */}
        <aside className="space-y-3 xl:max-h-full xl:overflow-y-auto xl:overscroll-contain" data-tour="gw-menu-vista">
          <h3 className="text-sm font-medium text-muted-foreground text-center">Así se leerá en la web</h3>
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <p className="text-xs text-muted-foreground first-letter:uppercase">{fecha ? formatearFechaLarga(fecha) : "Sin fecha"}</p>
              <CardTitle className="text-lg text-primary">{esMenu ? "Menú del día" : "Tapas del día"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {esMenu ? (
                <VistaPreviaMenu secciones={seccionesLimpias} />
              ) : lineas(tapasTexto).length > 0 ? (
                <ul className="space-y-1">
                  {lineas(tapasTexto).map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary shrink-0">•</span>
                      {/* Envuelto en un span con min-w-0: como texto suelto era un
                          item flex con min-width:auto y una palabra larga se salía
                          de la tarjeta (que tiene overflow-hidden) y salía cortada. */}
                      <span className="min-w-0 break-words">{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground italic">Escribe las tapas para verlas aquí.</p>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground text-center px-4">
            Vista orientativa. La web muestra el del día de hoy y los tres más recientes.
          </p>
        </aside>
      </div>

      <AlertDialog open={!!registroAEliminar} onOpenChange={(open) => !open && !isDeleting && setRegistroAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {config.articulo} {config.singular} del{" "}
              {registroAEliminar ? formatearFechaLarga(registroAEliminar.fecha) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán las versiones en español, inglés y francés. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
