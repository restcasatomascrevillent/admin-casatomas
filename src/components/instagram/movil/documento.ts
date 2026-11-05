/**
 * HTML de una imagen del montaje con el mismo motor que el servidor
 * (construirDocumento), para la vista previa del móvil.
 */
import { baseRecursosPanel, construirDocumento, obtenerPlantilla, type CampoPieza, type DatosPieza, type Foto, type MarcaId } from "@/lib/instagram";
import type { DiapositivaMontada, FormatoMontado, FotoParaMontar } from "@/lib/instagram/montar";

const BASE_RECURSOS = baseRecursosPanel();
const BASE_FICTICIA = "https://foto.invalid";
const RUTA_FICTICIA = "foto-movil.jpg";

/**
 * HTML de una imagen del montaje, o null si la plantilla no existe o no casa
 * con la marca (entonces se enseña la foto sola). La URL de la foto se pone
 * tal cual (sirve igual para la copia tmp/ del bucket que para la simulada).
 */
export function documentoDiapositiva(marca: MarcaId, formato: FormatoMontado, d: DiapositivaMontada, foto: FotoParaMontar | undefined): string | null {
  const pl = obtenerPlantilla(d.plantilla);
  const formatoPieza = formato === "story" ? "story" : "post";
  if (!pl || pl.marca !== marca || !pl.formatos.includes(formatoPieza)) return null;
  const admitidos = new Set<CampoPieza>(pl.admitidos);
  const datos: Record<string, unknown> = { marca, formato: formatoPieza, plantilla: pl.id };
  for (const [k, v] of Object.entries(d.datos)) if (admitidos.has(k as CampoPieza) && k !== "foto" && v !== "" && v != null) datos[k] = v;
  if (datos.titular === undefined) datos.titular = "";
  const catalogo: Foto[] = [];
  if (admitidos.has("foto") && foto) {
    datos.foto = foto.id;
    catalogo.push({ id: foto.id, marca, ruta: RUTA_FICTICIA, ancho: foto.ancho ?? 1080, alto: foto.alto ?? 1350, tipo: null, aptaPost: true, aptaStory: true, descripcion: "" });
  }
  try {
    const html = construirDocumento(datos as unknown as DatosPieza, { baseRecursos: BASE_RECURSOS, baseFotos: BASE_FICTICIA, fotos: catalogo });
    return foto ? html.split(`${BASE_FICTICIA}/${RUTA_FICTICIA}`).join(foto.url.replace(/"/g, "%22").replace(/'/g, "%27")) : html;
  } catch {
    return null;
  }
}

