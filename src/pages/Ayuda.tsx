import { useState, type ComponentType } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, Globe, PlayCircle, Receipt } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useUserRole, type SectionKey } from "@/hooks/useUserRole";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { SECCIONES_GESTOR_WEB } from "@/components/gestion-web/pestanasGestorWeb";
import { FICHAS_AYUDA, esArchivoVideo, type FichaAyuda } from "@/lib/ayuda/centroAyuda";
import type { EstadoLanzarTour, SeccionAyuda } from "@/lib/ayuda/tours";

// ---------------------------------------------------------------------------
// Centro de Ayuda: una ficha por sección (qué es, cómo se usa, preguntas
// frecuentes, vídeo si lo hay) y «Ver tour», que abre la sección y lanza su
// recorrido guiado. Visible para todos; «Ver tour» solo se activa si puedes
// entrar en esa sección. Sin scroll de página (regla del dueño): la ficha hace
// scroll por dentro.
// ---------------------------------------------------------------------------

const ICONOS: Record<SeccionAyuda, ComponentType<{ className?: string }>> = {
  facturas: Receipt,
  "gestor-web": Globe,
};

/** Secciones de permisos que dan acceso a cada parte del panel. */
const PERMISOS: Record<SeccionAyuda, SectionKey[]> = {
  facturas: ["facturas"],
  "gestor-web": SECCIONES_GESTOR_WEB,
};

/** Suelo (px) del alto de la página: por debajo vuelve el scroll de página. */
const ALTURA_MINIMA_AYUDA = 380;

function Ficha({ ficha, puedeEntrar }: { ficha: FichaAyuda; puedeEntrar: boolean }) {
  const navigate = useNavigate();
  const verTour = () => {
    const estado: EstadoLanzarTour = { lanzarTour: ficha.seccion };
    navigate(ficha.ruta, { state: estado });
  };

  return (
    <article className="mx-auto max-w-3xl space-y-6 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <h2 className="text-xl font-semibold">{ficha.titulo}</h2>
          <p className="text-base leading-relaxed text-muted-foreground">{ficha.queEs}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={verTour} disabled={!puedeEntrar} className="h-11 gap-2">
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            Ver tour
          </Button>
          {!puedeEntrar && <span className="text-xs text-muted-foreground">No tienes acceso a esta sección</span>}
        </div>
      </header>

      {ficha.videoUrl && (
        <div className="aspect-video overflow-hidden rounded-xl border bg-muted">
          {esArchivoVideo(ficha.videoUrl) ? (
            <video
              src={ficha.videoUrl}
              controls
              preload="metadata"
              playsInline
              aria-label={`Vídeo: cómo usar ${ficha.titulo}`}
              className="h-full w-full bg-black object-contain"
            />
          ) : (
          <iframe
            src={ficha.videoUrl}
            title={`Vídeo: cómo usar ${ficha.titulo}`}
            className="h-full w-full"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
          )}
        </div>
      )}

      <section aria-labelledby={`como-${ficha.seccion}`} className="space-y-3">
        <h3 id={`como-${ficha.seccion}`} className="text-base font-semibold">
          Cómo se usa, paso a paso
        </h3>
        <ol className="space-y-3">
          {ficha.pasos.map((paso, i) => (
            <li key={i} className="flex gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums text-primary"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <p className="pt-0.5 text-base leading-relaxed">{paso}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={`faq-${ficha.seccion}`} className="space-y-3">
        <h3 id={`faq-${ficha.seccion}`} className="text-base font-semibold">
          Preguntas frecuentes
        </h3>
        <div className="divide-y rounded-xl border bg-card">
          {ficha.preguntas.map((p) => (
            <details key={p.pregunta} className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-medium [&::-webkit-details-marker]:hidden">
                {p.pregunta}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="px-4 pb-4 text-base leading-relaxed text-muted-foreground">{p.respuesta}</p>
            </details>
          ))}
        </div>
      </section>
    </article>
  );
}

export default function Ayuda() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { permissions } = useUserRole();
  const { isSuperAdmin } = useSuperAdmin();

  const pedida = searchParams.get("seccion");
  const activa = FICHAS_AYUDA.some((f) => f.seccion === pedida) ? (pedida as SeccionAyuda) : FICHAS_AYUDA[0].seccion;
  const cambiar = (valor: string) => setSearchParams({ seccion: valor }, { replace: true });

  const puedeEntrar = (seccion: SeccionAyuda) =>
    isSuperAdmin || PERMISOS[seccion].some((clave) => permissions.some((p) => p.section_key === clave && p.can_view));

  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_AYUDA);

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        className={`flex flex-col gap-3 ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
      >
        <p className="shrink-0 text-muted-foreground">
          Elige una sección para ver cómo funciona. Con «Ver tour» te la enseñamos paso a paso sobre la pantalla real.
        </p>
        <Tabs value={activa} onValueChange={cambiar} className="flex min-h-0 flex-1 flex-col">
          <PestanasPagina
            pestanas={FICHAS_AYUDA.map((f) => {
              const Icono = ICONOS[f.seccion];
              return { valor: f.seccion, etiqueta: f.titulo, icono: <Icono /> };
            })}
          />
          {FICHAS_AYUDA.map((f) => (
            <TabsContent
              key={f.seccion}
              value={f.seccion}
              className="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 outline-none data-[state=inactive]:hidden"
            >
              <Ficha ficha={f} puedeEntrar={puedeEntrar(f.seccion)} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
