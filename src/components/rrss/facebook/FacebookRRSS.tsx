import { lazy, Suspense } from "react";
import { CheckCircle2, ClipboardCopy, Download, ExternalLink, PlugZap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Plegable } from "@/components/panel/Plegable";
import { useIsMobile } from "@/hooks/use-mobile";
import { ParaOficiosos } from "@/components/instagram/ParaOficiosos";
import { formatoSalida, proporcion, TIPOS_CONTENIDO } from "@/lib/rrss/formatos";

const EditorIA = lazy(() => import("@/components/rrss/editor/EditorIA").then((m) => ({ default: m.EditorIA })));

/** Meta Business Suite: donde se publica a mano lo preparado aquí. */
export const URL_META_BUSINESS_SUITE = "https://business.facebook.com/latest/composer";

function ListaFormatos() {
  const formatos = TIPOS_CONTENIDO.map((t) => formatoSalida("facebook", t, t === "reel" || t === "animada"));
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Formatos de Facebook">
      {formatos.map((f) => (
        <li key={f.tipo} className="rounded-full border px-2.5 py-1 text-muted-foreground">
          {f.etiqueta} · {proporcion(f)} {f.medio === "video" ? "vídeo" : "foto"}
        </li>
      ))}
    </ul>
  );
}

function PasosPublicar() {
  return (
    <ol className="mt-2 space-y-1 text-sm">
      <li className="flex gap-2">
        <Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Descarga las imágenes o el vídeo del trabajo.
      </li>
      <li className="flex gap-2">
        <ClipboardCopy className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Copia el texto de la publicación.
      </li>
      <li className="flex gap-2">
        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          Publícalo desde{" "}
          <a href={URL_META_BUSINESS_SUITE} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
            Meta Business Suite
          </a>{" "}
          o la app de Facebook.
        </span>
      </li>
    </ol>
  );
}

function NotaOficiosos() {
  return (
    <ParaOficiosos className="mt-2">
      <p>
        Para publicar desde el panel haría falta conectar la página: un token de página de larga duración del usuario del sistema de Meta con
        <code className="mx-1">pages_manage_posts</code>y<code className="mx-1">pages_read_engagement</code>, el id de la página (<code>FB_PAGE_ID</code>) y una Edge
        Function que publique en <code>/{"{page-id}"}/photos</code> y <code>/{"{page-id}"}/videos</code> como
        <code className="mx-1">instagram-publicar</code>. No está hecho: hoy no se guarda ningún token de Facebook.
      </p>
    </ParaOficiosos>
  );
}

/**
 * RRSS › Facebook (08/11/2026). Separa claramente las dos cosas:
 *
 *  · PREPARAR (lo que sí hace el panel): el mismo editor IA que «Subida de
 *    fotos», con el canal fijo en Facebook: formatos de Facebook (publicación
 *    4:5, álbum 1:1, story y reel 9:16, vídeo cuadrado), textos adaptados a
 *    Facebook, borradores guardados, descargar los archivos y copiar el texto.
 *  · PUBLICAR: NO hay integración con Facebook. No se finge ninguna cuenta
 *    conectada, publicación ni estadística: se dice que no está conectado y
 *    cómo publicarlo a mano. Lo que haría falta para conectarlo va en «Para
 *    Oficiosos».
 */
export function FacebookRRSS({ trabajoInicial, onTrabajo }: { trabajoInicial?: string | null; onTrabajo?: (id: string | null) => void }) {
  const esMovil = useIsMobile();
  if (esMovil) {
    // Móvil (12/11/2026): lo importante primero (el editor y «Nuevo trabajo»); cómo se publica a mano y los formatos,
    // plegados en una línea («No conectado» a la vista, que es lo que importa saber).
    return (
      <div className="flex flex-col gap-3" data-testid="rrss-facebook">
        <Plegable
          titulo={
            <span className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Publicar en Facebook
              <span className="rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground">No conectado</span>
            </span>
          }
          forzarMontaje
          className="rounded-lg border border-dashed bg-muted/30 px-3"
          data-testid="fb-publicacion"
        >
          <p className="text-sm text-muted-foreground">
            El panel no está conectado a la página de Facebook: no publica ni programa nada allí. Para publicar lo que prepares:
          </p>
          <PasosPublicar />
          <p className="mt-3 text-sm font-medium">Formatos que prepara</p>
          <ListaFormatos />
          <NotaOficiosos />
        </Plegable>
        <Suspense
          fallback={
            <div role="status" aria-label="Cargando el editor" className="space-y-3">
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-64 w-full" />
            </div>
          }
        >
          <EditorIA canalFijo="facebook" origen="facebook" trabajoInicial={trabajoInicial} onTrabajo={onTrabajo} className="min-h-[32rem]" />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="rrss-facebook">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]">
        <section aria-labelledby="fb-preparar" className="rounded-lg border bg-card p-3 sm:p-4">
          <h2 id="fb-preparar" className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Preparar contenido para Facebook
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sube fotos y vídeos y deja que la IA prepare la edición con los formatos y el tono de Facebook. Se guarda como borrador; luego lo descargas y copias el texto.
          </p>
          <ListaFormatos />
        </section>

        <section aria-labelledby="fb-publicar" className="rounded-lg border border-dashed bg-muted/30 p-3 sm:p-4" data-testid="fb-publicacion">
          <h2 id="fb-publicar" className="flex items-center gap-2 text-base font-semibold">
            <PlugZap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Publicar en Facebook
            <span className="rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground">No conectado</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            El panel no está conectado a la página de Facebook: no publica ni programa nada allí. Para publicar lo que prepares:
          </p>
          <PasosPublicar />
          <NotaOficiosos />
        </section>
      </div>

      <Suspense
        fallback={
          <div role="status" aria-label="Cargando el editor" className="space-y-3">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <EditorIA canalFijo="facebook" origen="facebook" trabajoInicial={trabajoInicial} onTrabajo={onTrabajo} className="min-h-[32rem]" />
      </Suspense>
    </div>
  );
}
