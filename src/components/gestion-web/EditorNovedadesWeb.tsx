import { useState, useRef, useEffect } from "react";
import { useNovedades } from "@/hooks/useNovedades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Edit2, Trash2, Eye, Save, X, Image as ImageIcon, Wine, UtensilsCrossed, Gift, Calendar, Star, Sparkles, Loader2, Globe, Move } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { NovedadPreview } from "./MobilePreview";
import { ImagePositionSelector } from "./ImagePositionSelector";
const TIPOS_NOVEDAD = [{
  value: "plato_nuevo",
  label: "Plato Nuevo"
}, {
  value: "promocion",
  label: "Promoción"
}, {
  value: "evento",
  label: "Evento"
}, {
  value: "festivo",
  label: "Festivo"
}, {
  value: "anuncio",
  label: "Anuncio General"
}];
const ICONOS = [{
  value: "utensils",
  label: "Cubiertos",
  icon: UtensilsCrossed
}, {
  value: "wine",
  label: "Vino",
  icon: Wine
}, {
  value: "gift",
  label: "Regalo",
  icon: Gift
}, {
  value: "calendar",
  label: "Calendario",
  icon: Calendar
}, {
  value: "star",
  label: "Estrella",
  icon: Star
}, {
  value: "sparkles",
  label: "Destacado",
  icon: Sparkles
}];
const TONOS = [{
  value: "cercano",
  label: "Cercano",
  description: "Tono amigable y familiar"
}, {
  value: "formal",
  label: "Formal",
  description: "Tono profesional y elegante"
}, {
  value: "divertido",
  label: "Divertido",
  description: "Tono alegre y desenfadado"
}, {
  value: "exclusivo",
  label: "Exclusivo",
  description: "Tono premium y sofisticado"
}];
const LOADING_MESSAGES = ["Generando magia ✨", "Cocinando las palabras perfectas 🍳", "Creando tu descripción...", "Puliendo cada detalle 💎", "Dándole el toque final 🎨", "Inspirándose en tu idea 💡", "Casi listo... ⏳"];
interface EditorNovedadesWebProps {
  onPreview: (novedad: NovedadPreview | null) => void;
  onPreviewListChange?: (ids: string[]) => void;
}
// Campos específicos por tipo de novedad
const CAMPOS_POR_TIPO: Record<string, {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
}[]> = {
  plato_nuevo: [{
    key: "nombre_plato",
    label: "Nombre del plato",
    placeholder: "Ej: Risotto de setas..."
  }, {
    key: "precio",
    label: "Precio (€)",
    placeholder: "12.50",
    type: "number"
  }, {
    key: "ingredientes",
    label: "Ingredientes principales",
    placeholder: "Tomate, mozzarella, albahaca..."
  }, {
    key: "alergenos",
    label: "Alérgenos",
    placeholder: "Gluten, lácteos, frutos secos..."
  }],
  promocion: [{
    key: "precio_original",
    label: "Precio original (€)",
    placeholder: "20.00",
    type: "number"
  }, {
    key: "precio_oferta",
    label: "Precio oferta (€)",
    placeholder: "15.00",
    type: "number"
  }, {
    key: "condiciones",
    label: "Condiciones",
    placeholder: "Válido solo fines de semana..."
  }],
  evento: [{
    key: "fecha_evento",
    label: "Fecha del evento",
    placeholder: "",
    type: "date"
  }, {
    key: "hora_evento",
    label: "Hora",
    placeholder: "20:00",
    type: "time"
  }, {
    key: "precio_entrada",
    label: "Precio entrada (€)",
    placeholder: "25.00",
    type: "number"
  }, {
    key: "aforo",
    label: "Aforo máximo",
    placeholder: "50",
    type: "number"
  }],
  festivo: [{
    key: "fecha_festivo",
    label: "Fecha",
    placeholder: "",
    type: "date"
  }, {
    key: "horario_especial",
    label: "Horario especial",
    placeholder: "12:00 - 16:00"
  }, {
    key: "menu_especial",
    label: "Menú especial",
    placeholder: "Menú de Navidad..."
  }],
  anuncio: []
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
  cta_text: string;
  cta_url: string;
  subtitle: string;
  tags: string[];
  tags_en: string[];
  tags_fr: string[];
  // Campos dinámicos por tipo
  campos_tipo: Record<string, string>;
}
const initialFormData: FormData = {
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
  icono: "utensils",
  imagen_url: "",
  imagen_posicion_y: 50,
  fecha_inicio: new Date().toISOString().split("T")[0],
  fecha_fin: "",
  activo: true,
  destacado: false,
  bullets: [],
  bullets_en: [],
  bullets_fr: [],
  cta_text: "",
  cta_url: "",
  subtitle: "",
  tags: [],
  tags_en: [],
  tags_fr: [],
  campos_tipo: {}
};
export function EditorNovedadesWeb({
  onPreview,
  onPreviewListChange
}: EditorNovedadesWebProps) {
  const {
    novedades,
    isLoading,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    toggleActivo
  } = useNovedades();
  const [editingId, setEditingId] = useState<string | null>("new");
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [generandoDescripcion, setGenerandoDescripcion] = useState(false);
  const [tonoModalOpen, setTonoModalOpen] = useState(false);
  const [tonoSeleccionado, setTonoSeleccionado] = useState("cercano");
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [resultadoModalOpen, setResultadoModalOpen] = useState(false);
  const [resultadoWebhook, setResultadoWebhook] = useState<{
    title?: string;
    subtitle?: string;
    body?: string;
    bullets?: string[];
    cta?: {
      text?: string;
      url?: string;
    };
    tags?: string[];
  } | null>(null);
  const [previewIds, setPreviewIds] = useState<Set<string>>(new Set());
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inicializar previewIds con novedades activas
  useEffect(() => {
    if (novedades && previewIds.size === 0) {
      const activeIds = novedades.filter(n => n.activo).map(n => n.id);
      setPreviewIds(new Set(activeIds));
    }
  }, [novedades]);

  // Notificar cambios en preview list
  useEffect(() => {
    onPreviewListChange?.(Array.from(previewIds));
  }, [previewIds, onPreviewListChange]);
  const handleTogglePreview = (id: string) => {
    setPreviewIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };
  const handleToggleActivo = async (id: string, currentActivo: boolean) => {
    await toggleActivo.mutateAsync({
      id,
      activo: !currentActivo
    });
  };
  const handleCampoTipoChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      campos_tipo: {
        ...prev.campos_tipo,
        [key]: value
      }
    }));
  };
  const camposActuales = CAMPOS_POR_TIPO[formData.tipo] || [];
  const handleAbrirModalTono = () => {
    if (!formData.descripcion.trim()) {
      toast.error("Escribe primero alguna idea o texto en la descripción");
      return;
    }
    setTonoModalOpen(true);
  };

  // Efecto para rotar mensajes de carga
  useEffect(() => {
    if (!generandoDescripcion) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => {
        const next = (prev + 1) % LOADING_MESSAGES.length;
        setLoadingMessage(LOADING_MESSAGES[next]);
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [generandoDescripcion]);
  const handleGenerarDescripcion = async () => {
    setTonoModalOpen(false);
    setLoadingMessageIndex(0);
    setLoadingMessage(LOADING_MESSAGES[0]);
    setResultadoWebhook(null);

    // Campos opcionales - no validamos como obligatorios
    const campos = formData.campos_tipo ?? {};

    // Construir texto enriquecido con los campos del tipo
    let textoEnriquecido = formData.descripcion;
    if (Object.keys(campos).length > 0) {
      const detalles = camposActuales.filter(campo => campos[campo.key]).map(campo => `${campo.label}: ${campos[campo.key]}`).join(". ");
      if (detalles) {
        textoEnriquecido += `. Detalles: ${detalles}`;
      }
    }
    setGenerandoDescripcion(true);
    try {
      const {
        data,
        error
      } = await supabase.functions.invoke("format-novedad", {
        body: {
          tipo: formData.tipo === "plato_nuevo" ? "plato" : formData.tipo === "promocion" ? "promo" : formData.tipo === "anuncio" ? "anuncio" : formData.tipo,
          // evento, festivo se envían tal cual
          idioma: "es",
          tono: tonoSeleccionado,
          texto: textoEnriquecido,
          canal: "novedades",
          campos_extra: formData.campos_tipo
        }
      });
      if (error) {
        console.error("Error al llamar webhook:", error);
        toast.error("Error al generar la descripción");
        setGenerandoDescripcion(false);
        return;
      }
      console.log("Respuesta del webhook:", data);

      // Guardar resultado y mostrar modal de resultados
      setResultadoWebhook(data);
      setGenerandoDescripcion(false);
      setResultadoModalOpen(true);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Error al conectar con el servicio");
      setGenerandoDescripcion(false);
    }
  };
  const handleAplicarResultado = () => {
    if (!resultadoWebhook) return;

    // Aplicar los datos devueltos por el webhook
    if (resultadoWebhook.title) {
      handleInputChange("titulo", resultadoWebhook.title);
    }
    if (resultadoWebhook.subtitle) {
      handleInputChange("subtitle", resultadoWebhook.subtitle);
    }
    if (resultadoWebhook.body) {
      handleInputChange("descripcion", resultadoWebhook.body);
    }
    if (resultadoWebhook.bullets && Array.isArray(resultadoWebhook.bullets)) {
      setFormData(prev => ({
        ...prev,
        bullets: resultadoWebhook.bullets || []
      }));
    }
    if (resultadoWebhook.cta) {
      if (resultadoWebhook.cta.text) handleInputChange("badge_text", resultadoWebhook.cta.text);
      if (resultadoWebhook.cta.url) handleInputChange("cta_url", resultadoWebhook.cta.url);
    }
    if (resultadoWebhook.tags && Array.isArray(resultadoWebhook.tags)) {
      setFormData(prev => ({
        ...prev,
        tags: resultadoWebhook.tags || []
      }));
    }
    toast.success("Contenido aplicado correctamente");
    setResultadoModalOpen(false);
    setResultadoWebhook(null);
  };
  const handleReenviar = () => {
    setResultadoModalOpen(false);
    handleGenerarDescripcion();
  };
  const handleCambiarTono = () => {
    setResultadoModalOpen(false);
    setTonoModalOpen(true);
  };
  const handleInputChange = (field: keyof FormData, value: string | boolean | string[] | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };
  const handlePreview = () => {
    onPreview({
      titulo: formData.titulo,
      descripcion: formData.descripcion,
      titulo_en: formData.titulo_en,
      descripcion_en: formData.descripcion_en,
      titulo_fr: formData.titulo_fr,
      descripcion_fr: formData.descripcion_fr,
      imagen_url: formData.imagen_url,
      imagen_posicion_y: formData.imagen_posicion_y,
      badge_text: formData.badge_text,
      badge_text_en: formData.badge_text_en,
      badge_text_fr: formData.badge_text_fr,
      icono: formData.icono,
      destacado: formData.destacado,
      bullets: formData.bullets,
      bullets_en: formData.bullets_en,
      bullets_fr: formData.bullets_fr,
      tags: formData.tags,
      tags_en: formData.tags_en,
      tags_fr: formData.tags_fr,
    });
  };

  const handleTranslate = async () => {
    if (!formData.titulo.trim()) {
      toast.error("Escribe primero un título para traducir");
      return;
    }
    
    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke("traducir-novedad", {
        body: {
          titulo: formData.titulo,
          descripcion: formData.descripcion,
          badge_text: formData.badge_text,
          bullets: formData.bullets,
          tags: formData.tags,
        }
      });

      if (error) {
        console.error("Error al traducir:", error);
        toast.error("Error al traducir la novedad");
        return;
      }

      console.log("Traducciones recibidas:", data);

      // Actualizar formData con las traducciones
      setFormData(prev => ({
        ...prev,
        titulo_en: data.titulo_en || prev.titulo_en,
        titulo_fr: data.titulo_fr || prev.titulo_fr,
        descripcion_en: data.descripcion_en || prev.descripcion_en,
        descripcion_fr: data.descripcion_fr || prev.descripcion_fr,
        badge_text_en: data.badge_text_en || prev.badge_text_en,
        badge_text_fr: data.badge_text_fr || prev.badge_text_fr,
        bullets_en: data.bullets_en || prev.bullets_en,
        bullets_fr: data.bullets_fr || prev.bullets_fr,
        tags_en: data.tags_en || prev.tags_en,
        tags_fr: data.tags_fr || prev.tags_fr,
      }));

      toast.success("¡Traducción completada! 🌍");
    } catch (error) {
      console.error("Error:", error);
      toast.error("Error al conectar con el servicio de traducción");
    } finally {
      setIsTranslating(false);
    }
  };
  const handleClearPreview = () => {
    onPreview(null);
  };
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `novedades/${fileName}`;
      const {
        error: uploadError
      } = await supabase.storage.from("novedades").upload(filePath, file);
      if (uploadError) throw uploadError;
      const {
        data
      } = supabase.storage.from("novedades").getPublicUrl(filePath);
      handleInputChange("imagen_url", data.publicUrl);
      toast.success("Imagen subida correctamente");
    } catch (error) {
      console.error("Error uploading image:", error);
      toast.error("Error al subir la imagen");
    } finally {
      setUploading(false);
    }
  };
  const handleEdit = (novedad: any) => {
    setEditingId(novedad.id);
    setFormData({
      tipo: novedad.tipo || "anuncio",
      titulo: novedad.titulo || "",
      descripcion: novedad.descripcion || "",
      titulo_en: novedad.titulo_en || "",
      descripcion_en: novedad.descripcion_en || "",
      titulo_fr: novedad.titulo_fr || "",
      descripcion_fr: novedad.descripcion_fr || "",
      badge_text: novedad.badge_text || "",
      badge_text_en: novedad.badge_text_en || "",
      badge_text_fr: novedad.badge_text_fr || "",
      icono: novedad.icono || "utensils",
      imagen_url: novedad.imagen_url || "",
      imagen_posicion_y: novedad.imagen_posicion_y ?? 50,
      fecha_inicio: novedad.fecha_inicio?.split("T")[0] || new Date().toISOString().split("T")[0],
      fecha_fin: novedad.fecha_fin?.split("T")[0] || "",
      activo: novedad.activo ?? true,
      destacado: novedad.destacado ?? false,
      bullets: novedad.bullets || [],
      bullets_en: novedad.bullets_en || [],
      bullets_fr: novedad.bullets_fr || [],
      cta_text: "",
      cta_url: "",
      subtitle: "",
      tags: novedad.tags || [],
      tags_en: novedad.tags_en || [],
      tags_fr: novedad.tags_fr || [],
      campos_tipo: {}
    });
  };
  const handleCancel = () => {
    setEditingId(null);
    setFormData(initialFormData);
    handleClearPreview();
  };
  const handleSubmit = async () => {
    if (!formData.titulo.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    const data = {
      tipo: "anuncio" as const,
      titulo: formData.titulo,
      descripcion: formData.descripcion,
      titulo_en: formData.titulo_en || null,
      descripcion_en: formData.descripcion_en || null,
      titulo_fr: formData.titulo_fr || null,
      descripcion_fr: formData.descripcion_fr || null,
      badge_text: formData.badge_text || null,
      badge_text_en: formData.badge_text_en || null,
      badge_text_fr: formData.badge_text_fr || null,
      icono: formData.icono,
      imagen_url: formData.imagen_url || null,
      imagen_posicion_y: Math.round(formData.imagen_posicion_y),
      fecha_inicio: formData.fecha_inicio,
      fecha_fin: formData.fecha_fin || null,
      activo: formData.activo,
      destacado: formData.destacado,
      bullets: formData.bullets.length > 0 ? formData.bullets : null,
      bullets_en: formData.bullets_en.length > 0 ? formData.bullets_en : null,
      bullets_fr: formData.bullets_fr.length > 0 ? formData.bullets_fr : null,
      tags: formData.tags.length > 0 ? formData.tags : null,
      tags_en: formData.tags_en.length > 0 ? formData.tags_en : null,
      tags_fr: formData.tags_fr.length > 0 ? formData.tags_fr : null,
    };
    setIsSaving(true);
    try {
      if (editingId && editingId !== "new") {
        // Actualizar: no llama al webhook
        await actualizarNovedad.mutateAsync({
          id: editingId,
          ...data
        });
        toast.success("Novedad actualizada");
      } else {
        // Crear: llama al webhook automáticamente desde el hook
        await crearNovedad.mutateAsync(data);
        toast.success("Novedad creada");
      }
      handleCancel();
    } catch (error) {
      toast.error("Error al guardar la novedad");
    } finally {
      setIsSaving(false);
    }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await eliminarNovedad.mutateAsync(deleteId);
      toast.success("Novedad eliminada");
      setDeleteId(null);
    } catch (error) {
      toast.error("Error al eliminar");
    }
  };
  const getEstadoBadge = (novedad: any) => {
    const hoy = new Date();
    const inicio = new Date(novedad.fecha_inicio);
    const fin = novedad.fecha_fin ? new Date(novedad.fecha_fin) : null;
    if (!novedad.activo) return <Badge variant="secondary">Inactivo</Badge>;
    if (inicio > hoy) return <Badge variant="outline">Programado</Badge>;
    if (fin && fin < hoy) return <Badge variant="destructive">Expirado</Badge>;
    return <Badge variant="default">Activo</Badge>;
  };
  return <div className="space-y-6">
      {/* Lista de novedades existentes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Novedades ({novedades?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-48 overflow-y-auto">
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando...</p> : novedades?.length === 0 ? <p className="text-sm text-muted-foreground">No hay novedades</p> : novedades?.map(novedad => <div key={novedad.id} className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">{novedad.titulo}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Toggle Activo */}
                  <div className="flex items-center gap-1">
                    <Switch checked={novedad.activo} onCheckedChange={() => handleToggleActivo(novedad.id, novedad.activo)} className="scale-75" />
                    <span className={`text-[10px] w-12 ${novedad.activo ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {novedad.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  {/* Toggle Preview */}
                  <div className="gap-[4px] items-center justify-start flex flex-row my-0 px-[7px]">
                    <Switch checked={previewIds.has(novedad.id)} onCheckedChange={() => handleTogglePreview(novedad.id)} className="scale-75" />
                    <Eye className={`w-3.5 h-3.5 ${previewIds.has(novedad.id) ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  {/* Acciones */}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(novedad)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(novedad.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>)}
        </CardContent>
      </Card>

      {/* Formulario de edición - Siempre visible */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {editingId && editingId !== "new" ? "Editar Novedad" : "Nueva Novedad"}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Tipo e Icono */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select value={formData.tipo} onValueChange={v => handleInputChange("tipo", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_NOVEDAD.map(t => <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Icono</Label>
              <Select value={formData.icono} onValueChange={v => handleInputChange("icono", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICONOS.map(i => {
                  const Icon = i.icon;
                  return <SelectItem key={i.value} value={i.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4" />
                          {i.label}
                        </div>
                      </SelectItem>;
                })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Título y Badge */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input value={formData.titulo} onChange={e => handleInputChange("titulo", e.target.value)} placeholder="Título de la novedad" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Badge</Label>
              <Input value={formData.badge_text} onChange={e => handleInputChange("badge_text", e.target.value)} placeholder="Nuevo" className="h-9" />
            </div>
          </div>

          {/* Campos específicos según tipo */}
          {camposActuales.length > 0 && <div className="space-y-2 p-3 rounded-lg bg-accent/30 border">
              <p className="text-xs font-medium text-muted-foreground">
                📋 Datos para {TIPOS_NOVEDAD.find(t => t.value === formData.tipo)?.label}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {camposActuales.map(campo => <div key={campo.key} className="space-y-1">
                    <Label className="text-xs">{campo.label}</Label>
                    <Input type={campo.type || "text"} value={(formData.campos_tipo ?? {})[campo.key] || ""} onChange={e => handleCampoTipoChange(campo.key, e.target.value)} placeholder={campo.placeholder} className="h-8 text-sm" step={campo.type === "number" ? "0.01" : undefined} />
                  </div>)}
              </div>
            </div>}

          {/* Descripción */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Descripción / Ideas</Label>
              <Textarea value={formData.descripcion} onChange={e => handleInputChange("descripcion", e.target.value)} placeholder="Escribe ideas o un borrador de la descripción..." className="min-h-16 resize-none" />
              <Button type="button" variant="outline" size="sm" className="mt-1" onClick={handleAbrirModalTono} disabled={generandoDescripcion}>
                {generandoDescripcion ? <>
                    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1" />
                    Generando...
                  </> : <>
                    <Sparkles className="w-3 h-3 mr-1" />
                    Hacer descripción
                  </>}
              </Button>
            </div>

            {/* Campos generados por el webhook - solo visibles si tienen contenido */}
            {(formData.subtitle || (formData.bullets?.length ?? 0) > 0 || formData.cta_text || (formData.tags?.length ?? 0) > 0) && <div className="space-y-3 p-3 rounded-lg bg-muted/50 border border-dashed">
                <p className="text-xs text-muted-foreground font-medium">✨ Contenido generado</p>

                {/* Subtítulo */}
                {formData.subtitle && <div className="space-y-1">
                    <Label className="text-xs">Subtítulo</Label>
                    <Input value={formData.subtitle} onChange={e => handleInputChange("subtitle", e.target.value)} className="h-8 text-sm" />
                  </div>}

                {/* Bullets */}
                {(formData.bullets?.length ?? 0) > 0 && <div className="space-y-1.5">
                    <Label className="text-xs">Puntos destacados</Label>
                    <div className="space-y-1">
                      {formData.bullets?.map((bullet, index) => <div key={index} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">•</span>
                          <Input value={bullet} onChange={e => {
                    const newBullets = [...(formData.bullets ?? [])];
                    newBullets[index] = e.target.value;
                    handleInputChange("bullets", newBullets);
                  }} className="h-7 text-sm flex-1" />
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                    const newBullets = (formData.bullets ?? []).filter((_, i) => i !== index);
                    handleInputChange("bullets", newBullets);
                  }}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>)}
                    </div>
                  </div>}

                {/* CTA */}
                {formData.cta_text}

                {/* Tags */}
                {(formData.tags?.length ?? 0) > 0 && <div className="space-y-1">
                    <Label className="text-xs">Etiquetas</Label>
                    <div className="flex flex-wrap gap-1">
                      {formData.tags?.map((tag, index) => <Badge key={index} variant="secondary" className="text-xs gap-1">
                          {tag}
                          <button type="button" onClick={() => {
                    const newTags = (formData.tags ?? []).filter((_, i) => i !== index);
                    handleInputChange("tags", newTags);
                  }} className="ml-1 hover:text-destructive">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </Badge>)}
                    </div>
                  </div>}
              </div>}
          </div>

          {/* Imagen */}
          <div className="space-y-2">
            <Label className="text-xs">Imagen</Label>

            {/* Previsualización grande si hay imagen */}
            {formData.imagen_url ? (
              <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-muted">
                <img 
                  src={formData.imagen_url} 
                  alt="Preview" 
                  className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                  style={{ objectPosition: `center ${formData.imagen_posicion_y}%` }}
                  onClick={() => setImageModalOpen(true)} 
                />
                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                  <Move className="w-3 h-3" />
                  Clic para posicionar
                </div>
                <Button 
                  type="button" 
                  variant="destructive" 
                  size="icon" 
                  className="absolute top-2 right-2 h-7 w-7" 
                  onClick={e => {
                    e.stopPropagation();
                    handleInputChange("imagen_url", "");
                    handleInputChange("imagen_posicion_y", 50);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label 
                className="w-full h-32 rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  className="hidden" 
                />
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-muted-foreground">Subiendo...</span>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                    <span className="text-xs text-muted-foreground">Haz clic para subir imagen</span>
                  </>
                )}
              </label>
            )}
          </div>


          {/* Fechas */}

          {/* Switches */}

          {/* Botones de acción */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handlePreview} className="flex-1">
              <Eye className="w-4 h-4 mr-1" />
              Vista previa
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSaving} className="flex-1">
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  {editingId && editingId !== "new" ? "Actualizando..." : "Guardando..."}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  {editingId && editingId !== "new" ? "Actualizar" : "Guardar"}
                </>
              )}
            </Button>
          </div>
          {/* Botón Borrar todo */}
          <div className="pt-2 border-t">
            <Button variant="destructive" size="sm" className="w-full" onClick={() => {
            setFormData(initialFormData);
            setEditingId("new");
            handleClearPreview();
          }}>
              <Trash2 className="w-4 h-4 mr-1" />
              Borrar todo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmación de eliminación */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar novedad?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La novedad será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal para posicionar imagen */}
      <ImagePositionSelector
        open={imageModalOpen}
        onOpenChange={setImageModalOpen}
        imageUrl={formData.imagen_url}
        currentPosition={formData.imagen_posicion_y}
        onPositionChange={(pos) => handleInputChange("imagen_posicion_y", pos)}
      />

      {/* Modal para seleccionar tono */}
      <Dialog open={tonoModalOpen} onOpenChange={setTonoModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Selecciona el tono</DialogTitle>
          </DialogHeader>
          <RadioGroup value={tonoSeleccionado} onValueChange={setTonoSeleccionado} className="space-y-3 py-4">
            {TONOS.map(tono => <div key={tono.value} className="flex items-start space-x-3">
                <RadioGroupItem value={tono.value} id={tono.value} className="mt-0.5" />
                <Label htmlFor={tono.value} className="flex flex-col cursor-pointer">
                  <span className="font-medium">{tono.label}</span>
                  <span className="text-xs text-muted-foreground">{tono.description}</span>
                </Label>
              </div>)}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTonoModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleGenerarDescripcion}>Enviar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de carga mientras se genera */}
      <Dialog open={generandoDescripcion} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
          <div className="flex flex-col items-center justify-center py-16 space-y-8">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full border-4 border-primary/20"></div>
              <Loader2 className="w-20 h-20 text-primary animate-spin" />
            </div>
            <div className="text-center space-y-3">
              <p className="text-2xl font-bold text-foreground">{loadingMessage}</p>
              <p className="text-sm text-muted-foreground">Esto puede tardar unos segundos...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de resultados del webhook */}
      <Dialog open={resultadoModalOpen} onOpenChange={setResultadoModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Contenido generado
            </DialogTitle>
          </DialogHeader>

          {resultadoWebhook && <div className="space-y-4 py-4">
              {/* Título */}
              {resultadoWebhook.title && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Título</Label>
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="font-semibold text-lg">{resultadoWebhook.title}</p>
                  </div>
                </div>}

              {/* Subtítulo */}
              {resultadoWebhook.subtitle && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subtítulo</Label>
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="text-muted-foreground">{resultadoWebhook.subtitle}</p>
                  </div>
                </div>}

              {/* Descripción */}
              {resultadoWebhook.body && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Descripción
                  </Label>
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <p className="text-sm leading-relaxed">{resultadoWebhook.body}</p>
                  </div>
                </div>}

              {/* Bullets */}
              {resultadoWebhook.bullets && resultadoWebhook.bullets.length > 0 && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Puntos destacados
                  </Label>
                  <div className="p-3 bg-muted/50 rounded-lg border space-y-1">
                    {resultadoWebhook.bullets.map((bullet, i) => <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{bullet}</span>
                      </div>)}
                  </div>
                </div>}

              {/* Tags */}
              {resultadoWebhook.tags && resultadoWebhook.tags.length > 0 && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Etiquetas</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {resultadoWebhook.tags.map((tag, i) => <Badge key={i} variant="outline" className="text-xs capitalize">
                        {tag}
                      </Badge>)}
                  </div>
                </div>}

              {/* CTA */}
              {resultadoWebhook.cta && (resultadoWebhook.cta.text || resultadoWebhook.cta.url) && <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Llamada a la acción (CTA)
                  </Label>
                  <div className="p-3 bg-muted/50 rounded-lg border space-y-1">
                    {resultadoWebhook.cta.text && <p className="text-sm font-medium">{resultadoWebhook.cta.text}</p>}
                    {resultadoWebhook.cta.url && <p className="text-xs text-muted-foreground break-all">{resultadoWebhook.cta.url}</p>}
                  </div>
                </div>}
            </div>}

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-4 border-t">
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={handleReenviar} className="flex-1 sm:flex-none">
                <Loader2 className="w-4 h-4 mr-1.5" />
                Regenerar
              </Button>
              <Button variant="outline" size="sm" onClick={handleCambiarTono} className="flex-1 sm:flex-none">
                <Edit2 className="w-4 h-4 mr-1.5" />
                Otro tono
              </Button>
            </div>
            <Button size="sm" onClick={handleAplicarResultado} className="flex-1 sm:flex-none">
              <Save className="w-4 h-4 mr-1.5" />
              Usar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>;
}