import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProductoFactura {
  id: number;
  producto_nombre: string;
  precio: number;
  proveedor: string | null;
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
}

const fetchDocumentosConProductos = async (tipo: 'factura' | 'albaran'): Promise<Factura[]> => {
  // Fetch documents of specified type
  const { data: documentos, error: docError } = await supabase
    .from('facturas')
    .select('*')
    .eq('tipo', tipo)
    .order('fecha', { ascending: false });

  if (docError) throw docError;
  if (!documentos || documentos.length === 0) return [];

  // Get all document IDs
  const documentoIds = documentos.map(d => d.id);

  // Fetch products for all documents
  const { data: productos, error: prodError } = await supabase
    .from('historial_precios')
    .select('*')
    .in('factura_id', documentoIds);

  if (prodError) throw prodError;

  // Map products to their documents
  const productosMap = new Map<number, ProductoFactura[]>();
  (productos || []).forEach(p => {
    const facturaId = p.factura_id;
    if (facturaId) {
      if (!productosMap.has(facturaId)) {
        productosMap.set(facturaId, []);
      }
      productosMap.get(facturaId)!.push({
        id: p.id,
        producto_nombre: p.producto_nombre,
        precio: Number(p.precio),
        proveedor: p.proveedor,
      });
    }
  });

  // Combine documents with products
  return documentos.map(doc => ({
    id: doc.id,
    tipo: doc.tipo,
    numero_documento: doc.numero_documento,
    proveedor: doc.proveedor,
    cif: doc.cif,
    fecha: doc.fecha,
    subtotal: doc.subtotal ? Number(doc.subtotal) : null,
    iva: doc.iva ? Number(doc.iva) : null,
    total: doc.total ? Number(doc.total) : null,
    observaciones: doc.observaciones,
    productos: productosMap.get(doc.id) || [],
  }));
};

export const useFacturas = () => {
  return useQuery({
    queryKey: ['facturas'],
    queryFn: () => fetchDocumentosConProductos('factura'),
  });
};

export const useAlbaranes = () => {
  return useQuery({
    queryKey: ['albaranes'],
    queryFn: () => fetchDocumentosConProductos('albaran'),
  });
};
