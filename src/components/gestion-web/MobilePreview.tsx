import { useState } from "react";
import { Wine, UtensilsCrossed, Gift, Calendar, Star, Sparkles, Coffee, Cake, ImageIcon, EyeOff, Phone, BookOpen, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { NOVEDAD_CARD_IMAGE_ASPECT_RATIO } from "./previewConstants";
import { ETIQUETA_BOTON, ETIQUETA_BOTON_IDIOMA, botonesVisiblesEnWeb, type TipoBoton } from "@/lib/menu-novedad";

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
  /** Solo para el borrador: motivo por el que NO se vería en la web todavía. */
  avisoVisibilidad?: string | null;
  /** Botones al pie de la tarjeta, en su orden. Sin ellos la tarjeta es la de siempre. */
  botones?: TipoBoton[];
  /** El plato de «Échale un vistazo» está en la carta (si no, la web oculta el botón). */
  platoEnCarta?: boolean;
  /**
   * «Ver menú» tiene qué enseñar (`menuPintable`): un Menú con algún plato o
   * una Cata con alguna bebida. Si no, la web oculta el botón.
   */
  menuConPlatos?: boolean;
}

interface MobilePreviewProps {
  /** Tarjetas en el orden en que las mostraría la web pública. */
  novedades: NovedadPreview[];
  /** id de la tarjeta que se está editando (se resalta). */
  idResaltado?: string | null;
}

type Idioma = "es" | "en" | "fr";

const IDIOMAS: { value: Idioma; label: string; nombre: string }[] = [
  { value: "es", label: "ES", nombre: "Español" },
  { value: "en", label: "EN", nombre: "Inglés" },
  { value: "fr", label: "FR", nombre: "Francés" },
];

// Mismo criterio que getLocalizedContent() de casa-tomas-story
// (NovedadesSection.tsx): si falta la traducción se cae al español.
const getTextoIdioma = (novedad: NovedadPreview, idioma: Idioma) => {
  const sufijo = idioma === "es" ? null : idioma;
  const pick = <T,>(es: T, en: T | null | undefined, fr: T | null | undefined): T =>
    (sufijo === "en" ? en || es : sufijo === "fr" ? fr || es : es) as T;
  return {
    titulo: pick(novedad.titulo, novedad.titulo_en, novedad.titulo_fr),
    descripcion: pick(novedad.descripcion, novedad.descripcion_en, novedad.descripcion_fr),
    badge: pick(novedad.badge_text || "", novedad.badge_text_en, novedad.badge_text_fr),
    bullets: pick(novedad.bullets || [], novedad.bullets_en?.length ? novedad.bullets_en : null, novedad.bullets_fr?.length ? novedad.bullets_fr : null),
    tags: pick(novedad.tags || [], novedad.tags_en?.length ? novedad.tags_en : null, novedad.tags_fr?.length ? novedad.tags_fr : null),
  };
};

const ICONOS_BOTON: Record<TipoBoton, React.ComponentType<{ className?: string }>> = {
  llamar: Phone,
  ver_menu: BookOpen,
  ver_plato: Eye,
};

// Mismos iconos (y mismo icono por defecto: estrella) que la web pública.
const ICONOS_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  utensils: UtensilsCrossed,
  wine: Wine,
  gift: Gift,
  calendar: Calendar,
  star: Star,
  sparkles: Sparkles,
  coffee: Coffee,
  cake: Cake,
};

// Textos reales de la sección en casa-tomas-story/src/i18n/languages/*.ts
const TEXTOS_SECCION: Record<Idioma, { titulo: string; subtitulo: string; vacio: string }> = {
  es: {
    titulo: "Novedades",
    subtitulo: "Nuevas incorporaciones y experiencias que queremos compartir",
    vacio: "No hay novedades en este momento",
  },
  en: {
    titulo: "What's New",
    subtitulo: "Fresh additions and experiences we're excited to share",
    vacio: "No highlights at the moment",
  },
  fr: {
    titulo: "Nouveautés",
    subtitulo: "Nos dernières créations et expériences à découvrir",
    vacio: "Aucune nouveauté pour le moment",
  },
};

/**
 * Réplica en miniatura de la sección «Novedades» de la web de Casa Tomás
 * (casa-tomas-story/src/components/NovedadesSection.tsx) tal y como se ve en
 * un móvil: una tarjeta por fila, foto de 176px de alto, badge solo si hay
 * texto, puntos destacados como lista, etiquetas como chips y, si los tiene,
 * los botones al pie (solo los que la web pintaría).
 */
export function MobilePreview({ novedades, idResaltado }: MobilePreviewProps) {
  const [idioma, setIdioma] = useState<Idioma>("es");
  const textos = TEXTOS_SECCION[idioma];

  return (
    <div className="flex flex-col items-center gap-3">
      <ToggleGroup
        type="single"
        value={idioma}
        onValueChange={(v) => v && setIdioma(v as Idioma)}
        className="bg-muted rounded-lg p-1"
        aria-label="Idioma de la vista previa"
      >
        {IDIOMAS.map((i) => (
          <ToggleGroupItem
            key={i.value}
            value={i.value}
            aria-label={i.nombre}
            title={i.nombre}
            className="h-11 min-w-11 px-4 text-sm font-semibold text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {i.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Marco del teléfono */}
      <div className="relative w-[320px] h-[640px] max-w-full bg-zinc-900 rounded-[3rem] p-2 shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-zinc-900 rounded-b-2xl z-10" />

        <div className="w-full h-full bg-background rounded-[2.5rem] overflow-hidden relative">
          <div className="h-8 bg-zinc-900 flex items-center justify-center">
            <div className="w-20 h-5 bg-zinc-800 rounded-full" />
          </div>

          <div className="h-[calc(100%-2rem)] overflow-y-auto px-4 py-5 space-y-4">
            <div className="text-center space-y-1 mb-5">
              <h2 className="text-2xl font-bold text-primary">{textos.titulo}</h2>
              <p className="text-xs text-muted-foreground">{textos.subtitulo}</p>
            </div>

            {novedades.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{textos.vacio}</div>
            ) : (
              <div className="space-y-4">
                {novedades.map((novedad, index) => {
                  const IconComponent = ICONOS_MAP[novedad.icono || "star"] || Star;
                  const resaltado = !!idResaltado && novedad.id === idResaltado;
                  const t = getTextoIdioma(novedad, idioma);
                  const botones = novedad.botones ?? [];
                  const botonesVisibles = botonesVisiblesEnWeb(botones, {
                    platoEnCarta: !!novedad.platoEnCarta,
                    menuConPlatos: !!novedad.menuConPlatos,
                  });
                  const botonesOcultos = botones.filter((b) => !botonesVisibles.includes(b));
                  return (
                    <Card
                      key={novedad.id || index}
                      className={`overflow-hidden border border-border/70 bg-gradient-to-br from-background via-muted/40 to-background transition-shadow ${
                        resaltado ? "ring-2 ring-primary ring-offset-2" : ""
                      }`}
                    >
                      <AspectRatio ratio={NOVEDAD_CARD_IMAGE_ASPECT_RATIO} className="relative overflow-hidden bg-muted/40">
                        {novedad.imagen_url ? (
                          <img
                            src={novedad.imagen_url}
                            alt={t.titulo}
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ objectPosition: `center ${novedad.imagen_posicion_y ?? 50}%` }}
                          />
                        ) : (
                          // La web pública rellena el hueco con una foto genérica
                          // del restaurante (pulpo / carne / champán) si no hay imagen.
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                            <ImageIcon className="w-5 h-5" />
                            <span className="text-[10px]">Sin foto: la web pondrá una genérica</span>
                          </div>
                        )}
                        {resaltado && (
                          <Badge className="absolute top-2 left-2 text-[10px] px-1.5 py-0">Editando</Badge>
                        )}
                      </AspectRatio>
                      {resaltado && novedad.avisoVisibilidad && (
                        <div className="flex items-center gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-[10px] px-3 py-1">
                          <EyeOff className="w-3 h-3 shrink-0" />
                          {novedad.avisoVisibilidad}
                        </div>
                      )}
                      {resaltado && botonesOcultos.length > 0 && (
                        <div className="flex items-center gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-[10px] px-3 py-1">
                          <EyeOff className="w-3 h-3 shrink-0" />
                          No saldrá en la web: {botonesOcultos.map((b) => `«${ETIQUETA_BOTON[b]}»`).join(" y ")}
                        </div>
                      )}
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-start justify-between mb-1">
                          <div className="p-2 bg-accent/10 rounded-lg">
                            <IconComponent className="w-5 h-5 text-accent" />
                          </div>
                          {t.badge && <Badge className="bg-accent hover:bg-accent/90 text-[10px]">{t.badge}</Badge>}
                        </div>
                        <CardTitle className="text-base leading-snug">
                          {t.titulo || <span className="text-muted-foreground italic">Sin título</span>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 space-y-2">
                        {t.descripcion && (
                          <p className="text-muted-foreground text-xs leading-relaxed">{t.descripcion}</p>
                        )}
                        {t.bullets.length > 0 && (
                          <ul className="space-y-0.5 text-xs text-muted-foreground">
                            {t.bullets.map((item, i) => (
                              <li key={i} className="flex gap-1.5 items-start">
                                <span className="text-primary">•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {t.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {t.tags.map((tag, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {/* Al pie, como en la web: lado a lado si caben y, si no,
                            apilados a todo el ancho. En la vista previa no se pulsan. */}
                        {botonesVisibles.length > 0 && (
                          <ul className="flex flex-wrap gap-2 pt-2" aria-label="Botones de la tarjeta" data-testid="botones-tarjeta">
                            {botonesVisibles.map((tipo, i) => {
                              const Icono = ICONOS_BOTON[tipo];
                              return (
                                <li
                                  key={tipo}
                                  data-boton={tipo}
                                  className={`flex min-h-9 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${
                                    i === 0
                                      ? "bg-primary text-primary-foreground"
                                      : "border border-primary/40 bg-background text-primary"
                                  }`}
                                >
                                  <Icono className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  {ETIQUETA_BOTON_IDIOMA[idioma][tipo]}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
