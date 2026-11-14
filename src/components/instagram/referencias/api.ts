/**
 * «Lo que publicáis ahora»: últimas publicaciones y stories activas de la
 * cuenta de Instagram de la marca (Edge Function instagram-estado, POST
 * { accion: "referencias", marca }). Solo lectura; con la sesión del panel,
 * como el resto de llamadas a instagram-estado. Las URLs de Meta caducan:
 * no se guardan en ningún sitio (solo en la caché de React Query mientras
 * se ve la página).
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";
import { ErrorInstagram, URL_ESTADO } from "@/components/marketing/instagram/api";

export type MarcaReferencias = "casa-tomas" | "touza";
export type TipoReferencia = "imagen" | "video" | "carrusel" | "reel" | "story";

export interface MedioReferencia {
  id: string;
  tipo: TipoReferencia;
  mediaUrl: string | null;
  miniaturaUrl: string | null;
  permalink: string | null;
  caption: string | null;
  fecha: string | null;
}

export interface RespuestaReferencias {
  marca: MarcaReferencias;
  cuenta: { igUserId: string | null; username: string | null };
  publicaciones: MedioReferencia[];
  stories: MedioReferencia[];
  avisos: string[];
}

const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");
const TIPOS: TipoReferencia[] = ["imagen", "video", "carrusel", "reel", "story"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON del servidor sin tipar: se normaliza aquí.
type Crudo = Record<string, any>;

function medio(x: Crudo): MedioReferencia | null {
  if (!x || typeof x !== "object" || !x.id) return null;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: String(x.id),
    tipo: TIPOS.includes(x.tipo) ? x.tipo : "imagen",
    mediaUrl: s(x.mediaUrl),
    miniaturaUrl: s(x.miniaturaUrl),
    permalink: s(x.permalink),
    caption: s(x.caption),
    fecha: s(x.fecha),
  };
}

const lista = (v: unknown) => (Array.isArray(v) ? v.map(medio).filter((m): m is MedioReferencia => m !== null) : []);

export function normalizarReferencias(r: Crudo, marca: MarcaReferencias): RespuestaReferencias {
  return {
    marca: r.marca === "touza" || r.marca === "casa-tomas" ? r.marca : marca,
    cuenta: { igUserId: r.cuenta?.igUserId ?? null, username: r.cuenta?.username ?? null },
    publicaciones: lista(r.publicaciones),
    stories: lista(r.stories),
    avisos: Array.isArray(r.avisos) ? r.avisos.map(String) : [],
  };
}

export async function leerReferencias(marca: MarcaReferencias, opts: { fetch?: typeof fetch; token?: string | null } = {}): Promise<RespuestaReferencias> {
  let token = opts.token;
  if (token === undefined) {
    try {
      token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    } catch {
      token = null;
    }
  }
  if (!token) throw new ErrorInstagram("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(URL_ESTADO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CLAVE_PUBLICA,
        "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ accion: "referencias", marca }),
    });
  } catch (e) {
    throw new ErrorInstagram((e as Error)?.message || "Sin conexión", "red");
  }
  let cuerpo: Crudo | null = null;
  try {
    cuerpo = (await r.json()) as Crudo;
  } catch {
    cuerpo = null;
  }
  if (!r.ok || !cuerpo || cuerpo.ok === false) {
    const c = cuerpo ?? {};
    if (r.status === 404 && !c.error) {
      throw new ErrorInstagram("La función de Instagram no está desplegada en este Supabase.", "servidor", 404, "npx supabase functions deploy instagram-estado --project-ref <ref> (docs/instagram.md).");
    }
    throw new ErrorInstagram(
      c.error ?? c.message ?? `El servidor respondió ${r.status}`,
      r.status === 401 || r.status === 403 ? "sesion" : "servidor",
      r.status,
      c.comoArreglarlo,
    );
  }
  if (cuerpo.publicaciones === undefined) {
    // Función desplegada sin la acción: devuelve la comprobación de siempre.
    throw new ErrorInstagram("La función instagram-estado desplegada aún no sabe leer las publicaciones.", "servidor", r.status, "Despliega instagram-estado de nuevo (docs/instagram.md).");
  }
  return normalizarReferencias(cuerpo, marca);
}
