/**
 * Cliente de «Montar con IA» (acción `montar_pieza` de la Edge Function
 * instagram-ia), según el contrato de src/lib/instagram/montar.ts. El
 * servidor lo hace otro agente; aquí solo se llama, se valida la respuesta y
 * se ofrece un modo SIMULADO para las pruebas y la demo en el navegador.
 *
 * Cuota de IA: este cliente NUNCA reintenta solo. Cada llamada sale de un
 * toque del usuario («Montar con IA», «Otra versión», «Cambiar tono»); el
 * asistente además guarda en caché el resultado por firma y pone un tope de
 * montajes por sesión (MAX_MONTAJES_SESION).
 */
import { ErrorIA, llamar, type OpcionesLlamada, type TonoIA } from "@/components/instagram/ia/api";
import { obtenerPlantilla, plantillaPara, type MarcaId } from "@/lib/instagram";
import {
  MAX_FOTOS_CARRUSEL,
  type DiapositivaMontada,
  type FormatoMontado,
  type FotoParaMontar,
  type PeticionMontar,
  type RespuestaMontar,
} from "@/lib/instagram/montar";

export type FuncionMontar = (p: PeticionMontar, opts?: OpcionesLlamada) => Promise<RespuestaMontar>;

/** Tope de montajes por sesión del asistente (primera + otras versiones + tonos). */
export const MAX_MONTAJES_SESION = 6;
export const MAX_INDICACION = 500;

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);

/** Formato por número de fotos cuando la IA no lo dice (o dice algo imposible). */
export function formatoPorFotos(n: number): FormatoMontado {
  return n <= 1 ? "post" : "carrusel";
}

/** Comprueba la petición antes de gastar una llamada. Lanza ErrorIA («rechazada»). */
export function validarPeticion(p: PeticionMontar): void {
  if (!p.fotos.length) throw new ErrorIA("Añade al menos una foto.", "rechazada");
  if (p.fotos.length > MAX_FOTOS_CARRUSEL) throw new ErrorIA(`Como mucho ${MAX_FOTOS_CARRUSEL} fotos.`, "rechazada");
  if ((p.indicacion ?? "").length > MAX_INDICACION) throw new ErrorIA(`El texto de «¿Algo que contar?» es demasiado largo (máximo ${MAX_INDICACION}).`, "rechazada");
}

/**
 * Respuesta del servidor → RespuestaMontar fiable: solo diapositivas con fotos
 * que se mandaron (sin repetir), hashtags con «#», hora válida o null.
 */
export function normalizarMontaje(c: Record<string, unknown>, fotos: readonly FotoParaMontar[]): RespuestaMontar {
  const ids = new Set(fotos.map((f) => f.id));
  const usadas = new Set<string>();
  const diapositivas: DiapositivaMontada[] = [];
  for (const d of Array.isArray(c.diapositivas) ? c.diapositivas : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const foto = texto(o.foto);
    if (!ids.has(foto) || usadas.has(foto)) continue;
    usadas.add(foto);
    diapositivas.push({
      foto,
      plantilla: texto(o.plantilla),
      datos: o.datos && typeof o.datos === "object" && !Array.isArray(o.datos) ? (o.datos as Record<string, unknown>) : {},
      altText: texto(o.altText),
    });
    if (diapositivas.length >= MAX_FOTOS_CARRUSEL) break;
  }
  if (!diapositivas.length) throw new ErrorIA("La IA no ha devuelto ninguna imagen montada. Prueba otra vez.", "servidor", 502);
  const pedido = c.formato;
  let formato: FormatoMontado = pedido === "post" || pedido === "carrusel" || pedido === "story" ? pedido : formatoPorFotos(diapositivas.length);
  if (formato === "carrusel" && diapositivas.length < 2) formato = "post";
  if (formato !== "carrusel" && diapositivas.length > 1) diapositivas.splice(1);
  const hora = texto(c.horaSugerida);
  const avisos = textos(c.avisos);
  if (usadas.size < fotos.length && formato === "carrusel") avisos.push(`La IA ha dejado fuera ${fotos.length - usadas.size} foto(s).`);
  return {
    ok: true,
    formato,
    diapositivas,
    caption: texto(c.caption),
    hashtags: textos(c.hashtags).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    horaSugerida: hora && !Number.isNaN(Date.parse(hora)) ? hora : null,
    resumen: texto(c.resumen),
    avisos,
  };
}

/** Llama a instagram-ia → montar_pieza. Una sola llamada: sin reintentos automáticos. */
export const montarPieza: FuncionMontar = async (p, opts) => {
  validarPeticion(p);
  const cuerpo: Record<string, unknown> = {
    accion: "montar_pieza",
    marca: p.marca,
    fotos: p.fotos.map((f) => ({ id: f.id, url: f.url, ancho: f.ancho ?? null, alto: f.alto ?? null })),
    formato: p.formato ?? "auto",
  };
  const indicacion = p.indicacion?.trim();
  if (indicacion) cuerpo.indicacion = indicacion;
  if (p.tono) cuerpo.tono = p.tono;
  const c = await llamar(cuerpo, opts);
  if (c.ok === false) {
    const tipo = c.tipo === "cupo" ? "cupo" : c.tipo === "foto_no_valida" ? "rechazada" : "servidor";
    throw new ErrorIA(texto(c.error) || "La IA no ha podido montar la publicación.", tipo);
  }
  return normalizarMontaje(c, p.fotos);
};

/** Mensaje para el usuario, sin jerga. */
export function mensajeErrorMontar(e: unknown): string {
  if (e instanceof ErrorIA) {
    switch (e.tipo) {
      case "cupo":
        return "Por hoy se ha gastado la IA disponible. Prueba más tarde o escribe tú el texto.";
      case "red":
        return "No hay conexión. Cuando vuelva la cobertura, pulsa «Probar otra vez».";
      case "sesion":
        return "Se ha cerrado la sesión. Vuelve a entrar en el panel.";
      case "sin_permiso":
        return "Tu usuario no tiene permiso para Instagram.";
      case "no_desplegada":
      case "configuracion":
        return "La IA de Instagram aún no está lista en el servidor. Avisa a Oficiosos.";
      default:
        return e.message || "La IA no ha podido montar la publicación.";
    }
  }
  return (e as Error)?.message || "La IA no ha podido montar la publicación.";
}

// ── Modo simulado (pruebas y demo) ───────────────────────────────────────────

const RESUMENES: Record<TonoIA, (n: number, extra: string) => string> = {
  cercano: (n, e) => `He entendido: ${n === 1 ? "una foto" : `${n} fotos`} de producto fresco recién llegado${e}. Lo cuento cercano, como en la barra.`,
  elegante: (n, e) => `He entendido: ${n === 1 ? "una foto" : `${n} fotos`} de producto de temporada${e}. Tono sobrio y cuidado.`,
  retranca: (n, e) => `He entendido: ${n === 1 ? "una foto" : `${n} fotos`} de género del bueno${e}. Con un poco de retranca gallega.`,
};

const CAPTIONS: Record<TonoIA, string[]> = {
  cercano: ["Hoy ha llegado así de bonito. Lo tenemos en la carta mientras dure: ven a probarlo.", "Recién descargado y ya en cocina. Si te apetece, te guardamos mesa."],
  elegante: ["Producto de temporada, tratado con respeto. Disponible estos días en Casa Tomás.", "La materia prima manda. Hoy, una selección que merece la visita."],
  retranca: ["Esto no se pesca en el súper. Avisados quedáis.", "Llegó, lo vimos y no pudimos callarlo. Mientras dure, que dura poco."],
};

/** Plantilla con foto de la marca: la portada a sangre (plantillas v2). */
function plantillaConFoto(marca: MarcaId): string {
  return plantillaPara(marca, "post", "portada", "sangre")?.id ?? (marca === "touza" ? "tz-portada" : "ct-portada");
}

/**
 * «Montar con IA» simulado: misma forma que el servidor, sin red ni cuota.
 * `espera` en ms (0 en las pruebas). `fallar` hace que la llamada n-ésima lance.
 */
export function crearMontarSimulado(o: { espera?: number; fallar?: (llamada: number) => Error | null } = {}): FuncionMontar & { llamadas: PeticionMontar[] } {
  const llamadas: PeticionMontar[] = [];
  const f = (async (p: PeticionMontar) => {
    validarPeticion(p);
    llamadas.push(p);
    if (o.espera) await new Promise((r) => setTimeout(r, o.espera));
    const error = o.fallar?.(llamadas.length);
    if (error) throw error;
    const tono: TonoIA = p.tono ?? "cercano";
    const version = llamadas.length;
    const plantilla = plantillaConFoto(p.marca);
    const pl = obtenerPlantilla(plantilla);
    const extra = p.indicacion?.trim() ? ` («${p.indicacion.trim().slice(0, 60)}»)` : "";
    const titulares = ["Recién llegado", "Del mar a la mesa", "Solo estos días", "Mira qué género", "Hoy en cocina", "Para compartir", "Fresco de verdad", "Temporada", "Así llega", "Y esto también"];
    const diapositivas = p.fotos.map((foto, i) => {
      const datos: Record<string, unknown> = { titular: titulares[(i + version - 1) % titulares.length] };
      if (pl?.admitidos.includes("antetitulo") && i === 0) datos.antetitulo = p.marca === "touza" ? "Touza" : "Casa Tomás";
      return { foto: foto.id, plantilla, datos, altText: `Foto ${i + 1}: producto fresco sobre la mesa de la cocina.` };
    });
    const mananaMadrid = new Date(Date.now() + 24 * 3600 * 1000);
    mananaMadrid.setUTCHours(12, 0, 0, 0); // 13:00 o 14:00 en Madrid según la época
    return {
      ok: true as const,
      formato: formatoPorFotos(p.fotos.length),
      diapositivas,
      caption: CAPTIONS[tono][(version - 1) % 2] + (p.indicacion?.trim() ? `\n\n${p.indicacion.trim()}.` : ""),
      hashtags: ["#Crevillent", "#productofresco", p.marca === "touza" ? "#Touza" : "#CasaTomas"],
      horaSugerida: mananaMadrid.toISOString(),
      resumen: RESUMENES[tono](p.fotos.length, extra),
      avisos: [],
    };
  }) as FuncionMontar & { llamadas: PeticionMontar[] };
  f.llamadas = llamadas;
  return f;
}
