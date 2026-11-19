// ============================================================================
//  chat-facturas · tabla del presupuesto, montada por el servidor (16/11/2026)
// ----------------------------------------------------------------------------
//  TS puro (sin Deno): corre bajo vitest.
//
//  Antes la tabla la escribía el modelo de chat con el resultado de
//  comparar_presupuesto recortado (40 líneas, 14.000 caracteres): con la
//  tarifa real del dueño enseñó 4 ofertas y dijo que no podía totalizar.
//  Ahora:
//    - tablaPresupuesto: TODAS las líneas, en tres secciones (Interesa,
//      Revisar, No interesa), ordenadas por ahorro, y el ahorro total al año
//      contado una vez por producto. Es determinista: mismas cifras siempre.
//    - resumenParaModelo: lo único que ve el modelo (totales y las 5 mejores),
//      para escribir un comentario corto. La tabla se añade debajo.
//
//  Seguimientos (19/11/2026, prueba del dueño en la demo): a «dime los cinco
//  que más me interesan» y «ponme sus precios con IVA, sin IVA y a cuánto lo
//  compro yo» el chat repetía el resumen y la tabla de 30 filas: el modelo
//  volvía a llamar a comparar_presupuesto, la tabla se pegaba siempre y
//  resumenParaModelo le obligaba a «2-4 lineas». Ahora:
//    - mostrarTablaPresupuesto: la tabla solo en la primera comparación tras
//      adjuntar, si se pide verla o si cambia el descuento;
//    - detalleParaModelo: en los demás casos el modelo recibe las líneas con
//      el precio por envase, con y sin IVA, y lo que se pagó la última vez,
//      y la orden de contestar SOLO lo que se pregunta.
//    - Las tablas dan el precio por botella o envase cuando se sabe (antes
//      €/l: 29,03 €/l en lugar de 21,77 € la botella de 75 cl).
// ============================================================================

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** 1.234,56 (con punto de miles también en 4 cifras, que toLocaleString no pone). */
const num = (x: number, d: number): string => {
  const [ent, dec] = Math.abs(x).toFixed(d).split(".");
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${x < 0 ? "-" : ""}${miles}${dec ? `,${dec}` : ""}`;
};

const eur = (n: unknown, dec?: number): string => {
  const x = typeof n === "number" ? n : Number(n);
  if (n === null || n === undefined || !Number.isFinite(x)) return "—";
  return `${num(x, dec ?? (Math.abs(x) < 1 ? 3 : 2))} €`;
};

const pct = (n: unknown): string => {
  const x = Number(n);
  if (n === null || n === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : ""}${num(x, 1)} %`;
};

const entero = (n: unknown) => num(Number(n ?? 0), 0);

/** Texto de una celda: sin barras ni saltos (rompen la tabla Markdown) y sin marcado. */
const celda = (s: unknown, max = 70): string => {
  const t = String(s ?? "").replace(/[|\r\n]+/g, " ").replace(/[*_`<>[\]]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const porUnidad = (u: unknown) => (u ? `/${u}` : "");

const MOTIVOS: Record<string, string> = {
  formato_distinto: "otro envase o tamaño",
  unidades_distintas: "se compra en otra unidad",
  sin_historial: "sin precio de compra",
  sin_compras_12m: "sin compras en 12 meses",
  coincidencia_dudosa: "no es seguro que sea el mismo producto",
  diferencia_sospechosa: "más de un 60 % de diferencia: seguramente otro formato (caja frente a unidad)",
  referencia_dudosa: "el último precio pagado no cuadra con la media de 12 meses (revisar el historial)",
  hay_mejor_proveedor: "ya hay otro proveedor más barato",
  precio_similar: "precio parecido (±2 %)",
};

function motivoLegible(l: Json): string {
  const base = MOTIVOS[String(l?.motivo ?? "")] ?? (l?.motivo ? String(l.motivo) : "");
  const nota = l?.nota && l.nota !== "sin confirmar" ? String(l.nota) : l?.nota === "sin confirmar" ? "sin confirmar por la IA" : "";
  if (l?.motivo === "unidades_distintas" && Array.isArray(l?.unidades_en_historial)) {
    return `${base} (${l.unidades_en_historial.join(", ")})`;
  }
  return [base, nota].filter(Boolean).join(": ");
}

const descuentoTexto = (d: Json): string => {
  if (!d || d.tipo === "ninguno") return "sin descuento";
  if (d.tipo === "porcentaje") return `descuento del ${Number(d.pct).toLocaleString("es-ES")} %`;
  if (d.tipo === "importe") return `descuento de ${eur(d.importe)} (${Number(d.pct_equivalente ?? 0).toLocaleString("es-ES")} %)`;
  return "";
};

/** Filas que se enseñan por defecto (las que más ahorran) y como mucho en «ver más». */
export const FILAS_POR_DEFECTO = 30;
export const FILAS_VER_MAS = 60;

export type VistaPresupuesto = "interesa" | "revisar" | "no_interesa";

export function vistaDe(v: unknown): VistaPresupuesto {
  const s = String(v ?? "").toLowerCase().replace(/\s+/g, "_");
  return s === "revisar" ? "revisar" : s === "no_interesa" ? "no_interesa" : "interesa";
}

/** «ver los de Revisar», «enséñame los que no interesan»: qué tabla pide el usuario (por defecto, Interesa). */
export function verDePregunta(p: unknown): VistaPresupuesto {
  const s = String(p ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\bno\s+(me\s+)?interesa/.test(s)) return "no_interesa";
  // Solo si PIDE VER la tabla («ver/enséñame/muéstrame … revisar», «los de Revisar»): «revisa esta tarifa y dime qué interesa» no.
  if (/\b(ver|veo|ensen\w*|muestr\w*|dame|saca|abre|pon|quiero ver)\b[^.?!]{0,40}\brevisar\b|\b(los|las|lo|la|tabla|pestana|lista|vista)( \w+){0,2} (de|en|a) revisar\b/.test(s)) return "revisar";
  return "interesa";
}

const ultimoTxt = (l: Json, u: string): string =>
  l?.ultimo ? `${eur(l.ultimo.precio)}${u}${l.ultimo.proveedor ? ` (${celda(l.ultimo.proveedor, 18)})` : ""}` : "—";

const UNIDADES_ENVASE = new Set(["ud", "botella", "lata", "bote", "frasco", "brik", "envase", "garrafa"]);
const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** «75 cl», «caja», «kg»: a qué se refiere el precio por envase de una línea. */
export function etiquetaEnvase(l: Json): string {
  const ut = String(l?.unidad_tarifa ?? "").toLowerCase();
  const env = l?.envase ? celda(l.envase, 24) : "";
  if (!ut || UNIDADES_ENVASE.has(ut)) return env || "ud";
  return env ? `${ut} · ${env}` : ut;
}

/**
 * Precio de la tarifa y último pagado por el MISMO envase (botella, lata, paquete o caja), solo si están los dos:
 * una fila nunca mezcla €/botella con €/l.
 */
export function preciosEnvase(l: Json): { tarifa: number; ultimo: number; etiqueta: string } | null {
  const pe = l?.precio_envase;
  if (!pe || !finito(pe.tarifa) || !finito(pe.ultimo)) return null;
  return { tarifa: pe.tarifa, ultimo: pe.ultimo, etiqueta: etiquetaEnvase(l) };
}

const ofertaTxt = (l: Json, u: string, conPct: boolean): string => {
  const pe = preciosEnvase(l);
  const pctTxt = conPct ? ` (${pct(l?.dif_pct)})` : "";
  return pe ? `${eur(pe.tarifa)} · ${pe.etiqueta}${pctTxt}` : `${eur(l?.oferta)}${u}${pctTxt}`;
};

const pagadoTxt = (l: Json, u: string): string => {
  const pe = preciosEnvase(l);
  if (!pe) return ultimoTxt(l, u);
  return `${eur(pe.ultimo)}${l?.ultimo?.proveedor ? ` (${celda(l.ultimo.proveedor, 18)})` : ""}`;
};

const tablaMd = (cab: string, alin: string, filas: string[]) => [cab, alin, ...filas].join("\n");

/**
 * La tabla en Markdown (GFM). Por defecto solo «Interesa»: las 30 que más ahorran y el total (la tabla real de la
 * revisión de producción tenía 470 filas y 77.000 caracteres: no cabía en el móvil ni se leía). «Revisar» y
 * «No interesa» se piden con `ver` («ver los de Revisar»).
 */
export function tablaPresupuesto(r: Json, ver: unknown = "interesa"): string {
  const vista = vistaDe(ver);
  const lineas: Json[] = Array.isArray(r?.lineas) ? r.lineas : [];
  const res = r?.resumen ?? {};
  const interesa = lineas.filter((l) => l?.veredicto === "Interesa");
  const noInteresa = lineas.filter((l) => l?.veredicto === "No interesa");
  const revisar = lineas.filter((l) => l?.veredicto !== "Interesa" && l?.veredicto !== "No interesa");
  const porAhorro = (a: Json, b: Json) => (Number(b?.ahorro_anual ?? -Infinity) - Number(a?.ahorro_anual ?? -Infinity));
  interesa.sort(porAhorro);
  noInteresa.sort((a, b) => Number(b?.dif_pct ?? 0) - Number(a?.dif_pct ?? 0));
  revisar.sort(porAhorro);

  const out: string[] = [];
  const quien = r?.proveedor ? ` de ${celda(r.proveedor, 60)}` : "";
  out.push(
    `**Tarifa «${celda(r?.archivo ?? "presupuesto", 80)}»${quien}** · ${descuentoTexto(r?.descuento)} · precios sin IVA. ` +
      `${entero(res.lineas_total)} artículos: ${entero(res.lineas_que_compras)} se parecen a lo que compras y ${entero(res.no_los_compras)} no.`,
  );
  if (r?.descuento?.aviso) out.push(`_${celda(r.descuento.aviso, 400)}_`);
  out.push(
    `**Ahorro estimado al año: ${eur(res.ahorro_anual_interesa, 2)}** si compras a este proveedor los ${entero(res.productos_interesa ?? interesa.length)} productos que interesan ` +
      `(con lo que gastaste en los últimos 12 meses; cada producto se cuenta una vez).`,
  );

  const u = (l: Json) => porUnidad(l?.unidad);
  if (vista === "interesa") {
    // Las «otra referencia» (el mismo producto en otra línea) no suman: fuera de la lista corta.
    const principales = interesa.filter((l) => !l?.otra_referencia);
    const otras = interesa.length - principales.length;
    const mostrar = principales.slice(0, FILAS_POR_DEFECTO);
    if (mostrar.length > 0) {
      out.push(`### Interesa: los ${mostrar.length} que más ahorran (de ${principales.length})`);
      out.push(tablaMd("| Producto de la tarifa | Oferta | Último pagado | Ahorro/año |", "|---|---:|---|---:|",
        mostrar.map((l) => `| ${celda(l?.producto, 46)} | ${ofertaTxt(l, u(l), true)} | ${pagadoTxt(l, u(l))} | ${eur(l?.ahorro_anual, 2)} |`)));
    }
    const resto = principales.length - mostrar.length;
    const notas: string[] = [];
    if (resto > 0) notas.push(`otros ${entero(resto)} que interesan${otras > 0 ? ` (y ${entero(otras)} segundas referencias del mismo producto)` : ""} suman el resto del ahorro`);
    if (revisar.length > 0) notas.push(`${entero(revisar.length)} para revisar a mano`);
    if (noInteresa.length > 0) notas.push(`${entero(noInteresa.length)} que no interesan`);
    if (notas.length > 0) out.push(`Además: ${notas.join(", ")}. Pídeme «ver los de Revisar» o «ver los que no interesan» y te los enseño.`);
  } else if (vista === "revisar") {
    const mostrar = revisar.slice(0, FILAS_VER_MAS);
    out.push(`### Revisar (${mostrar.length}${revisar.length > mostrar.length ? ` de ${revisar.length}` : ""})`);
    out.push(tablaMd("| Producto de la tarifa | Lo que compras | Por qué |", "|---|---|---|",
      mostrar.map((l) => `| ${celda(l?.producto, 46)} | ${celda(l?.coincide_con, 40)} | ${celda(motivoLegible(l), 110)} |`)));
    if (revisar.length > mostrar.length) out.push(`Faltan ${entero(revisar.length - mostrar.length)} más, con motivos parecidos (formato u otra unidad en su mayoría).`);
  } else {
    const mostrar = noInteresa.slice(0, FILAS_VER_MAS);
    out.push(`### No interesa (${mostrar.length}${noInteresa.length > mostrar.length ? ` de ${noInteresa.length}` : ""})`);
    out.push(tablaMd("| Producto de la tarifa | Oferta | Último pagado | Dif. |", "|---|---:|---|---:|",
      mostrar.map((l) => `| ${celda(l?.producto, 46)} | ${ofertaTxt(l, u(l), false)} | ${pagadoTxt(l, u(l))} | ${pct(l?.dif_pct)} |`)));
  }
  if (lineas.length === 0) out.push("Ningún artículo de la tarifa se parece a lo que compras.");
  return out.join("\n\n");
}

/** Lo que ve el modelo: totales y las 5 mejores ofertas. La tabla la pone la app. */
export function resumenParaModelo(r: Json): Json {
  const lineas: Json[] = Array.isArray(r?.lineas) ? r.lineas : [];
  const top = lineas
    .filter((l) => l?.veredicto === "Interesa" && !l?.otra_referencia)
    .sort((a, b) => Number(b?.ahorro_anual ?? 0) - Number(a?.ahorro_anual ?? 0))
    .slice(0, 5)
    .map((l) => ({
      producto: l.coincide_con ?? l.producto, oferta: l.oferta, ultimo: l.ultimo?.precio, unidad: l.unidad, ahorro_anual: l.ahorro_anual,
      ...(preciosEnvase(l) ? { envase: etiquetaEnvase(l), precio_envase: l.precio_envase } : {}),
    }));
  return {
    proveedor: r?.proveedor ?? null,
    descuento: r?.descuento ?? null,
    resumen: r?.resumen ?? {},
    mejores: top,
    tabla: "YA ESTA HECHA: la app la añade debajo de tu respuesta (los 30 que mas ahorran; Revisar y No interesa, si el usuario los pide).",
    como_responder: "Escribe SOLO 2-4 lineas: cuantos productos interesan, el ahorro estimado al año (resumen.ahorro_anual_interesa, " +
      "con el consumo de los ultimos 12 meses), los 2-3 mejores de «mejores» y cuantos hay que revisar. NO hagas tabla ni listas largas. " +
      "La app enseña los 30 que mas ahorran; si el usuario pide ver los de Revisar o los que no interesan, vuelve a llamar a comparar_presupuesto " +
      "con los mismos datos (la app ya mira si pide Revisar o No interesa). Si el descuento es un importe (descuento.aviso), di en una frase como se ha repartido.",
  };
}

// ─── Seguimientos sobre la misma tarifa (19/11/2026) ────────────────────────

/** Descuento con el que se llamó a comparar_presupuesto (argumentos del modelo). */
export interface DescuentoPedido { descuento_tipo?: unknown; descuento_valor?: unknown }

const sinAcentos = (p: unknown) => String(p ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** «ninguno», «porcentaje:5», «importe:120»: para saber si el descuento cambió. */
export function claveDescuento(a: DescuentoPedido | null | undefined): string {
  const tipo = String(a?.descuento_tipo ?? "").toLowerCase();
  if (tipo !== "porcentaje" && tipo !== "importe") return "ninguno";
  const v = Number(a?.descuento_valor);
  return `${tipo}:${Number.isFinite(v) ? Math.round(v * 100) / 100 : "?"}`;
}

const NUMERO_PEDIDO = /\b(\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\b/;

/**
 * ¿Pide ver la tabla de la comparación? «enséñame la tabla otra vez», «la comparativa completa», «ver todos los que
 * interesan». No: «ponme en una tabla los cinco que más interesan» (eso es una tabla corta que escribe el modelo).
 */
export function pideTablaCompleta(pregunta: unknown): boolean {
  const s = sinAcentos(pregunta);
  if (/\bsolo\b/.test(s) || NUMERO_PEDIDO.test(s.replace(/\b\d+([.,]\d+)?\s*(%|por ?ciento|euros?|eur|€)/g, ""))) return false;
  if (/\b(tabla|comparativa|comparacion|lista|listado)\b/.test(s) &&
      /\b(complet\w*|enter\w*|toda|todos|todas|otra vez|de nuevo|vuelv\w*|repit\w*|ensen\w*|muestr\w*|ver|veo|saca|pon|ponme|dame)\b/.test(s)) return true;
  return /\b(ver|veo|ensen\w*|muestr\w*|dame|saca)\b[^.?!]{0,30}\b(todos|todas|los|las)\b[^.?!]{0,20}\binteres\w*/.test(s) ||
    /\btodos los que (me )?interes\w*/.test(s);
}

/**
 * ¿Se pega la tabla debajo de la respuesta? Solo en la primera comparación tras adjuntar la tarifa, cuando el
 * usuario pide verla (Interesa, Revisar o No interesa) o cuando cambia el descuento (cambian todas las cifras).
 * En el resto de seguimientos («los cinco que más me interesan», «precios con IVA») contesta el modelo con
 * detalleParaModelo y sin tabla.
 */
export function mostrarTablaPresupuesto(pregunta: unknown, args: DescuentoPedido | null | undefined, previa: DescuentoPedido | null | undefined): boolean {
  if (!previa) return true;
  if (verDePregunta(pregunta) !== "interesa") return true;
  if (pideTablaCompleta(pregunta)) return true;
  return claveDescuento(args) !== claveDescuento(previa);
}

/** Líneas que el detalle lleva como mucho (las que interesan, por ahorro). */
export const MAX_LINEAS_DETALLE = 40;
/** Líneas de Revisar / No interesa que se añaden porque la pregunta las nombra. */
export const MAX_LINEAS_NOMBRADAS = 12;

const PALABRAS_VACIAS = new Set(["que", "los", "las", "del", "de", "la", "el", "un", "una", "con", "sin", "por", "para", "me", "mi", "mas",
  "precio", "precios", "iva", "cuanto", "compro", "pago", "pagado", "tarifa", "articulo", "articulos", "producto", "productos", "este",
  "esta", "estos", "estas", "interesa", "interesan", "ponme", "dime", "dame", "cual", "cuales", "como", "hay", "son", "sale", "salen",
  "botella", "botellas", "caja", "cajas", "litro", "litros", "solo", "cinco", "diez", "todos", "todas", "proveedor", "nuevo", "barato"]);

/** Palabras con contenido de la pregunta («beefeater», «ruinart»): para añadir las líneas que nombra. */
function palabrasDe(pregunta: unknown): string[] {
  return [...new Set(sinAcentos(pregunta).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !PALABRAS_VACIAS.has(w)))];
}

function nombraLinea(l: Json, palabras: string[]): boolean {
  if (palabras.length === 0) return false;
  const nombre = sinAcentos(`${l?.producto ?? ""} ${l?.coincide_con ?? ""}`);
  return palabras.some((w) => new RegExp(`\\b${w}`).test(nombre));
}

const r2 = (n: unknown) => (finito(n) ? n : undefined);

/** Una línea para el modelo: solo cifras ya calculadas (no recalcula nada). */
function lineaDetalle(l: Json, puesto?: number): Json {
  const pe = l?.precio_envase ?? {};
  const fila: Json = {
    ...(puesto ? { puesto } : {}),
    producto: celda(l?.producto, 80),
    es: l?.coincide_con ? celda(l.coincide_con, 80) : undefined,
    envase: etiquetaEnvase(l),
    sin_iva: r2(pe.tarifa),
    iva_pct: r2(l?.iva_pct),
    con_iva: r2(pe.tarifa_con_iva),
    tu_precio_sin_iva: r2(pe.ultimo),
    tu_precio_con_iva: r2(pe.ultimo_con_iva),
    ultimo_proveedor: l?.ultimo?.proveedor ?? undefined,
    ultima_fecha: l?.ultimo?.fecha ?? undefined,
    por_unidad: finito(l?.oferta) ? `${eur(l.oferta)}${porUnidad(l?.unidad)}${l?.ultimo?.precio !== undefined ? ` (tú ${eur(l.ultimo.precio)}${porUnidad(l?.unidad)})` : ""}` : undefined,
    dif_pct: r2(l?.dif_pct),
    ahorro_anual: r2(l?.ahorro_anual),
  };
  if (l?.veredicto !== "Interesa") {
    fila.veredicto = l?.veredicto ?? "Revisar";
    const m = motivoLegible(l);
    if (m) fila.motivo = m;
  }
  if (l?.otra_referencia) fila.otra_referencia = true;
  for (const k of Object.keys(fila)) if (fila[k] === undefined) delete fila[k];
  return fila;
}

/**
 * Lo que ve el modelo en un seguimiento SIN tabla: las líneas que interesan (por ahorro, con el precio por envase
 * con y sin IVA y lo que se pagó la última vez) y las de Revisar / No interesa que nombra la pregunta.
 */
export function detalleParaModelo(r: Json, pregunta: unknown): Json {
  const lineas: Json[] = Array.isArray(r?.lineas) ? r.lineas : [];
  const res = r?.resumen ?? {};
  const porAhorro = (a: Json, b: Json) => Number(b?.ahorro_anual ?? -Infinity) - Number(a?.ahorro_anual ?? -Infinity);
  const interesa = lineas.filter((l) => l?.veredicto === "Interesa" && !l?.otra_referencia).sort(porAhorro);
  const palabras = palabrasDe(pregunta);
  const enLista = new Set(interesa.slice(0, MAX_LINEAS_DETALLE));
  const nombradas = lineas.filter((l) => !enLista.has(l) && nombraLinea(l, palabras)).slice(0, MAX_LINEAS_NOMBRADAS);
  return {
    proveedor: r?.proveedor ?? null,
    descuento: r?.descuento ?? null,
    resumen: {
      lineas_total: res.lineas_total, se_parecen_a_lo_que_compras: res.lineas_que_compras,
      productos_interesa: res.productos_interesa ?? interesa.length, ahorro_anual_interesa: res.ahorro_anual_interesa,
      revisar: res.revisar, no_interesa: res.no_interesa,
    },
    interesa: interesa.slice(0, MAX_LINEAS_DETALLE).map((l, i) => lineaDetalle(l, i + 1)),
    ...(interesa.length > MAX_LINEAS_DETALLE ? { interesa_sin_listar: interesa.length - MAX_LINEAS_DETALLE } : {}),
    ...(nombradas.length > 0 ? { otras_que_nombra: nombradas.map((l) => lineaDetalle(l)) } : {}),
    tabla: "NO se añade esta vez: el usuario pregunta algo concreto. Contesta tú con estas cifras.",
    como_leer: "puesto = orden por ahorro al año. sin_iva / con_iva = precio de la tarifa por envase (envase: botella, lata, " +
      "paquete o caja tal como lo vende), con el descuento ya aplicado; iva_pct = el IVA de tus facturas de ese producto. " +
      "tu_precio_sin_iva / tu_precio_con_iva = lo que pagaste la ultima vez por ese mismo envase (ultimo_proveedor, ultima_fecha). " +
      "por_unidad = la comparacion en €/l, €/kg o €/ud. Si falta con_iva es que no consta el IVA de ese producto.",
    como_responder: "Contesta SOLO lo que pregunta el usuario, con estas cifras tal cual (ya calculadas: no recalcules). " +
      "Si pide N articulos, da exactamente N, por puesto. Si pide precios, da los que pide (sin IVA, con IVA, lo que paga el) " +
      "por envase; si falta el IVA de uno, dilo en ese. Una tabla corta con solo esas columnas vale. NO repitas el resumen " +
      "de la tarifa, el ahorro total ni cuantos hay que revisar salvo que lo pregunte. Si pregunta por un articulo que no esta " +
      "aqui, dilo y ofrece «ver los de Revisar».",
  };
}
