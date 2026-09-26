import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Loader2, RefreshCw, Save } from "lucide-react";
import {
  configToDraft,
  draftToUpdate,
  draftsIguales,
  useConfigBotWeb,
  type DraftBotWeb,
  type IdiomaBotWeb,
} from "@/hooks/useConfigBotWeb";
import { usePlatos, type Plato } from "@/hooks/usePlatos";
import { useVinos, type Vino } from "@/hooks/useVinos";
import { IDIOMAS, MAX_INSTRUCCIONES_EXTRA, detectaInfoContacto } from "@/components/bot/constantesBot";
import { BotIdiomaPanel } from "@/components/bot/BotIdiomaPanel";
import { EstadoGuardadoBadge } from "@/components/bot/EstadoGuardadoBadge";
import { SeccionProteccion } from "@/components/bot/SeccionProteccion";
import { cn } from "@/lib/utils";

type DraftsPorIdioma = Record<IdiomaBotWeb, DraftBotWeb>;

// usePlatos/useVinos hacen select("*"), así que las filas traen también las
// columnas traducidas aunque sus interfaces no las declaren.
type ConTraduccion = { nombre_en?: string | null; nombre_fr?: string | null };

// Mismo criterio que localizar() en supabase/functions/chat-web/index.ts: en
// en/fr se usa nombre_<idioma> si tiene contenido y si no, el nombre español.
// Así lo que se guarda en platos/vinos_recomendados coincide con los nombres
// que la herramienta del bot devuelve en ese idioma.
function nombreLocalizado(item: { nombre: string | null } & ConTraduccion, idioma: IdiomaBotWeb): string | null {
  if (idioma === "en" && item.nombre_en?.trim()) return item.nombre_en.trim();
  if (idioma === "fr" && item.nombre_fr?.trim()) return item.nombre_fr.trim();
  return item.nombre;
}

// Filtra por búsqueda (nombre localizado, nombre español o categoría),
// sustituye `nombre` por el localizado y agrupa por categoría.
function agruparLocalizado<T extends { nombre: string | null; categoria: string | null } & ConTraduccion>(
  items: T[],
  idioma: IdiomaBotWeb,
  buscar: string,
): Record<string, T[]> {
  const q = buscar.trim().toLowerCase();
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const nombre = nombreLocalizado(item, idioma);
    if (!nombre) continue;
    if (
      q &&
      !nombre.toLowerCase().includes(q) &&
      !item.nombre?.toLowerCase().includes(q) &&
      !item.categoria?.toLowerCase().includes(q)
    ) {
      continue;
    }
    const cat = item.categoria || "Sin categoría";
    (map[cat] ??= []).push({ ...item, nombre });
  }
  return map;
}

function porIdioma<T>(fn: (idioma: IdiomaBotWeb) => T): Record<IdiomaBotWeb, T> {
  return { es: fn("es"), en: fn("en"), fr: fn("fr") };
}

type EstadoIdioma = "cambios" | "error" | "incompleto" | "completo";

// Indicador por idioma en el selector: prioridad a lo accionable (sin
// guardar > error > le falta horario/contacto > todo bien). "incompleto" usa
// la misma heurística aproximada que el checklist de "Instrucciones extra".
const ESTADO_IDIOMA: Record<EstadoIdioma, { texto: string; punto: string }> = {
  cambios: { texto: "Cambios sin guardar", punto: "bg-amber-500" },
  error: { texto: "Error al guardar", punto: "bg-destructive" },
  incompleto: { texto: "Falta información básica", punto: "border-2 border-amber-500 bg-transparent" },
  completo: { texto: "Completo", punto: "bg-emerald-500" },
};

export default function TabBotWeb() {
  // Esta pestaña ahora solo cuelga de /super-admin/bot-web (SuperAdminRoute),
  // así que quien la vea ya es super admin: no hace falta comprobar el
  // permiso de edición de "gestion_bot", que dejó de existir como sección
  // asignable al mover el Bot Web al Super Admin.
  const canEdit = true;
  const { configs, isLoading, isError, error, refetch, updateConfig } = useConfigBotWeb();
  const { platos, isLoading: loadingPlatos } = usePlatos();
  const { vinos, isLoading: loadingVinos } = useVinos();

  const [activeIdioma, setActiveIdioma] = useState<IdiomaBotWeb>("es");
  const [drafts, setDrafts] = useState<DraftsPorIdioma | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<DraftsPorIdioma | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<IdiomaBotWeb, string | null>>({ es: null, en: null, fr: null });
  const [savingIdioma, setSavingIdioma] = useState<IdiomaBotWeb | null>(null);
  const [buscarPlato, setBuscarPlato] = useState("");
  const [buscarVino, setBuscarVino] = useState("");

  // Los borradores de los 3 idiomas se cargan UNA sola vez desde el
  // servidor y a partir de ahí viven solo en memoria: cambiar de pestaña ya
  // no dispara una recarga ni puede perder lo que llevabas escrito en la
  // otra — antes, al cambiar de idioma, el formulario se re-inicializaba
  // desde la query y cualquier cambio sin guardar en el idioma anterior
  // desaparecía sin avisar.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || isLoading) return;
    const inicial: DraftsPorIdioma = {
      es: configToDraft(configs.es),
      en: configToDraft(configs.en),
      fr: configToDraft(configs.fr),
    };
    setDrafts(inicial);
    setSavedBaseline(inicial);
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Aviso nativo del navegador si se intenta cerrar/recargar con cambios sin
  // guardar en cualquiera de los 3 idiomas.
  useEffect(() => {
    if (!drafts || !savedBaseline) return;
    const hayCambios = IDIOMAS.some((i) => !draftsIguales(drafts[i.value], savedBaseline[i.value]));
    if (!hayCambios) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [drafts, savedBaseline]);

  const isDirty = (idioma: IdiomaBotWeb) => {
    if (!drafts || !savedBaseline) return false;
    return !draftsIguales(drafts[idioma], savedBaseline[idioma]);
  };

  const estadoIdioma = (idioma: IdiomaBotWeb): EstadoIdioma => {
    if (isDirty(idioma)) return "cambios";
    if (saveErrors[idioma]) return "error";
    if (drafts && !detectaInfoContacto(drafts[idioma].instrucciones_extra).completa) return "incompleto";
    return "completo";
  };

  const updateDraft = (idioma: IdiomaBotWeb, patch: Partial<DraftBotWeb>) => {
    setDrafts((prev) => (prev ? { ...prev, [idioma]: { ...prev[idioma], ...patch } } : prev));
  };

  const togglePlato = (idioma: IdiomaBotWeb, nombre: string) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const actual = prev[idioma].platos;
      const platos = actual.includes(nombre) ? actual.filter((p) => p !== nombre) : [...actual, nombre];
      return { ...prev, [idioma]: { ...prev[idioma], platos } };
    });
  };

  const toggleVino = (idioma: IdiomaBotWeb, nombre: string) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const actual = prev[idioma].vinos;
      const vinos = actual.includes(nombre) ? actual.filter((v) => v !== nombre) : [...actual, nombre];
      return { ...prev, [idioma]: { ...prev[idioma], vinos } };
    });
  };

  const handleSave = async (idioma: IdiomaBotWeb) => {
    if (!drafts) return;
    if (drafts[idioma].instrucciones_extra.length > MAX_INSTRUCCIONES_EXTRA) {
      setSaveErrors((prev) => ({
        ...prev,
        [idioma]: `"Instrucciones extra" supera los ${MAX_INSTRUCCIONES_EXTRA} caracteres: recórtalo antes de guardar.`,
      }));
      return;
    }
    setSavingIdioma(idioma);
    setSaveErrors((prev) => ({ ...prev, [idioma]: null }));
    try {
      await updateConfig.mutateAsync({ idioma, updates: draftToUpdate(drafts[idioma]) });
      setSavedBaseline((prev) => (prev ? { ...prev, [idioma]: drafts[idioma] } : prev));
    } catch (e) {
      setSaveErrors((prev) => ({ ...prev, [idioma]: e instanceof Error ? e.message : "Error desconocido al guardar" }));
    } finally {
      setSavingIdioma((cur) => (cur === idioma ? null : cur));
    }
  };

  // Listas de la carta real — los mismos platos/vinos para los 3 idiomas,
  // pero en EN/FR se muestran y se guardan con su nombre traducido (ver
  // nombreLocalizado). ES queda igual que antes: `nombre`.
  const platosActivos = useMemo(
    () => ((platos || []) as (Plato & ConTraduccion)[]).filter((p) => p.activado !== false && p.nombre),
    [platos],
  );
  const vinosActivos = useMemo(
    () => ((vinos || []) as (Vino & ConTraduccion)[]).filter((v) => v.activado !== false && v.nombre),
    [vinos],
  );
  const platosPorIdioma = useMemo(
    () => porIdioma((idioma) => agruparLocalizado(platosActivos, idioma, buscarPlato)),
    [platosActivos, buscarPlato],
  );
  const vinosPorIdioma = useMemo(
    () => porIdioma((idioma) => agruparLocalizado(vinosActivos, idioma, buscarVino)),
    [vinosActivos, buscarVino],
  );

  if (isLoading || !drafts) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No se pudo cargar la configuración del bot</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error instanceof Error ? error.message : "Error desconocido al leer configBotWeb."}</p>
            <Button size="sm" variant="outline" className="bg-background" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
    );
  }

  const idiomaActivo = IDIOMAS.find((i) => i.value === activeIdioma)!;
  const dirtyActivo = isDirty(activeIdioma);
  const savingActivo = savingIdioma === activeIdioma;

  return (
    <div className="space-y-4">
      <Tabs
        value={activeIdioma}
        onValueChange={(v) => setActiveIdioma(v as IdiomaBotWeb)}
        className="space-y-4"
        onKeyDown={(e) => {
          // Ctrl/Cmd+S guarda el idioma activo en vez de abrir "Guardar página".
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (canEdit && dirtyActivo && !savingActivo) handleSave(activeIdioma);
          }
        }}
      >
        <h2 className="sr-only">Bot web</h2>

        {/* Barra de idioma + guardado. Pegada bajo la cabecera del layout
            (h-14 / sm:h-16) con fondo sólido y borde: no tapa contenido ni usa
            blur. Los márgenes negativos compensan el padding de <main>. */}
        <div className="sticky top-14 z-30 -mx-3 flex flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2 sm:top-16 sm:-mx-6 sm:px-6">
          <TabsList aria-label="Idioma del bot" className="h-9">
            {IDIOMAS.map((i) => {
              const estado = ESTADO_IDIOMA[estadoIdioma(i.value)];
              return (
                <TabsTrigger key={i.value} value={i.value} className="gap-2 px-3" title={`${i.label}: ${estado.texto}`}>
                  <span className="font-semibold uppercase">{i.value}</span>
                  <span className="hidden text-muted-foreground sm:inline">{i.label}</span>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", estado.punto)} aria-hidden="true" />
                  <span className="sr-only">({estado.texto})</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {canEdit && (
            <div className="flex items-center gap-2" aria-live="polite">
              <EstadoGuardadoBadge dirty={dirtyActivo} saving={savingActivo} error={saveErrors[activeIdioma]} />
              <Button
                size="sm"
                onClick={() => handleSave(activeIdioma)}
                disabled={savingActivo || !dirtyActivo}
                aria-label={`Guardar cambios en ${idiomaActivo.label}`}
                title="Guardar (Ctrl+S)"
              >
                {savingActivo ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                Guardar
              </Button>
            </div>
          )}
        </div>

        {IDIOMAS.map((i) => (
          <TabsContent key={i.value} value={i.value} className="mt-0">
            <BotIdiomaPanel
              idioma={i.value}
              draft={drafts[i.value]}
              draftEspañol={drafts.es}
              canEdit={canEdit}
              onChange={(patch) => updateDraft(i.value, patch)}
              onTogglePlato={(nombre) => togglePlato(i.value, nombre)}
              onToggleVino={(nombre) => toggleVino(i.value, nombre)}
              platosPorCategoria={platosPorIdioma[i.value]}
              vinosPorCategoria={vinosPorIdioma[i.value]}
              loadingPlatos={loadingPlatos}
              loadingVinos={loadingVinos}
              buscarPlato={buscarPlato}
              buscarVino={buscarVino}
              onBuscarPlatoChange={setBuscarPlato}
              onBuscarVinoChange={setBuscarVino}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Global (no depende del idioma): interruptor, consumo y límites. Fuera
          de <Tabs> para que Ctrl+S y la barra de guardado por idioma no le
          afecten — tiene su propio botón "Guardar límites". */}
      <SeccionProteccion />
    </div>
  );
}
