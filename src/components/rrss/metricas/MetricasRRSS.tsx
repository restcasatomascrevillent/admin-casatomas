/**
 * RRSS › Métricas (09/11/2026, pedido del dueño: «un panel de métricas globales
 * en RRSS y no uno por cada cosa, y que generen un informe como el de tráfico
 * web»). Sustituye a la pestaña «Métricas» que había dentro de Instagram.
 *
 *  · Arriba, una tarjeta por red con lo esencial de los últimos 28 días:
 *      Instagram: seguidores, alcance e interacciones (datos de la API oficial,
 *        los mismos que el detalle de abajo).
 *      Facebook: «No conectado». El panel no lee nada de Facebook y no se
 *        enseña ninguna cifra inventada.
 *      Web desde redes: visitas a las webs que llegan desde redes sociales
 *        (Tráfico web). Solo para quien puede ver Tráfico web (Super Admin).
 *  · «Generar informe»: informe mensual en diapositivas y PDF, como el de
 *    Tráfico web (./informe).
 *  · Debajo, Instagram en detalle: la gráfica, «Qué funciona» y el ranking de
 *    publicaciones (src/components/instagram/metricas, sin cambios).
 */
import { lazy, Suspense, useState, type ReactNode } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Facebook, FileBarChart2, Globe, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { cn } from "@/lib/utils";
import { MetricasInstagram } from "@/components/instagram/metricas/MetricasInstagram";
import { formatearNumero, textoVariacion } from "@/components/instagram/metricas/agregacion";
import { useMetricasInstagram, type ApiMetricas } from "@/components/instagram/metricas/useMetricasInstagram";
import type { Comparacion } from "@/components/instagram/metricas/tipos";
import { useWebDesdeRedes, type WebDesdeRedes } from "./datos";

const InformeRrssDialog = lazy(() => import("./informe/InformeRrssDialog"));

export interface MetricasRRSSProps {
  className?: string;
  /** Para pruebas: lectura simulada de Instagram en vez de la Edge Function. */
  apiInstagram?: ApiMetricas;
  /** Para pruebas: fuerza si se enseña la web desde redes (por defecto, solo Super Admin). */
  conWeb?: boolean;
}

function Estado({ children, tono }: { children: ReactNode; tono: "ok" | "apagado" | "aviso" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        tono === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tono === "aviso" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tono === "apagado" && "border border-dashed text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function TarjetaRed({ titulo, icono, estado, children, testid }: { titulo: string; icono: ReactNode; estado: ReactNode; children: ReactNode; testid: string }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
          {icono}
          {titulo}
        </h3>
        {estado}
      </div>
      {children}
    </Card>
  );
}

function Variacion({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">{textoVariacion(null)}</span>;
  return <span className={cn(v === 0 ? "text-muted-foreground" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{textoVariacion(v)}</span>;
}

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: ReactNode; detalle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs leading-tight text-muted-foreground">{etiqueta}</span>
      <span className="block text-lg font-semibold tabular-nums leading-tight">{valor}</span>
      {detalle && <span className="block text-xs leading-tight">{detalle}</span>}
    </div>
  );
}

function hace(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return formatDistanceToNow(parseISO(iso), { locale: es, addSuffix: true });
  } catch {
    return null;
  }
}

function ResumenInstagram({ api }: { api?: ApiMetricas }) {
  const { datos, cargando, error } = useMetricasInstagram(api);
  const r = datos?.resumen?.d28 ?? null;
  const actualizado = hace(datos?.ultimaCorrecta?.fin ?? datos?.ultimaCorrecta?.inicio);
  const estado = cargando ? null : error && !datos ? <Estado tono="aviso">Sin leer</Estado> : r ? <Estado tono="ok">Conectado</Estado> : <Estado tono="aviso">Sin datos</Estado>;
  const seguidores = r?.metricas.seguidores;
  const fila = (c: Comparacion | undefined) => (c ? <Variacion v={c.variacion} /> : null);
  return (
    <TarjetaRed titulo="Instagram" icono={<Instagram />} estado={estado} testid="red-instagram">
      {cargando ? (
        <Skeleton className="h-12 w-full" />
      ) : r ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Dato
              etiqueta="Seguidores"
              valor={formatearNumero(seguidores?.actual ?? null)}
              detalle={
                seguidores?.cambio != null ? (
                  <span className={cn(seguidores.cambio > 0 ? "text-emerald-600 dark:text-emerald-400" : seguidores.cambio < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                    {seguidores.cambio > 0 ? `+${formatearNumero(seguidores.cambio)}` : seguidores.cambio < 0 ? `−${formatearNumero(-seguidores.cambio)}` : "Igual"}
                  </span>
                ) : (
                  fila(seguidores)
                )
              }
            />
            <Dato etiqueta="Alcance" valor={formatearNumero(r.metricas.alcance.actual)} detalle={fila(r.metricas.alcance)} />
            <Dato etiqueta="Interacciones" valor={formatearNumero(r.metricas.interacciones.actual)} detalle={fila(r.metricas.interacciones)} />
          </div>
          <p className="text-xs text-muted-foreground">Últimos 28 días frente a los 28 anteriores{actualizado ? ` · actualizado ${actualizado}` : ""}.</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{error && !datos ? "No se han podido leer las métricas. Abajo se explica por qué." : "Todavía no hay métricas guardadas de Instagram."}</p>
      )}
    </TarjetaRed>
  );
}

function ResumenFacebook() {
  return (
    <TarjetaRed titulo="Facebook" icono={<Facebook />} estado={<Estado tono="apagado">No conectado</Estado>} testid="red-facebook">
      <p className="text-sm text-muted-foreground">
        El panel no está conectado a la página de Facebook, así que no tiene sus métricas. Cuando se conecte, saldrán aquí y en el informe.
      </p>
    </TarjetaRed>
  );
}

function ResumenWeb({ consulta }: { consulta: { data?: WebDesdeRedes; isLoading: boolean; error: unknown } }) {
  const d = consulta.data;
  return (
    <TarjetaRed
      titulo="Web desde redes"
      icono={<Globe />}
      estado={consulta.error ? <Estado tono="aviso">Sin leer</Estado> : null}
      testid="red-web"
    >
      {consulta.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : d ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Dato etiqueta="Visitas" valor={formatearNumero(d.total)} detalle={<Variacion v={d.variacion} />} />
            {d.redes.slice(0, 2).map((r) => (
              <Dato key={r.nombre} etiqueta={r.nombre} valor={formatearNumero(r.visitas)} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Visitas a las webs que llegan desde un enlace en redes, últimos 28 días{d.cuota !== null ? ` (${String(Math.round(d.cuota * 10) / 10).replace(".", ",")} % del total)` : ""}.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No se han podido leer las visitas de Tráfico web.</p>
      )}
    </TarjetaRed>
  );
}

export function MetricasRRSS({ className, apiInstagram, conWeb: conWebForzado }: MetricasRRSSProps) {
  const { isSuperAdmin } = useSuperAdmin();
  const conWeb = conWebForzado ?? isSuperAdmin;
  const web = useWebDesdeRedes(conWeb);
  const [informeAbierto, setInformeAbierto] = useState(false);

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="metricas-rrss">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Métricas de todas las redes.</span> Cifras reales de cada red; lo que no está conectado no se inventa.
        </p>
        <Button className="h-10 gap-2" onClick={() => setInformeAbierto(true)}>
          <FileBarChart2 className="h-4 w-4" aria-hidden />
          Generar informe
        </Button>
      </div>

      <section aria-label="Resumen por red" className={cn("grid shrink-0 gap-3 sm:grid-cols-2", conWeb && "lg:grid-cols-3")}>
        <ResumenInstagram api={apiInstagram} />
        <ResumenFacebook />
        {conWeb && <ResumenWeb consulta={web} />}
      </section>

      <section aria-label="Instagram en detalle" className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
          <Instagram aria-hidden />
          Instagram en detalle
        </h2>
        <MetricasInstagram api={apiInstagram} />
      </section>

      {informeAbierto && (
        <Suspense fallback={null}>
          <InformeRrssDialog abierto={informeAbierto} onAbiertoChange={setInformeAbierto} conWeb={conWeb} />
        </Suspense>
      )}
    </div>
  );
}
