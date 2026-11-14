// ============================================================================
//  Super Admin › Informes — «Informe mensual de costes» (antes «de servicios»,
//  ampliado el 13/11/2026 con el encargo «Pasos para saber el precio de todos
//  los servicios y de las IAs»): el gasto de cada servicio del mes (el mismo
//  que Servicios › Costes › «Informe mensual», generarInformeServicios), la IA
//  función por función, lo que cuesta cada cosa, lo que falta por meter y los
//  precios por confirmar. Tablas, para que la página haga la vista previa, el
//  PDF y el CSV con el formato común de los informes.
// ============================================================================
import { generarInformeServicios } from "@/components/servicios/generarInformeServicios";
import { cargarCostePorUso } from "@/hooks/useCostePorUso";
import {
  type FilaCostePorUso,
  costesPorAccion,
  inventarioServicios,
  textoCosteUso,
  totalesIa,
  ventanaMes,
} from "@/lib/costesServicios";
import { TEXTO_FALTA, TEXTO_ORIGEN, mesAnterior, textoMesCorto, textoMes as textoMesLargo, type InformeMes } from "@/lib/informeServicios";
import type { ServicioContratado } from "@/lib/servicios";
import { textoMes, type Periodo } from "../periodo";
import { nombreArchivoInforme, type ResultadoInformeTabla, type TablaInforme } from "../tabla";

const TITULO = "Informe mensual de costes";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Lo que el informe añade al gasto por servicio (13/11/2026). */
export interface ExtrasInformeCostes {
  /** IA del mes por función (`ia_coste_por_uso`); null si no se puede leer. */
  ia?: FilaCostePorUso[] | null;
  /** La del mes anterior (para «cuánto cuesta cada cosa» si este mes no se usó). */
  iaAnterior?: FilaCostePorUso[] | null;
  /** Servicios, para los precios por confirmar. */
  servicios?: ServicioContratado[];
  eurPorUsd?: number;
}

function tablasIa(ia: FilaCostePorUso[], iaAnterior: FilaCostePorUso[] | null, eurPorUsd: number, mes: string): TablaInforme[] {
  if (ia.length === 0) return [];
  const t = totalesIa(ia);
  const porUso = (f: FilaCostePorUso) =>
    f.usosConCoste === 0
      ? null
      : (f.medianaUsd ?? 0) <= 0
        ? textoCosteUso(f.medianaUsd, eurPorUsd, f.servidorPropio)
        : `${textoCosteUso(f.medianaUsd, eurPorUsd, f.servidorPropio).replace(/^≈ /, "")} por ${f.unidad}`;
  const mesLargo = textoMesLargo(`${mes}-01`);
  const acciones = costesPorAccion({ actual: ia, anterior: iaAnterior, eurPorUsd, textoMes: mesLargo, textoMesAnterior: textoMesLargo(mesAnterior(`${mes}-01`)) });
  return [
    {
      titulo: "IA, función por función",
      columnas: [
        { id: "que", etiqueta: "Qué hace", tipo: "texto" },
        { id: "llamadas", etiqueta: "Llamadas", tipo: "entero" },
        { id: "coste", etiqueta: "Coste", tipo: "eur" },
        { id: "uso", etiqueta: "Coste por uso", tipo: "texto", ancho: 220 },
      ],
      filas: ia.map((f) => ({ que: f.queHace ?? f.funcion, llamadas: f.llamadas, coste: f.costeUsd == null ? null : f.costeUsd * eurPorUsd, uso: porUso(f) })),
      total: { que: "Total", llamadas: t.llamadas, coste: t.costeUsd * eurPorUsd, uso: "" },
      nota:
        "Tokens × tarifa de cada modelo, sin IVA. Ya va dentro de OpenAI en el gasto por servicio: no se suma otra vez." +
        (t.filasSinTarifa ? ` ${t.filasSinTarifa} llamadas de ${t.modelosSinTarifa.join(", ")} sin tarifa: su coste no está sumado.` : ""),
    },
    {
      titulo: "Cuánto cuesta cada cosa",
      columnas: [
        { id: "accion", etiqueta: "Cada vez que…", tipo: "texto" },
        { id: "coste", etiqueta: "Cuesta", tipo: "texto", ancho: 230 },
        { id: "detalle", etiqueta: "Cómo se calcula", tipo: "texto" },
      ],
      filas: acciones.map((a) => ({ accion: a.accion, coste: a.texto, detalle: a.detalle })),
      nota: "La mediana: la mitad de las veces cuesta menos y la otra mitad, más. Un céntimo es 0,01 €.",
    },
  ];
}

/** El informe de un mes como tablas del módulo Informes. Función pura (se prueba sin Supabase). */
export function tablasInformeServicios(informe: InformeMes, mes: string, extras: ExtrasInformeCostes = {}): ResultadoInformeTabla {
  if (informe.filas.length === 0) return { vacio: true, motivo: "No hay servicios contratados." };
  const eurPorUsd = extras.eurPorUsd ?? informe.eurPorUsd;
  const anterior = textoMesCorto(informe.anterior);
  const comparacion =
    informe.diferenciaEur == null
      ? `sin datos de ${anterior} para comparar`
      : `${informe.diferenciaEur >= 0 ? "+" : "−"}${eur.format(Math.abs(informe.diferenciaEur))} frente a ${anterior}`;
  const ia = extras.ia ?? null;
  const costeIa = ia ? totalesIa(ia).costeUsd * eurPorUsd : null;
  const porConfirmar = extras.servicios ? inventarioServicios(extras.servicios, eurPorUsd).filas.filter((f) => f.estado !== "confirmado") : [];
  const descripcion =
    `Gasto en servicios contratados: ${eur.format(informe.totalEur)} (${comparacion}).` +
    (costeIa != null && costeIa > 0 ? ` De ello, inteligencia artificial: unos ${eur.format(costeIa)}.` : "") +
    (informe.faltan.length ? ` Faltan por meter ${informe.faltan.length}.` : "") +
    (porConfirmar.length ? ` Precios por confirmar: ${porConfirmar.length}.` : "") +
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
        nota: `Metido a mano: ${eur.format(informe.manualEur)} · estimado: ${eur.format(informe.estimadoEur)}. Los dólares, a 1 US$ = ${eurPorUsd.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €.`,
      },
      ...(ia ? tablasIa(ia, extras.iaAnterior ?? null, eurPorUsd, mes) : []),
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
      ...(porConfirmar.length
        ? [
            {
              titulo: "Precios por confirmar",
              columnas: [
                { id: "servicio", etiqueta: "Servicio", tipo: "texto" as const },
                { id: "plan", etiqueta: "Plan apuntado", tipo: "texto" as const },
                { id: "precio", etiqueta: "Precio apuntado", tipo: "texto" as const },
                { id: "donde", etiqueta: "Dónde mirarlo", tipo: "texto" as const, ancho: 300 },
              ],
              filas: porConfirmar.map((f) => ({ servicio: f.nombre, plan: f.plan, precio: f.textoMes, donde: f.fuentePrecio ?? f.panelUrl })),
              nota: "Se confirman en Super Admin › Servicios › Costes › «Qué tenemos contratado».",
            },
          ]
        : []),
    ],
  };
}

export async function obtenerInformeServicios(periodo: Periodo): Promise<ResultadoInformeTabla> {
  if (periodo.tipo !== "mes") return { vacio: true, motivo: "Elige un mes." };
  const actual = ventanaMes(`${periodo.mes}-01`);
  const previa = ventanaMes(mesAnterior(`${periodo.mes}-01`));
  const [r, ia, iaAnterior] = await Promise.all([
    generarInformeServicios(`${periodo.mes}-01`),
    // La IA no puede impedir el informe: si falla (o falta 20261129153000), sale sin sus tablas.
    cargarCostePorUso(actual.desde, actual.hasta).catch(() => null),
    cargarCostePorUso(previa.desde, previa.hasta).catch(() => null),
  ]);
  // Casts explícitos: sin strictNullChecks, comprobar `disponible` no estrecha la unión.
  if (r.disponible === false) return { vacio: true, motivo: (r as { motivo: string }).motivo };
  const ok = r as { informe: InformeMes; servicios: ServicioContratado[]; eurPorUsd: number };
  const filas = (x: typeof ia) => (x && x.disponible ? (x as { filas: FilaCostePorUso[] }).filas : null);
  return tablasInformeServicios(ok.informe, periodo.mes, { ia: filas(ia), iaAnterior: filas(iaAnterior), servicios: ok.servicios, eurPorUsd: ok.eurPorUsd });
}
