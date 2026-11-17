import { mesDeFecha, nuevaLinea, nuevaFactura, redondear, textoMesRecibo, tipoDeRecibo, type CatalogoFacturacion, type Factura, type LineaFactura, type TipoRecibo } from "./modelo";
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
    {id:"instalacion",nombre:"Instalación y puesta en marcha",categoria:"Instalación",precio:0,periodicidad:"Puntual"},
    {id:"licencia",nombre:"Licencia del panel",categoria:"Licencia",precio:0,periodicidad:"Mensual"},
    ...modulos.map(([id,nombre]) => ({id,nombre,categoria:"Módulo" as const,precio:0,periodicidad:"Mensual" as const})),
    {id:"soporte",nombre:"Soporte y mantenimiento",categoria:"Soporte",precio:0,periodicidad:"Mensual"},
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
    ...nuevaLinea(p.categoria),concepto:p.nombre,precio:p.precio,periodicidad:p.periodicidad,productoId:p.id,
    ...(paqueteId ? {paqueteId} : {}),
  }));
  if (!nuevos.length) return f;
  const lineas = f.lineas.filter(l => l.concepto.trim() || l.precio > 0);
  if (lineas.length + nuevos.length > 100) throw new Error("Una factura admite hasta 100 conceptos.");
  return {...f,lineas:[...lineas,...nuevos]};
}
/** El último recibo emitido al mismo cliente (por nombre: los recibos no llevan NIF). */
export function ultimaFacturaCliente(facturas: FacturaGuardada[], cliente: Factura["cliente"]) {
  const nombre = normalizar(cliente.nombre);
  if (!nombre) return undefined;
  return [...facturas].sort((a,b) => b.documento.fecha.localeCompare(a.documento.fecha) || b.creado_en.localeCompare(a.creado_en))
    .find(g => normalizar(g.documento.cliente.nombre) === nombre);
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
/** «R-2026-001»: los recibos llevan su propia serie (las antiguas «FO-…» no se tocan). */
export function siguienteNumero(facturas: FacturaGuardada[], fecha: string) {
  const prefijo = "R-" + fecha.slice(0,4) + "-";
  const n = Math.max(0,...facturas.filter(f=>f.numero.startsWith(prefijo)).map(f=>/^\d+$/.test(f.numero.slice(prefijo.length)) ? Number(f.numero.slice(prefijo.length)) : 0));
  return prefijo + String(n+1).padStart(3,"0");
}

// ─── Pago mensual: cuota fija + gastos de Servicios ─────────────────────────

/** Id fijo de la línea de la cuota: así se reconoce al cambiar de mes o de tarifa. */
export const ID_CUOTA_MENSUAL = "cuota-mensual";
const conceptoCuota = (mes: string | undefined) => {
  const texto = textoMesRecibo(mes);
  return texto ? `Cuota mensual · ${texto}` : "Cuota mensual";
};
/** La línea del precio fijo del mes (la tarifa sale de «Tarifas»; se puede editar en cada recibo). */
export function lineaCuota(catalogo: CatalogoFacturacion | undefined, mes: string | undefined): LineaFactura {
  return { ...nuevaLinea("Licencia"), concepto: conceptoCuota(mes), periodicidad: "Mensual", precio: catalogo?.cuotaMensual ?? 0, productoId: ID_CUOTA_MENSUAL };
}
/** Un gasto del mes tal como lo da Servicios › Costes (ya en euros). */
export interface GastoServicio {
  proveedor: string;
  nombre: string;
  /** «IA», «Hosting»… (texto de la categoría del servicio; puede faltar). */
  categoria: string | null;
  importe: number;
  /** De dónde sale el importe: metido a mano, estimado (cuota + uso leído) o falta meterlo. */
  origen: "manual" | "estimado" | "falta" | "gratis";
}
const esLineaVacia = (l: LineaFactura) => !l.concepto.trim() && l.precio === 0;
/** El concepto del recibo de un gasto de Servicios («OpenAI · Inteligencia artificial», su importe y su descuento). */
export function lineaDeGasto(g: GastoServicio, descuento = 0): LineaFactura {
  return { ...nuevaLinea("Servicio"), concepto: g.categoria ? `${g.nombre} · ${g.categoria}` : g.nombre,
    periodicidad: "Mensual", precio: redondear(g.importe), proveedor: g.proveedor, descuento };
}
/** Añade al recibo UN gasto de Servicios (al final, con los demás). No hace nada si ya está o cuesta 0 €. */
export function anadirGastoServicio(f: Factura, g: GastoServicio): Factura {
  if (g.importe <= 0 || f.lineas.some(l => l.proveedor === g.proveedor)) return f;
  const lineas = [...f.lineas.filter(l => !esLineaVacia(l)), lineaDeGasto(g)];
  if (lineas.length > 100) throw new Error("Un recibo admite hasta 100 conceptos.");
  return { ...f, lineas };
}
/** Pone el mismo descuento (%) a todos los gastos de Servicios del recibo; lo demás no se toca. */
export function descuentoAServicios(f: Factura, descuento: number): Factura {
  const d = Math.min(100, Math.max(0, Number.isFinite(descuento) ? descuento : 0));
  if (!f.lineas.some(l => l.proveedor && l.descuento !== d)) return f;
  return { ...f, lineas: f.lineas.map(l => (l.proveedor ? { ...l, descuento: d } : l)) };
}
/**
 * Añade un concepto a mano. En un pago mensual va antes de los gastos de Servicios: así el
 * recibo queda siempre como cuota y conceptos propios primero, y los servicios al final.
 */
export function anadirConcepto(f: Factura): Factura {
  const i = f.lineas.findIndex(l => l.proveedor);
  const nueva = nuevaLinea();
  return { ...f, lineas: i < 0 ? [...f.lineas, nueva] : [...f.lineas.slice(0, i), nueva, ...f.lineas.slice(i)] };
}
/** Quita un concepto; si era el último, deja una línea vacía para empezar. */
export function quitarConcepto(f: Factura, id: string): Factura {
  const lineas = f.lineas.filter(l => l.id !== id);
  return { ...f, lineas: lineas.length ? lineas : [{ ...nuevaLinea("Otros"), concepto: "" }] };
}
/**
 * Pone en el recibo los gastos del mes: sustituye las líneas que ya venían de Servicios
 * (se reconocen por `proveedor`) y deja intactas las demás (cuota y conceptos a mano).
 * Lo que cuesta 0 € no se añade. Los descuentos puestos a un servicio se conservan.
 */
export function aplicarGastosServicios(f: Factura, gastos: GastoServicio[]): Factura {
  const previas = new Map(f.lineas.filter(l => l.proveedor).map(l => [l.proveedor!, l]));
  const nuevas: LineaFactura[] = gastos.filter(g => g.importe > 0).map(g => lineaDeGasto(g, previas.get(g.proveedor)?.descuento ?? 0));
  const resto = f.lineas.filter(l => !l.proveedor && !esLineaVacia(l));
  const lineas = [...resto, ...nuevas];
  if (lineas.length > 100) throw new Error("Un recibo admite hasta 100 conceptos.");
  return { ...f, lineas: lineas.length ? lineas : [{ ...nuevaLinea("Otros"), concepto: "" }] };
}
/**
 * Cambia el tipo de recibo. A «mensual»: pone el mes (el actual si no había) y la línea de la
 * cuota fija si falta. A «licencia»: quita el mes, la cuota y los gastos de Servicios.
 */
export function cambiarTipo(f: Factura, tipo: TipoRecibo, hoy = new Date()): Factura {
  if (tipo === tipoDeRecibo(f) && (tipo === "licencia" || f.mes)) return f;
  if (tipo === "mensual") {
    const mes = f.mes ?? mesDeFecha(hoy);
    const resto = f.lineas.filter(l => !esLineaVacia(l));
    const lineas = resto.some(l => l.productoId === ID_CUOTA_MENSUAL) ? resto : [lineaCuota(f.catalogo, mes), ...resto];
    return { ...f, tipo, mes, lineas };
  }
  const lineas = f.lineas.filter(l => !l.proveedor && l.productoId !== ID_CUOTA_MENSUAL);
  const { mes: _mes, ...sinMes } = f;
  return { ...sinMes, tipo, lineas: lineas.length ? lineas : [{ ...nuevaLinea("Otros"), concepto: "" }] };
}
/** Cambia el mes de un pago mensual y renombra la cuota (si nadie le cambió el texto). */
export function cambiarMes(f: Factura, mes: string): Factura {
  if (!textoMesRecibo(mes) || mes === f.mes) return f;
  const anterior = conceptoCuota(f.mes);
  return { ...f, mes, lineas: f.lineas.map(l => l.productoId === ID_CUOTA_MENSUAL && (l.concepto === anterior || !l.concepto.trim()) ? { ...l, concepto: conceptoCuota(mes) } : l) };
}
/**
 * Un recibo nuevo: número siguiente, mismo cliente y emisor que el actual (en este panel el
 * cliente es siempre el mismo), catálogo y forma de pago. Mensual: con el mes y la cuota fija.
 */
export function prepararNuevaFactura(actual: Factura, facturas: FacturaGuardada[], tipo: TipoRecibo = "licencia", hoy = new Date()) {
  const base = nuevaFactura({ nombre: actual.emisor.nombre, nif: "", direccion: "", email: "" });
  const catalogo = actual.catalogo ?? catalogoInicial();
  const f: Factura = { ...base, numero: siguienteNumero(facturas, base.fecha), catalogo, pago: actual.pago,
    cliente: { nombre: actual.cliente.nombre, nif: "", direccion: "", email: "" } };
  return tipo === "mensual" ? cambiarTipo(f, "mensual", hoy) : f;
}
