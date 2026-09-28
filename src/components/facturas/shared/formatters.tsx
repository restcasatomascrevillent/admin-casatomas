import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { AlertaValidacion, Factura } from "@/hooks/useFacturas";

export const formatCurrency = (value: number | null): string => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
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

/**
 * Heuristica de cliente: algun producto del documento cuesta mas del doble de
 * lo que ha costado ese mismo producto en el resto de documentos CARGADOS EN
 * LA PAGINA. Es mas debil que `precio_atipico_historico`, que lo calcula
 * `validar_cordura_factura` contra todo el historico en la base; se conserva
 * porque pilla el caso de un proveedor nuevo del que aun no hay historico
 * guardado.
 */
export const tieneAnomaliaPrecio = (doc: Factura, allDocs: Factura[]): boolean =>
  doc.productos.some((p) => {
    if (!p.precio_unitario) return false;
    const pastPrices = allDocs
      .flatMap((f) => f.productos)
      .filter(
        (past) =>
          past.id !== p.id &&
          past.producto_nombre.toLowerCase() === p.producto_nombre.toLowerCase() &&
          typeof past.precio_unitario === "number",
      )
      .map((past) => past.precio_unitario as number);
    if (pastPrices.length === 0) return false;
    const avg = pastPrices.reduce((a, b) => a + b, 0) / pastPrices.length;
    return p.precio_unitario > avg * 2;
  });

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
export const avisosDocumento = (doc: Factura, allDocs: Factura[]): AlertaValidacion[] => {
  const base = Array.isArray(doc.alertas) ? doc.alertas : [];
  if (!tieneAnomaliaPrecio(doc, allDocs)) return base;
  return [
    ...base,
    {
      codigo: "precio_atipico_pagina",
      severidad: "media",
      mensaje: "Algún producto cuesta más del doble que en el resto de documentos cargados",
    },
  ];
};
