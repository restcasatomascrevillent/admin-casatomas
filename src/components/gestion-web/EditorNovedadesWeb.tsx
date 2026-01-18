import { useState, useRef } from "react";
import { useNovedades } from "@/hooks/useNovedades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit2, Trash2, Eye, Save, X, Upload, Image as ImageIcon, Wine, UtensilsCrossed, Gift, Calendar, Star, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { NovedadPreview } from "./MobilePreview";

const TIPOS_NOVEDAD = [
  { value: "plato_nuevo", label: "Plato Nuevo" },
  { value: "promocion", label: "Promoción" },
  { value: "evento", label: "Evento" },
  { value: "festivo", label: "Festivo" },
  { value: "anuncio", label: "Anuncio General" },
];

const ICONOS = [
  { value: "utensils", label: "Cubiertos", icon: UtensilsCrossed },
  { value: "wine", label: "Vino", icon: Wine },
  { value: "gift", label: "Regalo", icon: Gift },
  { value: "calendar", label: "Calendario", icon: Calendar },
  { value: "star", label: "Estrella", icon: Star },
  { value: "sparkles", label: "Destacado", icon: Sparkles },
];

interface EditorNovedadesWebProps {
  onPreview: (novedad: NovedadPreview | null) => void;
}

interface FormData {
  tipo: string;
  titulo: string;
  descripcion: string;
  titulo_en: string;
  descripcion_en: string;
  titulo_fr: string;
  descripcion_fr: string;
  badge_text: string;
  icono: string;
  imagen_url: string;
  fecha_inicio: string;
  fecha_fin: string;
  activo: boolean;
  destacado: boolean;
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
  icono: "utensils",
  imagen_url: "",
  fecha_inicio: new Date().toISOString().split('T')[0],
  fecha_fin: "",
  activo: true,
  destacado: false,
};

export function EditorNovedadesWeb({ onPreview }: EditorNovedadesWebProps) {
  const { novedades, isLoading, crearNovedad, actualizarNovedad, eliminarNovedad } = useNovedades();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePreview = () => {
    onPreview({
      titulo: formData.titulo,
      descripcion: formData.descripcion,
      imagen_url: formData.imagen_url,
      badge_text: formData.badge_text,
      icono: formData.icono,
      destacado: formData.destacado,
    });
  };

  const handleClearPreview = () => {
    onPreview(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `novedades/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('novedades')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('novedades').getPublicUrl(filePath);
      handleInputChange('imagen_url', data.publicUrl);
      toast.success("Imagen subida correctamente");
    } catch (error) {
      console.error('Error uploading image:', error);
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
      icono: novedad.icono || "utensils",
      imagen_url: novedad.imagen_url || "",
      fecha_inicio: novedad.fecha_inicio?.split('T')[0] || new Date().toISOString().split('T')[0],
      fecha_fin: novedad.fecha_fin?.split('T')[0] || "",
      activo: novedad.activo ?? true,
      destacado: novedad.destacado ?? false,
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
      icono: formData.icono,
      imagen_url: formData.imagen_url || null,
      fecha_inicio: formData.fecha_inicio,
      fecha_fin: formData.fecha_fin || null,
      activo: formData.activo,
      destacado: formData.destacado,
    };

    try {
      if (editingId && editingId !== 'new') {
        await actualizarNovedad.mutateAsync({ id: editingId, ...data });
        toast.success("Novedad actualizada");
      } else {
        await crearNovedad.mutateAsync(data);
        toast.success("Novedad creada");
      }
      handleCancel();
    } catch (error) {
      toast.error("Error al guardar la novedad");
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

  return (
    <div className="space-y-6">
      {/* Lista de novedades existentes */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Novedades ({novedades?.length || 0})</CardTitle>
            {!editingId && (
              <Button size="sm" onClick={() => setEditingId('new')}>
                <Plus className="w-4 h-4 mr-1" />
                Nueva
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 max-h-48 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : novedades?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay novedades</p>
          ) : (
            novedades?.map((novedad) => (
              <div 
                key={novedad.id} 
                className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {getEstadoBadge(novedad)}
                  <span className="text-sm font-medium truncate">{novedad.titulo}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(novedad)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(novedad.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Formulario de edición */}
      {editingId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId === 'new' ? 'Nueva Novedad' : 'Editar Novedad'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Tipo e Icono */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select value={formData.tipo} onValueChange={(v) => handleInputChange('tipo', v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_NOVEDAD.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Icono</Label>
                <Select value={formData.icono} onValueChange={(v) => handleInputChange('icono', v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICONOS.map(i => {
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
            </div>

            {/* Título y Badge */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Título *</Label>
                <Input 
                  value={formData.titulo} 
                  onChange={(e) => handleInputChange('titulo', e.target.value)}
                  placeholder="Título de la novedad"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Badge</Label>
                <Input 
                  value={formData.badge_text} 
                  onChange={(e) => handleInputChange('badge_text', e.target.value)}
                  placeholder="Nuevo"
                  className="h-9"
                />
              </div>
            </div>

            {/* Descripción */}
            <div className="space-y-1.5">
              <Label className="text-xs">Descripción</Label>
              <Textarea 
                value={formData.descripcion} 
                onChange={(e) => handleInputChange('descripcion', e.target.value)}
                placeholder="Descripción de la novedad"
                className="min-h-16 resize-none"
              />
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="mt-1"
                onClick={() => {
                  // TODO: Implementar generación automática de descripción
                  toast.info("Función de generar descripción próximamente");
                }}
              >
                Hacer descripción
              </Button>
            </div>

            {/* Traducciones - Siempre expandido */}
            <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground">Traducciones</p>
              
              {/* Inglés */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">🇬🇧 Inglés</Label>
                <Input 
                  value={formData.titulo_en} 
                  onChange={(e) => handleInputChange('titulo_en', e.target.value)}
                  placeholder="Title (English)"
                  className="h-8 text-sm"
                />
                <Textarea 
                  value={formData.descripcion_en} 
                  onChange={(e) => handleInputChange('descripcion_en', e.target.value)}
                  placeholder="Description (English)"
                  className="min-h-12 resize-none text-sm"
                />
              </div>
              
              {/* Francés */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">🇫🇷 Francés</Label>
                <Input 
                  value={formData.titulo_fr} 
                  onChange={(e) => handleInputChange('titulo_fr', e.target.value)}
                  placeholder="Titre (Français)"
                  className="h-8 text-sm"
                />
                <Textarea 
                  value={formData.descripcion_fr} 
                  onChange={(e) => handleInputChange('descripcion_fr', e.target.value)}
                  placeholder="Description (Français)"
                  className="min-h-12 resize-none text-sm"
                />
              </div>
            </div>

            {/* Imagen */}
            <div className="space-y-1.5">
              <Label className="text-xs">Imagen</Label>
              <div className="flex gap-2">
                <Input 
                  value={formData.imagen_url} 
                  onChange={(e) => handleInputChange('imagen_url', e.target.value)}
                  placeholder="URL de la imagen"
                  className="h-9 flex-1"
                />
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-9"
                >
                  {uploading ? (
                    <span className="animate-spin">⏳</span>
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {formData.imagen_url && (
                <div className="mt-2 relative w-24 h-16 rounded overflow-hidden border">
                  <img src={formData.imagen_url} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>

            {/* Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha inicio</Label>
                <Input 
                  type="date"
                  value={formData.fecha_inicio} 
                  onChange={(e) => handleInputChange('fecha_inicio', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha fin (opcional)</Label>
                <Input 
                  type="date"
                  value={formData.fecha_fin} 
                  onChange={(e) => handleInputChange('fecha_fin', e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {/* Switches */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch 
                  checked={formData.activo} 
                  onCheckedChange={(v) => handleInputChange('activo', v)}
                />
                <Label className="text-sm">Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch 
                  checked={formData.destacado} 
                  onCheckedChange={(v) => handleInputChange('destacado', v)}
                />
                <Label className="text-sm">Destacado</Label>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handlePreview} className="flex-1">
                <Eye className="w-4 h-4 mr-1" />
                Vista previa
              </Button>
              <Button size="sm" onClick={handleSubmit} className="flex-1">
                <Save className="w-4 h-4 mr-1" />
                Guardar
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
