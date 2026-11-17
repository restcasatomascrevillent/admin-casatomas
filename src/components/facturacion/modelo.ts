import { z } from "zod";

/**
 * Recibos de OficiosOsIA (17/11/2026, petición del dueño: «quítale el membrete y todos los datos
 * fiscales, solo que funcionen tipo recibos sin ninguna información fiscal»). El documento guardado
 * sigue teniendo la forma de la antigua factura (emisor, cliente, IVA, retención…) para que lo ya
 * guardado se siga leyendo, pero la pantalla y el PDF trabajan siempre con `sinDatosFiscales`: sin
 * NIF, sin dirección fiscal, sin IVA y sin retención.
 *
 * Dos tipos de recibo:
 *   · «licencia»: licencia global (instalación, licencias, módulos…), pago puntual.
 *   · «mensual»:  pago de un mes: la cuota fija + los gastos de ese mes que se ven en
 *                 Servicios (IA, hosting…), cada uno editable por si se aplica un descuento.
 */
export const categorias = ["Instalación", "Licencia", "Módulo", "Soporte", "Servicio", "Otros"] as const;
export const tiposRecibo = ["licencia", "mensual"] as const;
export type TipoRecibo = (typeof tiposRecibo)[number];
export const TEXTO_TIPO_RECIBO: Record<TipoRecibo, string> = { licencia: "Licencia global", mensual: "Pago mensual" };
export const periodicidades = ["Puntual", "Mensual", "Anual"] as const;
const precioSchema = z.number().finite().min(0).max(1000000);
const porcentajeSchema = z.number().finite().min(0).max(100);
export const catalogoSchema = z.object({
  productos: z.array(z.object({
    id: z.string(), nombre: z.string().min(1).max(160), categoria: z.enum(categorias),
    precio: precioSchema, periodicidad: z.enum(periodicidades), iva: porcentajeSchema.optional(),
  })).max(100),
  paquetes: z.array(z.object({id:z.string(), nombre:z.string().min(1).max(120), productoIds:z.array(z.string()).max(100)})).max(30),
  /** Precio fijo del pago mensual (sin los gastos de Servicios). */
  cuotaMensual: precioSchema.optional(),
});
export type CatalogoFacturacion = z.infer<typeof catalogoSchema>;
const texto = z.string().max(500);
const parteSchema = z.object({
  nombre: z.string().max(120), nif: z.string().max(30), direccion: texto,
  email: z.string().max(120),
});
export const facturaSchema = z.object({
  numero: z.string().max(60), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  emisor: parteSchema, cliente: parteSchema,
  lineas: z.array(z.object({
    id: z.string(), categoria: z.enum(categorias), concepto: z.string().max(300),
    productoId: z.string().optional(), paqueteId: z.string().optional(),
    /** Gasto traído de Servicios (proveedor de `servicios_contratados`): se refresca al cambiar de mes. */
    proveedor: z.string().max(80).optional(),
    periodicidad: z.enum(periodicidades),
    cantidad: z.number().finite().positive().max(100000),
    precio: z.number().finite().min(0).max(1000000),
    descuento: z.number().finite().min(0).max(100),
    iva: z.number().finite().min(0).max(100),
  })).min(1).max(100),
  retencion: porcentajeSchema,
  descuentoGlobal: porcentajeSchema.optional(),
  aplicarIva: z.boolean().optional(),
  ivaGlobal: porcentajeSchema.optional(),
  catalogo: catalogoSchema.optional(),
  pago: texto, notas: z.string().max(2000),
  /** Sin tipo (documentos anteriores al 17/11/2026) se trata como «licencia». */
  tipo: z.enum(tiposRecibo).optional(),
  /** Mes que se paga («AAAA-MM»), solo en «mensual». */
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
export type Factura = z.infer<typeof facturaSchema>;
export type LineaFactura = Factura["lineas"][number];
export type ParteFactura = Factura["emisor"];
export const euros = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
/**
 * Redondeo comercial a céntimos: la mitad hacia arriba y simétrico en negativos.
 * `toPrecision(15)` quita el ruido binario ANTES de redondear: 21,50 € × 21 % =
 * 4,515 se guarda como 4,51499999… y el `Math.round((n + EPSILON) * 100)` de antes
 * daba 4,51 € (EPSILON solo compensa números cercanos a 1).
 */
export const redondear = (n: number) => {
  const centimos = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
  if (centimos === 0) return 0;
  return (n < 0 ? -centimos : centimos) / 100;
};
export function nuevaLinea(categoria: LineaFactura["categoria"] = "Módulo"): LineaFactura {
  return { id: crypto.randomUUID(), categoria, concepto: categoria === "Instalación" ? "Instalación y puesta en marcha" : categoria,
    periodicidad: categoria === "Instalación" ? "Puntual" : "Mensual",
    cantidad: 1, precio: 0, descuento: 0, iva: 0 };
}
export function nuevaFactura(emisor?: ParteFactura): Factura {
  const hoy = new Date();
  const localDate = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  const vence = new Date(hoy); vence.setDate(vence.getDate() + 30);
  const vacio = { nombre: "", nif: "", direccion: "", email: "" };
  return { numero: "", fecha: localDate(hoy), vencimiento: localDate(vence),
    emisor: emisor ?? { ...vacio, nombre: "OficiosOsIA" }, cliente: { ...vacio },
    lineas: [{...nuevaLinea("Otros"),concepto:""}], retencion: 0, descuentoGlobal: 0, aplicarIva: false, pago: "", notas: "", tipo: "licencia" };
}
const MESES_RECIBO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «2026-11» → «noviembre de 2026» («» si no es un mes válido). */
export function textoMesRecibo(mes: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes ?? "");
  const nombre = m ? MESES_RECIBO[Number(m[2]) - 1] : undefined;
  return m && nombre ? `${nombre} de ${m[1]}` : "";
}
/** «2026-11»: el mes (hora local) de una fecha. */
export const mesDeFecha = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const tipoDeRecibo = (f: Pick<Factura, "tipo">): TipoRecibo => f.tipo ?? "licencia";
/** «Licencia global» o «Pago mensual · noviembre de 2026». */
export function tituloRecibo(f: Pick<Factura, "tipo" | "mes">): string {
  const tipo = tipoDeRecibo(f);
  const mes = tipo === "mensual" ? textoMesRecibo(f.mes) : "";
  return mes ? `${TEXTO_TIPO_RECIBO[tipo]} · ${mes}` : TEXTO_TIPO_RECIBO[tipo];
}
/**
 * El documento como recibo: sin NIF, dirección ni email de nadie, sin IVA y sin retención.
 * Devuelve el mismo objeto si ya estaba limpio (no fuerza renders ni marca cambios).
 */
export function sinDatosFiscales(f: Factura): Factura {
  const limpia = (p: ParteFactura) => (p.nif || p.direccion || p.email ? { nombre: p.nombre, nif: "", direccion: "", email: "" } : p);
  const emisor = limpia(f.emisor), cliente = limpia(f.cliente);
  if (emisor === f.emisor && cliente === f.cliente && f.aplicarIva === false && f.retencion === 0) return f;
  return { ...f, emisor, cliente, aplicarIva: false, retencion: 0 };
}
/** Totales de un recibo: los de siempre, sin impuestos ni retención pase lo que pase. */
export const totalesRecibo = (f: Factura) => totalesFactura(sinDatosFiscales(f));
export function totalesFactura(f: Factura) {
  const lineas = f.lineas.map(l => {
    const bruto = redondear(l.cantidad * l.precio);
    const descuento = redondear(bruto * l.descuento / 100);
    const baseAntesGlobal = redondear(bruto - descuento);
    const descuentoGlobalImporte = redondear(baseAntesGlobal * (f.descuentoGlobal ?? 0) / 100);
    const base = redondear(baseAntesGlobal - descuentoGlobalImporte);
    const impuesto = f.aplicarIva === false ? 0 : redondear(base * (f.ivaGlobal ?? l.iva) / 100);
    return { ...l, iva:f.ivaGlobal ?? l.iva, bruto, descuentoImporte: descuento, baseAntesGlobal, descuentoGlobalImporte, base, impuesto, total: redondear(base + impuesto) };
  });
  const base = redondear(lineas.reduce((s, l) => s + l.base, 0));
  const iva = f.aplicarIva === false ? 0 : f.ivaGlobal !== undefined ? redondear(base * f.ivaGlobal / 100) : redondear(lineas.reduce((s, l) => s + l.impuesto, 0));
  const retencion = redondear(base * f.retencion / 100);
  const grupos = f.aplicarIva === false ? [] : f.ivaGlobal !== undefined ? [{tipo:f.ivaGlobal,base,importe:iva}] : [...new Set(lineas.map(l => l.iva))].sort((a,b) => a-b).map(tipo => ({
    tipo, base: redondear(lineas.filter(l => l.iva === tipo).reduce((s,l) => s + l.base, 0)),
    importe: redondear(lineas.filter(l => l.iva === tipo).reduce((s,l) => s + l.impuesto, 0)),
  }));
  const subtotal = redondear(lineas.reduce((s,l) => s + l.baseAntesGlobal, 0));
  const descuentoGlobal = redondear(lineas.reduce((s,l) => s + l.descuentoGlobalImporte, 0));
  const descuentosLineas = redondear(lineas.reduce((s,l) => s + l.descuentoImporte, 0));
  return { lineas, base, subtotal, descuentoGlobal, descuentosLineas, iva, retencion, total: redondear(base + iva - retencion), grupos };
}
/** Importe contratado mensual sin impuestos; instalaciones puntuales quedan fuera. */
export function mensualFactura(f: Factura) {
  return redondear(totalesFactura(f).lineas.reduce((s,l) =>
    s + (l.periodicidad === "Mensual" ? l.base : l.periodicidad === "Anual" ? l.base / 12 : 0), 0));
}
export function erroresFactura(f: Factura): string[] {
  const parse = facturaSchema.safeParse(f);
  if (!parse.success) return ["Revisa cantidades, precios, descuentos y longitud de los textos."];
  const errores: string[] = [];
  if (!f.numero.trim()) errores.push("Indica el número de recibo.");
  if (!f.cliente.nombre.trim()) errores.push("Indica el nombre del cliente.");
  if (tipoDeRecibo(f) === "mensual" && !textoMesRecibo(f.mes)) errores.push("Indica el mes que se paga.");
  if (f.lineas.some(l => !l.concepto.trim())) errores.push("Todos los conceptos deben tener una descripción.");
  const fechaValida = (v: string) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v;
  };
  // El vencimiento ya no se enseña (un recibo no vence): solo se exige la fecha del recibo.
  if (!fechaValida(f.fecha)) errores.push("Indica una fecha válida.");
  return errores;
}
