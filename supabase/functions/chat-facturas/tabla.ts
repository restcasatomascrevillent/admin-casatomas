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

const eur = (n: unknown, dec?: number): string => {
  const x = typeof n === "number" ? n : Number(n);
  if (n === null || n === undefined || !Number.isFinite(x)) return "—";
  const d = dec ?? (Math.abs(x) < 1 ? 3 : 2);
  return `${x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} €`;
};

const pct = (n: unknown): string => {
  const x = Number(n);
  if (n === null || n === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : ""}${x.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
};

const entero = (n: unknown) => Number(n ?? 0).toLocaleString("es-ES");

/** Texto de una celda: sin barras ni saltos (rompen la tabla Markdown) y sin marcado. */
const celda = (s: unknown, max = 70): string => {
  const t = String(s ?? "").replace(/[|\r\n]+/g, " ").replace(/[*_`<>[\]]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const porUnidad = (u: unknown) => (u ? ` /${u}` : "");

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

/** La tabla completa en Markdown (GFM), lista para pintar en el panel. */
export function tablaPresupuesto(r: Json): string {
  const lineas: Json[] = Array.isArray(r?.lineas) ? r.lineas : [];
  const res = r?.resumen ?? {};
  const interesa = lineas.filter((l) => l?.veredicto === "Interesa");
  const noInteresa = lineas.filter((l) => l?.veredicto === "No interesa");
  const revisar = lineas.filter((l) => l?.veredicto !== "Interesa" && l?.veredicto !== "No interesa");
  const porAhorro = (a: Json, b: Json) => (Number(b?.ahorro_anual ?? -Infinity) - Number(a?.ahorro_anual ?? -Infinity));
  interesa.sort(porAhorro);
  noInteresa.sort((a, b) => Number(b?.dif_pct ?? 0) - Number(a?.dif_pct ?? 0));

  const out: string[] = [];
  const quien = r?.proveedor ? ` de ${celda(r.proveedor, 60)}` : "";
  out.push(
    `**Tarifa «${celda(r?.archivo ?? "presupuesto", 80)}»${quien}** · ${descuentoTexto(r?.descuento)} · precios sin IVA. ` +
      `${entero(res.lineas_total)} artículos: ${entero(res.lineas_que_compras)} se parecen a lo que compras y ${entero(res.no_los_compras)} no.`,
  );
  out.push(
    `**Ahorro estimado al año: ${eur(res.ahorro_anual_interesa, 2)}** si compras a este proveedor los ${entero(res.productos_interesa ?? interesa.length)} productos que interesan ` +
      `(con lo que gastaste en los últimos 12 meses; cada producto se cuenta una vez).`,
  );

  if (interesa.length > 0) {
    out.push(`### Interesa (${interesa.length})`);
    const t = ["| Producto de la tarifa | Lo que compras | Oferta | Último pagado | Media 12 m | Mejor actual | Dif. | Ahorro/año |", "|---|---|---:|---|---:|---|---:|---:|"];
    for (const l of interesa) {
      const u = porUnidad(l?.unidad);
      const ult = l?.ultimo ? `${eur(l.ultimo.precio)}${u} (${celda(l.ultimo.proveedor, 28)})` : "—";
      const mej = l?.mejor_actual ? `${eur(l.mejor_actual.precio)} (${celda(l.mejor_actual.proveedor, 28)})` : "—";
      const ahorro = l?.otra_referencia ? "otra ref. del mismo producto" : eur(l?.ahorro_anual, 2);
      t.push(`| ${celda(l?.producto)} | ${celda(l?.coincide_con, 50)} | ${eur(l?.oferta)}${u} | ${ult} | ${l?.media_12m ? eur(l.media_12m.precio) : "—"} | ${mej} | ${pct(l?.dif_pct)} | ${ahorro} |`);
    }
    out.push(t.join("\n"));
  }
  if (revisar.length > 0) {
    out.push(`### Revisar (${revisar.length})`);
    const t = ["| Producto de la tarifa | Lo que compras | Oferta | Último pagado | Por qué |", "|---|---|---:|---|---|"];
    for (const l of revisar) {
      const u = porUnidad(l?.unidad);
      const ult = l?.ultimo ? `${eur(l.ultimo.precio)}${u} (${celda(l.ultimo.proveedor, 28)})` : "—";
      t.push(`| ${celda(l?.producto)} | ${celda(l?.coincide_con, 50)} | ${l?.oferta != null ? `${eur(l.oferta)}${u}` : "—"} | ${ult} | ${celda(motivoLegible(l), 110)} |`);
    }
    out.push(t.join("\n"));
  }
  if (noInteresa.length > 0) {
    out.push(`### No interesa (${noInteresa.length})`);
    const t = ["| Producto de la tarifa | Lo que compras | Oferta | Último pagado | Dif. |", "|---|---|---:|---|---:|"];
    for (const l of noInteresa) {
      const u = porUnidad(l?.unidad);
      const ult = l?.ultimo ? `${eur(l.ultimo.precio)}${u} (${celda(l.ultimo.proveedor, 28)})` : "—";
      t.push(`| ${celda(l?.producto)} | ${celda(l?.coincide_con, 50)} | ${eur(l?.oferta)}${u} | ${ult} | ${pct(l?.dif_pct)} |`);
    }
    out.push(t.join("\n"));
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
    tabla: "YA ESTA HECHA: la app la añade debajo de tu respuesta con TODAS las lineas (Interesa, Revisar, No interesa).",
    como_responder: "Escribe SOLO 2-4 lineas: cuantos productos interesan, el ahorro estimado al año (resumen.ahorro_anual_interesa, " +
      "con el consumo de los ultimos 12 meses), los 2-3 mejores de «mejores» y cuantos hay que revisar. NO hagas tabla ni listas largas " +
      "y no digas que el resultado esta recortado.",
  };
}
