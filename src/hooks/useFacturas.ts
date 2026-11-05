import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { cargarEscalonado, type CacheEscalonada } from "@/lib/facturas/cargaEscalonada";
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
  /**
   * Lo que VALE lo recibido aunque venga con descuento o regalado (migración
   * 20261104170000; de momento solo lo rellena la importación histórica):
   * cantidad × precio antes de descuento, y si es un cálculo con el precio de
   * otras facturas del proveedor (`importe_bruto_estimado`).
   */
  descuento_pct?: number | null;
  importe_bruto?: number | null;
  importe_bruto_estimado?: boolean;
  /**
   * Precio de referencia de la línea: media del precio unitario de las DEMÁS
   * líneas con el mismo nombre, del mismo proveedor y tipo de documento (lo
   * calcula `documento_compras()`, migración 20261105190000). null = sin con
   * qué comparar; ausente = no se ha calculado.
   */
  media_referencia?: number | null;
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
  /**
   * Quién la dio por revisada (migración 20261010130000): 'auto' = cuadra todo
   * y el proveedor es conocido, no la ha mirado nadie; 'manual' = una persona.
   * null = sin revisar.
   */
  verificacion_origen?: "auto" | "manual" | null;
  /**
   * A qué local va el documento (`facturas.local`, migración 20261104170000):
   * 'casa_tomas' | 'touza'. null = sin marcar (lo subido por el OCR), que se
   * trata como Casa Tomás (decisión del dueño). Ausente si la columna no existe.
   */
  local?: "casa_tomas" | "touza" | null;
}

const columnasDocumento = (conBultos: boolean, conProducto: boolean, conFacturado: boolean, conBruto: boolean, conLocal: boolean) => `
      id, tipo, numero_documento, proveedor, proveedor_normalizado, cif, fecha,${conFacturado ? " facturado_en_id," : ""}${conLocal ? " local," : ""}
      subtotal, iva, total, total_origen, observaciones, drive_url, archivo_path,
      alertas_validacion, procesado_en, created_at, verificada, verificacion_origen,
      productos_factura (
        id, nombre, precio_unitario, cantidad, unidad, total${conBultos ? ", bultos" : ""}${
          conBruto ? ", descuento_pct, importe_bruto, importe_bruto_estimado" : ""
        }${
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

/**
 * Los documentos de un tipo con TODAS sus líneas (la carga de antes de la
 * migración 20261105190000). Solo se usa si `documentos_lista()` aún no existe
 * (ver useListaCompras.ts): con el histórico son ≈ 5,9 MB.
 */
export const leerDocumentosCompletos = async (tipo: 'factura' | 'albaran'): Promise<Factura[]> => {
  // Una sola query con JOIN por tanda — se evita el N+1 de queries separadas.
  // Por tandas (`.range`, carga escalonada): PostgREST corta cada petición a
  // 1.000 filas y con el histórico hay más. Ver lib/facturas/cargaEscalonada.ts.
  const consultar = (conBultos: boolean, conProducto: boolean, conFacturado: boolean, conBruto: boolean, conLocal: boolean, primera: number, ultima: number) =>
    supabase
      .from('facturas')
      .select(columnasDocumento(conBultos, conProducto, conFacturado, conBruto, conLocal))
      .eq('tipo', tipo)
      .order('fecha', { ascending: false })
      // Desempate por id: sin un orden total las tandas repiten o se saltan documentos del mismo día.
      .order('id', { ascending: false })
      // Las líneas en el orden impreso: se insertan en ese orden (también las de
      // los documentos largos, 04b), así que el id lo reproduce sin depender de
      // la columna `orden` (migración 20261005120000, puede no estar aplicada).
      .order('id', { referencedTable: 'productos_factura', ascending: true })
      .range(primera, ultima);

  // La categoría de cada línea (catálogo de productos, migración
  // 20261007160000) es un extra: sin la migración se consulta sin ella.
  const categorias = await leerCategorias();
  let conProducto = categorias !== null;
  let conBultos = true;
  // `facturado_en_id` llega con la migración 20261008120000 (ya aplicada en
  // producción): si faltara, se repite la consulta sin ella.
  let conFacturado = true;
  // Valor sin descuento: migración 20261104170000 (importación histórica).
  let conBruto = true;
  // Local (Casa Tomás / Touza): la misma migración 20261104170000.
  let conLocal = true;
  const mapaCategorias = new Map((categorias ?? []).map((c) => [c.id, c]));

  const leerTanda = async (primera: number, ultima: number): Promise<Factura[]> => {
    let { data, error } = await consultar(conBultos, conProducto, conFacturado, conBruto, conLocal, primera, ultima);
    for (let i = 0; i < 5 && error; i++) {
      const msg = error.message ?? '';
      if (conProducto && /producto_id|productos_catalogo|relationship/i.test(msg)) conProducto = false;
      // `bultos` llega con la migración 20261005150000, que aplica el dueño a mano:
      // mientras no esté, se repite la consulta sin esa columna en vez de dejar el
      // listado de facturas vacío.
      else if (conBultos && /bultos/i.test(msg)) conBultos = false;
      else if (conFacturado && /facturado_en_id/i.test(msg)) conFacturado = false;
      else if (conBruto && /importe_bruto|descuento_pct/i.test(msg)) conBruto = false;
      // «column facturas.local does not exist»
      else if (conLocal && /\blocal\b/i.test(msg)) conLocal = false;
      else break;
      ({ data, error } = await consultar(conBultos, conProducto, conFacturado, conBruto, conLocal, primera, ultima));
    }

    if (error) throw error;
    if (!data || data.length === 0) return [];

    return data.map((doc: any) => {
      const productos: ProductoFactura[] = (doc.productos_factura || []).map((p: any) => {
        const precioUnitario = Number(p.precio_unitario) || 0;
        const cantidad = Number(p.cantidad) || 0;
        // El importe IMPRESO (0 en un regalo); solo si no hay importe se calcula.
        const totalProducto = p.total != null && p.total !== "" ? Number(p.total) : precioUnitario * cantidad;
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
          descuento_pct: p.descuento_pct != null ? Number(p.descuento_pct) : null,
          importe_bruto: p.importe_bruto != null ? Number(p.importe_bruto) : null,
          importe_bruto_estimado: p.importe_bruto_estimado === true,
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
        verificacion_origen:
          doc.verificacion_origen === "auto" || doc.verificacion_origen === "manual" ? doc.verificacion_origen : null,
        local: doc.local === "casa_tomas" || doc.local === "touza" ? doc.local : null,
      };
    });
  };

  // Sin escribir en ninguna caché a medias: quien llama recibe todo de una vez.
  const sinCache: CacheEscalonada<Factura> = { getQueryData: () => [], setQueryData: () => undefined };
  return cargarEscalonado<Factura>(sinCache, [tipo], leerTanda);
};

/** La ficha de `documento_compras(id)` (migración 20261105190000) como `Factura`. */
export function aFacturaDetalle(doc: Record<string, unknown>): Factura {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const lineas = Array.isArray(doc.productos) ? (doc.productos as Record<string, unknown>[]) : [];
  return {
    id: Number(doc.id),
    tipo: String(doc.tipo ?? ""),
    numero_documento: String(doc.numero_documento ?? ""),
    proveedor: (doc.proveedor as string | null) ?? null,
    proveedor_normalizado: (doc.proveedor_normalizado as string | null) ?? null,
    cif: (doc.cif as string | null) ?? null,
    fecha: String(doc.fecha ?? ""),
    subtotal: n(doc.subtotal),
    iva: n(doc.iva),
    total: n(doc.total),
    total_origen: doc.total_origen === "leido" || doc.total_origen === "deducido" ? doc.total_origen : null,
    observaciones: (doc.observaciones as string | null) ?? null,
    productos: lineas.map((p) => {
      const precioUnitario = Number(p.precio_unitario) || 0;
      const cantidad = Number(p.cantidad) || 0;
      const categoria = p.categoria as { nombre?: unknown; ruta?: unknown } | null;
      return {
        id: Number(p.id),
        producto_nombre: String(p.nombre ?? ""),
        // El importe IMPRESO (0 en un regalo); solo si no hay importe se calcula.
        precio: p.total != null && p.total !== "" ? Number(p.total) : precioUnitario * cantidad,
        cantidad,
        unidad: (p.unidad as string | null) ?? null,
        bultos: n(p.bultos),
        proveedor: null,
        precio_unitario: precioUnitario,
        categoria: categoria && typeof categoria.nombre === "string" ? { nombre: categoria.nombre, ruta: String(categoria.ruta ?? categoria.nombre) } : null,
        producto_canonico: (p.producto_canonico as string | null) ?? null,
        producto_id: p.producto_id != null ? Number(p.producto_id) : null,
        descuento_pct: n(p.descuento_pct),
        importe_bruto: n(p.importe_bruto),
        importe_bruto_estimado: p.importe_bruto_estimado === true,
        media_referencia: n(p.media_referencia),
      };
    }),
    drive_url: (doc.drive_url as string | null) ?? null,
    archivo_path: (doc.archivo_path as string | null) ?? null,
    facturado_en_id: n(doc.facturado_en_id),
    alertas: Array.isArray(doc.alertas_validacion) ? (doc.alertas_validacion as AlertaValidacion[]) : [],
    procesado_en: (doc.procesado_en as string | null) ?? null,
    created_at: (doc.created_at as string | null) ?? null,
    verificada: doc.verificada === true,
    verificacion_origen: doc.verificacion_origen === "auto" || doc.verificacion_origen === "manual" ? doc.verificacion_origen : null,
    local: doc.local === "casa_tomas" || doc.local === "touza" ? doc.local : null,
  };
}

// ─── Qué se refresca tras un cambio (QA 05/11/2026, C-11) ───────────────────
// Además de ['facturas'] (lista, fichas y búsquedas de Compras) y ['albaranes'],
// lo que se calcula con las líneas o los importes: el catálogo y sus líneas
// (['productos']), las gráficas y fichas de Compras (['compras']) y la lista
// de proveedores con sus importes (['proveedores']).
const CLAVE_LISTA = ["facturas", "lista"] as const;

/** Productos, gráficas/fichas de Compras y proveedores. */
export function invalidarDerivadosCompras(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["productos"] });
  qc.invalidateQueries({ queryKey: ["compras"] });
  qc.invalidateQueries({ queryKey: ["proveedores"] });
}

/** Tras cambiar la cabecera de un documento (o subir uno): todo. */
export function invalidarTrasDocumento(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["facturas"] });
  qc.invalidateQueries({ queryKey: ["albaranes"] });
  invalidarDerivadosCompras(qc);
}

/**
 * Tras crear o editar una LÍNEA: su ficha, las búsquedas y lo derivado, pero
 * NO se vuelve a bajar la lista entera (≈ 0,5 MB): su cabecera se corrige en
 * la caché (`n_lineas`) y la lista queda marcada como vieja para la próxima
 * vez. Con la carga de antes (la lista trae los documentos completos) sí se
 * recarga, porque la ficha sale de ella.
 */
export function refrescarTrasLinea(qc: QueryClient, facturaId: number | null | undefined, lineasNuevas = 0) {
  type Lista = { cabeceras: { id: number; n_lineas: number }[]; completos: unknown } | undefined;
  const lista = qc.getQueryData<Lista>(CLAVE_LISTA);
  if (!lista || lista.completos) {
    qc.invalidateQueries({ queryKey: ["facturas"] });
  } else {
    qc.invalidateQueries({ queryKey: ["facturas"], predicate: (q) => q.queryKey[1] !== "lista" });
    qc.invalidateQueries({ queryKey: CLAVE_LISTA, refetchType: "none" });
    if (lineasNuevas !== 0 && facturaId != null) {
      qc.setQueryData<Lista>(CLAVE_LISTA, (prev) =>
        prev
          ? { ...prev, cabeceras: prev.cabeceras.map((c) => (c.id === facturaId ? { ...c, n_lineas: c.n_lineas + lineasNuevas } : c)) }
          : prev,
      );
    }
  }
  qc.invalidateQueries({ queryKey: ["albaranes"] });
  invalidarDerivadosCompras(qc);
}

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
      invalidarTrasDocumento(queryClient);
      toast.success("Documento actualizado correctamente");
    },
    onError: (error) => {
      console.error("Error al actualizar la factura:", error);
      toast.error("Error al actualizar el documento");
    }
  });
};

/** Añade a mano una línea a un documento (la IA no la detectó). */
export const useCrearProductoFactura = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      factura_id,
      producto_nombre,
      cantidad,
      unidad,
      precio_unitario,
      precio,
    }: {
      factura_id: number;
      producto_nombre: string;
      cantidad?: number;
      unidad?: string;
      precio_unitario?: number;
      precio?: number;
    }) => {
      const fila = {
        factura_id,
        nombre: producto_nombre.trim(),
        cantidad,
        unidad,
        precio_unitario,
        total: precio,
      };
      Object.keys(fila).forEach((key) => {
        if (fila[key as keyof typeof fila] === undefined) delete fila[key as keyof typeof fila];
      });

      const { data, error } = await supabase
        .from('productos_factura')
        .insert(fila as typeof fila & { nombre: string; factura_id: number })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      refrescarTrasLinea(queryClient, vars.factura_id, 1);
      toast.success("Línea añadida");
    },
    onError: (error) => {
      console.error("Error creando producto_factura:", error);
      toast.error("No se ha podido añadir la línea");
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
    onSuccess: (data) => {
      refrescarTrasLinea(queryClient, (data as { factura_id?: number } | null)?.factura_id ?? null);
      toast.success("Línea de producto actualizada");
    },
    onError: (error) => {
      console.error("Error updating producto_factura:", error);
      toast.error("Error al actualizar el producto");
    }
  });
};
