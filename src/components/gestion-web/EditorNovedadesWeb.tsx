import { useState, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNovedades, type Novedad } from "@/hooks/useNovedades";
import { indexarPlatos, usePlatosParaMenu, type PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Plus,
  Edit2,
  Trash2,
  X,
  Image as ImageIcon,
  Wine,
  UtensilsCrossed,
  Gift,
  Calendar,
  Star,
  Sparkles,
  Loader2,
  Languages,
  Move,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Eraser,
  Newspaper,
  Upload,
  Coffee,
  Cake,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MobilePreview, type NovedadPreview } from "./MobilePreview";
import { camposSinTraducir, normalizarTraduccionNovedad } from "@/lib/traduccion-novedad";
import { ImagePositionSelector } from "./ImagePositionSelector";
import { NOVEDAD_CARD_IMAGE_ASPECT_RATIO } from "./previewConstants";
import { BloqueBotonesNovedad } from "./BloqueBotonesNovedad";
import {
  camposBotonesPayload,
  esErrorSinColumnasBotones,
  estadoPlatoEnlazado,
  menuNovedadVacio,
  menuTieneComida,
  parseBotonesNovedad,
  parseMenuNovedad,
  platoEnCarta,
  platoRetiradoDeLaCarta,
  traducirMenuNovedad,
  validarBotonesNovedad,
  type MenuNovedad,
  type TipoBoton,
} from "@/lib/menu-novedad";

// ---------------------------------------------------------------------------
// Novedades de la web (tabla `novedades`)
//
// La web pública (casa-tomas-story, NovedadesSection) lee la tabla en vivo,
// sin rebuild: lo que se guarda aquí se ve en la web al recargarla. Qué filas
// ve el público lo decide la RLS «Público puede ver novedades activas
// vigentes»: activo = true AND fecha_inicio <= hoy AND (fecha_fin IS NULL OR
// fecha_fin >= hoy). El orden es destacado DESC, orden ASC.
// ---------------------------------------------------------------------------

/** Solo orienta al generador de texto (format-novedad); no se guarda. */
const TIPOS_NOVEDAD = [
  { value: "plato_nuevo", label: "Plato nuevo" },
  { value: "promocion", label: "Promoción" },
  { value: "evento", label: "Evento" },
  { value: "festivo", label: "Festivo" },
  { value: "anuncio", label: "Anuncio general" },
];

// Los mismos iconos que sabe pintar la web pública.
const ICONOS = [
  { value: "star", label: "Estrella", icon: Star },
  { value: "utensils", label: "Cubiertos", icon: UtensilsCrossed },
  { value: "wine", label: "Vino", icon: Wine },
  { value: "gift", label: "Regalo", icon: Gift },
  { value: "calendar", label: "Calendario", icon: Calendar },
  { value: "sparkles", label: "Destellos", icon: Sparkles },
  { value: "coffee", label: "Café", icon: Coffee },
  { value: "cake", label: "Tarta", icon: Cake },
];

const TONOS = [
  { value: "cercano", label: "Cercano", description: "Amigable y familiar" },
  { value: "formal", label: "Formal", description: "Profesional y elegante" },
  { value: "divertido", label: "Divertido", description: "Alegre y desenfadado" },
  { value: "exclusivo", label: "Exclusivo", description: "Premium y sofisticado" },
];

const LOADING_MESSAGES = [
  "Redactando la descripción...",
  "Buscando las palabras justas...",
  "Puliendo los detalles...",
  "Casi listo...",
];

const SECCION_NOVEDADES = "gestion_web_novedades";
const BUCKET = "novedades";
const MAX_IMAGEN_MB = 5;
const MAX_TITULO = 120;

// Campos opcionales que enriquecen el texto que se manda a la IA.
const CAMPOS_POR_TIPO: Record<string, { key: string; label: string; placeholder: string; type?: string }[]> = {
  plato_nuevo: [
    { key: "nombre_plato", label: "Nombre del plato", placeholder: "Ej: Risotto de setas" },
    { key: "precio", label: "Precio (€)", placeholder: "12.50", type: "number" },
    { key: "ingredientes", label: "Ingredientes principales", placeholder: "Tomate, mozzarella..." },
    { key: "alergenos", label: "Alérgenos", placeholder: "Gluten, lácteos..." },
  ],
  promocion: [
    { key: "precio_original", label: "Precio original (€)", placeholder: "20.00", type: "number" },
    { key: "precio_oferta", label: "Precio oferta (€)", placeholder: "15.00", type: "number" },
    { key: "condiciones", label: "Condiciones", placeholder: "Válido solo fines de semana..." },
  ],
  evento: [
    { key: "fecha_evento", label: "Fecha del evento", placeholder: "", type: "date" },
    { key: "hora_evento", label: "Hora", placeholder: "20:00", type: "time" },
    { key: "precio_entrada", label: "Precio entrada (€)", placeholder: "25.00", type: "number" },
    { key: "aforo", label: "Aforo máximo", placeholder: "50", type: "number" },
  ],
  festivo: [
    { key: "fecha_festivo", label: "Fecha", placeholder: "", type: "date" },
    { key: "horario_especial", label: "Horario especial", placeholder: "12:00 - 16:00" },
    { key: "menu_especial", label: "Menú especial", placeholder: "Menú de Navidad..." },
  ],
  anuncio: [],
};

interface FormData {
  tipo: string;
  titulo: string;
  descripcion: string;
  titulo_en: string;
  descripcion_en: string;
  titulo_fr: string;
  descripcion_fr: string;
  badge_text: string;
  badge_text_en: string;
  badge_text_fr: string;
  icono: string;
  imagen_url: string;
  imagen_posicion_y: number;
  fecha_inicio: string;
  fecha_fin: string;
  activo: boolean;
  destacado: boolean;
  bullets: string[];
  bullets_en: string[];
  bullets_fr: string[];
  tags: string[];
  tags_en: string[];
  tags_fr: string[];
  campos_tipo: Record<string, string>;
  /** Botones de la tarjeta, en orden (vacío = «Sin botones»). */
  botones: TipoBoton[];
  /** Plato de «Échale un vistazo». Solo se guarda si está ese botón. */
  plato_id: string | null;
  /** Menú de «Ver menú». Solo se guarda si está ese botón. */
  menu: MenuNovedad;
}

interface ResultadoIA {
  title?: string | null;
  body?: string | null;
  bullets?: string[];
  tags?: string[];
  meta?: { source?: string; missing?: string[] };
}

/** Fecha local YYYY-MM-DD (toISOString daría la de UTC y de madrugada cambia de día). */
const hoyLocal = () => new Date().toLocaleDateString("sv-SE");

const formatearFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const nuevoFormulario = (): FormData => ({
  tipo: "anuncio",
  titulo: "",
  descripcion: "",
  titulo_en: "",
  descripcion_en: "",
  titulo_fr: "",
  descripcion_fr: "",
  badge_text: "",
  badge_text_en: "",
  badge_text_fr: "",
  icono: "star",
  imagen_url: "",
  imagen_posicion_y: 50,
  fecha_inicio: hoyLocal(),
  fecha_fin: "",
  activo: true,
  destacado: false,
  bullets: [],
  bullets_en: [],
  bullets_fr: [],
  tags: [],
  tags_en: [],
  tags_fr: [],
  campos_tipo: {},
  botones: [],
  plato_id: null,
  menu: menuNovedadVacio(),
});

const formularioDesdeNovedad = (n: Novedad): FormData => ({
  tipo: "anuncio",
  titulo: n.titulo || "",
  descripcion: n.descripcion || "",
  titulo_en: n.titulo_en || "",
  descripcion_en: n.descripcion_en || "",
  titulo_fr: n.titulo_fr || "",
  descripcion_fr: n.descripcion_fr || "",
  badge_text: n.badge_text || "",
  badge_text_en: n.badge_text_en || "",
  badge_text_fr: n.badge_text_fr || "",
  icono: n.icono || "star",
  imagen_url: n.imagen_url || "",
  imagen_posicion_y: n.imagen_posicion_y ?? 50,
  fecha_inicio: n.fecha_inicio?.split("T")[0] || hoyLocal(),
  fecha_fin: n.fecha_fin?.split("T")[0] || "",
  activo: n.activo ?? true,
  destacado: n.destacado ?? false,
  bullets: n.bullets || [],
  bullets_en: n.bullets_en || [],
  bullets_fr: n.bullets_fr || [],
  tags: n.tags || [],
  tags_en: n.tags_en || [],
  tags_fr: n.tags_fr || [],
  campos_tipo: {},
  // Una novedad de antes de los botones (o una BBDD sin la migración) no trae
  // estas columnas: se lee como «Sin botones» y se guarda como siempre.
  botones: parseBotonesNovedad(n.botones),
  plato_id: n.plato_id ?? null,
  menu: parseMenuNovedad(n.menu) ?? menuNovedadVacio(),
});

/** Lo que se traduce: si cambia, las traducciones guardadas quedan viejas. */
const huellaEspanol = (f: Pick<FormData, "titulo" | "descripcion" | "badge_text" | "bullets" | "tags">) =>
  JSON.stringify([f.titulo.trim(), f.descripcion.trim(), f.badge_text.trim(), f.bullets, f.tags]);

/** Lo que se guarda (para saber si hay cambios sin guardar). */
const huellaFormulario = (f: FormData) => {
  // campos_tipo y tipo solo alimentan a la IA, no se guardan.
  const { campos_tipo: _c, tipo: _t, ...resto } = f;
  return JSON.stringify(resto);
};

type EstadoWeb = { clave: "visible" | "oculta" | "programada" | "caducada"; texto: string };

const estadoEnWeb = (n: { activo: boolean | null; fecha_inicio: string; fecha_fin: string | null }): EstadoWeb => {
  const hoy = hoyLocal();
  const inicio = n.fecha_inicio?.split("T")[0] || "";
  const fin = n.fecha_fin?.split("T")[0] || "";
  if (!n.activo) return { clave: "oculta", texto: "Oculta" };
  if (inicio && inicio > hoy) return { clave: "programada", texto: `Desde el ${formatearFecha(inicio)}` };
  if (fin && fin < hoy) return { clave: "caducada", texto: "Caducada" };
  return { clave: "visible", texto: "En la web" };
};

const ESTILO_ESTADO: Record<EstadoWeb["clave"], string> = {
  visible: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  oculta: "bg-muted text-muted-foreground",
  programada: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900",
  caducada: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
};

/** Ruta dentro del bucket `novedades` a partir de la URL pública, o null si no es de ese bucket. */
const rutaEnBucket = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const marca = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marca);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marca.length).split("?")[0]);
};

const aPreview = (f: FormData | Novedad, id: string, platosPorId: Map<string, PlatoDeCarta>): NovedadPreview => ({
  id,
  titulo: f.titulo || "",
  descripcion: f.descripcion || "",
  titulo_en: f.titulo_en,
  descripcion_en: f.descripcion_en,
  titulo_fr: f.titulo_fr,
  descripcion_fr: f.descripcion_fr,
  imagen_url: f.imagen_url,
  imagen_posicion_y: f.imagen_posicion_y,
  badge_text: f.badge_text,
  badge_text_en: f.badge_text_en,
  badge_text_fr: f.badge_text_fr,
  icono: f.icono,
  destacado: !!f.destacado,
  bullets: f.bullets || [],
  bullets_en: f.bullets_en,
  bullets_fr: f.bullets_fr,
  tags: f.tags || [],
  tags_en: f.tags_en,
  tags_fr: f.tags_fr,
  botones: parseBotonesNovedad(f.botones),
  platoEnCarta: platoEnCarta(f.plato_id ? platosPorId.get(f.plato_id) : undefined),
  menuConPlatos: menuTieneComida(parseMenuNovedad(f.menu) ?? menuNovedadVacio()),
});

const ID_NUEVA = "__nueva__";

const CLAVES_IDIOMA = {
  en: {
    nombre: "Inglés",
    titulo: "titulo_en",
    badge: "badge_text_en",
    descripcion: "descripcion_en",
    bullets: "bullets_en",
    tags: "tags_en",
  },
  fr: {
    nombre: "Francés",
    titulo: "titulo_fr",
    badge: "badge_text_fr",
    descripcion: "descripcion_fr",
    bullets: "bullets_fr",
    tags: "tags_fr",
  },
} as const;

export function EditorNovedadesWeb() {
  const {
    novedades,
    isLoading,
    isError,
    error,
    refetch,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    toggleActivo,
    reordenar,
  } = useNovedades();
  const queryClient = useQueryClient();

  // La carta: para enlazar el plato de «Échale un vistazo», componer el menú de
  // «Ver menú» y avisar cuando un plato enlazado ya no está en la carta.
  const { platos, isLoading: cargandoPlatos, error: errorPlatos } = usePlatosParaMenu();
  const platosPorId = useMemo(() => indexarPlatos(platos), [platos]);
  const cartaCargada = !cargandoPlatos && !errorPlatos;

  // --- Formulario -----------------------------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(nuevoFormulario);
  const [huellaGuardada, setHuellaGuardada] = useState(() => huellaFormulario(nuevoFormulario()));
  /** Huella del español con la que se corresponden las traducciones actuales. */
  const [huellaTraducida, setHuellaTraducida] = useState(() => huellaEspanol(nuevoFormulario()));
  /** El usuario ha escrito a mano en EN/FR: no se sobrescriben al guardar. */
  const [traduccionManual, setTraduccionManual] = useState(false);
  const [imagenOriginal, setImagenOriginal] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [traduccionesAbiertas, setTraduccionesAbiertas] = useState(false);
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState("");
  /** Botones y plato que tenía la novedad al abrirla (regla 2.4 del payload y aviso de plato retirado). */
  const [alAbrir, setAlAbrir] = useState<{ botones: TipoBoton[]; platoId: string | null }>({
    botones: [],
    platoId: null,
  });
  const bloqueBotonesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const tituloRef = useRef<HTMLInputElement>(null);

  // --- Diálogos -------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<Novedad | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [accionPendiente, setAccionPendiente] = useState<(() => void) | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [previewMovilAbierta, setPreviewMovilAbierta] = useState(false);

  // --- IA -------------------------------------------------------------------
  const [generandoDescripcion, setGenerandoDescripcion] = useState(false);
  const [tonoModalOpen, setTonoModalOpen] = useState(false);
  const [tonoSeleccionado, setTonoSeleccionado] = useState("cercano");
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [resultadoIA, setResultadoIA] = useState<ResultadoIA | null>(null);

  const editando = editingId !== null;
  const hayCambios = huellaFormulario(formData) !== huellaGuardada;
  const espanolCambiado = huellaEspanol(formData) !== huellaTraducida;
  const tieneTraducciones = !!(formData.titulo_en || formData.titulo_fr);
  const estadoBorrador = estadoEnWeb({
    activo: formData.activo,
    fecha_inicio: formData.fecha_inicio,
    fecha_fin: formData.fecha_fin || null,
  });
  const novedadEditada = editando ? novedades.find((n) => n.id === editingId) : undefined;

  const estadoPlato = estadoPlatoEnlazado(formData.plato_id, platosPorId, cartaCargada);
  const erroresBotones = validarBotonesNovedad({ botones: formData.botones, menu: formData.menu, estadoPlato });
  // «El plato ya no está en la carta»: se desactivó o salió del restaurante, o
  // se borró (la FK dejó `plato_id` a NULL y así llegó al abrir la novedad).
  const platoRetiradoEnFormulario =
    formData.botones.includes("ver_plato") &&
    (estadoPlato === "fuera_de_carta" ||
      (estadoPlato === "sin_plato" && editando && alAbrir.botones.includes("ver_plato") && alAbrir.platoId === null));

  // Aviso del navegador si se cierra/recarga con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hayCambios]);

  // Si alguien borra desde otro sitio la novedad que estoy editando.
  useEffect(() => {
    if (editingId && !isLoading && !novedades.some((n) => n.id === editingId)) {
      toast.warning("La novedad que estabas editando ya no existe.");
      cargarEnFormulario(null);
    }
  }, [novedades, isLoading, editingId]);

  useEffect(() => {
    if (!generandoDescripcion) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [generandoDescripcion]);

  // --- Utilidades -----------------------------------------------------------
  const setCampo = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const setTraduccion = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setTraduccionManual(true);
    setCampo(field, value);
  };

  /** Borra de Storage una imagen del bucket si ninguna novedad la usa. Nunca bloquea. */
  const borrarImagenSiHuerfana = async (url: string | null | undefined, excluirId?: string) => {
    const ruta = rutaEnBucket(url);
    if (!ruta) return;
    const enUso = novedades.some((n) => n.id !== excluirId && n.imagen_url === url);
    if (enUso) return;
    try {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([ruta]);
      if (removeError) console.error("No se pudo borrar la imagen de Storage (novedades):", removeError);
    } catch (err) {
      console.error("Error borrando imagen de Storage (novedades):", err);
    }
  };

  /** Una imagen subida en este formulario que no llegó a guardarse. */
  const descartarSubidaSinGuardar = () => {
    if (formData.imagen_url && formData.imagen_url !== imagenOriginal) {
      void borrarImagenSiHuerfana(formData.imagen_url);
    }
  };

  const cargarEnFormulario = (novedad: Novedad | null) => {
    const datos = novedad ? formularioDesdeNovedad(novedad) : nuevoFormulario();
    setEditingId(novedad?.id ?? null);
    setFormData(datos);
    setHuellaGuardada(huellaFormulario(datos));
    // Se asume que las traducciones guardadas corresponden al español guardado.
    setHuellaTraducida(huellaEspanol(datos));
    setTraduccionManual(false);
    setImagenOriginal(datos.imagen_url);
    setNuevaEtiqueta("");
    setAlAbrir({ botones: datos.botones, platoId: datos.plato_id });
  };

  /** Ejecuta `accion` y, si hay cambios sin guardar, pregunta antes. */
  const conConfirmacion = (accion: () => void) => {
    if (hayCambios) {
      setAccionPendiente(() => accion);
      return;
    }
    accion();
  };

  const empezarEdicion = (novedad: Novedad) => {
    if (novedad.id === editingId) return;
    conConfirmacion(() => {
      descartarSubidaSinGuardar();
      cargarEnFormulario(novedad);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const empezarNueva = () => {
    conConfirmacion(() => {
      descartarSubidaSinGuardar();
      cargarEnFormulario(null);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => tituloRef.current?.focus(), 300);
    });
  };

  // --- Lista y orden --------------------------------------------------------
  // Se muestran TODAS las filas de la tabla: la web pública no filtra por
  // sección ni por tipo, así que cualquier fila activa y vigente sale en la
  // web y tiene que poder gestionarse desde aquí.
  const lista = novedades;

  const moverNovedad = async (index: number, direccion: -1 | 1) => {
    const destino = index + direccion;
    if (destino < 0 || destino >= lista.length) return;
    const ids = lista.map((n) => n.id);
    [ids[index], ids[destino]] = [ids[destino], ids[index]];
    try {
      await reordenar.mutateAsync(ids);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cambiar el orden. Inténtalo de nuevo.");
    }
  };

  const handleToggleActivo = async (novedad: Novedad, checked: boolean) => {
    setTogglingId(novedad.id);
    try {
      await toggleActivo.mutateAsync({ id: novedad.id, activo: checked });
      toast.success(checked ? `«${novedad.titulo}» vuelve a mostrarse en la web` : `«${novedad.titulo}» ya no se muestra en la web`);
      if (novedad.id === editingId) {
        // Mantener el formulario coherente con lo guardado sin perder otros cambios.
        setFormData((prev) => ({ ...prev, activo: checked }));
        setHuellaGuardada((prev) => {
          const base = JSON.parse(prev) as Record<string, unknown>;
          return JSON.stringify({ ...base, activo: checked });
        });
      }
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cambiar la visibilidad. Inténtalo de nuevo.");
    } finally {
      setTogglingId(null);
    }
  };

  // «Aplicar posición» en una novedad ya guardada guarda el encuadre al momento,
  // igual que en la carta (ListaPlatos/ListaVinos). Antes solo cambiaba el
  // formulario y, si no se pulsaba «Guardar», la web seguía igual. Si la foto
  // también ha cambiado y aún no se ha guardado, el encuadre se guarda con ella
  // al pulsar «Guardar».
  const handleEncuadre = async (posicion: number) => {
    setCampo("imagen_posicion_y", posicion);
    if (!editingId || formData.imagen_url !== imagenOriginal) return;
    try {
      await actualizarNovedad.mutateAsync({ id: editingId, imagen_posicion_y: posicion });
      toast.success("Encuadre guardado. Recarga la web para verlo.");
      // Mantener el formulario coherente con lo guardado sin perder otros cambios.
      setHuellaGuardada((prev) => {
        const base = JSON.parse(prev) as Record<string, unknown>;
        return JSON.stringify({ ...base, imagen_posicion_y: posicion });
      });
    } catch (e) {
      console.error(e);
      toast.error("No se pudo guardar el encuadre. Pulsa «Guardar» para intentarlo de nuevo.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await eliminarNovedad.mutateAsync(deleteTarget.id);
      await borrarImagenSiHuerfana(deleteTarget.imagen_url, deleteTarget.id);
      toast.success(`«${deleteTarget.titulo}» eliminada`);
      if (deleteTarget.id === editingId) cargarEnFormulario(null);
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo eliminar la novedad.");
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Imagen ---------------------------------------------------------------
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permite volver a elegir el mismo fichero después de quitarlo.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("El archivo tiene que ser una imagen (JPG, PNG o WebP).");
      return;
    }
    if (file.size > MAX_IMAGEN_MB * 1024 * 1024) {
      toast.error(`La imagen pesa demasiado (máximo ${MAX_IMAGEN_MB} MB).`);
      return;
    }
    setUploading(true);
    try {
      const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
      const filePath = `novedades/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file, {
        contentType: file.type,
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
      // Si ya había una subida sin guardar en este formulario, se descarta.
      descartarSubidaSinGuardar();
      setFormData((prev) => ({ ...prev, imagen_url: data.publicUrl, imagen_posicion_y: 50 }));
      toast.success("Imagen subida. Ajusta el encuadre si hace falta.");
    } catch (error) {
      console.error("Error uploading image:", error);
      toast.error("No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  };

  const quitarImagen = () => {
    descartarSubidaSinGuardar();
    setFormData((prev) => ({ ...prev, imagen_url: "", imagen_posicion_y: 50 }));
  };

  // --- Traducción -----------------------------------------------------------
  const traducir = async (datos: FormData): Promise<Partial<FormData> | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("traducir-contenido", {
        body: {
          tipo: "novedad",
          datos: {
            titulo: datos.titulo,
            descripcion: datos.descripcion,
            badge_text: datos.badge_text,
            bullets: datos.bullets,
            tags: datos.tags,
          },
        },
      });
      // traducir-contenido responde 200 con {ok:false, error} si falla OpenAI.
      if (error || !data?.ok) {
        console.error("Error al traducir:", error ?? data?.error);
        return null;
      }
      const t = normalizarTraduccionNovedad(data.translations);
      // Una traducción a medias (falta un idioma, la mitad de los puntos...)
      // se trata como un fallo: antes se guardaba tal cual y, al editar,
      // machacaba la traducción buena que ya había.
      const faltan = camposSinTraducir(datos, t);
      if (faltan.length > 0) {
        console.error("Traducción incompleta, se descarta:", faltan);
        return null;
      }
      return t;
    } catch (e) {
      console.error("Error al traducir:", e);
      return null;
    }
  };

  const handleTranslate = async () => {
    if (!formData.titulo.trim()) {
      toast.error("Escribe primero el título en español.");
      return;
    }
    setIsTranslating(true);
    const t = await traducir(formData);
    setIsTranslating(false);
    if (!t) {
      toast.error("El traductor automático no está disponible ahora mismo. Puedes escribir las traducciones a mano.");
      return;
    }
    setFormData((prev) => ({ ...prev, ...t }));
    setHuellaTraducida(huellaEspanol(formData));
    setTraduccionManual(false);
    setTraduccionesAbiertas(true);
    toast.success("Traducciones actualizadas. Revísalas antes de guardar.");
  };

  // --- Guardar --------------------------------------------------------------
  const handleSubmit = async () => {
    const titulo = formData.titulo.trim();
    if (!titulo) {
      toast.error("El título es obligatorio.");
      tituloRef.current?.focus();
      return;
    }
    if (formData.fecha_fin && formData.fecha_inicio && formData.fecha_fin < formData.fecha_inicio) {
      toast.error("La fecha «hasta» no puede ser anterior a la fecha «desde».");
      return;
    }
    if (erroresBotones.length > 0) {
      toast.error(
        erroresBotones.length === 1
          ? `No se puede guardar: ${erroresBotones[0].mensaje}`
          : `No se puede guardar: ${erroresBotones.map((e) => e.mensaje).join(" ")}`,
        { duration: 8000 },
      );
      bloqueBotonesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const conMenu = formData.botones.includes("ver_menu");
    // Sin la carta cargada no se sabe si el plato enlazado sigue en ella, ni qué
    // platos del menú tienen ya su traducción.
    if ((conMenu || formData.botones.includes("ver_plato")) && cargandoPlatos) {
      toast.info("Un momento: todavía se está cargando la carta.");
      return;
    }

    setIsSaving(true);
    let datos = formData;
    let avisoTraduccion: string | null = null;
    let avisoTraduccionMenu: string | null = null;

    // Traducción automática al guardar si el español ha cambiado desde la
    // última traducción y nadie ha tocado las traducciones a mano. Antes solo
    // se traducía al CREAR: al editar una novedad las versiones EN/FR se
    // quedaban con el texto viejo para siempre. El menú de «Ver menú» se
    // traduce en la misma pasada (solo lo que no tiene ya traducción).
    const traducirNovedad = espanolCambiado && !traduccionManual;
    const [t, menuTraducido] = await Promise.all([
      traducirNovedad ? traducir(formData) : Promise.resolve(null),
      conMenu
        ? traducirMenuNovedad(formData.menu, platosPorId, (body) =>
            supabase.functions.invoke("traducir-contenido", { body }),
          )
        : Promise.resolve(null),
    ]);
    if (traducirNovedad) {
      if (t) {
        datos = { ...formData, ...t };
      } else {
        avisoTraduccion = tieneTraducciones
          ? "No se pudo actualizar la traducción: en inglés y francés sigue el texto anterior."
          : "No se pudo traducir: en inglés y francés se mostrará el texto en español.";
      }
    }
    if (menuTraducido && menuTraducido.sinTraducir > 0) {
      avisoTraduccionMenu =
        "Menú: los platos de la carta llevan su traducción, pero lo escrito a mano se ha guardado en español porque el traductor automático no responde.";
    }

    const nullSiVacio = (v: string) => (v.trim() ? v.trim() : null);
    const arrayONull = (v: string[]) => {
      const limpio = v.map((x) => x.trim()).filter(Boolean);
      return limpio.length > 0 ? limpio : null;
    };

    const payload = {
      tipo: "anuncio" as const,
      tipo_asociacion: "seccion" as const,
      seccion: SECCION_NOVEDADES,
      titulo,
      descripcion: datos.descripcion.trim(),
      titulo_en: nullSiVacio(datos.titulo_en),
      descripcion_en: nullSiVacio(datos.descripcion_en),
      titulo_fr: nullSiVacio(datos.titulo_fr),
      descripcion_fr: nullSiVacio(datos.descripcion_fr),
      badge_text: nullSiVacio(datos.badge_text),
      badge_text_en: nullSiVacio(datos.badge_text_en),
      badge_text_fr: nullSiVacio(datos.badge_text_fr),
      icono: datos.icono,
      imagen_url: datos.imagen_url || null,
      imagen_posicion_y: Math.round(datos.imagen_posicion_y),
      fecha_inicio: datos.fecha_inicio || hoyLocal(),
      fecha_fin: datos.fecha_fin || null,
      activo: datos.activo,
      destacado: datos.destacado,
      bullets: arrayONull(datos.bullets),
      bullets_en: arrayONull(datos.bullets_en),
      bullets_fr: arrayONull(datos.bullets_fr),
      tags: arrayONull(datos.tags),
      tags_en: arrayONull(datos.tags_en),
      tags_fr: arrayONull(datos.tags_fr),
      // Regla 2.4: botones, menu y plato_id solo viajan si la novedad tiene
      // botones o los tenía al abrirla. Una novedad sin botones se guarda
      // exactamente igual que antes (también contra una BBDD sin la migración).
      ...camposBotonesPayload({
        botonesAlAbrir: alAbrir.botones,
        botones: datos.botones,
        platoId: datos.plato_id,
        menu: menuTraducido?.menu ?? datos.menu,
      }),
    };

    try {
      if (editingId) {
        await actualizarNovedad.mutateAsync({ id: editingId, ...payload });
        if (imagenOriginal && imagenOriginal !== payload.imagen_url) {
          await borrarImagenSiHuerfana(imagenOriginal, editingId);
        }
      } else {
        // Las nuevas salen las primeras (orden menor que el de todas las demás).
        const ordenMinimo = novedades.reduce((min, n) => Math.min(min, n.orden ?? 0), 0);
        await crearNovedad.mutateAsync({ ...payload, orden: ordenMinimo - 1 });
      }

      const estado = estadoEnWeb(payload);
      const accion = editingId ? "Cambios guardados" : "Novedad creada";
      if (estado.clave === "visible") {
        toast.success(`${accion}. Ya se ve en la web (recarga la página para verla).`);
      } else {
        toast.success(`${accion}. No se muestra en la web: ${estado.texto.toLowerCase()}.`);
      }
      if (avisoTraduccion) toast.warning(avisoTraduccion, { duration: 10000 });
      if (avisoTraduccionMenu) toast.warning(avisoTraduccionMenu, { duration: 10000 });

      cargarEnFormulario(null);
    } catch (e) {
      console.error(e);
      const mensaje = e instanceof Error ? e.message : "Error desconocido";
      const crudo =
        e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : mensaje;
      if (esErrorSinColumnasBotones(crudo)) {
        toast.error(
          "No se pudo guardar: la base de datos todavía no admite botones en las novedades. Quita los botones para guardarla y avisa para que la actualicen.",
          { duration: 10000 },
        );
        return;
      }
      toast.error(`No se pudo guardar la novedad: ${mensaje}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- IA: "Hacer descripción" ----------------------------------------------
  const camposActuales = CAMPOS_POR_TIPO[formData.tipo] || [];

  const handleAbrirModalTono = () => {
    if (!formData.descripcion.trim()) {
      toast.error("Escribe primero alguna idea en la descripción.");
      return;
    }
    setTonoModalOpen(true);
  };

  const handleGenerarDescripcion = async () => {
    setTonoModalOpen(false);
    setLoadingMessageIndex(0);
    setResultadoIA(null);

    const campos = formData.campos_tipo ?? {};
    let textoEnriquecido = formData.descripcion;
    const detalles = camposActuales
      .filter((campo) => campos[campo.key])
      .map((campo) => `${campo.label}: ${campos[campo.key]}`)
      .join(". ");
    if (detalles) textoEnriquecido += `. Detalles: ${detalles}`;

    setGenerandoDescripcion(true);
    try {
      const { data, error } = await supabase.functions.invoke("format-novedad", {
        body: {
          tipo:
            formData.tipo === "plato_nuevo" ? "plato" : formData.tipo === "promocion" ? "promo" : formData.tipo,
          idioma: "es",
          tono: tonoSeleccionado,
          texto: textoEnriquecido,
          canal: "novedades",
          campos_extra: formData.campos_tipo,
        },
      });
      if (error) {
        console.error("Error al llamar a format-novedad:", error);
        toast.error("No se pudo generar la descripción. Inténtalo de nuevo.");
        return;
      }
      const resultado = data as ResultadoIA;
      // format-novedad NUNCA devuelve error: si falla OpenAI responde 200 con
      // meta.source = "fallback" y el texto original. Antes eso se mostraba
      // como si fuera un resultado y parecía que la IA "no hacía nada".
      if (resultado?.meta?.source === "fallback") {
        toast.error(resultado.meta.missing?.[0] || "El generador de textos no está disponible ahora mismo.");
        return;
      }
      setResultadoIA(resultado);
    } catch (error) {
      console.error("Error:", error);
      toast.error("No se pudo conectar con el generador de textos.");
    } finally {
      setGenerandoDescripcion(false);
    }
  };

  const handleAplicarResultado = () => {
    if (!resultadoIA) return;
    setFormData((prev) => ({
      ...prev,
      titulo: resultadoIA.title || prev.titulo,
      descripcion: resultadoIA.body || prev.descripcion,
      bullets: Array.isArray(resultadoIA.bullets) && resultadoIA.bullets.length > 0 ? resultadoIA.bullets : prev.bullets,
      tags: Array.isArray(resultadoIA.tags) && resultadoIA.tags.length > 0 ? resultadoIA.tags : prev.tags,
    }));
    toast.success("Texto aplicado. Revísalo y pulsa «Guardar».");
    setResultadoIA(null);
  };

  // --- Vista previa ---------------------------------------------------------
  // Lo que vería el público: filas visibles hoy, en el orden de la web, con la
  // que se está editando sustituida por el borrador (en vivo, sin botón).
  const idBorrador = editingId ?? ID_NUEVA;
  const novedadesPreview = useMemo(() => {
    type Item = NovedadPreview & { _orden: number; _pos: number };
    const items: Item[] = [];
    lista.forEach((n, pos) => {
      if (n.id === editingId) return;
      if (estadoEnWeb(n).clave !== "visible") return;
      items.push({ ...aPreview(n, n.id, platosPorId), _orden: n.orden ?? 0, _pos: pos });
    });
    const ordenBorrador = editingId
      ? novedadEditada?.orden ?? 0
      : lista.reduce((min, n) => Math.min(min, n.orden ?? 0), 0) - 1;
    const posBorrador = editingId ? lista.findIndex((n) => n.id === editingId) : -1;
    const tieneContenido = formData.titulo.trim() || formData.descripcion.trim() || formData.imagen_url;
    if (editingId || tieneContenido) {
      items.push({
        ...aPreview(formData, idBorrador, platosPorId),
        avisoVisibilidad: estadoBorrador.clave === "visible" ? null : `No se verá en la web: ${estadoBorrador.texto.toLowerCase()}`,
        _orden: ordenBorrador,
        _pos: posBorrador,
      });
    }
    items.sort(
      (a, b) => Number(!!b.destacado) - Number(!!a.destacado) || a._orden - b._orden || a._pos - b._pos,
    );
    return items.map(({ _orden: _o, _pos: _p, ...rest }) => rest);
  }, [lista, editingId, novedadEditada, formData, idBorrador, estadoBorrador.clave, estadoBorrador.texto, platosPorId]);

  const visiblesEnWeb = lista.filter((n) => estadoEnWeb(n).clave === "visible").length;

  const vistaPrevia = <MobilePreview novedades={novedadesPreview} idResaltado={idBorrador} />;

  // --- Render ---------------------------------------------------------------
  // Alto de pantalla (2026-10-07): la pestaña del Gestor Web mide lo que queda
  // de pantalla (GestorWeb.tsx). Desde `xl`, lista + formulario y la vista
  // previa son dos columnas y cada una hace su propio scroll (antes la vista
  // previa era `sticky top-20` contra la ventana, que ya no se desplaza); por
  // debajo de `xl` va todo apilado y desplaza la pestaña entera.
  return (
    <div className="space-y-4 xl:flex xl:h-full xl:flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Se muestran en la web de Casa Tomás y los cambios se ven al momento.
        </p>
        <Button onClick={empezarNueva} data-tour="gw-novedades-nueva">
          <Plus className="w-4 h-4 mr-1.5" />
          Nueva novedad
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[minmax(0,1fr)] xl:flex-1 xl:min-h-0 gap-4 items-start">
        <div className="space-y-4 min-w-0 xl:h-full xl:overflow-y-auto xl:overscroll-contain">
          {/* ------------------------------------------------ Lista */}
          <Card data-tour="gw-novedades-lista">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Publicadas y guardadas
                <Badge variant="secondary">{lista.length}</Badge>
              </CardTitle>
              <CardDescription>
                {visiblesEnWeb === 1 ? "1 se ve" : `${visiblesEnWeb} se ven`} ahora mismo en la web. El orden de esta
                lista es el de la web: usa las flechas para cambiarlo.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : isError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>No se pudieron cargar las novedades</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>{error instanceof Error ? error.message : "Error desconocido"}</p>
                    <Button size="sm" variant="outline" className="h-11 bg-background" onClick={() => refetch()}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      Reintentar
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : lista.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2 py-8">
                  <Newspaper className="w-8 h-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Todavía no hay novedades</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Crea la primera con el formulario de abajo: un plato nuevo, una promoción o un evento.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2" aria-label="Novedades">
                  {lista.map((novedad, index) => {
                    const estado = estadoEnWeb(novedad);
                    const esEditada = novedad.id === editingId;
                    const platoRetirado = platoRetiradoDeLaCarta(
                      parseBotonesNovedad(novedad.botones),
                      novedad.plato_id,
                      platosPorId,
                      cartaCargada,
                    );
                    const mismoGrupoArriba = index > 0 && !!lista[index - 1].destacado === !!novedad.destacado;
                    const mismoGrupoAbajo =
                      index < lista.length - 1 && !!lista[index + 1].destacado === !!novedad.destacado;
                    return (
                      <li
                        key={novedad.id}
                        className={`flex items-center gap-2 p-2 pr-1 rounded-lg border transition-colors ${
                          esEditada ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => empezarEdicion(novedad)}
                          className="flex min-h-11 items-center gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Editar «${novedad.titulo}»`}
                        >
                          <div className="h-10 w-14 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                            {novedad.imagen_url ? (
                              <img
                                src={novedad.imagen_url}
                                alt=""
                                className="h-full w-full object-cover"
                                style={{ objectPosition: `center ${novedad.imagen_posicion_y ?? 50}%` }}
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-muted-foreground/60" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{novedad.titulo || "Sin título"}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ESTILO_ESTADO[estado.clave]}`}>
                                {estado.texto}
                              </Badge>
                              {novedad.destacado && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  <Star className="w-2.5 h-2.5 mr-0.5" />
                                  Destacada
                                </Badge>
                              )}
                              {platoRetirado && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900"
                                >
                                  <AlertTriangle className="w-2.5 h-2.5 mr-0.5" aria-hidden="true" />
                                  El plato ya no está en la carta
                                </Badge>
                              )}
                              {esEditada && <span className="text-[10px] text-primary font-medium">Editando</span>}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <label className="flex min-h-11 items-center gap-1.5 px-1.5 cursor-pointer">
                            <Switch
                              checked={!!novedad.activo}
                              disabled={togglingId === novedad.id}
                              onCheckedChange={(checked) => handleToggleActivo(novedad, checked)}
                              aria-label={`Visible en la web: «${novedad.titulo}»`}
                            />
                            <span className="hidden sm:inline text-xs text-muted-foreground w-14">
                              {novedad.activo ? "Visible" : "Oculta"}
                            </span>
                          </label>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11"
                            disabled={!mismoGrupoArriba || reordenar.isPending}
                            onClick={() => moverNovedad(index, -1)}
                            aria-label="Subir"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11"
                            disabled={!mismoGrupoAbajo || reordenar.isPending}
                            onClick={() => moverNovedad(index, 1)}
                            aria-label="Bajar"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11"
                            onClick={() => empezarEdicion(novedad)}
                            aria-label="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(novedad)}
                            aria-label="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ------------------------------------------------ Formulario */}
          <Card ref={formRef} className={`scroll-mt-4 ${editando ? "border-primary" : ""}`}>
            <CardHeader className="p-4 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    {editando ? "Editar novedad" : "Nueva novedad"}
                    {editando && (
                      <Badge variant="outline" className="border-primary text-primary font-normal truncate max-w-[16rem]">
                        {novedadEditada?.titulo || formData.titulo}
                      </Badge>
                    )}
                    {hayCambios && (
                      <span className="flex items-center gap-1 text-xs font-normal text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Sin guardar
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    La vista previa se actualiza mientras escribes. Nada se publica hasta que pulses «Guardar».
                  </CardDescription>
                </div>
                {!editando && hayCambios && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 text-muted-foreground shrink-0"
                    onClick={() => conConfirmacion(() => {
                      descartarSubidaSinGuardar();
                      cargarEnFormulario(null);
                    })}
                  >
                    <Eraser className="w-4 h-4 mr-1" />
                    Vaciar
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-4 pt-0 space-y-5">
              {/* Título y badge */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="nov-titulo">
                    Título <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="nov-titulo"
                    ref={tituloRef}
                    value={formData.titulo}
                    maxLength={MAX_TITULO}
                    onChange={(e) => setCampo("titulo", e.target.value)}
                    placeholder="Ej: Llega el cocido gallego"
                    aria-required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nov-badge">Etiqueta de la tarjeta</Label>
                  <Input
                    id="nov-badge"
                    value={formData.badge_text}
                    maxLength={24}
                    onChange={(e) => setCampo("badge_text", e.target.value)}
                    placeholder="Ej: Nuevo, -20%"
                  />
                </div>
              </div>

              {/* Descripción + IA */}
              <div className="space-y-2">
                <div className="flex items-end justify-between gap-2">
                  <Label htmlFor="nov-descripcion">Descripción</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11"
                    onClick={handleAbrirModalTono}
                    disabled={generandoDescripcion}
                  >
                    {generandoDescripcion ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Redactar con IA
                  </Button>
                </div>
                <Textarea
                  id="nov-descripcion"
                  value={formData.descripcion}
                  onChange={(e) => setCampo("descripcion", e.target.value)}
                  placeholder="Escribe el texto o unas ideas sueltas y pulsa «Redactar con IA» para que lo pula."
                  className="min-h-24 text-base md:text-base"
                />

                <Collapsible>
                  <CollapsibleTrigger className="group flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    Datos extra para la IA (opcional)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3 space-y-3">
                    <div className="space-y-1.5 max-w-xs">
                      <Label className="text-xs">Tipo de novedad</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setCampo("tipo", v)}>
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_NOVEDAD.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {camposActuales.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg bg-muted/40 border">
                        {camposActuales.map((campo) => (
                          <div key={campo.key} className="space-y-1">
                            <Label className="text-xs">{campo.label}</Label>
                            <Input
                              type={campo.type || "text"}
                              value={formData.campos_tipo[campo.key] || ""}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  campos_tipo: { ...prev.campos_tipo, [campo.key]: e.target.value },
                                }))
                              }
                              placeholder={campo.placeholder}
                              className="h-11 text-base md:text-base"
                              inputMode={campo.type === "number" ? "decimal" : undefined}
                              step={campo.type === "number" ? "0.01" : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Solo sirven para que la IA redacte mejor; no se guardan ni se muestran en la web.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Puntos destacados */}
              <div className="space-y-2">
                <Label>Puntos destacados</Label>
                {formData.bullets.length > 0 && (
                  <div className="space-y-1.5">
                    {formData.bullets.map((bullet, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="text-primary text-sm">•</span>
                        <Input
                          value={bullet}
                          onChange={(e) => {
                            const nuevos = [...formData.bullets];
                            nuevos[index] = e.target.value;
                            setCampo("bullets", nuevos);
                          }}
                          className="h-11 flex-1 text-base md:text-base"
                          aria-label={`Punto destacado ${index + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 shrink-0"
                          onClick={() => setCampo("bullets", formData.bullets.filter((_, i) => i !== index))}
                          aria-label="Quitar punto"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 px-3 text-muted-foreground"
                  onClick={() => setCampo("bullets", [...formData.bullets, ""])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Añadir punto
                </Button>
              </div>

              {/* Etiquetas */}
              <div className="space-y-2">
                <Label htmlFor="nov-etiqueta">Etiquetas</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {formData.tags.map((tag, index) => (
                    <Badge key={`${tag}-${index}`} variant="secondary" className="gap-0 py-0 pl-3 pr-0 text-sm">
                      {tag}
                      <button
                        type="button"
                        onClick={() => setCampo("tags", formData.tags.filter((_, i) => i !== index))}
                        className="flex h-11 w-11 items-center justify-center rounded-full hover:text-destructive"
                        aria-label={`Quitar etiqueta ${tag}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    id="nov-etiqueta"
                    value={nuevaEtiqueta}
                    onChange={(e) => setNuevaEtiqueta(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === ",") && nuevaEtiqueta.trim()) {
                        e.preventDefault();
                        setCampo("tags", [...formData.tags, nuevaEtiqueta.trim()]);
                        setNuevaEtiqueta("");
                      }
                    }}
                    placeholder="Escribe y pulsa Intro"
                    className="h-11 w-52 text-base md:text-base"
                  />
                </div>
              </div>

              {/* Imagen */}
              <div className="space-y-2">
                <Label>Imagen</Label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                {formData.imagen_url ? (
                  <div className="space-y-2">
                    <div className="relative w-full max-w-md rounded-lg overflow-hidden border bg-muted" style={{ aspectRatio: NOVEDAD_CARD_IMAGE_ASPECT_RATIO }}>
                      <img
                        src={formData.imagen_url}
                        alt="Imagen de la novedad"
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ objectPosition: `center ${formData.imagen_posicion_y}%` }}
                      />
                      {uploading && (
                        <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setImageModalOpen(true)}>
                        <Move className="w-3.5 h-3.5 mr-1.5" />
                        Ajustar encuadre
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        Cambiar
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-11 text-destructive hover:text-destructive" onClick={quitarImagen}>
                        <X className="w-3.5 h-3.5 mr-1.5" />
                        Quitar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full max-w-md h-32 rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-muted/50 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">Subiendo...</span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="w-7 h-7 text-muted-foreground/50" />
                        <span className="text-sm text-muted-foreground">Subir imagen</span>
                        <span className="text-xs text-muted-foreground/80">
                          JPG, PNG o WebP · máx. {MAX_IMAGEN_MB} MB · sin foto la web pone una genérica
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Icono */}
              <div className="space-y-1.5 max-w-xs">
                <Label>Icono</Label>
                <Select value={formData.icono} onValueChange={(v) => setCampo("icono", v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICONOS.map((i) => {
                      const Icon = i.icon;
                      return (
                        <SelectItem key={i.value} value={i.value}>
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {i.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Botones de la tarjeta */}
              <div ref={bloqueBotonesRef} className="scroll-mt-4">
                <BloqueBotonesNovedad
                  botones={formData.botones}
                  onBotonesChange={(botones) => setCampo("botones", botones)}
                  platoId={formData.plato_id}
                  onPlatoChange={(platoId) => setCampo("plato_id", platoId)}
                  menu={formData.menu}
                  onMenuChange={(menu) => setCampo("menu", menu)}
                  platos={platos}
                  platosPorId={platosPorId}
                  cargandoPlatos={cargandoPlatos}
                  errorPlatos={errorPlatos}
                  onReintentarPlatos={() => queryClient.invalidateQueries({ queryKey: ["platos-para-menu"] })}
                  platoRetirado={platoRetiradoEnFormulario}
                  errores={erroresBotones}
                />
              </div>

              {/* Publicación */}
              <div className="rounded-lg border p-4 space-y-4" data-tour="gw-novedades-publicacion">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Publicación</p>
                  <Badge variant="outline" className={`text-[11px] ${ESTILO_ESTADO[estadoBorrador.clave]}`}>
                    {estadoBorrador.texto}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex min-h-11 items-start justify-between gap-3 cursor-pointer">
                    <span>
                      <span className="text-sm block">Visible en la web</span>
                      <span className="text-xs text-muted-foreground">Desactívalo para guardarla sin mostrarla.</span>
                    </span>
                    <Switch checked={formData.activo} onCheckedChange={(v) => setCampo("activo", v)} />
                  </label>
                  <label className="flex min-h-11 items-start justify-between gap-3 cursor-pointer">
                    <span>
                      <span className="text-sm block">Destacada</span>
                      <span className="text-xs text-muted-foreground">Aparece antes que las demás.</span>
                    </span>
                    <Switch checked={formData.destacado} onCheckedChange={(v) => setCampo("destacado", v)} />
                  </label>
                  <div className="space-y-1.5">
                    <Label htmlFor="nov-desde" className="text-xs">Mostrar desde</Label>
                    <Input
                      id="nov-desde"
                      type="date"
                      value={formData.fecha_inicio}
                      onChange={(e) => setCampo("fecha_inicio", e.target.value)}
                      className="h-11 text-base md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nov-hasta" className="text-xs">Hasta (opcional)</Label>
                    <div className="flex gap-1">
                      <Input
                        id="nov-hasta"
                        type="date"
                        value={formData.fecha_fin}
                        min={formData.fecha_inicio || undefined}
                        onChange={(e) => setCampo("fecha_fin", e.target.value)}
                        className="h-11 text-base md:text-base"
                      />
                      {formData.fecha_fin && (
                        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => setCampo("fecha_fin", "")} aria-label="Quitar fecha de fin">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Traducciones */}
              <Collapsible open={traduccionesAbiertas} onOpenChange={setTraduccionesAbiertas} className="rounded-lg border">
                <div className="flex items-center justify-between gap-2 p-3">
                  <CollapsibleTrigger className="group flex min-h-11 flex-wrap items-center gap-2 text-sm font-medium min-w-0">
                    <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                    <Languages className="w-4 h-4 shrink-0" />
                    Inglés y francés
                    {espanolCambiado && !traduccionManual ? (
                      <Badge variant="outline" className="text-[10px] font-normal">Se traducirá al guardar</Badge>
                    ) : espanolCambiado && traduccionManual ? (
                      <Badge variant="outline" className="text-[10px] font-normal border-amber-300 text-amber-700">Revisar: el español ha cambiado</Badge>
                    ) : tieneTraducciones ? (
                      <Badge variant="outline" className="text-[10px] font-normal">Al día</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] font-normal">Sin traducir</Badge>
                    )}
                  </CollapsibleTrigger>
                  <Button type="button" variant="outline" size="sm" className="h-11" onClick={handleTranslate} disabled={isTranslating || !formData.titulo.trim()}>
                    {isTranslating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Languages className="w-3.5 h-3.5 mr-1.5" />}
                    Traducir ahora
                  </Button>
                </div>
                <CollapsibleContent className="px-3 pb-3 space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Al guardar se traduce automáticamente todo lo que haya cambiado en español. Si corriges algo aquí a mano,
                    se respeta tu versión. Si falta una traducción, la web muestra el texto en español.
                  </p>
                  {(["en", "fr"] as const).map((lang) => {
                    const k = CLAVES_IDIOMA[lang];
                    const extras = [...formData[k.bullets], ...formData[k.tags]];
                    return (
                      <div key={lang} className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{k.nombre}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <Input
                            className="sm:col-span-2 h-11 text-base md:text-base"
                            value={formData[k.titulo]}
                            onChange={(e) => setTraduccion(k.titulo, e.target.value)}
                            placeholder={formData.titulo || "Título"}
                            aria-label={`Título (${k.nombre.toLowerCase()})`}
                          />
                          <Input
                            className="h-11 text-base md:text-base"
                            value={formData[k.badge]}
                            onChange={(e) => setTraduccion(k.badge, e.target.value)}
                            placeholder={formData.badge_text || "Etiqueta"}
                            aria-label={`Etiqueta (${k.nombre.toLowerCase()})`}
                          />
                        </div>
                        <Textarea
                          value={formData[k.descripcion]}
                          onChange={(e) => setTraduccion(k.descripcion, e.target.value)}
                          placeholder={formData.descripcion || "Descripción"}
                          className="min-h-16 text-base md:text-base"
                          aria-label={`Descripción (${k.nombre.toLowerCase()})`}
                        />
                        {extras.length > 0 && <p className="text-xs text-muted-foreground">{extras.join(" · ")}</p>}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>

              {/* Acciones */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t">
                {editando && (
                  <Button
                    variant="ghost"
                    onClick={() => conConfirmacion(() => {
                      descartarSubidaSinGuardar();
                      cargarEnFormulario(null);
                    })}
                    disabled={isSaving}
                  >
                    Cancelar edición
                  </Button>
                )}
                <Button onClick={handleSubmit} disabled={isSaving || uploading || (editando && !hayCambios)} className="sm:min-w-40">
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      {(espanolCambiado && !traduccionManual) || formData.botones.includes("ver_menu")
                        ? "Traduciendo y guardando..."
                        : "Guardando..."}
                    </>
                  ) : editando ? (
                    "Guardar cambios"
                  ) : (
                    "Guardar novedad"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------ Vista previa */}
        <aside className="hidden xl:block xl:max-h-full xl:overflow-y-auto xl:overscroll-contain" data-tour="gw-novedades-vista">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 text-center">Así se ve en el móvil</h3>
          {vistaPrevia}
        </aside>
        <Collapsible open={previewMovilAbierta} onOpenChange={setPreviewMovilAbierta} className="xl:hidden rounded-lg border">
          <CollapsibleTrigger className="group w-full flex min-h-11 items-center justify-between p-3 text-sm font-medium">
            Vista previa en el móvil
            <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-4 px-2">{previewMovilAbierta && vistaPrevia}</CollapsibleContent>
        </Collapsible>
      </div>

      {/* Eliminar */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{deleteTarget?.titulo}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Desaparecerá de la web en los tres idiomas y no se puede deshacer. Si solo quieres quitarla un tiempo,
              usa el interruptor «Visible» en su lugar.
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

      {/* Descartar cambios */}
      <AlertDialog open={!!accionPendiente} onOpenChange={(open) => !open && setAccionPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios sin guardar?</AlertDialogTitle>
            <AlertDialogDescription>
              Has modificado {editando ? `«${novedadEditada?.titulo ?? formData.titulo}»` : "la nueva novedad"} y no lo
              has guardado. Si continúas, se perderán esos cambios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const accion = accionPendiente;
                setAccionPendiente(null);
                accion?.();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImagePositionSelector
        open={imageModalOpen}
        onOpenChange={setImageModalOpen}
        imageUrl={formData.imagen_url}
        currentPosition={formData.imagen_posicion_y}
        onPositionChange={handleEncuadre}
        aspectRatio={NOVEDAD_CARD_IMAGE_ASPECT_RATIO}
      />

      {/* IA: tono */}
      <Dialog open={tonoModalOpen} onOpenChange={setTonoModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Con qué tono?</DialogTitle>
            <DialogDescription>La IA reescribirá tu texto; podrás revisarlo antes de usarlo.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={tonoSeleccionado} onValueChange={setTonoSeleccionado} className="space-y-3 py-2">
            {TONOS.map((tono) => (
              <div key={tono.value} className="flex items-start space-x-3">
                <RadioGroupItem value={tono.value} id={`tono-${tono.value}`} className="mt-0.5" />
                <Label htmlFor={`tono-${tono.value}`} className="flex flex-col cursor-pointer">
                  <span className="font-medium">{tono.label}</span>
                  <span className="text-xs text-muted-foreground font-normal">{tono.description}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTonoModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleGenerarDescripcion}>
              <Sparkles className="w-4 h-4 mr-1.5" />
              Redactar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IA: cargando */}
      <Dialog open={generandoDescripcion}>
        <DialogContent
          className="max-w-sm [&>button]:hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Redactando</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-10 space-y-5" role="status" aria-live="polite">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-lg font-semibold">{LOADING_MESSAGES[loadingMessageIndex]}</p>
              <p className="text-sm text-muted-foreground">Puede tardar unos segundos.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* IA: resultado */}
      <Dialog open={!!resultadoIA} onOpenChange={(open) => !open && setResultadoIA(null)}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Propuesta de la IA
            </DialogTitle>
            <DialogDescription>
              «Usar este texto» sustituye el título, la descripción, los puntos y las etiquetas del formulario.
            </DialogDescription>
          </DialogHeader>

          {resultadoIA && (
            <div className="space-y-4 py-2">
              {resultadoIA.title && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Título</Label>
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="font-semibold text-lg">{resultadoIA.title}</p>
                  </div>
                </div>
              )}
              {resultadoIA.body && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Descripción</Label>
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="text-sm leading-relaxed">{resultadoIA.body}</p>
                  </div>
                </div>
              )}
              {resultadoIA.bullets && resultadoIA.bullets.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Puntos destacados</Label>
                  <div className="p-3 bg-muted/50 rounded-lg border space-y-1">
                    {resultadoIA.bullets.map((bullet, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-primary">•</span>
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {resultadoIA.tags && resultadoIA.tags.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Etiquetas</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {resultadoIA.tags.map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleGenerarDescripcion}>
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Otra versión
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setResultadoIA(null);
                setTonoModalOpen(true);
              }}
            >
              Cambiar tono
            </Button>
            <Button onClick={handleAplicarResultado}>Usar este texto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
