import { z } from "zod";

export const categorias = ["Instalación", "Licencia", "Módulo", "Soporte", "Otros"] as const;
export const periodicidades = ["Puntual", "Mensual", "Anual"] as const;
const precioSchema = z.number().finite().min(0).max(1000000);
const porcentajeSchema = z.number().finite().min(0).max(100);
export const catalogoSchema = z.object({
  productos: z.array(z.object({
    id: z.string(), nombre: z.string().min(1).max(160), categoria: z.enum(categorias),
    precio: precioSchema, periodicidad: z.enum(periodicidades), iva: porcentajeSchema,
  })).max(100),
  paquetes: z.array(z.object({id:z.string(), nombre:z.string().min(1).max(120), productoIds:z.array(z.string()).max(100)})).max(30),
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
    periodicidad: z.enum(periodicidades),
    cantidad: z.number().finite().positive().max(100000),
    precio: z.number().finite().min(0).max(1000000),
    descuento: z.number().finite().min(0).max(100),
    iva: z.number().finite().min(0).max(100),
  })).min(1).max(100),
  retencion: porcentajeSchema,
  descuentoGlobal: porcentajeSchema.optional(),
  aplicarIva: z.boolean().optional(),
  catalogo: catalogoSchema.optional(),
  pago: texto, notas: z.string().max(2000),
});
export type Factura = z.infer<typeof facturaSchema>;
export type LineaFactura = Factura["lineas"][number];
export type ParteFactura = Factura["emisor"];
export const euros = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
export const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function nuevaLinea(categoria: LineaFactura["categoria"] = "Módulo"): LineaFactura {
  return { id: crypto.randomUUID(), categoria, concepto: categoria === "Instalación" ? "Instalación y puesta en marcha" : categoria,
    periodicidad: categoria === "Instalación" ? "Puntual" : "Mensual",
    cantidad: 1, precio: 0, descuento: 0, iva: 21 };
}
export function nuevaFactura(emisor?: ParteFactura): Factura {
  const hoy = new Date();
  const localDate = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  const vence = new Date(hoy); vence.setDate(vence.getDate() + 30);
  const vacio = { nombre: "", nif: "", direccion: "", email: "" };
  return { numero: "", fecha: localDate(hoy), vencimiento: localDate(vence),
    emisor: emisor ?? { ...vacio, nombre: "OficiosOsIA" }, cliente: { ...vacio },
    lineas: [{...nuevaLinea("Otros"),concepto:""}], retencion: 0, descuentoGlobal: 0, aplicarIva: true, pago: "", notas: "" };
}
export function totalesFactura(f: Factura) {
  const lineas = f.lineas.map(l => {
    const bruto = redondear(l.cantidad * l.precio);
    const descuento = redondear(bruto * l.descuento / 100);
    const baseAntesGlobal = redondear(bruto - descuento);
    const descuentoGlobalImporte = redondear(baseAntesGlobal * (f.descuentoGlobal ?? 0) / 100);
    const base = redondear(baseAntesGlobal - descuentoGlobalImporte);
    const impuesto = f.aplicarIva === false ? 0 : redondear(base * l.iva / 100);
    return { ...l, bruto, descuentoImporte: descuento, baseAntesGlobal, descuentoGlobalImporte, base, impuesto, total: redondear(base + impuesto) };
  });
  const base = redondear(lineas.reduce((s, l) => s + l.base, 0));
  const iva = redondear(lineas.reduce((s, l) => s + l.impuesto, 0));
  const retencion = redondear(base * f.retencion / 100);
  const grupos = f.aplicarIva === false ? [] : [...new Set(lineas.map(l => l.iva))].sort((a,b) => a-b).map(tipo => ({
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
  if (!parse.success) return ["Revisa cantidades, precios, descuentos, impuestos y longitud de los textos."];
  const errores: string[] = [];
  if (!f.numero.trim()) errores.push("Indica el número de factura.");
  for (const [rol, parte] of [["emisor", f.emisor], ["cliente", f.cliente]] as const) {
    if (!parte.nombre.trim() || !parte.nif.trim() || !parte.direccion.trim()) errores.push(`Completa nombre o razón social, NIF y dirección del ${rol}.`);
  }
  if (f.lineas.some(l => !l.concepto.trim())) errores.push("Todos los conceptos deben tener una descripción.");
  const fechaValida = (v: string) => {
    const d = new Date(v + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v;
  };
  if (!fechaValida(f.fecha) || !fechaValida(f.vencimiento)) errores.push("Indica fechas válidas.");
  else if (f.vencimiento < f.fecha) errores.push("El vencimiento no puede ser anterior a la fecha de factura.");
  return errores;
}
