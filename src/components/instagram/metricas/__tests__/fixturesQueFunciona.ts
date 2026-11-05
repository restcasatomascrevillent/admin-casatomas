/** Respuestas de la RPC instagram_que_funciona para las pruebas del panel. */
import type { GrupoQueFunciona, QueFunciona } from "../tipos";

const g = (clave: string, publicaciones: number, tasa: number, suficiente = publicaciones >= 3): GrupoQueFunciona => ({
  clave, publicaciones, alcance_medio: 1000, tasa, guardados_por_alcance: 1, suficiente, orden: 0,
});

/** Igual que lo que devuelve la RPC en la prueba PGlite (12 publicaciones). */
export const QF_CON_DATOS: QueFunciona = {
  periodo_dias: 90,
  minimo: 3,
  publicaciones: 12,
  con_pieza: 8,
  tasa_media: 5.5,
  suficiente: true,
  aviso: null,
  por: {
    formato: [g("reel", 4, 9), g("post", 8, 3.6)],
    plantilla: [g("ct-foto-titular", 4, 4), g("ct-tipografica", 4, 3)],
    tipo_foto: [g("plato", 4, 4)],
    dia: [g("martes", 4, 9), g("miércoles", 3, 5), g("jueves", 4, 4), g("sábado", 4, 3), g("viernes", 3, 2), g("domingo", 1, 20), g("lunes", 1, 1)],
    franja: [g("12-14", 4, 9), g("20-22", 8, 3.6)],
    hashtag: [g("#cocido", 4, 9), g("#casatomas", 8, 6.5)],
  },
  conclusiones: [
    { eje: "formato", estado: "mejor", clave: "reel", publicaciones: 4, tasa: 9, tasa_media: 5.5, texto: "Los reels funcionan mejor: …" },
    { eje: "plantilla", estado: "parecido", tasa_media: 5.5, texto: "Por plantilla no hay diferencias claras todavía." },
    { eje: "tipo_foto", estado: "faltan_datos", tasa_media: 5.5, texto: "Por tipo de foto faltan datos: hacen falta al menos 3 publicaciones en dos grupos distintos." },
    { eje: "dia", estado: "mejor", clave: "martes", publicaciones: 4, tasa: 9, tasa_media: 5.5, texto: "Los martes funcionan mejor: …" },
    { eje: "franja", estado: "mejor", clave: "12-14", publicaciones: 4, tasa: 9, tasa_media: 5.5, texto: "Publicar entre las 12 y las 14 h…" },
    { eje: "hashtag", estado: "mejor", clave: "#cocido", publicaciones: 4, tasa: 9, tasa_media: 5.5, texto: "Las publicaciones con #cocido…" },
  ],
  mejores: [],
  peores: [],
};

export const QF_POCOS: QueFunciona = {
  ...QF_CON_DATOS,
  publicaciones: 2,
  suficiente: false,
  aviso: "Solo hay 2 publicaciones con datos en los últimos 90 días: hacen falta al menos 6 para sacar conclusiones.",
  por: { formato: [g("reel", 2, 9)], dia: [g("martes", 2, 9)], franja: [g("12-14", 2, 9)] },
  conclusiones: ["formato", "plantilla", "tipo_foto", "dia", "franja", "hashtag"].map((eje) => ({
    eje: eje as QueFunciona["conclusiones"][number]["eje"],
    estado: "faltan_datos" as const,
    tasa_media: 9,
    texto: `Por ${eje} faltan datos: hacen falta al menos 3 publicaciones en dos grupos distintos.`,
  })),
};
