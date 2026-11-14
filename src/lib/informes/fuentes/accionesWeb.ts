// ============================================================================
//  Super Admin › Informes — «Informe mensual de lo que hacen los clientes en la web» (14/11/2026).
//  Petición del dueño: el ranking de lo que más hacen los clientes (ver la carta, abrir
//  un vino, pulsar Reservar, llamar, WhatsApp, cómo llegar, comprar un cheque, buscar…),
//  cuántas veces y en qué % de las visitas, comparado con el mes anterior.
//  Los datos salen de la RPC `informe_acciones_web_mensual` (migración 20261201110000,
//  solo super admin), que lee web_sesiones / web_eventos. SOLO cuenta visitas con el
//  consentimiento «Estadísticas»: el informe lo dice. Aquí solo se convierte en tablas.
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { textoMes, type Periodo } from "../periodo";
import { nombreArchivoInforme, type ColumnaInforme, type ResultadoInformeTabla, type TablaInforme } from "../tabla";

const TITULO = "Informe mensual de lo que hacen los clientes en la web";

export interface AccionWebDatos {
  id: string;
  n: number;
  sesiones: number;
  n_anterior: number;
  sesiones_anterior: number;
}
export interface DatosAccionesWeb {
  mes: string;
  entorno: string;
  sesiones: number;
  sesiones_anterior: number;
  datos_desde: string | null;
  acciones: AccionWebDatos[];
}

/** Cómo se llama cada acción en el informe, con una frase que dice qué se cuenta. */
export const ACCIONES_WEB: Record<string, { grupo: string; texto: string }> = {
  ver_carta: { grupo: "Carta", texto: "Mirar la carta (entrar en cualquier página de la carta)" },
  ver_vinos: { grupo: "Carta", texto: "Mirar la carta de vinos" },
  cambiar_categoria: { grupo: "Carta", texto: "Cambiar de categoría de la carta (entrantes, carnes, postres…)" },
  abrir_plato: { grupo: "Carta", texto: "Abrir un plato para verlo con detalle" },
  abrir_vino: { grupo: "Carta", texto: "Abrir un vino para verlo con detalle" },
  abrir_bebida: { grupo: "Carta", texto: "Abrir una bebida o cóctel" },
  ver_alergenos: { grupo: "Carta", texto: "Mirar los ingredientes y alérgenos de un plato" },
  ampliar_foto: { grupo: "Carta", texto: "Ver la foto de un plato en grande" },
  buscar: { grupo: "Carta", texto: "Buscar algo en la carta" },
  filtrar: { grupo: "Carta", texto: "Filtrar la carta (dieta, tipo de vino…)" },
  mi_mesa: { grupo: "Carta", texto: "Añadir un plato o vino a «Mi mesa»" },
  pulsar_reservar: { grupo: "Reservar", texto: "Pulsar un botón o enlace de «Reservar»" },
  ver_disponibilidad: { grupo: "Reservar", texto: "Comprobar si hay mesa libre" },
  reserva_enviada: { grupo: "Reservar", texto: "Enviar una solicitud de reserva (queda pendiente de que la confirméis)" },
  llamar: { grupo: "Contacto", texto: "Pulsar el teléfono para llamar" },
  whatsapp: { grupo: "Contacto", texto: "Pulsar WhatsApp" },
  como_llegar: { grupo: "Contacto", texto: "Pulsar «Cómo llegar» (el mapa)" },
  correo: { grupo: "Contacto", texto: "Pulsar el correo electrónico" },
  redes: { grupo: "Contacto", texto: "Ir a vuestras redes sociales (Instagram, Facebook…)" },
  ver_cheques: { grupo: "Cheques regalo", texto: "Entrar en la tienda de cheques regalo" },
  ir_a_pagar_cheque: { grupo: "Cheques regalo", texto: "Ir a pagar un cheque regalo (todavía no pagado)" },
  cheque_pagado: { grupo: "Cheques regalo", texto: "Comprar un cheque regalo (pago completado)" },
  chat: { grupo: "Ayuda", texto: "Escribir al asistente «Tomy»" },
};

const col = (id: string, etiqueta: string, tipo: ColumnaInforme["tipo"], ancho?: number): ColumnaInforme => ({ id, etiqueta, tipo, ancho });

const pct = (parte: number, total: number): number | null => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

/** «Sube 2,5 puntos», «Igual», «Nuevo este mes»… sin jerga. */
export function textoCambio(actual: number | null, anterior: number | null): string {
  if (anterior === null || actual === null) return "—";
  if (anterior === 0 && actual > 0) return "Nuevo este mes";
  const d = Math.round((actual - anterior) * 10) / 10;
  if (d === 0) return "Igual";
  const n = Math.abs(d).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${d > 0 ? "Sube" : "Baja"} ${n} puntos`;
}

const NOTA_COOKIES =
  "SOLO cuenta a quien aceptó las cookies de estadísticas: quien las rechaza no sale aquí, así que las cifras reales son mayores. " +
  "«Visita» = una vez que alguien entra en la web (30 minutos sin tocar nada abren otra). Sin bots ni vuestras propias pruebas.";

/** El informe como tablas. Función pura (se prueba sin Supabase). */
export function tablasInformeAccionesWeb(d: DatosAccionesWeb, mes: string): ResultadoInformeTabla {
  const conocidas = d.acciones.filter((a) => ACCIONES_WEB[a.id] && (a.n > 0 || a.n_anterior > 0));
  if (d.sesiones === 0 && conocidas.length === 0) {
    return { vacio: true, motivo: `No hay visitas con cookies aceptadas en ${textoMes(mes)}.` };
  }
  const ordenadas = [...conocidas].sort((a, b) => b.sesiones - a.sesiones || b.n - a.n);

  const tablas: TablaInforme[] = [
    {
      titulo: "Lo que más hacen los clientes",
      columnas: [
        col("puesto", "Puesto", "texto", 70),
        col("que", "Qué hacen", "texto"),
        col("veces", "Veces", "entero", 90),
        col("visitas", "Visitas", "entero", 100),
        col("pct", "% de visitas", "pct", 120),
        col("pct_ant", "Mes anterior", "pct", 120),
        col("cambio", "Cambio", "texto", 170),
      ],
      filas: ordenadas.map((a, i) => {
        const p = pct(a.sesiones, d.sesiones);
        const pa = pct(a.sesiones_anterior, d.sesiones_anterior);
        return { puesto: `${i + 1}º`, que: ACCIONES_WEB[a.id].texto, veces: a.n, visitas: a.sesiones, pct: p, pct_ant: pa, cambio: textoCambio(p, pa) };
      }),
      nota:
        "Ejemplo: «30 %» = de cada 100 visitas, 30 hicieron eso al menos una vez. «Veces» cuenta todas las veces (una misma visita puede repetirlo). " +
        NOTA_COOKIES,
    },
  ];

  const grupos = [...new Set(Object.values(ACCIONES_WEB).map((x) => x.grupo))];
  tablas.push({
    titulo: "Por tipo de cosa",
    columnas: [col("grupo", "Tipo", "texto", 220), col("veces", "Veces", "entero", 110), col("que", "Lo más pulsado", "texto")],
    filas: grupos
      .map((g) => {
        const as = ordenadas.filter((a) => ACCIONES_WEB[a.id].grupo === g);
        return { grupo: g, veces: as.reduce((s, a) => s + a.n, 0), que: as[0] ? ACCIONES_WEB[as[0].id].texto : "—" };
      })
      .filter((f) => f.veces > 0),
    nota: "Agrupa lo de arriba para ver de un vistazo si la gente mira la carta, intenta reservar o contacta.",
  });

  const descripcion =
    `Qué hacen los clientes en la web en ${textoMes(mes)}: ${d.sesiones} ${d.sesiones === 1 ? "visita" : "visitas"} con cookies aceptadas` +
    (d.sesiones_anterior ? ` (el mes anterior, ${d.sesiones_anterior})` : "") +
    ". Solo cuenta a quien aceptó las cookies de estadísticas.";

  return { vacio: false, titulo: TITULO, descripcion, textoPeriodo: textoMes(mes), tablas, nombreArchivo: nombreArchivoInforme(TITULO, mes) };
}

export async function obtenerInformeAccionesWeb(periodo: Periodo): Promise<ResultadoInformeTabla> {
  if (periodo.tipo !== "mes") return { vacio: true, motivo: "Elige un mes." };
  const { data, error } = await supabase.rpc("informe_acciones_web_mensual" as never, { p_mes: periodo.mes } as never);
  if (error) return { vacio: true, motivo: `No se pudo leer lo que hacen los clientes: ${error.message}` };
  return tablasInformeAccionesWeb(data as unknown as DatosAccionesWeb, periodo.mes);
}
