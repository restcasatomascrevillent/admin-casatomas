import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, RefreshCw, Save } from "lucide-react";
import {
  configToDraft,
  draftToUpdate,
  draftsIguales,
  useConfigBotWeb,
  type DraftBotWeb,
} from "@/hooks/useConfigBotWeb";
import { useTraduccionBotWeb } from "@/hooks/useTraduccionBotWeb";
import { usePlatos, type Plato } from "@/hooks/usePlatos";
import { useVinos, type Vino } from "@/hooks/useVinos";
import { MAX_INSTRUCCIONES_EXTRA } from "@/components/bot/constantesBot";
import { BotIdiomaPanel } from "@/components/bot/BotIdiomaPanel";
import { EstadoGuardadoBadge } from "@/components/bot/EstadoGuardadoBadge";
import { EstadoTraduccionBadges } from "@/components/bot/EstadoTraduccionBadges";
import { TraduccionesBot } from "@/components/bot/TraduccionesBot";
import { VistaPreviaBot } from "@/components/bot/VistaPreviaBot";
import { SeccionProteccion } from "@/components/bot/SeccionProteccion";
import type { CatalogosCarta, ConTraduccion } from "@/components/bot/traduccionBot";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la pestaña: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y vuelve el scroll de página.
 */
const ALTURA_MINIMA_BOT_WEB = 360;

// Filtra por búsqueda (nombre o categoría) y agrupa por categoría. La
// selección se hace con los nombres ESPAÑOLES; EN/FR los mapean a
// nombre_en/nombre_fr de la carta al traducir (traduccionBot.mapearNombres).
function agruparPorCategoria<T extends { nombre: string | null; categoria: string | null }>(
  items: T[],
  buscar: string,
): Record<string, T[]> {
  const q = buscar.trim().toLowerCase();
  const map: Record<string, T[]> = {};
  for (const item of items) {
    if (!item.nombre) continue;
    if (q && !item.nombre.toLowerCase().includes(q) && !item.categoria?.toLowerCase().includes(q)) continue;
    const cat = item.categoria || "Sin categoría";
    (map[cat] ??= []).push(item);
  }
  return map;
}

export default function TabBotWeb() {
  // Esta pestaña ahora solo cuelga de /super-admin/bot-web (SuperAdminRoute),
  // así que quien la vea ya es super admin: no hace falta comprobar el
  // permiso de edición de "gestion_bot", que dejó de existir como sección
  // asignable al mover el Bot Web al Super Admin.
  const canEdit = true;
  const { configs, isLoading, isError, error, refetch, updateConfig } = useConfigBotWeb();
  const traduccion = useTraduccionBotWeb();
  const { platos, isLoading: loadingPlatos } = usePlatos();
  const { vinos, isLoading: loadingVinos } = useVinos();

  // Solo se edita el español; EN/FR se traducen al guardar.
  const [draft, setDraft] = useState<DraftBotWeb | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<DraftBotWeb | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errorTraduccion, setErrorTraduccion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [buscarPlato, setBuscarPlato] = useState("");
  const [buscarVino, setBuscarVino] = useState("");
  // Alto de la pantalla (regla del dueño, 2026-10-07): la pestaña mide lo que
  // queda bajo la cabecera del layout; la barra de guardado queda fija arriba y
  // el resto hace scroll en su región. Sin medida (jsdom, primer pintado) cae al
  // layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_BOT_WEB);

  // El borrador se carga UNA sola vez desde el servidor: los refetch
  // posteriores (p. ej. tras traducir) no pisan lo que se esté escribiendo.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || isLoading) return;
    const inicial = configToDraft(configs.es);
    setDraft(inicial);
    setSavedBaseline(inicial);
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const dirty = !!draft && !!savedBaseline && !draftsIguales(draft, savedBaseline);

  // Aviso nativo del navegador si se intenta cerrar/recargar con cambios sin
  // guardar en el español.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const updateDraft = (patch: Partial<DraftBotWeb>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleEn = (campo: "platos" | "vinos", nombre: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const actual = prev[campo];
      return { ...prev, [campo]: actual.includes(nombre) ? actual.filter((n) => n !== nombre) : [...actual, nombre] };
    });
  };

  // Catálogo COMPLETO (también lo desactivado) para mapear nombres a EN/FR:
  // un plato marcado que se desactive después sigue teniendo su traducción.
  const catalogos: CatalogosCarta = useMemo(
    () => ({
      platos: (platos || []) as (Plato & ConTraduccion)[],
      vinos: (vinos || []) as (Vino & ConTraduccion)[],
    }),
    [platos, vinos],
  );

  const traducir = async (draftEs: DraftBotWeb) => {
    setErrorTraduccion(null);
    try {
      await traduccion.mutateAsync({ draftEs, catalogos });
    } catch (e) {
      // ES ya está guardado; EN/FR se quedan como estaban (nunca vacíos).
      setErrorTraduccion(e instanceof Error ? e.message : "Error desconocido al traducir");
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    if (draft.instrucciones_extra.length > MAX_INSTRUCCIONES_EXTRA) {
      setSaveError(`"Instrucciones extra" supera los ${MAX_INSTRUCCIONES_EXTRA} caracteres: recórtalo antes de guardar.`);
      return;
    }
    const aGuardar = draft;
    setSaving(true);
    setSaveError(null);
    try {
      await updateConfig.mutateAsync({ idioma: "es", updates: draftToUpdate(aGuardar) });
      setSavedBaseline(aGuardar);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Error desconocido al guardar");
      return;
    } finally {
      setSaving(false);
    }
    await traducir(aGuardar);
  };

  // Reintentar/retraducir usa lo último GUARDADO en español, nunca el
  // borrador sin guardar (la fila ES y las traducciones deben coincidir).
  const retraducir = () => {
    if (savedBaseline) traducir(savedBaseline);
  };

  const platosPorCategoria = useMemo(
    () => agruparPorCategoria((platos || []).filter((p) => p.activado !== false), buscarPlato),
    [platos, buscarPlato],
  );
  const vinosPorCategoria = useMemo(
    () => agruparPorCategoria((vinos || []).filter((v) => v.activado !== false), buscarVino),
    [vinos, buscarVino],
  );

  const borradoresPreview = useMemo(
    () => (draft ? { es: draft, en: configToDraft(configs.en), fr: configToDraft(configs.fr) } : null),
    [draft, configs.en, configs.fr],
  );

  if (isLoading || !draft || !borradoresPreview) {
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
          <Button size="sm" variant="outline" className="h-11 bg-background" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const traduciendo = traduccion.isPending;
  const ocupado = saving || traduciendo;

  // Ctrl/Cmd+S guarda en vez de abrir "Guardar página". Va en la barra y en los
  // paneles del bot, NO en Protección (tiene su propio botón "Guardar límites"):
  // antes los envolvía un solo div, pero la barra quedó fuera de la región con
  // scroll y Protección dentro.
  const atajoGuardar = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (canEdit && dirty && !ocupado) handleSave();
    }
  };

  return (
    <div ref={setRaiz} className="flex flex-col gap-4" style={alto ? { height: alto } : undefined}>
      <h2 className="sr-only">Bot web</h2>

      {/* Barra de guardado + estado de traducciones. Fija arriba, fuera de
          la región con scroll; con fondo sólido y borde: no tapa contenido ni
          usa blur. Los márgenes negativos compensan el padding de <main>. El
          `sticky` (bajo la cabecera del layout, h-14 / sm:h-16) solo actúa si
          la página desplaza: sin medida o bajo el suelo. */}
      <div
        className="sticky top-14 z-30 -mx-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2 sm:top-16 sm:-mx-6 sm:px-6"
        onKeyDown={atajoGuardar}
      >
        <p className="text-sm text-muted-foreground">
          Edita en <span className="font-medium text-foreground">español</span>; inglés y francés se traducen solos al guardar.
        </p>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <EstadoTraduccionBadges
              configEs={configs.es}
              configs={{ en: configs.en, fr: configs.fr }}
              traduciendo={traduciendo}
              errorTraduccion={errorTraduccion}
              onReintentar={retraducir}
              puedeReintentar={!dirty && !ocupado}
            />
            <EstadoGuardadoBadge dirty={dirty} saving={saving} error={saveError} />
            <Button
              size="sm"
              className="h-11 px-4"
              onClick={handleSave}
              disabled={ocupado || !dirty}
              aria-label="Guardar cambios y traducir a inglés y francés"
              title="Guardar (Ctrl+S)"
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Guardar
            </Button>
          </div>
        )}
      </div>

      {/* `relative`: la región es el bloque contenedor de los `sr-only` (absolute) de
          los paneles; sin él se escapaban del recorte y alargaban la página. */}
      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
        <div className="space-y-4" onKeyDown={atajoGuardar}>
          <BotIdiomaPanel
            draft={draft}
            canEdit={canEdit}
            onChange={updateDraft}
            onTogglePlato={(nombre) => toggleEn("platos", nombre)}
            onToggleVino={(nombre) => toggleEn("vinos", nombre)}
            platosPorCategoria={platosPorCategoria}
            vinosPorCategoria={vinosPorCategoria}
            loadingPlatos={loadingPlatos}
            loadingVinos={loadingVinos}
            buscarPlato={buscarPlato}
            buscarVino={buscarVino}
            onBuscarPlatoChange={setBuscarPlato}
            onBuscarVinoChange={setBuscarVino}
          />

          <TraduccionesBot
            configs={{ en: configs.en, fr: configs.fr }}
            traduciendo={traduciendo}
            puedeRetraducir={!dirty && !ocupado}
            onRetraducir={retraducir}
          />

          <VistaPreviaBot borradores={borradoresPreview} />
        </div>

        {/* Global (no depende del idioma): interruptor, consumo y límites. Fuera
            del bloque con Ctrl+S — tiene su propio botón "Guardar límites". */}
        <SeccionProteccion />
      </div>
    </div>
  );
}
