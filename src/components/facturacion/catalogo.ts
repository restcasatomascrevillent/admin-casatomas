import { nuevaLinea, nuevaFactura, type CatalogoFacturacion, type Factura, type LineaFactura } from "./modelo";
import type { FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

/** Servicios disponibles en las rutas del panel. Sus precios se definen en el catálogo. */
export function catalogoInicial(): CatalogoFacturacion {
  const modulos = [
    ["web","Gestor Web"],["reservas","Reservas y espacios"],["bot","Chatbot IA"],
    ["facturas","Procesamiento de facturas IA"],["newsletter","Newsletter"],
    ["telefono","Asistente telefónico"],["ecommerce","Ecommerce"],
    ["resenas","Reseñas Google"],["trafico","Tráfico web"],["emails","Plantillas de email"],
  ];
  return {productos:[
    {id:"instalacion",nombre:"Instalación y puesta en marcha",categoria:"Instalación",precio:0,periodicidad:"Puntual",iva:21},
    {id:"licencia",nombre:"Licencia del panel",categoria:"Licencia",precio:0,periodicidad:"Mensual",iva:21},
    ...modulos.map(([id,nombre]) => ({id,nombre,categoria:"Módulo" as const,precio:0,periodicidad:"Mensual" as const,iva:21})),
    {id:"soporte",nombre:"Soporte y mantenimiento",categoria:"Soporte",precio:0,periodicidad:"Mensual",iva:21},
  ],paquetes:[
    {id:"esencial",nombre:"Panel esencial",productoIds:["licencia","web","reservas"]},
    {id:"ia",nombre:"Panel con IA",productoIds:["licencia","web","reservas","bot","facturas"]},
    {id:"completo",nombre:"Panel completo",productoIds:["licencia",...modulos.map(([id])=>id),"soporte"]},
  ]};
}
export const normalizar = (s: string) => s.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
export function productosSeleccionados(lineas: LineaFactura[], catalogo: CatalogoFacturacion) {
  return new Set(lineas.map(l => l.productoId ?? catalogo.productos.find(p => normalizar(p.nombre) === normalizar(l.concepto))?.id).filter((id): id is string => !!id));
}
export function agregarProductos(f: Factura, catalogo: CatalogoFacturacion, ids: string[], paqueteId?: string): Factura {
  const seleccionados = productosSeleccionados(f.lineas,catalogo);
  const nuevos = catalogo.productos.filter(p => ids.includes(p.id) && !seleccionados.has(p.id)).map(p => ({
    ...nuevaLinea(p.categoria),concepto:p.nombre,precio:p.precio,periodicidad:p.periodicidad,iva:p.iva,productoId:p.id,
    ...(paqueteId ? {paqueteId} : {}),
  }));
  if (!nuevos.length) return f;
  const lineas = f.lineas.filter(l => l.concepto.trim() || l.precio > 0);
  if (lineas.length + nuevos.length > 100) throw new Error("Una factura admite hasta 100 conceptos.");
  return {...f,lineas:[...lineas,...nuevos]};
}
export function ultimaFacturaCliente(facturas: FacturaGuardada[], cliente: Factura["cliente"]) {
  const nif = normalizar(cliente.nif);
  if (!nif) return undefined;
  return [...facturas].sort((a,b) => b.documento.fecha.localeCompare(a.documento.fecha) || b.creado_en.localeCompare(a.creado_en))
    .find(g => normalizar(g.documento.cliente.nif) === nif);
}
export function recuperarServicios(f: Factura, anterior: Factura): Factura {
  const existentes = new Set(f.lineas.filter(l=>l.concepto.trim()).map(l=>l.productoId ?? normalizar(l.concepto)));
  const recurrentes = anterior.lineas.filter(l=>l.periodicidad !== "Puntual" && !existentes.has(l.productoId ?? normalizar(l.concepto)))
    .map(l=>({...l,id:crypto.randomUUID()}));
  if (!recurrentes.length) return f;
  const lineas = f.lineas.filter(l=>l.concepto.trim() || l.precio > 0);
  if (lineas.length + recurrentes.length > 100) throw new Error("Una factura admite hasta 100 conceptos.");
  return {...f,lineas:[...lineas,...recurrentes]};
}
export function siguienteNumero(facturas: FacturaGuardada[], fecha: string) {
  const prefijo = "FO-" + fecha.slice(0,4) + "-";
  const n = Math.max(0,...facturas.filter(f=>f.numero.startsWith(prefijo)).map(f=>/^\d+$/.test(f.numero.slice(prefijo.length)) ? Number(f.numero.slice(prefijo.length)) : 0));
  return prefijo + String(n+1).padStart(3,"0");
}
export function prepararNuevaFactura(actual: Factura, facturas: FacturaGuardada[]) {
  const f = nuevaFactura(actual.emisor);
  return {...f,numero:siguienteNumero(facturas,f.fecha),catalogo:actual.catalogo ?? catalogoInicial(),pago:actual.pago};
}
