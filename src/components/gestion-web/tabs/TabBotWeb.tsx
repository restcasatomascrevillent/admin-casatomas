import { useEffect, useMemo, useRef, useState } from "react";
import { CabeceraPestana } from "@/components/gestion-web/CabeceraPestana";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Eye, Loader2, RefreshCw } from "lucide-react";
import {
  configToDraft,
  draftToUpdate,
  draftsIguales,
  useConfigBotWeb,
  type DraftBotWeb,
  type IdiomaBotWeb,
} from "@/hooks/useConfigBotWeb";
import { usePlatos } from "@/hooks/usePlatos";
import { useVinos } from "@/hooks/useVinos";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { IDIOMAS } from "@/components/bot/constantesBot";
import { BotIdiomaPanel } from "@/components/bot/BotIdiomaPanel";

type DraftsPorIdioma = Record<IdiomaBotWeb, DraftBotWeb>;

export default function TabBotWeb() {
  const { canAccess: canEdit } = useCanAccessSection("gestion_bot", "edit");
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

  // Listas de la carta real — compartidas por los 3 idiomas (son el mismo
  // restaurante); solo cambia qué nombres están marcados en cada borrador.
  const platosActivos = useMemo(() => {
    const items = (platos || []).filter((p) => p.activado !== false && p.nombre);
    if (!buscarPlato) return items;
    const q = buscarPlato.toLowerCase();
    return items.filter((p) => p.nombre?.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q));
  }, [platos, buscarPlato]);

  const platosPorCategoria = useMemo(() => {
    const map: Record<string, typeof platosActivos> = {};
    platosActivos.forEach((p) => {
      const cat = p.categoria || "Sin categoría";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    return map;
  }, [platosActivos]);

  const vinosActivos = useMemo(() => {
    const items = (vinos || []).filter((v) => v.activado !== false && v.nombre);
    if (!buscarVino) return items;
    const q = buscarVino.toLowerCase();
    return items.filter((v) => v.nombre?.toLowerCase().includes(q) || v.categoria?.toLowerCase().includes(q));
  }, [vinos, buscarVino]);

  const vinosPorCategoria = useMemo(() => {
    const map: Record<string, typeof vinosActivos> = {};
    vinosActivos.forEach((v) => {
      const cat = v.categoria || "Sin categoría";
      if (!map[cat]) map[cat] = [];
      map[cat].push(v);
    });
    return map;
  }, [vinosActivos]);

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

  return (
      <div className="space-y-6">
        <CabeceraPestana
          titulo="Bot web"
          descripcion={
            <>
              Cómo se comporta el chatbot de la web — estás editando la versión en{" "}
              <span className="font-medium text-foreground">{idiomaActivo.label}</span>.
            </>
          }
        />

        {!canEdit && (
          <Alert>
            <Eye className="h-4 w-4" />
            <AlertTitle>Modo solo lectura</AlertTitle>
            <AlertDescription>
              Puedes consultar la configuración de los 3 idiomas y la vista previa, pero tu usuario no tiene
              permiso para guardar cambios en esta sección.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeIdioma} onValueChange={(v) => setActiveIdioma(v as IdiomaBotWeb)}>
          <TabsList className="w-full sm:w-auto bg-muted/80 p-1.5 h-auto gap-1 flex-wrap">
            {IDIOMAS.map((i) => (
              <TabsTrigger
                key={i.value}
                value={i.value}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all"
              >
                <span>{i.flag}</span>
                <span>{i.label}</span>
                {isDirty(i.value) && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    title="Tiene cambios sin guardar"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {IDIOMAS.map((i) => (
            <TabsContent key={i.value} value={i.value} className="mt-6">
              <BotIdiomaPanel
                idioma={i.value}
                draft={drafts[i.value]}
                draftEspañol={drafts.es}
                canEdit={canEdit}
                dirty={isDirty(i.value)}
                saving={savingIdioma === i.value}
                saveError={saveErrors[i.value]}
                onChange={(patch) => updateDraft(i.value, patch)}
                onTogglePlato={(nombre) => togglePlato(i.value, nombre)}
                onToggleVino={(nombre) => toggleVino(i.value, nombre)}
                onSave={() => handleSave(i.value)}
                platosPorCategoria={platosPorCategoria}
                vinosPorCategoria={vinosPorCategoria}
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
      </div>
  );
}
