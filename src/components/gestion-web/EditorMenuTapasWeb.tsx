import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CalendarDays, Edit2, Eye, Loader2, RefreshCw, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { EditorSeccionesMenu } from "@/components/gestion-web/EditorSeccionesMenu";
import { InterruptorMenuTapas } from "@/components/gestion-web/InterruptorMenuTapas";
import { VistaPreviaMenu } from "@/components/gestion-web/VistaPreviaMenu";
import { indexarPlatos, usePlatosParaMenu } from "@/hooks/usePlatosParaMenu";
import {
  ETIQUETA_POSTRE_CAFE,
  ETIQUETA_SECCION,
  OPCIONES_POSTRE_CAFE,
  POSTRE_CAFE_POR_DEFECTO,
  SECCIONES_MENU,
  SECCIONES_MENU_DIA,
  emparejarTraduccion,
  esPostreCafe,
  menuEnIdioma,
  rotuloEnElEditor,
  menuTieneContenido,
  parseMenuDia,
  seccionesMenuDiaVacias,
  serializarMenuDia,
  textoDeSeccion,
  type ItemMenu,
  type MenuEstructurado,
  type PostreCafe,
  type SeccionMenuDia,
  type SeccionesMenuDia,
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
//
// Menos scroll (petición del dueño, 01/11/2026), sobre todo en el móvil:
//   - La lista enseña los días de hoy en adelante y los dos últimos; el resto,
//     tras «Ver los N anteriores».
//   - Las secciones del menú se pliegan con su resumen (`plegable`) y cada
//     plato ocupa una sola fila (ver EditorSeccionesMenu).
//   - Por debajo de `xl` la vista previa es un botón que la abre en un
//     diálogo (antes iba entera debajo del formulario), y «Vista previa» y
//     «Guardar» quedan pegados abajo mientras se edita.
// ---------------------------------------------------------------------------

type SeccionEspecial = "menus_diarios" | "tapas";

const SECCION_CONFIG: Record<
  SeccionEspecial,
  {
    table: "menus_diarios" | "tapas";
    singular: string;
    articulo: string;
    origenRebuild: string;
  }
> = {
  menus_diarios: {
    table: "menus_diarios",
    singular: "menú",
    articulo: "el",
    origenRebuild: "menu",
  },
  tapas: {
    table: "tapas",
    singular: "tapas",
    articulo: "las",
    origenRebuild: "tapas",
  },
};

/** Días pasados que se ven en la lista sin pulsar «Ver los N anteriores». */
const PASADOS_A_LA_VISTA = 2;

interface Registro {
  /** Clave real: es/en/fr comparten fecha, no id. */
  fecha: string;
  menu?: MenuEstructurado;
  tapas?: string[];
}

/**
 * Quita las líneas que se quedaron sin nombre (se añade «A mano» con el campo
 * en blanco y puede no llegar a rellenarse) y los alérgenos huérfanos que
 * colgaban de ellas.
 */
const limpiarSecciones = (secciones: SeccionesMenuDia): SeccionesMenuDia => {
  const limpias = seccionesMenuDiaVacias();
  for (const seccion of SECCIONES_MENU_DIA) {
    limpias[seccion] = secciones[seccion]
      .map((item) => ({ ...item, nombre: item.nombre.trim() }))
      .filter((item) => item.nombre !== "");
  }
  return limpias;
};

/** Lo que devuelve `traducir-contenido` en `translations`, o `null` si falló. */
type Traducciones = Record<string, unknown> | null;

async function pedirTraduccion(body: Record<string, unknown>): Promise<Traducciones> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", { body });
    return !error && data?.ok ? (data.translations as Record<string, unknown>) : null;
  } catch (error) {
    // Sin traductor se guarda igual (en español): no es motivo para no publicar.
    console.error("Error al traducir:", error);
    return null;
  }
}

/** El texto traducido de una sección (`menu_en.primero`…), o "" si no está. */
function textoTraducido(traducciones: Traducciones, idioma: "en" | "fr", seccion: string): string {
  const bloque = traducciones?.[idioma === "en" ? "menu_en" : "menu_fr"];
  if (!bloque || typeof bloque !== "object") return "";
  const valor = (bloque as Record<string, unknown>)[seccion];
  return typeof valor === "string" ? valor : "";
}

/**
 * «¿Qué entra?» del postre. Un `<select>` nativo y no tres botones: ocupa una
 * sola fila también en el móvil, donde además abre el selector del sistema.
 */
function SelectorPostreCafe({ valor, onChange }: { valor: PostreCafe; onChange: (valor: PostreCafe) => void }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Label htmlFor={id} className="text-sm">
        ¿Qué entra?
      </Label>
      <select
        id={id}
        value={valor}
        onChange={(e) => {
          if (esPostreCafe(e.target.value)) onChange(e.target.value);
        }}
        className="h-11 min-w-0 flex-1 rounded-md border bg-background px-2 text-base md:text-sm"
      >
        {OPCIONES_POSTRE_CAFE.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion === "postre"
              ? "Solo postre"
              : opcion === "postre_o_cafe"
                ? "Postre o café (uno de los dos)"
                : "Postre y café (los dos)"}
          </option>
        ))}
      </select>
    </div>
  );
}

const hoyLocal = () => new Date().toLocaleDateString("sv-SE");

const formatearFechaLarga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

/**
 * «mié, 30 dic 2026»: la de la lista en el móvil (QA-MDN-03, 01/11/2026). La
 * larga («miércoles, 30 de diciembre de 2026») no cabía a 390 px junto a los
 * botones de editar y borrar y se cortaba en «30 de diciembr…».
 */
const formatearFechaCorta = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
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
  const [secciones, setSecciones] = useState<SeccionesMenuDia>(seccionesMenuDiaVacias);
  /**
   * Qué entra en el postre. `null` = no se ha tocado en un menú nuevo: vale la
   * del último menú que la tenga elegida (o «Postre y café»), que puede llegar
   * después de abrir el formulario, cuando termina de cargar la lista.
   */
  const [postreCafeElegido, setPostreCafeElegido] = useState<PostreCafe | null>(null);
  const [tapasTexto, setTapasTexto] = useState("");
  /** Cambia al abrir otro registro o vaciar: vuelve a plegar las secciones como toca. */
  const [claveFormulario, setClaveFormulario] = useState(0);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [vistaPreviaAbierta, setVistaPreviaAbierta] = useState(false);
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
    setSecciones(seccionesMenuDiaVacias());
    setPostreCafeElegido(null);
    setTapasTexto("");
    setClaveFormulario((n) => n + 1);
  };

  const editar = (registro: Registro) => {
    setEditandoFecha(registro.fecha);
    setFecha(registro.fecha);
    // Solo se carga el español: las versiones en/fr se vuelven a derivar al
    // guardar (de la carta para los platos enlazados, del traductor para el
    // texto libre), así que no hay que leerlas ni mantenerlas a mano.
    setSecciones(registro.menu ? registro.menu.secciones : seccionesMenuDiaVacias());
    // Un menú de antes de la opción se queda como se ve hoy en la web: «Postre».
    setPostreCafeElegido(registro.menu?.postreCafe ?? "postre");
    setTapasTexto((registro.tapas ?? []).join("\n"));
    setClaveFormulario((n) => n + 1);
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  /** Otro registro (no el que edito) que ya ocupa esa fecha: se sustituirá. */
  const choqueFecha = registros.find((r) => r.fecha === fecha && r.fecha !== editandoFecha);
  const hoy = hoyLocal();
  const seccionesLimpias = useMemo(() => limpiarSecciones(secciones), [secciones]);
  const hayContenido = esMenu ? menuTieneContenido(seccionesLimpias) : lineas(tapasTexto).length > 0;
  /** Secciones sin ningún plato (el entrante es opcional). No bloquea: solo se avisa. */
  const seccionesVaciasAviso = SECCIONES_MENU.filter((s) => seccionesLimpias[s].length === 0);
  /** La del último menú (el más reciente por fecha) que la tenga elegida. */
  const postreCafeSugerido =
    registros.find((r) => r.menu?.postreCafe)?.menu?.postreCafe ?? POSTRE_CAFE_POR_DEFECTO;
  const postreCafe = postreCafeElegido ?? postreCafeSugerido;
  const tituloSeccion = (seccion: SeccionMenuDia) => rotuloEnElEditor(seccion, seccionesLimpias, postreCafe);

  // Lista: de hoy en adelante y los últimos días pasados; el resto, a un toque.
  const registrosALaVista = verAnteriores
    ? registros
    : registros.filter((r) => r.fecha >= hoy).concat(registros.filter((r) => r.fecha < hoy).slice(0, PASADOS_A_LA_VISTA));
  const anterioresOcultos = registros.length - registrosALaVista.length;
  const hayAnterioresPlegables = registros.filter((r) => r.fecha < hoy).length > PASADOS_A_LA_VISTA;

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
            SECCIONES_MENU_DIA.map((s) => [s, seccionesLimpias[s].filter(necesitaTraduccion)]),
          ) as SeccionesMenuDia)
        : seccionesMenuDiaVacias();
      const hayLibreFijo = SECCIONES_MENU.some((s) => libresPorSeccion[s].length > 0);
      const hayLibreEntrante = libresPorSeccion.entrante.length > 0;

      let traducciones: Traducciones = null;
      let traduccionesEntrante: Traducciones = null;
      let falloTraduccion = false;
      if (esMenu) {
        // `traducir-contenido` solo conoce primero, segundo y postre. El
        // entrante va en OTRA llamada, en el hueco de «primero» (el mismo truco
        // que las secciones extra de las novedades): así no hay que tocar la
        // función y, si falla una de las dos, la otra se guarda igual.
        [traducciones, traduccionesEntrante] = await Promise.all([
          hayLibreFijo
            ? pedirTraduccion({
                tipo: "menu",
                datos: {
                  primero: textoDeSeccion(libresPorSeccion.primero),
                  segundo: textoDeSeccion(libresPorSeccion.segundo),
                  postre: textoDeSeccion(libresPorSeccion.postre),
                },
              })
            : Promise.resolve(null),
          hayLibreEntrante
            ? pedirTraduccion({
                tipo: "menu",
                datos: { primero: textoDeSeccion(libresPorSeccion.entrante), segundo: "", postre: "" },
              })
            : Promise.resolve(null),
        ]);
        falloTraduccion = (hayLibreFijo && !traducciones) || (hayLibreEntrante && !traduccionesEntrante);
      } else {
        traducciones = await pedirTraduccion({ tipo: "tapas", datos: { tapas } });
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

          for (const seccion of SECCIONES_MENU_DIA) {
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

          for (const seccion of SECCIONES_MENU) {
            const texto = textoTraducido(traducciones, idioma, seccion);
            for (const [id, variante] of emparejarTraduccion(libresPorSeccion[seccion], texto)) {
              variantes.set(id, variante);
            }
          }
          // El entrante volvió en el hueco de «primero» de su propia llamada.
          const textoEntrante = textoTraducido(traduccionesEntrante, idioma, "primero");
          for (const [id, variante] of emparejarTraduccion(libresPorSeccion.entrante, textoEntrante)) {
            variantes.set(id, variante);
          }

          return variantes;
        };

        // 2) Se escriben SIEMPRE las tres filas con `upsert` sobre
        //    (fecha, idiom), que es justo la clave única de la tabla. El código
        //    anterior insertaba antes de borrar y chocaba con esa restricción al
        //    volver a guardar el mismo día; además, si una fila no se escribía,
        //    quedaba la versión vieja de ese idioma junto a la nueva.
        const filas = [
          { fecha, idiom: "es", menu: serializarMenuDia(seccionesLimpias, postreCafe) },
          {
            fecha,
            idiom: "en",
            menu: serializarMenuDia(menuEnIdioma(seccionesLimpias, variantesDe("en")), postreCafe),
          },
          {
            fecha,
            idiom: "fr",
            menu: serializarMenuDia(menuEnIdioma(seccionesLimpias, variantesDe("fr")), postreCafe),
          },
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

  const vistaPrevia = (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <p className="text-xs text-muted-foreground first-letter:uppercase">{fecha ? formatearFechaLarga(fecha) : "Sin fecha"}</p>
          <CardTitle className="text-lg text-primary">{esMenu ? "Menú del día" : "Tapas del día"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {esMenu ? (
            <VistaPreviaMenu secciones={seccionesLimpias} postreCafe={postreCafe} />
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
    </>
  );

  // Alto de pantalla (2026-10-07): la pestaña del Gestor Web mide lo que queda
  // de pantalla (GestorWeb.tsx). Desde `xl`, lista + formulario y la vista
  // previa son dos columnas y cada una hace su propio scroll (antes la vista
  // previa era `sticky top-20` contra la ventana, que ya no se desplaza); por
  // debajo de `xl` va todo apilado y desplaza la pestaña entera, y la vista
  // previa se abre con un botón en vez de ir debajo del formulario.
  return (
    <div className="space-y-4 xl:flex xl:h-full xl:flex-col">
      <InterruptorMenuTapas boton={esMenu ? "menu" : "tapas"} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[minmax(0,1fr)] xl:flex-1 xl:min-h-0 gap-4 items-start">
        <div className="space-y-4 min-w-0 xl:h-full xl:overflow-y-auto xl:overscroll-contain">
          {/* ---------------------------------------------- Lista */}
          <Card data-tour="gw-menu-lista">
            <CardHeader className="p-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <CardTitle className="text-base flex items-center gap-2">
                    Guardados
                    <Badge variant="secondary">{registros.length}</Badge>
                  </CardTitle>
                  <CardDescription>Pulsa uno para editarlo. Eliminar lo quita en los tres idiomas.</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 -mt-2 -mr-2"
                  onClick={() => cargarDatos()}
                  disabled={isLoading}
                  aria-label="Recargar"
                  title="Recargar"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
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
                <>
                  <ul className="space-y-2" data-testid="lista-guardados">
                    {registrosALaVista.map((registro) => {
                      const detalle = registro.menu
                        ? SECCIONES_MENU_DIA.flatMap((s) => registro.menu!.secciones[s].map((i) => i.nombre)).join(" · ")
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
                              <span className="truncate first-letter:uppercase sm:hidden" title={formatearFechaLarga(registro.fecha)}>
                                {formatearFechaCorta(registro.fecha)}
                              </span>
                              <span className="hidden truncate first-letter:uppercase sm:inline">{formatearFechaLarga(registro.fecha)}</span>
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
                  {hayAnterioresPlegables && (
                    <Button
                      variant="ghost"
                      className="h-11 w-full text-muted-foreground"
                      onClick={() => setVerAnteriores((valor) => !valor)}
                      aria-expanded={verAnteriores}
                    >
                      {verAnteriores
                        ? "Ocultar los anteriores"
                        : anterioresOcultos === 1
                          ? "Ver 1 anterior"
                          : `Ver los ${anterioresOcultos} anteriores`}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          {/* ---------------------------------------------- Formulario */}
          <Card ref={formRef} className={`scroll-mt-4 ${editandoFecha ? "border-primary" : ""}`} data-tour="gw-menu-formulario">
            <CardHeader className="p-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1.5">
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
                </div>
                {/* Arriba, junto a lo que se está editando, y no en la barra de
                    abajo: así «Guardar» tiene sitio de sobra en el móvil. */}
                {(editandoFecha || hayContenido) && (
                  <Button variant="ghost" className="h-11 shrink-0 -mt-2 -mr-2 px-3" onClick={resetForm} disabled={isSaving}>
                    {editandoFecha ? "Cancelar" : "Vaciar"}
                  </Button>
                )}
              </div>
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
                  {/* Plegadas: las que tienen platos enseñan solo su resumen (al
                      abrir un menú guardado se ve entero de un vistazo) y las
                      vacías empiezan abiertas para rellenarlas, salvo el
                      entrante, que es opcional. */}
                  <EditorSeccionesMenu
                    key={claveFormulario}
                    orden={SECCIONES_MENU_DIA}
                    secciones={secciones}
                    onChange={setSecciones}
                    platos={platos}
                    platosPorId={platosPorId}
                    cargandoPlatos={cargandoPlatos}
                    plegable
                    titulos={{
                      primero: tituloSeccion("primero"),
                      segundo: tituloSeccion("segundo"),
                      postre: tituloSeccion("postre"),
                    }}
                    abiertaAlInicio={(seccion, items) => seccion !== "entrante" && items.length === 0}
                    detalleVacia={{ entrante: "Opcional" }}
                    cabeceraDe={(seccion) =>
                      seccion === "postre" ? (
                        <SelectorPostreCafe valor={postreCafe} onChange={setPostreCafeElegido} />
                      ) : seccion === "entrante" && secciones.entrante.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Si no le pones nada, no sale en la web.
                        </p>
                      ) : null
                    }
                  />
                  {hayContenido && seccionesVaciasAviso.length > 0 && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Sin platos en {seccionesVaciasAviso
                          .map((s) => (s === "postre" ? ETIQUETA_POSTRE_CAFE[postreCafe] : ETIQUETA_SECCION[s]).toLowerCase())
                          .join(" ni ")}. Se
                        puede guardar igual: esa parte no saldrá en la web.
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

              {/* Pegada abajo mientras se edita: con un menú largo, «Guardar» y
                  la vista previa siguen a mano sin bajar hasta el final. */}
              <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-lg border-t bg-card px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 px-3 xl:hidden"
                  onClick={() => setVistaPreviaAbierta(true)}
                  data-tour="gw-menu-vista"
                >
                  <Eye className="w-4 h-4 mr-1.5" />
                  Vista previa
                </Button>
                <Button onClick={guardar} disabled={isSaving} className="h-11 min-w-0 flex-1 sm:flex-none sm:min-w-40">
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      <span className="truncate">Traduciendo y guardando...</span>
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

        {/* ---------------------------------------------- Vista previa (desde xl) */}
        <aside
          className="hidden space-y-3 xl:block xl:max-h-full xl:overflow-y-auto xl:overscroll-contain"
          data-tour="gw-menu-vista"
        >
          <h3 className="text-sm font-medium text-muted-foreground text-center">Así se leerá en la web</h3>
          {vistaPrevia}
        </aside>
      </div>

      {/* ---------------------------------------------- Vista previa (por debajo de xl) */}
      <Dialog open={vistaPreviaAbierta} onOpenChange={setVistaPreviaAbierta}>
        <DialogContent className="max-w-md rounded-lg p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Así se leerá en la web</DialogTitle>
            <DialogDescription className="sr-only">
              Vista previa de lo que estás escribiendo, sin guardar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">{vistaPrevia}</div>
        </DialogContent>
      </Dialog>

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
