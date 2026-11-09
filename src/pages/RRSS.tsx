import { lazy, Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Facebook, Instagram, Lightbulb, Sparkles, Wand2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useRolesEncargos } from "@/components/instagram/encargos/useEncargos";
import { ContenidoInstagram } from "@/pages/Instagram";

// Facebook y el editor se descargan la primera vez que se abren (Instagram, la de por defecto, no).
const FacebookRRSS = lazy(() => import("@/components/rrss/facebook/FacebookRRSS").then((m) => ({ default: m.FacebookRRSS })));
const EditorIA = lazy(() => import("@/components/rrss/editor/EditorIA").then((m) => ({ default: m.EditorIA })));
const IdeasGrabar = lazy(() => import("@/components/rrss/ideas/IdeasGrabar").then((m) => ({ default: m.IdeasGrabar })));

export const REDES = ["instagram", "facebook", "editor"] as const;
export type RedRrss = (typeof REDES)[number];

const ALTURA_MINIMA = 360;
const CONTENIDO = "mt-0 flex-1 min-h-0 data-[state=inactive]:hidden";

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
 *
 * `?red=instagram|facebook|editor` abre esa pestaña; `?trabajo=<id>` abre un
 * trabajo del editor; `/instagram?…` redirige aquí con `red=instagram` y el
 * resto de parámetros (tab, encargo, pieza…), así que los enlaces y avisos
 * antiguos siguen funcionando.
 */
export default function RRSS() {
  const [params, setParams] = useSearchParams();
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const roles = useRolesEncargos();
  // Agencia sin Marketing: solo Instagram (y dentro, solo Encargos).
  const soloAgencia = !roles.cargando && roles.agencia && !roles.restaurante;
  const pedida = params.get("red") as RedRrss | null;
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
    cambiar(r === "instagram" ? { red: r } : { red: r, tab: null, encargo: null, pieza: null });
  };

  return (
    <DashboardLayout>
      <h1 className="sr-only">RRSS</h1>
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined} data-testid="pagina-rrss">
        <Tabs value={red} onValueChange={cambiarRed} className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          {!soloAgencia && (
            <PestanasPagina
              pestanas={[
                { valor: "instagram", etiqueta: "Instagram", icono: <Instagram /> },
                { valor: "facebook", etiqueta: "Facebook", icono: <Facebook /> },
                { valor: "editor", etiqueta: "Subida de fotos", etiquetaCorta: "Subida", icono: <Sparkles /> },
              ]}
            />
          )}

          <TabsContent value="instagram" className={`${CONTENIDO} flex flex-col`}>
            {red === "instagram" && <ContenidoInstagram />}
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
                  <p className="text-sm text-muted-foreground">
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
