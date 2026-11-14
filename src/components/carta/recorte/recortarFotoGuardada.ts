/**
 * Recorta una foto YA GUARDADA en una ficha de la carta y deja en la ficha la
 * foto de carta compuesta con el fondo elegido:
 *
 *   foto original (bajada del bucket) → reducida antes de decodificar
 *   (reducirFotoRecorte) → modelo + refinado del navegador
 *   (quitarFondoNavegador: WebGPU si hay, si no WASM) → composición con el
 *   tema → `<ruta>-carta-<ext>.webp` en el bucket → `imagen_url` de la ficha.
 *
 * La ficha solo se toca si SIGUE apuntando a esa foto original: si mientras
 * tanto alguien le puso otra, no se pisa (ErrorFichaCambiada).
 *
 * Platos y vinos (08/11/2026, en Supabase solo el sticker): al terminar, la
 * foto `<id>.<ext>` deja de ser la de la web y queda como original. Se sube
 * a Google Drive (guardarOriginalCarta) y SOLO si queda allí se borra del
 * bucket (si otra ficha no la usa). Si Drive falla, se queda en el bucket
 * (scripts/carta/mover-originales-a-drive.mjs la moverá) y se avisa.
 * Lo usa el ordenador que recorta fotos pendientes (potente/procesarTrabajoRecorte.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { borrarFotoSiNoSeUsa, rutaEnBucket } from "@/lib/storage-carta";
import { solicitarRepublicacion } from "@/lib/rebuild-webs";
import { componerFotoCarta, type NombreTema } from "../composicionCarta";
import { extensionFoto } from "../composicionVino";
import { rutaCartaDesdeOriginal } from "../rutasFotoCarta";
import { BUCKET_TABLA, TIPO_TABLA, type DatosRecorte } from "./recorteMovil";
import { reducirFotoRecorte } from "./reducirFotoRecorte";
import { esTablaOriginal, guardarOriginalCarta } from "../originalCarta";
import type { ProgresoRecorte } from "./quitarFondoNavegador";

const sb = supabase as unknown as SupabaseClient;

/** En el ordenador, como en el formulario. */
export const LADO_RECORTE_PC = 1600;

export class ErrorFichaCambiada extends Error {
  constructor() {
    super("La ficha ya tiene otra foto: no se toca");
    this.name = "ErrorFichaCambiada";
  }
}

const ORIGEN_PUBLICACION: Record<DatosRecorte["tabla"], string> = {
  Platos: "plato",
  Vinos: "vino",
  Bebidas: "bebida",
  Cocteles: "coctel",
};

export interface OpcionesRecorteGuardado {
  /** La foto original si ya se tiene; si no, se baja del bucket. */
  original?: Blob | null;
  /** Lado mayor de la foto que entra al recorte. */
  lado?: number;
  onProgreso?: (p: ProgresoRecorte) => void;
  /** Solo para pruebas: subir el original a Drive y borrarlo del bucket. */
  guardarOriginal?: typeof guardarOriginalCarta;
  borrar?: typeof borrarFotoSiNoSeUsa;
}

export async function recortarFotoGuardada(d: DatosRecorte, opts: OpcionesRecorteGuardado = {}): Promise<string> {
  const bucket = BUCKET_TABLA[d.tabla];
  const almacen = sb.storage.from(bucket);
  let original = opts.original ?? null;
  if (!original) {
    const { data, error } = await almacen.download(d.rutaOriginal);
    if (error || !data) throw error ?? new Error("No se pudo bajar la foto original");
    original = data;
  }
  // Platos y vinos: el original se guarda para Drive (después del recorte).
  const paraDrive = esTablaOriginal(d.tabla) ? original : null;
  const reducida = await reducirFotoRecorte(original, opts.lado ?? LADO_RECORTE_PC);
  original = null;
  const { quitarFondoNavegador } = await import("./quitarFondoNavegador");
  let sticker = await quitarFondoNavegador(reducida, opts.onProgreso);
  if (TIPO_TABLA[d.tabla] === "plato") {
    // El modelo a veces deja solo la comida: se busca el plato entero (completarPlato.ts).
    try {
      sticker = await (await import("./completarPlato")).completarPlato(reducida, sticker);
    } catch (e) {
      console.warn("[recorte] no se pudo completar el plato", e);
    }
  }
  const compuesta = await componerFotoCarta(sticker, { tipo: TIPO_TABLA[d.tabla], tema: d.tema as NombreTema });
  const rutaCarta = rutaCartaDesdeOriginal(d.rutaOriginal, extensionFoto(compuesta));

  // ¿Sigue la ficha con ESA foto? (si no, no se sube ni se pisa nada)
  const { data: ficha, error: eLeer } = await sb.from(d.tabla).select("imagen_url").eq("id", d.registroId).maybeSingle();
  if (eLeer) throw eLeer;
  if (!ficha) throw new ErrorFichaCambiada();
  const actual = rutaEnBucket((ficha as { imagen_url?: string | null }).imagen_url, bucket);
  if (actual !== d.rutaOriginal && actual !== rutaCarta) throw new ErrorFichaCambiada();

  const { error: eSubir } = await almacen.upload(rutaCarta, compuesta, { upsert: true, contentType: compuesta.type });
  if (eSubir) throw eSubir;
  const url = `${almacen.getPublicUrl(rutaCarta).data.publicUrl}?t=${Date.now()}`;
  const { error: eGuardar } = await sb.from(d.tabla).update({ imagen_url: url }).eq("id", d.registroId);
  if (eGuardar) throw eGuardar;
  void solicitarRepublicacion(ORIGEN_PUBLICACION[d.tabla]);
  if (paraDrive && esTablaOriginal(d.tabla) && d.rutaOriginal !== rutaCarta) {
    const subir = opts.guardarOriginal ?? guardarOriginalCarta;
    const borrar = opts.borrar ?? borrarFotoSiNoSeUsa;
    // Nunca lanza: la foto de la web ya está guardada.
    if (await subir(d.tabla, d.registroId, paraDrive)) {
      await borrar({ tabla: d.tabla, bucket, ruta: d.rutaOriginal, excluirId: d.registroId });
    }
  }
  return url;
}
