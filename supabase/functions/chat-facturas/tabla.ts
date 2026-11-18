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
        mostrar.map((l) => `| ${celda(l?.producto, 46)} | ${eur(l?.oferta)}${u(l)} (${pct(l?.dif_pct)}) | ${ultimoTxt(l, u(l))} | ${eur(l?.ahorro_anual, 2)} |`)));
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
      mostrar.map((l) => `| ${celda(l?.producto, 46)} | ${eur(l?.oferta)}${u(l)} | ${ultimoTxt(l, u(l))} | ${pct(l?.dif_pct)} |`)));
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
    .map((l) => ({ producto: l.coincide_con ?? l.producto, oferta: l.oferta, ultimo: l.ultimo?.precio, unidad: l.unidad, ahorro_anual: l.ahorro_anual }));
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
