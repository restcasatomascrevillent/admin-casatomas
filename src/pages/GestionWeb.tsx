import { useState, useMemo, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EditorNovedadesWeb } from "@/components/gestion-web/EditorNovedadesWeb";
import { EditorMenuTapasWeb } from "@/components/gestion-web/EditorMenuTapasWeb";
import { MobilePreview, type NovedadPreview } from "@/components/gestion-web/MobilePreview";
import { useNovedades, type Novedad } from "@/hooks/useNovedades";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type GestionWebTab = "novedades" | "menus_diarios" | "tapas";

const SECCIONES_DB: Record<GestionWebTab, string> = {
  novedades: "gestion_web_novedades",
  menus_diarios: "gestion_web_menus_diarios",
  tapas: "gestion_web_tapas",
};

const perteneceASeccion = (novedad: Novedad, seccion: GestionWebTab): boolean => {
  if (novedad.tipo !== "anuncio") {
    return false;
  }

  if (seccion === "novedades") {
    // Compatibilidad con datos anteriores que no tenían sección asignada.
    return !novedad.seccion || novedad.seccion === SECCIONES_DB.novedades;
  }

  return novedad.seccion === SECCIONES_DB[seccion];
};

export default function GestionWeb() {
  const [previewNovedad, setPreviewNovedad] = useState<NovedadPreview | null>(null);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [seccionActiva, setSeccionActiva] = useState<GestionWebTab>("novedades");
  const { novedades } = useNovedades();
  const mostrarPreviewTelefono = seccionActiva === "novedades";

  const handlePreviewListChange = useCallback((ids: string[]) => {
    setPreviewIds(ids);
  }, []);

  const novedadesDeSeccion = useMemo(() => {
    return (novedades || []).filter((novedad) => perteneceASeccion(novedad, seccionActiva));
  }, [novedades, seccionActiva]);

  // Convertir novedades seleccionadas al formato de preview
  const novedadesParaPreview = useMemo(() => {
    return novedadesDeSeccion
      .filter(n => previewIds.includes(n.id))
      .map(n => ({
        id: n.id,
        titulo: n.titulo,
        descripcion: n.descripcion || "",
        titulo_en: n.titulo_en,
        descripcion_en: n.descripcion_en,
        titulo_fr: n.titulo_fr,
        descripcion_fr: n.descripcion_fr,
        imagen_url: n.imagen_url,
        imagen_posicion_y: n.imagen_posicion_y,
        badge_text: n.badge_text,
        badge_text_en: n.badge_text_en,
        badge_text_fr: n.badge_text_fr,
        icono: n.icono,
        destacado: n.destacado,
        bullets: n.bullets || [],
        bullets_en: n.bullets_en,
        bullets_fr: n.bullets_fr,
        tags: n.tags || [],
        tags_en: n.tags_en,
        tags_fr: n.tags_fr,
      }));
  }, [novedadesDeSeccion, previewIds]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestor Web</h2>
          <p className="text-muted-foreground">
            Prepara las novedades y contenido que aparecerá en la web pública
          </p>
        </div>

        <Tabs
          value={seccionActiva}
          onValueChange={(value) => {
            setSeccionActiva(value as GestionWebTab);
            setPreviewIds([]);
            setPreviewNovedad(null);
          }}
        >
          <TabsList className="grid w-full grid-cols-3 max-w-xl">
            <TabsTrigger value="novedades">Novedades</TabsTrigger>
            <TabsTrigger value="menus_diarios">Menús diarios</TabsTrigger>
            <TabsTrigger value="tapas">Tapas</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className={mostrarPreviewTelefono ? "grid grid-cols-1 lg:grid-cols-5 gap-6" : "grid grid-cols-1 gap-6"}>
          {/* Editor - 3 columnas */}
          <div className={mostrarPreviewTelefono ? "lg:col-span-3" : ""}>
            {seccionActiva === "novedades" ? (
              <EditorNovedadesWeb
                key={seccionActiva}
                seccionActiva={seccionActiva}
                onPreview={setPreviewNovedad}
                onPreviewListChange={handlePreviewListChange}
              />
            ) : (
              <EditorMenuTapasWeb
                key={seccionActiva}
                seccionActiva={seccionActiva}
              />
            )}
          </div>
          
          {/* Preview móvil - 2 columnas */}
          {mostrarPreviewTelefono && (
            <div className="lg:col-span-2">
              <div className="sticky top-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-4 text-center">
                  Vista previa móvil
                </h3>
                <MobilePreview
                  novedades={novedadesParaPreview}
                  previewNovedad={previewNovedad}
                  seccionActiva={seccionActiva}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
