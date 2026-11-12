/**
 * El original de Google Drive de una factura o albarán, pedido a la Edge
 * Function `facturas-original` con la sesión de Supabase del panel.
 *
 * Antes (hasta el 12/11/2026) se incrustaba la vista previa de Drive en un
 * iframe y solo se veía si el navegador tenía sesión de Google con acceso al
 * archivo. Ahora el servidor lo descarga con la cuenta del restaurante y el
 * panel lo enseña como blob URL (imagen con zoom o PDF).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");

export const URL_ORIGINAL = `${SUPABASE_URL}/functions/v1/facturas-original`;

/** Igual que la caché privada que manda la función (10 min). */
const VIDA_MS = 10 * 60 * 1000;

export class ErrorOriginal extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.name = "ErrorOriginal";
    this.estado = estado;
  }
}

export interface OpcionesOriginal {
  fetch?: typeof fetch;
  /** JWT; por defecto el de la sesión actual. */
  token?: string | null;
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Bytes del original (imagen o PDF). Lanza ErrorOriginal con un texto para el usuario. */
export async function descargarOriginalDrive(facturaId: number, opts: OpcionesOriginal = {}): Promise<Blob> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorOriginal("No hay sesión: vuelve a entrar en el panel.", 401);
  let r: Response;
  try {
    r = await (opts.fetch ?? fetch)(`${URL_ORIGINAL}?id=${encodeURIComponent(String(facturaId))}`, {
      headers: { apikey: CLAVE_PUBLICA, "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ErrorOriginal("Sin conexión con el servidor.", 0);
  }
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  if (r.ok && (tipo.startsWith("image/") || tipo === "application/pdf")) {
    const blob = await r.blob();
    // Algunos entornos pierden el tipo al leer el blob: se repone.
    return blob.type ? blob : new Blob([blob], { type: tipo });
  }
  let mensaje = "";
  if (tipo.includes("application/json")) {
    const j = (await r.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof j?.error === "string") mensaje = j.error;
  }
  if (!mensaje) mensaje = r.status === 403 ? "No tienes permiso para ver facturas." : `El servidor respondió ${r.status}.`;
  throw new ErrorOriginal(mensaje, r.status);
}

/** El original como Blob, cacheado por documento. Solo se pide con `activo`. */
export function useOriginalDrive(facturaId: number | null | undefined, activo = true) {
  return useQuery({
    queryKey: ["factura-original-drive", facturaId],
    enabled: activo && typeof facturaId === "number" && facturaId > 0,
    staleTime: VIDA_MS,
    gcTime: VIDA_MS,
    // Un 4xx no se arregla reintentando (sin permiso, sin archivo…); un fallo de red o 5xx, una vez.
    retry: (n, e) => n < 1 && !(e instanceof ErrorOriginal && e.estado >= 400 && e.estado < 500),
    queryFn: () => descargarOriginalDrive(facturaId as number),
  });
}

/** blob URL de un Blob, que se libera al cambiar o desmontar. */
export function useUrlDeBlob(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
