import type { Foto } from "@/lib/instagram";

/**
 * Marca discreta de las fotos de la carta en la biblioteca: «Original» si la
 * foto tiene su original a tamaño completo en Drive (sirve a sangre), «Solo
 * web» si solo está la versión de la web (1200×900). Ver originalesCarta.ts.
 */
export function EtiquetaOriginal({ foto }: { foto: Pick<Foto, "original" | "platoId" | "vinoId"> }) {
  if ((!foto.platoId && !foto.vinoId) || foto.original === undefined) return null;
  return (
    <span
      className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px] font-medium leading-4 text-muted-foreground"
      title={foto.original ? "Con el original a tamaño completo (Drive)" : "Solo la versión de la web"}
      data-testid="etiqueta-original"
      aria-hidden="true"
    >
      {foto.original ? "Original" : "Solo web"}
    </span>
  );
}
