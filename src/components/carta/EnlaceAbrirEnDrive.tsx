import { ExternalLink } from "lucide-react";

/** Mismo patrón que el CHECK de Platos/Vinos.drive_folder_id (migración 20261201120000). */
const RE_ID_CARPETA = /^[A-Za-z0-9_-]{10,200}$/;

/** Enlace a la carpeta de Drive de un plato o vino, o null si no hay id válido. */
export function urlCarpetaDrive(id: string | null | undefined): string | null {
  return typeof id === "string" && RE_ID_CARPETA.test(id) ? `https://drive.google.com/drive/folders/${id}` : null;
}

/**
 * «Abrir en Drive» de la ficha de un plato o vino: lleva a su carpeta
 * (marketing/Platos/… o Vinos/…). No sale si la ficha aún no tiene carpeta
 * enlazada (se enlaza al subir su original o con scripts/carta/vincular-carpetas-drive.mjs).
 */
export function EnlaceAbrirEnDrive({ carpetaId, className }: { carpetaId: string | null | undefined; className?: string }) {
  const url = urlCarpetaDrive(carpetaId);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="abrir-en-drive"
      className={`inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Abrir en Drive
      <span className="sr-only"> (carpeta de la ficha, en una pestaña nueva)</span>
    </a>
  );
}
