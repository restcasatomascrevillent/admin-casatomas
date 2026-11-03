import { cn } from "@/lib/utils";
import { NOMBRE_ENTORNO, VERSION_APP, type VersionApp } from "@/lib/version";

/** Color del entorno con los tokens de estado: Producción verde, Demo ámbar, Preview azul, Local gris. */
const TONO: Record<VersionApp["entorno"], string> = {
  produccion: "bg-status-confirmed text-status-confirmed-foreground",
  demo: "bg-status-pending text-status-pending-foreground",
  preview: "bg-status-verified text-status-verified-foreground",
  local: "bg-muted text-muted-foreground",
};

/**
 * Versión y entorno, arriba del todo en el menú (cabecera del Admin Panel y del Super
 * Admin) y en la barra superior de tablet/móvil (petición del dueño, 2026-11-03; antes
 * iba en el pie). Así se sabe de un vistazo si se está en la demo o en producción y qué
 * versión tiene cada una (la demo va igual o por delante). Al pasar el ratón: versión,
 * entorno, commit y, si falta el número (`v0.?`), el motivo.
 *
 * `colapsado` (menú plegado a iconos): solo el número, en el color del entorno; el
 * entorno sigue en el tooltip y para el lector de pantalla.
 */
export function VersionPanel({
  colapsado = false,
  version = VERSION_APP,
  className,
}: {
  colapsado?: boolean;
  version?: VersionApp;
  className?: string;
}) {
  const entorno = NOMBRE_ENTORNO[version.entorno];
  // Sin build (tests, `vite` sin el script de versión) no hay número: solo el entorno.
  const numero = version.version && version.version !== "local" ? `v${version.version}` : null;
  const detalle = [numero ? `${numero} · ${entorno}` : entorno, version.commit && `Commit ${version.commit}`, version.aviso]
    .filter(Boolean)
    .join(" · ");
  return (
    <p
      data-testid="version-panel"
      data-entorno={version.entorno}
      title={detalle}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
        colapsado ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px] pointer-coarse:text-xs",
        TONO[version.entorno],
        className,
      )}
    >
      {numero && <span className="font-mono tabular-nums">{numero}</span>}
      {colapsado && numero ? (
        <span className="sr-only"> · {entorno}</span>
      ) : (
        <>
          {numero && <span aria-hidden="true">·</span>}
          <span>{entorno}</span>
        </>
      )}
    </p>
  );
}
