import { Wine, UtensilsCrossed, Gift, Calendar, Star, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
export interface NovedadPreview {
  id?: string;
  titulo: string;
  descripcion: string;
  imagen_url?: string | null;
  badge_text?: string | null;
  icono?: string | null;
  destacado?: boolean;
}
interface MobilePreviewProps {
  novedades: NovedadPreview[];
  previewNovedad?: NovedadPreview | null;
}
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
  // Si hay una novedad en preview, mostrarla primero
  const todasNovedades = previewNovedad ? [{
    ...previewNovedad,
    id: 'preview'
  }, ...novedades.filter(n => n.id !== previewNovedad.id)] : novedades;
  return <div className="flex justify-center">
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
              <h2 className="text-lg font-bold text-foreground">Novedades</h2>
              <p className="text-xs text-muted-foreground">Nuevas incorporaciones y experiencias que queremos compartir       </p>
            </div>

            {/* Cards de novedades */}
            {todasNovedades.length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">
                No hay novedades para mostrar
              </div> : <div className="space-y-3">
                {todasNovedades.map((novedad, index) => {
              const IconComponent = ICONOS_MAP[novedad.icono || 'utensils'] || UtensilsCrossed;
              const isPreview = novedad.id === 'preview';
              return <Card key={novedad.id || index} className={`overflow-hidden transition-all duration-300 ${isPreview ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
                      {novedad.imagen_url && <div className="relative h-24 overflow-hidden">
                          <img src={novedad.imagen_url} alt={novedad.titulo} className="w-full h-full object-cover" />
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
                          {novedad.badge_text && <Badge className="text-[10px] px-1.5 py-0 bg-accent text-primary-foreground hover:bg-accent/90 border-0">
                              {novedad.badge_text}
                            </Badge>}
                        </div>
                        <CardTitle className="text-sm font-semibold leading-tight">
                          {novedad.titulo || "Sin título"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-2 pt-0">
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {novedad.descripcion || "Sin descripción"}
                        </p>
                      </CardContent>
                    </Card>;
            })}
              </div>}
          </div>
        </div>
      </div>
    </div>;
}