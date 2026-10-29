import { supabase } from "@/integrations/supabase/client";
import { redimensionarFoto } from "./redimensionarFoto";
import { recortarFoto, type RecorteNormalizado } from "./recorteFoto";
import type { ResultadoFotoCarta } from "./fotoCartaVino";

export interface FuentePrecioMercado {
  tienda: string;
  url: string;
  precio: number;
}

/** Datos que devuelve la Edge Function `extraer-vino-foto` (campos de `Vinos` + extras). */
export interface DatosVinoFoto {
  nombre: string | null;
  categoria: string | null;
  descripcion: string | null;
  ingredientes: string | null;
  denominacion_origen: string | null;
  ubicacion_region: string | null;
  ubicacion_pais: string | null;
  /** Ya no se usa (el formulario de vino no tiene alérgenos); se ignora. */
  contiene_sulfitos?: boolean;
  /** Pueden no venir si la función desplegada es anterior. */
  precio_sugerido?: number | null;
  precio_razon?: string | null;
  /** Mediana del precio en tiendas online españolas (€, botella 75 cl). */
  precio_mercado?: number | null;
  /** Hasta 3 tiendas donde se vio el precio. */
  precio_mercado_fuentes?: FuentePrecioMercado[];
  recorte?: RecorteNormalizado | null;
}

export interface VinoDesdeFoto {
  datos: DatosVinoFoto;
  /**
   * Foto redimensionada y encuadrada en 3:4 (recorteFoto.ts). El recorte sin
   * fondo y la foto de carta los hace el formulario (recorte/useRecorteVino).
   */
  foto: File;
  /** Modo lote: recorte ya lanzado en segundo plano (el formulario lo espera). */
  recorte?: Promise<ResultadoFotoCarta>;
  /** Aviso corto sobre la foto para el usuario. */
  avisoFoto?: string;
  /** Modo lote: se llama al guardar el vino en el formulario. */
  alGuardar?: () => void;
  /** Modo lote: se llama al cerrar el formulario (guardado o no). */
  alCerrar?: () => void;
}

function aDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Precio sugerido válido (número finito > 0) o null. */
export function precioSugerido(d: Pick<DatosVinoFoto, "precio_sugerido"> | null | undefined): number | null {
  const p = d?.precio_sugerido;
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
}

/** Precio de tienda válido (número finito > 0) o null. */
export function precioMercado(d: Pick<DatosVinoFoto, "precio_mercado"> | null | undefined): number | null {
  const p = d?.precio_mercado;
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
}

/** Fuentes del precio de tienda con URL http(s) válida (máx. 3). */
export function fuentesMercado(d: Pick<DatosVinoFoto, "precio_mercado_fuentes"> | null | undefined): FuentePrecioMercado[] {
  const lista = Array.isArray(d?.precio_mercado_fuentes) ? d.precio_mercado_fuentes : [];
  return lista
    .filter(
      (f) =>
        f && typeof f.url === "string" && /^https?:\/\//i.test(f.url) && typeof f.precio === "number" && f.precio > 0,
    )
    .slice(0, 3);
}

export function formatoEuros(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Redimensiona, manda a `extraer-vino-foto` y encuadra la foto. Lanza error si la lectura falla. */
export async function leerVinoDeFoto(file: File, categorias: string[]): Promise<VinoDesdeFoto> {
  const r = await redimensionarFoto(file);
  const imagen = await aDataUrl(r.blob);
  // Diagnóstico desde el móvil (chrome://inspect): qué se manda realmente a la IA.
  console.info("[extraer-vino-foto] foto", {
    tipo: file.type || "(vacío)",
    bytesOriginal: file.size,
    original: `${r.original.ancho}x${r.original.alto}`,
    final: `${r.final.ancho}x${r.final.alto}`,
    metodo: r.metodo,
    bytesBase64: imagen.length,
  });
  const { data, error } = await supabase.functions.invoke("extraer-vino-foto", {
    body: { imagen, categorias: categorias.filter(Boolean) },
  });
  if (error || !data?.ok || !data?.vino) {
    throw new Error(data?.error || error?.message || "Respuesta vacía");
  }
  const datos = data.vino as DatosVinoFoto;
  console.info(
    "[extraer-vino-foto] campos recibidos",
    Object.entries(datos)
      .filter(([, v]) => v !== null && v !== "" && v !== false && v !== undefined)
      .map(([k]) => k),
  );
  const blob = await recortarFoto(r.blob, datos.recorte);
  return { datos, foto: new File([blob], "botella.jpg", { type: "image/jpeg" }) };
}
