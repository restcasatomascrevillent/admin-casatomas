import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { AlertaValidacion, Factura, ProductoFactura } from "@/hooks/useFacturas";

export const formatCurrency = (value: number | null): string => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
};

/** Cantidad con coma decimal y hasta 3 decimales (los kilos van al gramo): 75,48 · 24 · 1,5. */
export const formatNumero = (value: number): string =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value);

/**
 * «24 kg», «3 ud» o, si la línea se factura por peso y trae sus unidades
 * (`bultos`), «12 ud · 24 kg». La cantidad es siempre la magnitud por la que
 * se multiplica el precio (kilos si el precio es por kilo).
 */
export const formatCantidadLinea = (
  p: Pick<ProductoFactura, "cantidad" | "unidad" | "bultos">,
): string => {
  const cantidad =
    p.cantidad === null || p.cantidad === undefined
      ? "-"
      : `${formatNumero(p.cantidad)}${p.unidad ? ` ${p.unidad}` : ""}`;
  if (p.bultos === null || p.bultos === undefined || p.bultos === 0) return cantidad;
  return `${formatNumero(p.bultos)} ud · ${cantidad}`;
};

/**
 * «Valor sin descuento» de una línea con descuento o regalada (importación
 * histórica, 04/11/2026): el valor antes de descuento si difiere del importe
 * impreso; null si no hay nada que enseñar.
 */
export const valorSinDescuento = (
  p: Pick<ProductoFactura, "precio" | "importe_bruto" | "importe_bruto_estimado" | "descuento_pct">,
): { texto: string; titulo: string } | null => {
  if (p.importe_bruto === null || p.importe_bruto === undefined) return null;
  if (Math.abs(p.importe_bruto - (p.precio ?? 0)) < 0.005) return null;
  const estimado = p.importe_bruto_estimado === true;
  const dto = p.descuento_pct ? ` · dto. ${formatNumero(p.descuento_pct)} %` : "";
  return {
    texto: `Valor sin descuento ${formatCurrency(p.importe_bruto)}${estimado ? " (estimado)" : ""}${dto}`,
    titulo: estimado
      ? "Calculado con el precio al que este proveedor cobró el artículo en otras facturas: aquí no venía precio."
      : "Cantidad × precio antes del descuento. El importe de la línea es el impreso.",
  };
};

export const formatDate = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateString;
  }
};

/**
 * Fecha con el año de dos cifras, para la franja 1024–1279 px. Ahorra ~28 px
 * por columna, que es justo lo que hacia falta para que no sobre nada.
 */
export const formatDateCorta = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yy", { locale: es });
  } catch {
    return dateString;
  }
};

export const formatDateTime = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy HH:mm", { locale: es });
  } catch {
    return dateString;
  }
};

export const truncateText = (text: string | null, maxLength: number = 40): string => {
  if (!text) return "-";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

/** Minusculas, sin acentos y con los espacios colapsados. */
const plano = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Misma idea que `normalizar_proveedor()` en SQL (sin acentos, sin el alias
 * entre parentesis, sin sufijo legal al final). Solo se usa si el documento
 * no trae `proveedor_normalizado`, que es la fuente buena.
 */
export const claveProveedor = (doc: Pick<Factura, "proveedor" | "proveedor_normalizado">): string => {
  if (doc.proveedor_normalizado) return doc.proveedor_normalizado;
  if (!doc.proveedor) return "";
  return plano(doc.proveedor)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(
      /[,\s]+(sociedad limitada unipersonal|sociedad anonima unipersonal|sociedad cooperativa|sociedad limitada|sociedad anonima|s\.l\.u\.|s\.a\.u\.|s\.l\.|s\.a\.|s\.c\.p\.|s\.c\.l\.|s\.c\.|s\.coop\.?|slu|sau|sl|sa|cb|sc)\s*$/,
      "",
    )
    .replace(/[,.\s]+$/, "")
    .trim();
};

/**
 * Lineas que no son mercancia sino un servicio o un cargo del proveedor:
 * portes, gestion y logistica, punto verde... Su "precio unitario" depende del
 * pedido, de la distancia o del proveedor, no de un producto, asi que no tiene
 * sentido decir que es "atipico". Caso real: los Portes de Angelmar (57 €)
 * salian como precio atipico porque ENCHENTA cobra 25,45 € por los suyos.
 */
const LINEA_SERVICIO =
  /\b(portes?|transportes?|envios?|gastos? de (envio|gestion|transporte)|gestion y logistica|logistica|punto verde|ecoembes|canon|recargos?|fianzas?|depositos?)\b/;

export const esLineaDeServicio = (nombre: string): boolean => LINEA_SERVICIO.test(plano(nombre));

/**
 * Heuristica de cliente: algun producto del documento cuesta mas del doble de
 * lo que ha costado ese mismo producto, DEL MISMO PROVEEDOR, en el resto de
 * documentos CARGADOS EN LA PAGINA. Es mas debil que
 * `precio_atipico_historico`, que lo calcula `validar_cordura_factura` contra
 * todo el historico en la base.
 *
 * Solo compara dentro del mismo proveedor: dos proveedores pueden vender "lo
 * mismo" a precios muy distintos (y los portes de cada uno no tienen nada que
 * ver), asi que mezclarlos solo genera falsos positivos. Las lineas de
 * servicio (ver `esLineaDeServicio`) y los precios a 0 (bonificaciones o
 * importes no leidos) no cuentan ni como sospechosos ni como referencia.
 */
export const tieneAnomaliaPrecio = (doc: Factura, allDocs: Factura[]): boolean => {
  const proveedor = claveProveedor(doc);
  if (!proveedor) return false;
  const delMismoProveedor = allDocs.filter((f) => claveProveedor(f) === proveedor);

  return doc.productos.some((p) => {
    if (!p.precio_unitario || p.precio_unitario <= 0) return false;
    if (esLineaDeServicio(p.producto_nombre)) return false;
    const nombre = plano(p.producto_nombre);
    const pastPrices = delMismoProveedor
      .flatMap((f) => f.productos)
      .filter(
        (past) =>
          past.id !== p.id &&
          typeof past.precio_unitario === "number" &&
          past.precio_unitario > 0 &&
          plano(past.producto_nombre) === nombre,
      )
      .map((past) => past.precio_unitario as number);
    if (pastPrices.length === 0) return false;
    const avg = pastPrices.reduce((a, b) => a + b, 0) / pastPrices.length;
    return p.precio_unitario > avg * 2;
  });
};

/**
 * Lo mismo que `tieneAnomaliaPrecio`, para MUCHOS documentos: indexa una vez
 * los precios por proveedor y nombre de producto (suma y número) y cada línea
 * se compara con la media de las demás restando la suya. Con el histórico
 * (~1.900 documentos, ~12.000 líneas) la versión de uno en uno era cuadrática.
 */
export const indiceAnomaliasPrecio = (allDocs: Factura[]): ((doc: Factura) => boolean) => {
  const indice = new Map<string, { suma: number; n: number }>();
  const claveLinea = (proveedor: string, nombre: string) => `${proveedor}\u0000${plano(nombre)}`;
  const cuenta = (precio: number | null | undefined): precio is number => typeof precio === "number" && precio > 0;
  for (const f of allDocs) {
    const proveedor = claveProveedor(f);
    if (!proveedor) continue;
    for (const p of f.productos) {
      if (!cuenta(p.precio_unitario)) continue;
      const k = claveLinea(proveedor, p.producto_nombre);
      const e = indice.get(k);
      if (e) {
        e.suma += p.precio_unitario;
        e.n += 1;
      } else indice.set(k, { suma: p.precio_unitario, n: 1 });
    }
  }
  const indexados = new Set(allDocs);
  return (doc) => {
    const proveedor = claveProveedor(doc);
    if (!proveedor) return false;
    // ¿Está el propio documento en el índice? (si no, su línea no se resta).
    const dentro = indexados.has(doc);
    return doc.productos.some((p) => {
      if (!cuenta(p.precio_unitario)) return false;
      if (esLineaDeServicio(p.producto_nombre)) return false;
      const e = indice.get(claveLinea(proveedor, p.producto_nombre));
      if (!e) return false;
      const n = dentro ? e.n - 1 : e.n;
      if (n <= 0) return false;
      const avg = (dentro ? e.suma - p.precio_unitario : e.suma) / n;
      return p.precio_unitario > avg * 2;
    });
  };
};

/**
 * Todo lo que hay que revisar de un documento en una sola lista: los avisos
 * que guardo `validar_cordura_factura` al procesarlo mas, si aplica, la
 * anomalia de precio detectada en la propia pagina.
 *
 * Antes iban por separado y se pintaban como dos insignias distintas pegadas
 * al numero de documento. Juntarlos permite tratarlos igual (una insignia con
 * el problema escrito, el resto resumido en "+N") y deja el numero de
 * documento con su columna entera.
 */
export const avisosDocumento = (
  doc: Factura,
  allDocs: Factura[],
  anomalia: (d: Factura) => boolean = (d) => tieneAnomaliaPrecio(d, allDocs),
): AlertaValidacion[] => {
  const base = Array.isArray(doc.alertas) ? doc.alertas : [];
  if (!anomalia(doc)) return base;
  return [
    ...base,
    {
      codigo: "precio_atipico_pagina",
      severidad: "media",
      mensaje: "Algún producto cuesta más del doble que en otros documentos cargados del mismo proveedor",
    },
  ];
};
