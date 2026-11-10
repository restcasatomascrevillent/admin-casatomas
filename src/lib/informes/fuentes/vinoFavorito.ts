// ============================================================================
//  Super Admin › Informes — «Votación del vino favorito»: recuento por vino y
//  participantes, lo mismo que Gestor Web › Carta › Vinos › Resultados y su
//  CSV (src/components/carta/EncuestaVinoFavorito.tsx).
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { recuentoPorVino, type VotoVino } from "@/hooks/useEncuestaVinos";
import type { ContextoInforme } from "../registro";
import { nombreArchivoInforme, type ResultadoInformeTabla } from "../tabla";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export function informeVinoFavorito(votos: readonly VotoVino[], ctx: ContextoInforme): ResultadoInformeTabla {
  if (votos.length === 0) return { vacio: true, motivo: "Todavía no ha votado nadie." };
  const recuento = recuentoPorVino(votos);
  const titulo = "Votación del vino favorito";
  return {
    vacio: false,
    titulo,
    descripcion: `${votos.length} ${votos.length === 1 ? "participante" : "participantes"} en «Vota tu vino favorito y entra en el sorteo».`,
    textoPeriodo: "Todos los votos",
    tablas: [
      {
        titulo: "Votos por vino",
        columnas: [
          { id: "vino", etiqueta: "Vino", tipo: "texto" },
          { id: "votos", etiqueta: "Votos", tipo: "entero" },
          { id: "pct", etiqueta: "% de los votos", tipo: "pct" },
        ],
        filas: recuento.map((r) => ({ vino: r.vino, votos: r.votos, pct: (r.votos / votos.length) * 100 })),
        total: { vino: "Total", votos: votos.length, pct: 100 },
      },
      {
        titulo: "Participantes",
        columnas: [
          { id: "fecha", etiqueta: "Fecha", tipo: "fecha" },
          { id: "nombre", etiqueta: "Nombre", tipo: "texto" },
          { id: "contacto", etiqueta: "Contacto", tipo: "texto" },
          { id: "vino", etiqueta: "Vino", tipo: "texto" },
          { id: "idioma", etiqueta: "Idioma", tipo: "texto" },
        ],
        filas: votos.map((v) => ({ fecha: fechaHora(v.created_at), nombre: v.nombre, contacto: v.contacto, vino: v.vino_nombre, idioma: v.idioma })),
      },
    ],
    nombreArchivo: nombreArchivoInforme(titulo, ctx.hoy),
  };
}

export async function obtenerInformeVinoFavorito(ctx: ContextoInforme): Promise<ResultadoInformeTabla> {
  const { data, error } = await supabase
    .from("votos_vino_favorito")
    .select("id, vino_id, vino_nombre, nombre, contacto, idioma, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "No se han podido leer los votos.");
  return informeVinoFavorito(data ?? [], ctx);
}
