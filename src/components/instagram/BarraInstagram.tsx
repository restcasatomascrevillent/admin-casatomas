/**
 * Lo que va a la derecha de la barra de pestañas de Instagram (maqueta,
 * `.acciones-barra`): el selector de marca común a todas las pestañas («Las
 * dos / Casa Tomás / Touza», píldora `.segmentado`) y el indicador de la
 * cuenta conectada («● @cuenta»), que abre la conexión.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import { ConexionInstagram } from "@/components/marketing/instagram/ConexionInstagram";
import { useConexionInstagram } from "@/components/marketing/instagram/useConexionInstagram";

export type FiltroMarca = MarcaId | "todas";

const OPCIONES: ReadonlyArray<{ valor: FiltroMarca; nombre: string; corto: string }> = [
  { valor: "todas", nombre: "Las dos", corto: "Las dos" },
  { valor: "casa-tomas", nombre: "Casa Tomás", corto: "CT" },
  { valor: "touza", nombre: "Touza", corto: "TZ" },
];

export function SelectorMarca({ valor, onCambio, className }: { valor: FiltroMarca; onCambio: (m: FiltroMarca) => void; className?: string }) {
  return (
    <div role="group" aria-label="Ver marca" className={cn("inline-flex shrink-0 gap-0.5 rounded-full border bg-[#f6f3f1] p-[3px]", className)} data-testid="selector-marca">
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "h-8 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10",
            valor === o.valor && "bg-background font-medium text-foreground shadow-sm",
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

/** Texto del indicador según el estado de la conexión. */
export function textoIndicador(c: { estado: { ok: boolean; cuenta: { username: string } | null; cuentasPorMarca: Array<{ marca: string; username: string | null }> } | null; cargando: boolean; error: unknown }, marca: FiltroMarca): { texto: string; tono: "ok" | "aviso" | "mal" | "gris" } {
  if (c.cargando) return { texto: "Comprobando…", tono: "gris" };
  if (c.error || !c.estado) return { texto: "Sin comprobar", tono: c.error ? "mal" : "gris" };
  const deMarca = marca === "todas" ? null : c.estado.cuentasPorMarca.find((x) => x.marca === marca)?.username;
  const usuario = deMarca ?? c.estado.cuenta?.username ?? null;
  if (!usuario) return { texto: "Sin cuenta", tono: "mal" };
  return { texto: `@${usuario}`, tono: c.estado.ok ? "ok" : "aviso" };
}

const COLOR_PUNTO = { ok: "bg-[#117e39]", aviso: "bg-[#e7b008]", mal: "bg-red-600", gris: "bg-muted-foreground/60" } as const;

export function IndicadorCuenta({ marca, className }: { marca: FiltroMarca; className?: string }) {
  const conexion = useConexionInstagram();
  const [abierto, setAbierto] = useState(false);
  const { texto, tono } = textoIndicador(conexion, marca);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "inline-flex h-8 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
          className,
        )}
        aria-label={`Cuenta de Instagram: ${texto}. Ver la conexión`}
        data-testid="indicador-cuenta"
        data-tono={tono}
      >
        <i aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", COLOR_PUNTO[tono])} />
        <span className="truncate">{texto}</span>
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conexión con Instagram</DialogTitle>
            <DialogDescription>En qué cuenta publica cada marca y si todo está listo.</DialogDescription>
          </DialogHeader>
          <ConexionInstagram sinTitulo className="border-0 p-0" />
        </DialogContent>
      </Dialog>
    </>
  );
}
