import { useState, useMemo, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EditorNovedadesWeb } from "@/components/gestion-web/EditorNovedadesWeb";
import { MobilePreview, type NovedadPreview } from "@/components/gestion-web/MobilePreview";
import { useNovedades } from "@/hooks/useNovedades";

export default function GestionWeb() {
  const [previewNovedad, setPreviewNovedad] = useState<NovedadPreview | null>(null);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const { novedades } = useNovedades();

  const handlePreviewListChange = useCallback((ids: string[]) => {
    setPreviewIds(ids);
  }, []);

  // Convertir novedades seleccionadas al formato de preview
  const novedadesParaPreview = useMemo(() => {
    return (novedades || [])
      .filter(n => previewIds.includes(n.id))
      .map(n => ({
        id: n.id,
        titulo: n.titulo,
        descripcion: n.descripcion || "",
        imagen_url: n.imagen_url,
        badge_text: n.badge_text,
        icono: n.icono,
        destacado: n.destacado,
      }));
  }, [novedades, previewIds]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestor Web</h2>
          <p className="text-muted-foreground">
            Prepara las novedades y contenido que aparecerá en la web pública
          </p>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Editor - 3 columnas */}
          <div className="lg:col-span-3">
            <EditorNovedadesWeb 
              onPreview={setPreviewNovedad} 
              onPreviewListChange={handlePreviewListChange}
            />
          </div>
          
          {/* Preview móvil - 2 columnas */}
          <div className="lg:col-span-2">
            <div className="sticky top-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4 text-center">
                Vista previa móvil
              </h3>
              <MobilePreview 
                novedades={novedadesParaPreview} 
                previewNovedad={previewNovedad}
              />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
