/**
 * Datos reales de la demo (Supabase `sfonaclosuafvlhutkon`, consultados el
 * 03-11-2026 con las mismas RPC que usa el informe) para la web de Casa Tomás,
 * octubre de 2026 comparado con septiembre. Cosas a tener en cuenta, que son
 * justo las que el informe tiene que resolver bien:
 *   · Hasta el 22 de septiembre todo es 0: Web Analytics aún no medía (la
 *     primera visita registrada es del 23).
 *   · Del 27 al 31 de octubre no hay datos (la sincronización se cortó con la
 *     migración de cuenta de Vercel): NULL, no 0.
 */
import type { DatosInformeTrafico, FilaSerie } from "@/hooks/useTraficoWeb";

// [fecha, visitas, visitantes, z_dow, es_anomalia]
type FilaCompacta = [string, number | null, number | null, number | null, boolean | null];

const SERIE: FilaCompacta[] = [
  ...Array.from({ length: 22 }, (_, i): FilaCompacta => [`2026-09-${String(i + 1).padStart(2, "0")}`, 0, 0, null, null]),
  ["2026-09-23", 1, 1, null, null],
  ["2026-09-24", 36, 5, null, null],
  ["2026-09-25", 30, 4, null, null],
  ["2026-09-26", 30, 7, null, null],
  ["2026-09-27", 3, 1, null, null],
  ["2026-09-28", 67, 6, null, null],
  ["2026-09-29", 96, 6, null, null],
  ["2026-09-30", 136, 10, 303.658, true],
  ["2026-10-01", 53, 10, 2.845, true],
  ["2026-10-02", 28, 6, 1.64, false],
  ["2026-10-03", 40, 7, 2.534, true],
  ["2026-10-04", 29, 5, 21.168, true],
  ["2026-10-05", 11, 3, -0.08, false],
  ["2026-10-06", 35, 3, 0.485, false],
  ["2026-10-07", 16, 4, -0.123, false],
  ["2026-10-08", 23, 3, 0.346, false],
  ["2026-10-09", 18, 3, 0.556, false],
  ["2026-10-10", 39, 6, 1.49, false],
  ["2026-10-11", 0, 0, -0.458, false],
  ["2026-10-12", 25, 4, 0.447, false],
  ["2026-10-13", 5, 2, -0.376, false],
  ["2026-10-14", 1, 1, -0.412, false],
  ["2026-10-15", 19, 4, 0.138, false],
  ["2026-10-16", 3, 2, -0.56, false],
  ["2026-10-17", 9, 3, -0.334, false],
  ["2026-10-18", 16, 4, 1.055, false],
  ["2026-10-19", 0, 0, -0.591, false],
  ["2026-10-20", 1, 1, -0.469, false],
  ["2026-10-21", 17, 5, -0.047, false],
  ["2026-10-22", 42, 8, 1.27, false],
  ["2026-10-23", 1, 1, -0.668, false],
  ["2026-10-24", 3, 2, -0.64, false],
  ["2026-10-25", 1, 1, -0.463, false],
  ["2026-10-26", 7, 3, -0.249, false],
  ["2026-10-27", null, null, null, null],
  ["2026-10-28", null, null, null, null],
  ["2026-10-29", null, null, null, null],
  ["2026-10-30", null, null, null, null],
  ["2026-10-31", null, null, null, null],
];

export const filaSerie = ([fecha, visitas, visitantes, z_dow, es_anomalia]: FilaCompacta): FilaSerie => ({
  fecha,
  visitas,
  visitantes,
  media_7: null,
  media_30: null,
  desv_30: null,
  media_dow: null,
  desv_dow: null,
  n_dow: 8,
  z_dow,
  desviacion_pct: null,
  es_anomalia,
});

const pagina = (ruta: string, visitas: number) => ({
  proyecto: "casa-tomas-story",
  ruta,
  visitas,
  bytes_estimados: null,
  pct_visitas: null,
  pct_bytes: null,
});

export const DATOS_DEMO_OCTUBRE_2026: DatosInformeTrafico = {
  serie: SERIE.map(filaSerie),
  paginas: [
    pagina("/", 200),
    pagina("/carta/vinos", 59),
    pagina("/carta/novedades-del-dia", 57),
    pagina("/carta", 40),
    pagina("/reservas", 16),
    pagina("/carta/entrantes-calientes", 11),
    pagina("/carta/entrantes-frios", 7),
    pagina("/carta/mariscos", 7),
    pagina("/carta/snack", 7),
    pagina("/carta/ensaladas", 6),
    pagina("/carta/postres", 6),
    pagina("/en", 4),
    pagina("/carta/arroces", 3),
    pagina("/carta/bebidas", 3),
    pagina("/carta/carnes", 3),
    pagina("/el-restaurante", 3),
    pagina("/politica-privacidad", 3),
    pagina("/carta/pescados", 2),
    pagina("/regala", 2),
    pagina("/aviso-legal", 1),
    pagina("/condiciones", 1),
    pagina("/reserva/respuesta", 1),
  ],
  dispositivos: [
    { valor: "mobile", visitas: 294, visitantes: 60, pct: 66.52 },
    { valor: "desktop", visitas: 148, visitantes: 31, pct: 33.48 },
  ],
  paises: [
    { valor: "ES", visitas: 440, visitantes: 90, pct: 99.55 },
    { valor: "US", visitas: 2, visitantes: 1, pct: 0.45 },
  ],
  procedencias: [
    { valor: "(directo)", visitas: 399, visitantes: 88, pct: 90.27 },
    { valor: "checkout.stripe.com", visitas: 26, visitantes: 15, pct: 5.88 },
    { valor: "vercel.com", visitas: 17, visitantes: 7, pct: 3.85 },
  ],
  primerDiaConVisitas: "2026-09-23",
};

/**
 * Un mes «normal» inventado (los dos meses completos, Google e Instagram entre
 * las procedencias, visitantes extranjeros…) para probar las reglas que los
 * datos de la demo no tocan: comparación de totales, conclusiones de redes y
 * buscadores, idiomas, etc.
 */
export function datosMesCompleto(): DatosInformeTrafico {
  const serie: FilaSerie[] = [];
  // Septiembre (30 días) a ~40/día y octubre (31 días) a ~50/día; sábados más fuertes.
  for (let d = 1; d <= 30; d++) {
    const fecha = `2026-09-${String(d).padStart(2, "0")}`;
    const sabado = new Date(`${fecha}T12:00:00`).getDay() === 6;
    serie.push(filaSerie([fecha, sabado ? 70 : 36, sabado ? 30 : 15, null, false]));
  }
  for (let d = 1; d <= 31; d++) {
    const fecha = `2026-10-${String(d).padStart(2, "0")}`;
    const sabado = new Date(`${fecha}T12:00:00`).getDay() === 6;
    serie.push(filaSerie([fecha, sabado ? 90 : 45, sabado ? 36 : 18, d === 17 ? 2.6 : 0.3, d === 17]));
  }
  return {
    serie,
    paginas: [
      pagina("/", 600),
      pagina("/carta", 300),
      pagina("/carta/vinos", 200),
      pagina("/reservas", 180),
      pagina("/en", 90),
      pagina("/en/carta", 60),
      pagina("/fr", 30),
      pagina("/carta/mariscos", 25),
      pagina("/regala", 15),
    ],
    dispositivos: [
      { valor: "mobile", visitas: 1200, visitantes: 500, pct: 78 },
      { valor: "desktop", visitas: 300, visitantes: 120, pct: 19.5 },
      { valor: "tablet", visitas: 40, visitantes: 15, pct: 2.5 },
    ],
    paises: [
      { valor: "ES", visitas: 1300, visitantes: 520, pct: 84.4 },
      { valor: "FR", visitas: 120, visitantes: 50, pct: 7.8 },
      { valor: "GB", visitas: 80, visitantes: 30, pct: 5.2 },
      { valor: "DE", visitas: 40, visitantes: 15, pct: 2.6 },
    ],
    procedencias: [
      { valor: "google.com", visitas: 500, visitantes: 200, pct: 32 },
      { valor: "www.google.es", visitas: 100, visitantes: 40, pct: 6 },
      { valor: "(directo)", visitas: 400, visitantes: 150, pct: 26 },
      { valor: "l.instagram.com", visitas: 300, visitantes: 120, pct: 19 },
      { valor: "instagram.com", visitas: 50, visitantes: 20, pct: 3 },
      { valor: "facebook.com", visitas: 100, visitantes: 40, pct: 6 },
      { valor: "tripadvisor.es", visitas: 60, visitantes: 25, pct: 4 },
      { valor: "checkout.stripe.com", visitas: 30, visitantes: 10, pct: 2 },
    ],
    primerDiaConVisitas: "2026-03-01",
  };
}
