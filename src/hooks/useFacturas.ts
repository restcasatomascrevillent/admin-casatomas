import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProductoFactura {
  id: number;
  producto_nombre: string;
  precio: number;
  cantidad?: number;
  unidad?: string | null;
  proveedor: string | null;
  precio_unitario?: number;
}

export interface Factura {
  id: number;
  tipo: string;
  numero_documento: string;
  proveedor: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  observaciones: string | null;
  productos: ProductoFactura[];
  drive_url: string | null;
  procesado_en: string | null;
  created_at: string | null;
}

const STALE_TIME = 1000 * 60 * 2; // 2 minutos — evita refetches al cambiar de pestaña

const fetchDocumentosConProductos = async (tipo: 'factura' | 'albaran'): Promise<Factura[]> => {
  // Una sola query con JOIN — se evita el N+1 de queries separadas
  const { data, error } = await supabase
    .from('facturas')
    .select(`
      id, tipo, numero_documento, proveedor, cif, fecha,
      subtotal, iva, total, observaciones, drive_url,
      procesado_en, created_at,
      productos_factura (
        id, nombre, precio_unitario, cantidad, unidad, total
      )
    `)
    .eq('tipo', tipo)
    .order('fecha', { ascending: false });

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
        proveedor: null,
        precio_unitario: precioUnitario,
      };
    });

    return {
      id: doc.id,
      tipo: doc.tipo,
      numero_documento: doc.numero_documento,
      proveedor: doc.proveedor,
      cif: doc.cif,
      fecha: doc.fecha,
      subtotal: doc.subtotal != null ? Number(doc.subtotal) : null,
      iva: doc.iva != null ? Number(doc.iva) : null,
      total: doc.total != null ? Number(doc.total) : null,
      observaciones: doc.observaciones,
      productos,
      drive_url: doc.drive_url ?? null,
      procesado_en: doc.procesado_en ?? null,
      created_at: doc.created_at ?? null,
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
