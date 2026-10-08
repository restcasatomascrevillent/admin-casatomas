import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ProductoFactura {
  id: number;
  producto_nombre: string;
  precio: number;
  cantidad?: number;
  unidad?: string | null;
  /**
   * Unidades/bultos de una línea facturada por peso o volumen
   * (`productos_factura.bultos`, migración 20261005150000): «12 ud · 24 kg».
   * En ese caso `cantidad` son los kilos y `precio_unitario` es por kilo.
   * null/ausente si la línea va por unidades.
   */
  bultos?: number | null;
  proveedor: string | null;
  precio_unitario?: number;
  /**
   * Categoría del producto canónico de la línea (Facturas › Productos,
   * migración 20261007160000). null/ausente = sin clasificar o migración sin
   * aplicar. Solo lectura aquí: se cambia en la pestaña Productos.
   */
  categoria?: { nombre: string; ruta: string } | null;
  /** Nombre del producto canónico (productos_catalogo) si la línea lo tiene. */
  producto_canonico?: string | null;
  /** Id del producto canónico: enlaza la línea con su ficha en Compras › Productos. */
  producto_id?: number | null;
}

/** Una anomalia de importes detectada por `procesar-factura` al cargar el documento. */
export interface AlertaValidacion {
  codigo: string;
  severidad: "alta" | "media" | string;
  mensaje: string;
  detalle?: Record<string, unknown>;
}

export interface Factura {
  id: number;
  tipo: string;
  numero_documento: string;
  proveedor: string | null;
  /**
   * `facturas.proveedor_normalizado`: minusculas, sin acentos ni sufijo legal
   * y, desde 20261007180000_proveedores_unificados, el nombre CANONICO del
   * proveedor asignado (lo mantiene un trigger; antes era columna generada).
   * Es lo que permite saber que "Bodega Campoluz, S.L." y "BODEGA CAMPOLUZ,
   * S.L." -o "JOSELITO (Carnicas Joselito)" y "Carnicas Joselito S.A."- son
   * el mismo proveedor. Opcional para no romper los mocks que no la traen.
   */
  proveedor_normalizado?: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  /**
   * De donde sale `total`:
   *   'leido'    — lo extrajo el modelo del documento (lo pone el papel).
   *   'deducido' — NO lo pone el papel: lo calculo `procesar-factura` con
   *                aritmetica exacta (subtotal + IVA, o la suma de las
   *                lineas) porque el bloque de totales no se veia en la
   *                imagen. Caso real: factura F/25011959 de Salazones Garre,
   *                cuyo bloque de totales se quedo fuera del encuadre.
   *   null       — el documento no tiene total (albaran sin precios).
   * Un total deducido por suma de lineas es la BASE de esas lineas: si el
   * original llevaba IVA que no se ve, el importe real es mayor. Por eso hay
   * que poder distinguirlo en pantalla de uno leido.
   */
  total_origen: "leido" | "deducido" | null;
  observaciones: string | null;
  productos: ProductoFactura[];
  drive_url: string | null;
  /** Ruta del original en el bucket privado `facturas-originales` (fallback de Drive). */
  archivo_path: string | null;
  /**
   * Albarán ya recogido en una factura (`facturas.facturado_en_id`, migración
   * 20261008120000): id de esa factura. null = no consta factura (o es una
   * factura). «Albaranes sin factura» = tipo 'albaran' con esto a null.
   */
  facturado_en_id?: number | null;
  /** Avisos de cordura de importes. Array vacio = sin anomalias. */
  alertas: AlertaValidacion[];
  procesado_en: string | null;
  created_at: string | null;
  verificada: boolean;
}

const STALE_TIME = 1000 * 60 * 2; // 2 minutos — evita refetches al cambiar de pestaña

const columnasDocumento = (conBultos: boolean, conProducto: boolean, conFacturado: boolean) => `
      id, tipo, numero_documento, proveedor, proveedor_normalizado, cif, fecha,${conFacturado ? " facturado_en_id," : ""}
      subtotal, iva, total, total_origen, observaciones, drive_url, archivo_path,
      alertas_validacion, procesado_en, created_at, verificada,
      productos_factura (
        id, nombre, precio_unitario, cantidad, unidad, total${conBultos ? ", bultos" : ""}${
          conProducto ? ", producto_id, productos_catalogo ( nombre, categoria_id )" : ""
        }
      )
    `;

interface CategoriaMin {
  id: number;
  nombre: string;
  padre_id: number | null;
}

/** Categorías de producto para la etiqueta de cada línea. [] si la migración no está. */
const leerCategorias = async (): Promise<CategoriaMin[] | null> => {
  const { data, error } = await supabase.from('categorias_producto').select('id, nombre, padre_id');
  if (error) return null;
  return (data ?? []) as CategoriaMin[];
};

function categoriaDeLinea(
  mapa: Map<number, CategoriaMin>,
  id: number | null | undefined,
): { nombre: string; ruta: string } | null {
  if (id === null || id === undefined) return null;
  const c = mapa.get(id);
  if (!c) return null;
  const padre = c.padre_id !== null ? mapa.get(c.padre_id) : undefined;
  return { nombre: c.nombre, ruta: padre ? `${padre.nombre} › ${c.nombre}` : c.nombre };
}

const fetchDocumentosConProductos = async (tipo: 'factura' | 'albaran'): Promise<Factura[]> => {
  // Una sola query con JOIN — se evita el N+1 de queries separadas
  const consultar = (conBultos: boolean, conProducto: boolean, conFacturado: boolean) =>
    supabase
      .from('facturas')
      .select(columnasDocumento(conBultos, conProducto, conFacturado))
      .eq('tipo', tipo)
      .order('fecha', { ascending: false })
      // Las líneas en el orden impreso: se insertan en ese orden (también las de
      // los documentos largos, 04b), así que el id lo reproduce sin depender de
      // la columna `orden` (migración 20261005120000, puede no estar aplicada).
      .order('id', { referencedTable: 'productos_factura', ascending: true });

  // La categoría de cada línea (catálogo de productos, migración
  // 20261007160000) es un extra: sin la migración se consulta sin ella.
  const categorias = await leerCategorias();
  let conProducto = categorias !== null;
  let conBultos = true;
  // `facturado_en_id` llega con la migración 20261008120000 (ya aplicada en
  // producción): si faltara, se repite la consulta sin ella.
  let conFacturado = true;
  let { data, error } = await consultar(conBultos, conProducto, conFacturado);
  for (let i = 0; i < 3 && error; i++) {
    const msg = error.message ?? '';
    if (conProducto && /producto_id|productos_catalogo|relationship/i.test(msg)) conProducto = false;
    // `bultos` llega con la migración 20261005150000, que aplica el dueño a mano:
    // mientras no esté, se repite la consulta sin esa columna en vez de dejar el
    // listado de facturas vacío.
    else if (conBultos && /bultos/i.test(msg)) conBultos = false;
    else if (conFacturado && /facturado_en_id/i.test(msg)) conFacturado = false;
    else break;
    ({ data, error } = await consultar(conBultos, conProducto, conFacturado));
  }
  const mapaCategorias = new Map((categorias ?? []).map((c) => [c.id, c]));

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return data.map((doc: any) => {
    const productos: ProductoFactura[] = (doc.productos_factura || []).map((p: any) => {
      const precioUnitario = Number(p.precio_unitario) || 0;
      const cantidad = Number(p.cantidad) || 0;
      const totalProducto = Number(p.total) || precioUnitario * cantidad;
      return {
        id: p.id,
        producto_nombre: p.nombre,
        precio: totalProducto,
        cantidad,
        unidad: p.unidad ?? null,
        bultos: p.bultos != null ? Number(p.bultos) : null,
        proveedor: null,
        precio_unitario: precioUnitario,
        categoria: categoriaDeLinea(mapaCategorias, p.productos_catalogo?.categoria_id),
        producto_canonico: p.productos_catalogo?.nombre ?? null,
        producto_id: p.producto_id ?? null,
      };
    });

    return {
      id: doc.id,
      tipo: doc.tipo,
      numero_documento: doc.numero_documento,
      proveedor: doc.proveedor,
      proveedor_normalizado: doc.proveedor_normalizado ?? null,
      cif: doc.cif,
      fecha: doc.fecha,
      subtotal: doc.subtotal != null ? Number(doc.subtotal) : null,
      iva: doc.iva != null ? Number(doc.iva) : null,
      total: doc.total != null ? Number(doc.total) : null,
      // Solo se acepta el vocabulario que declara la columna. Cualquier otra
      // cosa (o la columna sin migrar todavia) se trata como "no consta", que
      // es mas honesto que asumir que se leyo del papel.
      total_origen:
        doc.total_origen === "leido" || doc.total_origen === "deducido" ? doc.total_origen : null,
      observaciones: doc.observaciones,
      productos,
      drive_url: doc.drive_url ?? null,
      archivo_path: doc.archivo_path ?? null,
      facturado_en_id: doc.facturado_en_id != null ? Number(doc.facturado_en_id) : null,
      alertas: Array.isArray(doc.alertas_validacion) ? doc.alertas_validacion : [],
      procesado_en: doc.procesado_en ?? null,
      created_at: doc.created_at ?? null,
      verificada: doc.verificada ?? false,
    };
  });
};

export const useFacturas = () =>
  useQuery({
    queryKey: ['facturas'],
    queryFn: () => fetchDocumentosConProductos('factura'),
    staleTime: STALE_TIME,
  });

export const useAlbaranes = () =>
  useQuery({
    queryKey: ['albaranes'],
    queryFn: () => fetchDocumentosConProductos('albaran'),
    staleTime: STALE_TIME,
  });

export const useUpdateFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Factura> & { id: number }) => {
      // Filtrar los campos que van a 'facturas'
      const dataToUpdate = {
        proveedor: updates.proveedor,
        cif: updates.cif,
        numero_documento: updates.numero_documento,
        fecha: updates.fecha,
        subtotal: updates.subtotal,
        iva: updates.iva,
        total: updates.total,
        // Si un humano guarda el total desde el panel, ese importe deja de
        // ser deducido: lo ha puesto una persona con el documento delante.
        // Sin esto, una factura corregida a mano seguiria luciendo el
        // distintivo de "calculado, no leido" para siempre.
        // El rastro NO se pierde: el aviso `total_deducido` sigue en
        // `alertas_validacion`, que esta pantalla no toca.
        ...(updates.total !== undefined
          ? { total_origen: updates.total === null ? null : ("leido" as const) }
          : {}),
        observaciones: updates.observaciones,
        verificada: updates.verificada,
      };

      // Remover undefined
      Object.keys(dataToUpdate).forEach(key => {
        if (dataToUpdate[key as keyof typeof dataToUpdate] === undefined) {
          delete dataToUpdate[key as keyof typeof dataToUpdate];
        }
      });

      const { data, error } = await supabase
        .from('facturas')
        .update(dataToUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['albaranes'] });
      toast.success("Documento actualizado correctamente");
    },
    onError: (error) => {
      console.error("Error al actualizar la factura:", error);
      toast.error("Error al actualizar el documento");
    }
  });
};

export const useUpdateProductoFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProductoFactura> & { id: number }) => {
      const dataToUpdate = {
        nombre: updates.producto_nombre,
        precio_unitario: updates.precio_unitario,
        cantidad: updates.cantidad,
        unidad: updates.unidad,
        total: updates.precio,
      };

      // Remover undefined
      Object.keys(dataToUpdate).forEach(key => {
        if (dataToUpdate[key as keyof typeof dataToUpdate] === undefined) {
          delete dataToUpdate[key as keyof typeof dataToUpdate];
        }
      });

      const { data, error } = await supabase
        .from('productos_factura')
        .update(dataToUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['albaranes'] });
      toast.success("Línea de producto actualizada");
    },
    onError: (error) => {
      console.error("Error updating producto_factura:", error);
      toast.error("Error al actualizar el producto");
    }
  });
};
