import { lazy, Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Facebook, Instagram, Lightbulb, Sparkles, Wand2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTecladoAbierto } from "@/hooks/useTecladoAbierto";
import { BarraRedesMovil } from "@/components/rrss/BarraRedesMovil";
import { cn } from "@/lib/utils";
import { useRolesEncargos } from "@/components/instagram/encargos/useEncargos";
import { ContenidoInstagram } from "@/pages/Instagram";

// Facebook y el editor se descargan la primera vez que se abren (Instagram, la de por defecto, no).
const FacebookRRSS = lazy(() => import("@/components/rrss/facebook/FacebookRRSS").then((m) => ({ default: m.FacebookRRSS })));
const EditorIA = lazy(() => import("@/components/rrss/editor/EditorIA").then((m) => ({ default: m.EditorIA })));
const IdeasGrabar = lazy(() => import("@/components/rrss/ideas/IdeasGrabar").then((m) => ({ default: m.IdeasGrabar })));
const MetricasRRSS = lazy(() => import("@/components/rrss/metricas/MetricasRRSS").then((m) => ({ default: m.MetricasRRSS })));

export const REDES = ["instagram", "facebook", "editor", "metricas"] as const;
export type RedRrss = (typeof REDES)[number];

const ALTURA_MINIMA = 360;
// `relative`: lo que va en `position: absolute` (textos sr-only de las gráficas) queda dentro del scroll de la pestaña y no alarga la página.
const CONTENIDO = "relative mt-0 flex-1 min-h-0 data-[state=inactive]:hidden";

function Cargando() {
  return (
    <div role="status" aria-label="Cargando la pestaña" className="space-y-3 p-1">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const Perezosa = ({ children }: { children: ReactNode }) => <Suspense fallback={<Cargando />}>{children}</Suspense>;

/** Etiqueta larga desde `sm` y corta en el móvil (el nombre accesible es el que se ve). */
function EtiquetaChip({ larga, corta }: { larga: string; corta: string }) {
  return (
    <>
      <span className="sm:hidden">{corta}</span>
      <span className="hidden sm:inline">{larga}</span>
    </>
  );
}

/**
 * RRSS (08/11/2026, antes «Instagram»): redes sociales del restaurante en una
 * sola sección, con el mismo permiso que antes (Marketing; la agencia solo ve
 * Instagram › Encargos).
 *
 *  · Instagram: todo lo de siempre (Estudio, Crear, Campañas, Reels,
 *    Calendario, Encargos, Métricas), sin cambios: src/pages/Instagram.tsx.
 *  · Facebook: preparar contenido para Facebook (formatos y textos propios),
 *    guardar borradores, descargar y copiar. El panel NO publica en Facebook.
 *  · Subida de fotos — Editor IA de fotos y vídeos: subir fotos y vídeos, que
 *    la IA proponga la edición y el motor la haga de verdad; y «Dame ideas
 *    para grabar». Ver docs/rrss.md.
 *  · Métricas (09/11/2026): un solo panel para todas las redes, con
 *    «Generar informe» mensual como el de Tráfico web. Sustituye a
 *    Instagram › Métricas. Ver docs/rrss.md.
 *
 * `?red=instagram|facebook|editor|metricas` abre esa pestaña; `?trabajo=<id>`
 * abre un trabajo del editor; `/instagram?…` redirige aquí con `red=instagram`
 * y el resto de parámetros (tab, encargo, pieza…), así que los enlaces y
 * avisos antiguos siguen funcionando. El antiguo `?tab=metricas` de Instagram
 * abre RRSS › Métricas.
 */
export default function RRSS() {
  const [params, setParams] = useSearchParams();
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const roles = useRolesEncargos();
  // Móvil (< 768 px, 12/11/2026): las redes van en una barra inferior (BarraRedesMovil) y no arriba; con el teclado
  // abierto la barra se quita para dejar todo el alto a lo que se escribe.
  const esMovil = useIsMobile();
  const tecladoAbierto = useTecladoAbierto();
  // Agencia sin Marketing: solo Instagram (y dentro, solo Encargos).
  const soloAgencia = !roles.cargando && roles.agencia && !roles.restaurante;
  // Enlaces antiguos a Instagram › Métricas (`?tab=metricas`, con o sin `red=instagram`): ahora es RRSS › Métricas.
  const metricasAntigua = params.get("tab") === "metricas" && (params.get("red") ?? "instagram") === "instagram";
  const pedida = metricasAntigua ? "metricas" : (params.get("red") as RedRrss | null);
  const red: RedRrss = soloAgencia ? "instagram" : pedida && REDES.includes(pedida) ? pedida : "instagram";
  const [modoEditor, setModoEditor] = useState<"editor" | "ideas">(() => (params.get("modo") === "ideas" ? "ideas" : "editor"));
  const trabajo = params.get("trabajo");

  const cambiar = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const cambiarRed = (r: string) => {
    if (!REDES.includes(r as RedRrss)) return;
    // Los parámetros de Instagram (tab, encargo, pieza) solo valen en Instagram.
    cambiar(r === "instagram" && params.get("tab") !== "metricas" ? { red: r } : { red: r, tab: null, encargo: null, pieza: null });
  };

  return (
    <DashboardLayout>
      <h1 className="sr-only">RRSS</h1>
      <div ref={setRaiz} className={cn("flex flex-col", esMovil && "rrss-movil")} style={alto ? { height: alto } : undefined} data-testid="pagina-rrss">
        <Tabs value={red} onValueChange={cambiarRed} className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          {!soloAgencia && !esMovil && (
            <PestanasPagina
              // Cuatro pestañas no caben con iconos a 390 px: en el móvil, solo el texto.
              iconosSoloEscritorio
              pestanas={[
                { valor: "instagram", etiqueta: "Instagram", icono: <Instagram /> },
                { valor: "facebook", etiqueta: "Facebook", icono: <Facebook /> },
                { valor: "editor", etiqueta: "Subida de fotos", etiquetaCorta: "Subida", icono: <Sparkles /> },
                { valor: "metricas", etiqueta: "Métricas", icono: <BarChart3 /> },
              ]}
            />
          )}

          <TabsContent value="instagram" className={`${CONTENIDO} flex flex-col`}>
            {red === "instagram" && <ContenidoInstagram incrustado onIrMetricas={() => cambiarRed("metricas")} />}
          </TabsContent>

          <TabsContent value="facebook" className={`${CONTENIDO} overflow-y-auto overscroll-contain`}>
            {red === "facebook" && (
              <Perezosa>
                <FacebookRRSS trabajoInicial={trabajo} onTrabajo={(id) => cambiar({ trabajo: id })} />
              </Perezosa>
            )}
          </TabsContent>

          <TabsContent value="editor" className={`${CONTENIDO} flex flex-col gap-2`}>
            {red === "editor" && (
              <Tabs value={modoEditor} onValueChange={(v) => setModoEditor(v as "editor" | "ideas")} className="flex flex-1 min-h-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* En el móvil sobra la explicación (cada pantalla ya dice qué hace): solo los dos botones. */}
                  <p className="hidden text-sm text-muted-foreground sm:block">
                    <span className="font-medium text-foreground">Editor IA de fotos y vídeos.</span> Sube tus fotos y vídeos, elige qué quieres conseguir y la IA prepara la edición. Nada se publica solo.
                  </p>
                  <ChipsSubnivel
                    chips={[
                      // En el móvil, etiquetas cortas: las largas no caben juntas a 390 px.
                      { valor: "editor", etiqueta: <EtiquetaChip larga="Editar mis archivos" corta="Editar" />, icono: <Wand2 /> },
                      { valor: "ideas", etiqueta: <EtiquetaChip larga="Dame ideas para grabar" corta="Ideas para grabar" />, icono: <Lightbulb /> },
                    ]}
                  />
                </div>
                <TabsContent value="editor" className="mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain lg:overflow-hidden data-[state=inactive]:hidden">
                  {modoEditor === "editor" && (
                    <Perezosa>
                      <EditorIA className="h-full" origen="editor" trabajoInicial={trabajo} onTrabajo={(id) => cambiar({ trabajo: id })} />
                    </Perezosa>
                  )}
                </TabsContent>
                <TabsContent value="ideas" className="mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden">
                  {modoEditor === "ideas" && (
                    <Perezosa>
                      <IdeasGrabar />
                    </Perezosa>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>

          <TabsContent value="metricas" className={`${CONTENIDO} overflow-y-auto overscroll-contain`}>
            {red === "metricas" && (
              <Perezosa>
                <MetricasRRSS />
              </Perezosa>
            )}
          </TabsContent>
          {!soloAgencia && esMovil && !tecladoAbierto && (
            <BarraRedesMovil
              redes={[
                { valor: "instagram", etiqueta: "Instagram", icono: <Instagram /> },
                { valor: "facebook", etiqueta: "Facebook", icono: <Facebook /> },
                { valor: "editor", etiqueta: "Subida", nombre: "Subida de fotos", icono: <Sparkles /> },
                { valor: "metricas", etiqueta: "Métricas", icono: <BarChart3 /> },
              ]}
            />
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
