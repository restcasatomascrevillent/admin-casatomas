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
      mensaje: "Algún producto cuesta más del doble que en otros documentos cargados del mismo proveedor",
    },
  ];
};
