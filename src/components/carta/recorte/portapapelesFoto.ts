/**
 * Portapapeles y dispositivo para «Pegar foto recortada» (PegarFotoRecortada.tsx):
 * lógica pura, testeable sin DOM real.
 */
/** Tipos preferidos al leer el portapapeles (el PNG conserva la transparencia). */
export const TIPOS_PORTAPAPELES = ["image/png", "image/webp", "image/jpeg"] as const;

export const AVISO_SIN_FOTO = "No hay ninguna foto copiada. En Fotos mantén pulsado el plato y pulsa «Copiar».";
export const AVISO_SIN_PERMISO = "No se ha podido leer lo copiado. Pulsa otra vez «Pegar foto recortada» y toca «Pegar» en el aviso.";
export const TRUCO_IPHONE = "Truco iPhone: en Fotos mantén pulsado el plato → Copiar, y aquí pulsa «Pegar foto recortada».";

const EXTENSION: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

function aArchivo(blob: Blob, tipo: string): File {
  const t = blob.type || tipo;
  return new File([blob], `foto-pegada.${EXTENSION[t] ?? "png"}`, { type: t });
}

type Portapapeles = Pick<Clipboard, "read">;

/** Primera imagen del portapapeles (prefiere PNG), o null si no hay. Lanza si no deja leer. */
export async function leerFotoPortapapeles(clip: Portapapeles | undefined = navigator.clipboard): Promise<File | null> {
  if (!clip?.read) return null;
  const elementos = await clip.read();
  for (const el of elementos) {
    const tipo = TIPOS_PORTAPAPELES.find((t) => el.types.includes(t)) ?? el.types.find((t) => t.startsWith("image/"));
    if (tipo) return aArchivo(await el.getType(tipo), tipo);
  }
  return null;
}

/** Imagen de un evento `paste` (Ctrl+V), o null. */
export function fotoDeEventoPegar(e: Pick<ClipboardEvent, "clipboardData">): File | null {
  const datos = e.clipboardData;
  if (!datos) return null;
  const archivos = Array.from(datos.files ?? []).filter((f) => f.type.startsWith("image/"));
  const png = archivos.find((f) => f.type === "image/png");
  if (png ?? archivos[0]) return png ?? archivos[0];
  for (const it of Array.from(datos.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** iPhone / iPad (también el iPad que se presenta como Mac). */
export function esDispositivoIOS(nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}
