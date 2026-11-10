// ============================================================================
//  Super Admin › Informes — «Informe mensual de servicios»: el mismo que
//  Servicios › Costes › «Informe mensual» (generarInformeServicios), pasado a
//  tablas para que la página haga la vista previa, el PDF y el CSV con el
//  formato común de los informes.
// ============================================================================
import { generarInformeServicios } from "@/components/servicios/generarInformeServicios";
import { TEXTO_FALTA, TEXTO_ORIGEN, textoMesCorto, type InformeMes } from "@/lib/informeServicios";
import { textoMes, type Periodo } from "../periodo";
import { nombreArchivoInforme, type ResultadoInformeTabla } from "../tabla";

const TITULO = "Informe mensual de servicios";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** El informe de un mes de Servicios como tablas del módulo Informes. Función pura (se prueba sin Supabase). */
export function tablasInformeServicios(informe: InformeMes, mes: string): ResultadoInformeTabla {
  if (informe.filas.length === 0) return { vacio: true, motivo: "No hay servicios contratados." };
  const anterior = textoMesCorto(informe.anterior);
  const comparacion =
    informe.diferenciaEur == null
      ? `sin datos de ${anterior} para comparar`
      : `${informe.diferenciaEur >= 0 ? "+" : "−"}${eur.format(Math.abs(informe.diferenciaEur))} frente a ${anterior}`;
  const descripcion =
    `Gasto en servicios contratados: ${eur.format(informe.totalEur)} (${comparacion}).` +
    (informe.faltan.length ? ` Faltan por meter ${informe.faltan.length}.` : "") +
    (informe.enCurso ? " El mes está en curso: las cifras aún pueden crecer." : "");
  return {
    vacio: false,
    titulo: TITULO,
    descripcion,
    textoPeriodo: textoMes(mes),
    nombreArchivo: nombreArchivoInforme(TITULO, mes),
    tablas: [
      {
        titulo: "Gasto por servicio",
        columnas: [
          { id: "servicio", etiqueta: "Servicio", tipo: "texto" },
          { id: "origen", etiqueta: "Origen", tipo: "texto" },
          { id: "total", etiqueta: "Este mes", tipo: "eur" },
          { id: "anterior", etiqueta: anterior, tipo: "eur" },
          { id: "diferencia", etiqueta: "Diferencia", tipo: "eur" },
        ],
        filas: informe.filas.map((f) => ({
          servicio: f.nombre,
          origen: f.origen === "falta" && f.falta ? `${TEXTO_ORIGEN.falta}: ${TEXTO_FALTA[f.falta].toLowerCase()}` : TEXTO_ORIGEN[f.origen],
          total: f.origen === "falta" ? null : f.totalEur,
          anterior: f.anteriorEur,
          diferencia: f.diferenciaEur,
        })),
        total: { servicio: "Total", origen: "", total: informe.totalEur, anterior: informe.totalAnteriorEur, diferencia: informe.diferenciaEur },
        nota: `Metido a mano: ${eur.format(informe.manualEur)} · estimado: ${eur.format(informe.estimadoEur)}.`,
      },
      ...(informe.faltan.length
        ? [
            {
              titulo: "Falta por meter",
              columnas: [
                { id: "servicio", etiqueta: "Servicio", tipo: "texto" as const },
                { id: "motivo", etiqueta: "Qué falta", tipo: "texto" as const },
              ],
              filas: informe.faltan.map((f) => ({ servicio: f.nombre, motivo: f.falta ? TEXTO_FALTA[f.falta] : TEXTO_ORIGEN.falta })),
            },
          ]
        : []),
    ],
  };
}

export async function obtenerInformeServicios(periodo: Periodo): Promise<ResultadoInformeTabla> {
  if (periodo.tipo !== "mes") return { vacio: true, motivo: "Elige un mes." };
  const r = await generarInformeServicios(`${periodo.mes}-01`);
  // Casts explícitos: sin strictNullChecks, comprobar `disponible` no estrecha la unión.
  if (r.disponible === false) return { vacio: true, motivo: (r as { motivo: string }).motivo };
  return tablasInformeServicios((r as { informe: InformeMes }).informe, periodo.mes);
}
