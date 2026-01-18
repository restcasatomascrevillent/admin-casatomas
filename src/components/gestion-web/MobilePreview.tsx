import { useState } from "react";
import { Wine, UtensilsCrossed, Gift, Calendar, Star, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface NovedadPreview {
  id?: string;
  titulo: string;
  descripcion: string;
  titulo_en?: string | null;
  descripcion_en?: string | null;
  titulo_fr?: string | null;
  descripcion_fr?: string | null;
  imagen_url?: string | null;
  imagen_posicion_y?: number | null;
  badge_text?: string | null;
  badge_text_en?: string | null;
  badge_text_fr?: string | null;
  icono?: string | null;
  destacado?: boolean;
  bullets?: string[];
  bullets_en?: string[] | null;
  bullets_fr?: string[] | null;
  tags?: string[];
  tags_en?: string[] | null;
  tags_fr?: string[] | null;
}

interface MobilePreviewProps {
  novedades: NovedadPreview[];
  previewNovedad?: NovedadPreview | null;
}

type Idioma = "es" | "en" | "fr";

const getTextoIdioma = (novedad: NovedadPreview, idioma: Idioma) => {
  switch (idioma) {
    case "en":
      return {
        titulo: novedad.titulo_en || novedad.titulo,
        descripcion: novedad.descripcion_en || novedad.descripcion,
        badge_text: novedad.badge_text_en || novedad.badge_text,
        bullets: novedad.bullets_en || novedad.bullets || [],
        tags: novedad.tags_en || novedad.tags || [],
      };
    case "fr":
      return {
        titulo: novedad.titulo_fr || novedad.titulo,
        descripcion: novedad.descripcion_fr || novedad.descripcion,
        badge_text: novedad.badge_text_fr || novedad.badge_text,
        bullets: novedad.bullets_fr || novedad.bullets || [],
        tags: novedad.tags_fr || novedad.tags || [],
      };
    default:
      return {
        titulo: novedad.titulo,
        descripcion: novedad.descripcion,
        badge_text: novedad.badge_text,
        bullets: novedad.bullets || [],
        tags: novedad.tags || [],
      };
  }
};
const ICONOS_MAP: Record<string, React.ComponentType<{
  className?: string;
}>> = {
  utensils: UtensilsCrossed,
  wine: Wine,
  gift: Gift,
  calendar: Calendar,
  star: Star,
  sparkles: Sparkles
};
export function MobilePreview({
  novedades,
  previewNovedad
}: MobilePreviewProps) {
  const [idioma, setIdioma] = useState<Idioma>("es");
  
  // Si hay una novedad en preview, mostrarla primero
  const todasNovedades = previewNovedad ? [{
    ...previewNovedad,
    id: 'preview'
  }, ...novedades.filter(n => n.id !== previewNovedad.id)] : novedades;
  
  return <div className="flex flex-col items-center gap-3">
      {/* Selector de idioma */}
      <ToggleGroup 
        type="single" 
        value={idioma} 
        onValueChange={(v) => v && setIdioma(v as Idioma)}
        className="bg-muted rounded-lg p-1"
      >
        <ToggleGroupItem value="es" className="text-base px-2 py-1 data-[state=on]:bg-background">
          🇪🇸
        </ToggleGroupItem>
        <ToggleGroupItem value="en" className="text-base px-2 py-1 data-[state=on]:bg-background">
          🇬🇧
        </ToggleGroupItem>
        <ToggleGroupItem value="fr" className="text-base px-2 py-1 data-[state=on]:bg-background">
          🇫🇷
        </ToggleGroupItem>
      </ToggleGroup>
      
      {/* Marco del teléfono */}
      <div className="relative w-[320px] h-[640px] bg-zinc-900 rounded-[3rem] p-2 shadow-2xl">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-zinc-900 rounded-b-2xl z-10" />
        
        {/* Pantalla */}
        <div className="w-full h-full bg-background rounded-[2.5rem] overflow-hidden relative">
          {/* Barra de estado */}
          <div className="h-8 bg-zinc-900 flex items-center justify-center">
            <div className="w-20 h-5 bg-zinc-800 rounded-full" />
          </div>
          
          {/* Contenido scrolleable */}
          <div className="h-[calc(100%-2rem)] overflow-y-auto px-3 py-4 space-y-4">
            {/* Header */}
            <div className="text-center space-y-1 mb-4">
              <h2 className="text-lg font-bold text-foreground">
                {idioma === "en" ? "What's New" : idioma === "fr" ? "Nouveautés" : "Novedades"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {idioma === "en" 
                  ? "New additions and experiences we want to share" 
                  : idioma === "fr" 
                    ? "Nouvelles incorporations et expériences à partager" 
                    : "Nuevas incorporaciones y experiencias que queremos compartir"}
              </p>
            </div>

            {/* Cards de novedades */}
            {todasNovedades.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">
                {idioma === "en" ? "No news to show" : idioma === "fr" ? "Aucune nouveauté à afficher" : "No hay novedades para mostrar"}
              </div> : <div className="space-y-3">
                {todasNovedades.map((novedad, index) => {
              const IconComponent = ICONOS_MAP[novedad.icono || 'utensils'] || UtensilsCrossed;
              const isPreview = novedad.id === 'preview';
              const textos = getTextoIdioma(novedad, idioma);
              return <Card key={novedad.id || index} className={`overflow-hidden transition-all duration-300 ${isPreview ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
                      {novedad.imagen_url && <div className="relative h-24 overflow-hidden">
                          <img src={novedad.imagen_url} alt={textos.titulo} className="w-full h-full object-cover" style={{ objectPosition: `center ${novedad.imagen_posicion_y ?? 50}%` }} />
                          {isPreview && <div className="absolute top-1 right-1">
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                Preview
                              </Badge>
                            </div>}
                        </div>}
                      <CardHeader className="p-2 pb-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="p-1 rounded-full bg-accent/20">
                            <IconComponent className="w-3 h-3 text-accent" />
                          </div>
                          <Badge className="text-[10px] px-1.5 py-0 bg-accent text-primary-foreground hover:bg-accent/90 border-0">
                              {textos.badge_text || (idioma === "en" ? "New" : idioma === "fr" ? "Nouveau" : "Nuevo")}
                            </Badge>
                        </div>
                        <CardTitle className="text-sm font-semibold leading-tight">
                          {textos.titulo || (idioma === "en" ? "No title" : idioma === "fr" ? "Sans titre" : "Sin título")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-2 pt-0 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {textos.descripcion || (idioma === "en" ? "No description" : idioma === "fr" ? "Sans description" : "Sin descripción")}
                        </p>
                        
                        {/* Puntos destacados (bullets) */}
                        {textos.bullets && textos.bullets.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {textos.bullets.map((bullet, i) => (
                              <Badge 
                                key={i} 
                                variant="secondary" 
                                className="text-[8px] px-1.5 py-0.5 h-auto font-normal"
                              >
                                {bullet}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        {/* Etiquetas (tags) */}
                        {textos.tags && textos.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {textos.tags.map((tag, i) => (
                              <Badge 
                                key={i} 
                                variant="outline" 
                                className="text-[8px] px-1 py-0 h-4 bg-muted/50"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>;
            })}
              </div>}
          </div>
        </div>
      </div>
    </div>;
}