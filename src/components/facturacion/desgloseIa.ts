// ============================================================================
//  Recibo mensual · desglose de la IA (OpenAI) por lo que se ha hecho en el panel
// ----------------------------------------------------------------------------
//  25/11/2026, petición del dueño al ver el recibo mensual: «Que salga cuánto ha
//  sido subiendo facturas, cuánto en el chat, cuánto leyendo etiquetas, cuánto
//  traduciendo, cuánto generando novedades...».
//
//  De dónde sale: cada llamada a la IA ya se apunta con su función, sus tokens y
//  su coste (`ia_coste_por_uso`, migración 20261129153000; lo mismo que Servicios ›
//  Costes › «IA, función por función»). Aquí se agrupa por lo que entiende el
//  dueño y se reparte la LÍNEA DE OPENAI del recibo, sin cambiar su importe:
//    · lo registrado ≤ la línea: cada grupo con lo suyo y la diferencia en
//      «Sin asignar» (lo que OpenAI cobra y aquí no se apunta: llamadas sin
//      registrar, redondeos, tarifas que han cambiado);
//    · lo registrado > la línea (la línea es la factura de OpenAI o su estimación
//      y lo registrado es tokens × tarifa): se reparte la línea en proporción.
//  En el recibo se guarda la PARTE de cada grupo (0–1), no euros: así, si se
//  cambia el precio o el descuento de la línea, el desglose sigue cuadrando.
// ============================================================================
import type { FilaCostePorUso } from "@/lib/costesServicios";

export interface ParteDesglose {
  concepto: string;
  /** Fracción de la línea (las de una línea suman 1). */
  parte: number;
  /** Veces que se ha usado (si se sabe). */
  usos?: number;
}

interface GrupoIa {
  concepto: string;
  funciones: readonly string[];
  /** Los que pidió el dueño: salen siempre que tengan gasto, aunque sea poco. */
  pedido?: boolean;
}

/** Grupos en el orden en que salen. Una función que no esté aquí va a «Otros». */
export const GRUPOS_IA: readonly GrupoIa[] = [
  { concepto: "Subir y leer facturas", funciones: ["ocr-trabajo", "procesar-factura", "importar-factura-historica"], pedido: true },
  { concepto: "Chat (Facturas y web)", funciones: ["chat-facturas", "chat-web"], pedido: true },
  { concepto: "Leer etiquetas de vino", funciones: ["extraer-vino-foto", "buscar-puntuacion-parker"], pedido: true },
  { concepto: "Traducir la carta", funciones: ["traducir-contenido"], pedido: true },
  { concepto: "Generar novedades", funciones: ["format-novedad"], pedido: true },
  { concepto: "Instagram y redes sociales", funciones: ["instagram-ia", "rrss-ia"] },
  { concepto: "Newsletter", funciones: ["newsletter-ia"] },
  { concepto: "Contestar reseñas", funciones: ["resenas-contestador"] },
  { concepto: "Ordenar productos de las facturas", funciones: ["clasificar-productos", "embeddings-nombres"] },
  { concepto: "Leer reservas escritas a mano", funciones: ["interpretar-reserva-manuscrita"] },
  { concepto: "Dictado por voz", funciones: ["transcribir-dictado"] },
  { concepto: "Probar modelos de IA (Servicios)", funciones: ["ia-modelos-openai"] },
  { concepto: "Avisos de la web y peticiones del panel", funciones: ["procesar-logs-web", "resumen-logs-web", "analizar-peticion"] },
];
export const CONCEPTO_OTROS = "Otros";
export const CONCEPTO_SIN_ASIGNAR = "Sin asignar";
/** Por debajo de esta parte, un grupo no pedido va a «Otros». */
const PARTE_MINIMA = 0.03;
/** «Sin asignar» por debajo de esto (fracción de la línea) es ruido de redondeo: no sale. */
const SIN_ASIGNAR_MINIMO = 0.005;

export interface ResultadoDesgloseIa {
  desglose: ParteDesglose[];
  /** Lo apuntado en el panel (€) para ese mes. */
  registradoEur: number;
  /** true: lo registrado pasaba de la línea y se ha repartido en proporción. */
  proporcional: boolean;
}

/**
 * El desglose de una línea de IA de `importeEur` con lo apuntado por función ese mes.
 * null si no hay nada apuntado (la línea sale sola, como antes).
 */
export function desgloseIa(filas: FilaCostePorUso[], importeEur: number, eurPorUsd: number): ResultadoDesgloseIa | null {
  if (!(importeEur > 0)) return null;
  const grupoDe = new Map(GRUPOS_IA.flatMap((g, i) => g.funciones.map((f) => [f, i] as const)));
  const sumas = new Map<number, { eur: number; usos: number }>(); // -1 = Otros
  for (const f of filas) {
    if (f.servidorPropio || !f.costeUsd || f.costeUsd <= 0) continue;
    const i = grupoDe.get(f.funcion) ?? -1;
    const s = sumas.get(i) ?? { eur: 0, usos: 0 };
    s.eur += f.costeUsd * eurPorUsd;
    s.usos += f.usos;
    sumas.set(i, s);
  }
  const registradoEur = [...sumas.values()].reduce((t, s) => t + s.eur, 0);
  if (registradoEur <= 0) return null;
  const proporcional = registradoEur > importeEur;
  const base = proporcional ? registradoEur : importeEur;

  const filasGrupo: ParteDesglose[] = [];
  const otros = { parte: 0, usos: 0 };
  GRUPOS_IA.forEach((g, i) => {
    const s = sumas.get(i);
    if (!s) return;
    const parte = s.eur / base;
    if (g.pedido || parte >= PARTE_MINIMA) filasGrupo.push({ concepto: g.concepto, parte, usos: s.usos });
    else {
      otros.parte += parte;
      otros.usos += s.usos;
    }
  });
  const sueltos = sumas.get(-1);
  if (sueltos) {
    otros.parte += sueltos.eur / base;
    otros.usos += sueltos.usos;
  }
  // Los pedidos en su orden; los demás, de más a menos.
  const pedidos = new Set(GRUPOS_IA.filter((g) => g.pedido).map((g) => g.concepto));
  const desglose = [
    ...filasGrupo.filter((f) => pedidos.has(f.concepto)),
    ...filasGrupo.filter((f) => !pedidos.has(f.concepto)).sort((a, b) => b.parte - a.parte),
  ];
  if (otros.parte > 0) desglose.push({ concepto: CONCEPTO_OTROS, parte: otros.parte, usos: otros.usos });
  const sinAsignar = proporcional ? 0 : 1 - registradoEur / importeEur;
  if (sinAsignar >= SIN_ASIGNAR_MINIMO) desglose.push({ concepto: CONCEPTO_SIN_ASIGNAR, parte: sinAsignar });
  return { desglose: normalizar(desglose), registradoEur, proporcional };
}

/** Que las partes sumen exactamente 1 (y queden con una precisión razonable para guardarlas). */
function normalizar(desglose: ParteDesglose[]): ParteDesglose[] {
  const total = desglose.reduce((t, d) => t + d.parte, 0);
  return total > 0 ? desglose.map((d) => ({ ...d, parte: Math.round((d.parte / total) * 1e6) / 1e6 })) : [];
}

/**
 * Los euros de cada parte de una línea de `importe` €, en céntimos y cuadrando con el importe
 * (método del resto mayor: el céntimo que sobra va a la parte a la que más le falta).
 */
export function importesDesglose(
  importe: number,
  // Laxo a propósito: sin strictNullChecks, el tipo que infiere zod deja todo opcional.
  desglose: readonly Partial<ParteDesglose>[] | undefined,
): { concepto: string; importe: number; usos?: number }[] {
  if (!desglose?.length) return [];
  const centimos = Math.round(importe * 100);
  const total = desglose.reduce((t, d) => t + (d.parte ?? 0), 0) || 1;
  const exactos = desglose.map((d) => (centimos * (d.parte ?? 0)) / total);
  const base = exactos.map((x) => Math.floor(x));
  let resto = centimos - base.reduce((t, x) => t + x, 0);
  const orden = exactos.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; resto > 0 && orden.length; k = (k + 1) % orden.length, resto--) base[orden[k].i]++;
  return desglose.map((d, i) => ({ concepto: d.concepto ?? "", importe: base[i] / 100, ...(d.usos != null ? { usos: d.usos } : {}) }));
}

/** «1.858 usos», «1 uso» o «» (para el PDF y la pantalla). */
export function textoUsos(usos: number | undefined): string {
  if (!usos) return "";
  // «always»: en español, Intl no separa los miles de 4 cifras (1858); aquí sí (1.858).
  return `${new Intl.NumberFormat("es-ES", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(usos)} ${usos === 1 ? "uso" : "usos"}`;
}
