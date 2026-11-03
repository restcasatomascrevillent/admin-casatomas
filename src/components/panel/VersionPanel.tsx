import { cn } from "@/lib/utils";
import { NOMBRE_ENTORNO, VERSION_APP, type VersionApp } from "@/lib/version";

const TONO: Record<VersionApp["entorno"], string> = {
  produccion: "bg-emerald-100 text-emerald-800",
  demo: "bg-amber-100 text-amber-800",
  preview: "bg-sky-100 text-sky-800",
  local: "bg-muted text-muted-foreground",
};

/**
 * Versión y entorno en el pie del menú: así se sabe de un vistazo si se está en la demo o en
 * producción y qué versión tiene cada una (la demo va igual o por delante).
 */
export function VersionPanel({ colapsado = false, version = VERSION_APP }: { colapsado?: boolean; version?: VersionApp }) {
  const detalle = [version.commit && `Commit ${version.commit}`, version.aviso].filter(Boolean).join(" · ");
  return (
    <p
      data-testid="version-panel"
      title={detalle || undefined}
      className={cn("flex items-center gap-1.5 px-2 pt-1 text-[11px] pointer-coarse:text-xs leading-none text-muted-foreground", colapsado && "justify-center px-0")}
    >
      <span className="font-mono tabular-nums">v{version.version}</span>
      {!colapsado && <span className={cn("rounded-full px-1.5 py-0.5 font-medium", TONO[version.entorno])}>{NOMBRE_ENTORNO[version.entorno]}</span>}
    </p>
  );
}
