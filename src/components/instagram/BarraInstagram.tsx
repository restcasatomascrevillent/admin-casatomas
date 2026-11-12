/**
 * Lo que va a la derecha de la barra de pestañas de Instagram (maqueta,
 * `.acciones-barra`): el selector de marca común a todas las pestañas («Las
 * dos / Casa Tomás / Touza», píldora `.segmentado`) y el indicador de la
 * cuenta conectada («● @cuenta»), que abre la conexión.
 *
 * El indicador NO llama a instagram-estado al cargar (esa función pregunta a
 * Meta varias veces, 2-5 s): pinta la última cuenta comprobada (en caché de
 * TanStack Query o guardada en el navegador, cuentaGuardada.ts). La
 * comprobación completa solo se hace al abrir el diálogo o con «Comprobar».
 * Ver docs/instagram-rendimiento.md.
 */
import { lazy, Suspense, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import { useConexionInstagram } from "@/components/marketing/instagram/useConexionInstagram";
import { leerCuentaGuardada } from "@/components/marketing/instagram/cuentaGuardada";

// El diálogo de conexión solo se descarga al abrirlo.
const ConexionInstagram = lazy(() => import("@/components/marketing/instagram/ConexionInstagram").then((m) => ({ default: m.ConexionInstagram })));

export type FiltroMarca = MarcaId | "todas";

const OPCIONES: ReadonlyArray<{ valor: FiltroMarca; nombre: string; corto: string }> = [
  { valor: "todas", nombre: "Las dos", corto: "Las dos" },
  { valor: "casa-tomas", nombre: "Casa Tomás", corto: "CT" },
  { valor: "touza", nombre: "Touza", corto: "TZ" },
];

export function SelectorMarca({
  valor,
  onCambio,
  className,
  grande = false,
}: {
  valor: FiltroMarca;
  onCambio: (m: FiltroMarca) => void;
  className?: string;
  /** Móvil (12/11/2026): botones de 48 px y texto de 14 px, sin relleno alrededor (el grupo mide 48). */
  grande?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Ver marca"
      className={cn("inline-flex shrink-0 gap-0.5 rounded-full border bg-[#f6f3f1]", grande ? "overflow-hidden p-0" : "p-[3px]", className)}
      data-testid="selector-marca"
    >
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "h-8 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10",
            grande && "h-12 min-w-11 px-2.5 text-sm pointer-coarse:h-12",
            valor === o.valor && (grande ? "bg-primary font-semibold text-primary-foreground" : "bg-background font-medium text-foreground shadow-sm"),
          )}
        >
          <span className="hidden 2xl:inline">{o.nombre}</span>
          <span className="2xl:hidden" aria-hidden={o.corto !== o.nombre ? "true" : undefined}>
            {o.corto}
          </span>
          {o.corto !== o.nombre && <span className="sr-only 2xl:hidden">{o.nombre}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Texto del indicador según el estado de la conexión. `caducada`: el estado es
 * una cuenta guardada hace más de 45 min (se ve el @usuario, con el punto gris).
 */
export function textoIndicador(
  c: { estado: { ok: boolean; cuenta: { username: string } | null; cuentasPorMarca: Array<{ marca: string; username: string | null }> } | null; cargando: boolean; error: unknown; caducada?: boolean },
  marca: FiltroMarca,
): { texto: string; tono: "ok" | "aviso" | "mal" | "gris" } {
  if (c.cargando) return { texto: "Comprobando…", tono: "gris" };
  if (c.error || !c.estado) return { texto: "Sin comprobar", tono: c.error ? "mal" : "gris" };
  const deMarca = marca === "todas" ? null : c.estado.cuentasPorMarca.find((x) => x.marca === marca)?.username;
  const usuario = deMarca ?? c.estado.cuenta?.username ?? null;
  if (!usuario) return { texto: "Sin cuenta", tono: c.caducada ? "gris" : "mal" };
  return { texto: `@${usuario}`, tono: c.caducada ? "gris" : c.estado.ok ? "ok" : "aviso" };
}

const COLOR_PUNTO = { ok: "bg-[#117e39]", aviso: "bg-[#e7b008]", mal: "bg-red-600", gris: "bg-muted-foreground/60" } as const;

/**
 * `compacto`: solo el punto de color (botón de 44 px, el texto queda como nombre accesible y en el `title`). Para la
 * cabecera del asistente móvil, donde no cabe «@cuenta».
 */
export function IndicadorCuenta({ marca, className, compacto = false }: { marca: FiltroMarca; className?: string; compacto?: boolean }) {
  // Sin comprobación automática: solo lo que ya esté en la caché de TanStack Query…
  const conexion = useConexionInstagram(false);
  // …o, si aún no, la última cuenta guardada en el navegador.
  const [guardada] = useState(() => leerCuentaGuardada());
  const [abierto, setAbierto] = useState(false);
  const enMemoria = conexion.estado;
  const { texto, tono } = textoIndicador(
    {
      estado: enMemoria ?? guardada?.cuenta ?? null,
      cargando: !enMemoria && !guardada && conexion.comprobando,
      error: enMemoria || guardada ? null : conexion.error,
      caducada: !enMemoria && !!guardada && !guardada.vigente,
    },
    marca,
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          compacto
            ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "inline-flex h-8 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
          className,
        )}
        title={compacto ? texto : undefined}
        aria-label={`Cuenta de Instagram: ${texto}. Ver la conexión`}
        data-testid="indicador-cuenta"
        data-tono={tono}
      >
        <i aria-hidden="true" className={cn("shrink-0 rounded-full", compacto ? "h-2.5 w-2.5" : "h-2 w-2", COLOR_PUNTO[tono])} />
        {!compacto && <span className="truncate">{texto}</span>}
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conexión con Instagram</DialogTitle>
            <DialogDescription>En qué cuenta publica cada marca y si todo está listo.</DialogDescription>
          </DialogHeader>
          {abierto && (
            <Suspense fallback={<Skeleton role="status" className="h-40 w-full" aria-label="Cargando la conexión" />}>
              <ConexionInstagram sinTitulo className="border-0 p-0" />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
