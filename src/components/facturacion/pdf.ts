import { erroresFactura, facturaSchema, sinDatosFiscales, tituloRecibo, totalesRecibo, euros, type Factura } from "./modelo";

export interface OpcionesPdf {
  /**
   * Vista previa de un recibo SIN EMITIR (17/11/2026, «que dé vista previa del PDF»): no exige
   * número, cliente ni descripciones (pone «pendiente»), y lo marca arriba como «BORRADOR · SIN
   * EMITIR» para que no se confunda con un recibo emitido.
   */
  borrador?: boolean;
}

/**
 * PDF vectorial con paginación: no depende del tamaño de pantalla ni de capturas del DOM.
 * Es un RECIBO (17/11/2026): sin membrete (ni logo ni franja de marca) y sin ningún dato
 * fiscal — ni NIF, ni dirección, ni IVA, ni retención, ni vencimiento —, aunque el documento
 * guardado los tuviera.
 */
export async function crearPdfFactura(original: Factura, { borrador = false }: OpcionesPdf = {}) {
  let f = sinDatosFiscales(original);
  if (borrador) {
    if (!facturaSchema.safeParse(f).success) throw new Error("Revisa fechas, cantidades, precios y límites de los textos.");
    f = { ...f, numero: f.numero.trim() || "Sin número", cliente: { ...f.cliente, nombre: f.cliente.nombre.trim() || "Cliente pendiente" },
      lineas: f.lineas.map(l => (l.concepto.trim() ? l : { ...l, concepto: "Concepto pendiente" })) };
  } else {
    const errores = erroresFactura(f);
    if (errores.length) throw new Error(errores.join(" "));
  }
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cargarBase64 = async (ruta: string) => {
    const response = await fetch(ruta);
    if (!response.ok) throw new Error("No se han podido cargar los recursos del recibo.");
    const recurso = await response.blob();
    return new Promise<string>((resolve,reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(",")[1]);
      lector.onerror = () => reject(new Error("No se ha podido leer un recurso del recibo."));
      lector.readAsDataURL(recurso);
    });
  };
  // Fuentes incrustadas: la tipografía y los acentos no dependen del visor PDF.
  const [regular, negrita] = await Promise.all([
    cargarBase64("/branding/fonts/DejaVuSans.ttf"), cargarBase64("/branding/fonts/DejaVuSans-Bold.ttf"),
  ]);
  doc.addFileToVFS("DejaVuSans.ttf",regular); doc.addFont("DejaVuSans.ttf","OficiosSans","normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf",negrita); doc.addFont("DejaVuSans-Bold.ttf","OficiosSans","bold");
  const t = totalesRecibo(f);
  const bruto = t.lineas.reduce((sum,l)=>sum+l.bruto,0);
  const hayDescuento = t.descuentosLineas > 0 || (f.descuentoGlobal??0)>0;
  let y = 40;
  const izquierda = 16, derecha = 194, limite = 274;
  const fecha = (v: string) => v.split("-").reverse().join("/");
  const texto = (valor: string, x: number, posY: number, size = 10, bold = false) => {
    doc.setFont("OficiosSans", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(25, 25, 25);
    doc.text(valor, x, posY);
  };
  // Cabecera sobria, sin membrete: título, tipo de recibo, número y fecha, y una línea.
  const encabezado = () => {
    texto("RECIBO", izquierda, 20, 17, true);
    texto(tituloRecibo(f), izquierda, 27, 9);
    doc.setFont("OficiosSans", "bold"); doc.setFontSize(10); doc.setTextColor(25, 25, 25);
    doc.text(f.numero, derecha, 20, { align: "right" });
    doc.setFont("OficiosSans", "normal"); doc.setFontSize(9);
    doc.text("Fecha: " + fecha(f.fecha), derecha, 27, { align: "right" });
    doc.setDrawColor(25, 25, 25); doc.line(izquierda, 31, derecha, 31);
    if (borrador) {
      doc.setFont("OficiosSans", "bold"); doc.setFontSize(9); doc.setTextColor(150, 150, 150);
      doc.text("BORRADOR · SIN EMITIR", 105, 12, { align: "center" });
    }
  };
  const pagina = () => { doc.addPage(); encabezado(); y = 40; };
  const espacio = (alto: number) => { if (y + alto > limite) pagina(); };
  const parrafo = (valor: string, ancho = 178, size = 9, bold = false) => {
    doc.setFont("OficiosSans", bold ? "bold" : "normal"); doc.setFontSize(size);
    const partes: string[] = doc.splitTextToSize(valor, ancho);
    for (const linea of partes) { espacio(5); texto(linea, izquierda, y, size, bold); y += 5; }
  };
  encabezado();
  texto("RECIBÍ DE", izquierda, y, 8, true); y += 6;
  parrafo(f.cliente.nombre, 178, 10, true); y += 6;
  const cabeceraTabla = () => {
    espacio(10);
    doc.setFillColor(238, 238, 238); doc.rect(izquierda, y - 5, 178, 9, "F");
    texto("CONCEPTO", 18, y, 8, true); texto("UD.", 105, y, 8, true);
    texto("PRECIO", 125, y, 8, true);
    texto("IMPORTE", 172, y, 8, true); y += 10;
  };
  const derechaTexto = (v: string, x: number, pos: number, maxWidth: number) => {
    doc.setFont("OficiosSans", "normal"); doc.setFontSize(9);
    const size = Math.min(9, 9 * maxWidth / Math.max(maxWidth, doc.getTextWidth(v)));
    doc.setFontSize(size); doc.setTextColor(25,25,25); doc.text(v, x, pos, { align: "right" });
  };
  cabeceraTabla();
  for (const l of t.lineas) {
    doc.setFont("OficiosSans", "normal"); doc.setFontSize(9);
    const descripcion: string[] = doc.splitTextToSize(l.concepto, 82);
    const detalle = l.descuento ? "Dto. " + l.descuento + "%" : "";
    const alto = Math.max(11, descripcion.length * 4.5 + (detalle ? 9 : 5));
    if (y + alto > limite) { pagina(); cabeceraTabla(); }
    descripcion.forEach((v, i) => texto(v, 18, y + i * 4.5, 9));
    if (detalle) texto(detalle, 18, y + descripcion.length * 4.5 + 1, 7);
    derechaTexto(String(l.cantidad), 115, y, 13);
    derechaTexto(euros(l.precio), 150, y, 30);
    derechaTexto(euros(l.baseAntesGlobal), 192, y, 28);
    y += alto;
    doc.setDrawColor(220,220,220); doc.line(izquierda, y-4, derecha, y-4);
  }
  const altoTotales = 22 + (hayDescuento ? 14 : 0) + ((f.descuentoGlobal??0)>0 ? 14 : 0);
  espacio(altoTotales); y += 4;
  const totalFila = (label: string, importe: number, destacado = false) => {
    if (destacado) { doc.setFillColor(238,238,238); doc.rect(88,y-5,106,10,"F"); }
    texto(label, 91, y, destacado ? 10 : 9, destacado);
    derechaTexto(euros(importe), 192, y, 40); y += destacado ? 14 : 7;
  };
  if(hayDescuento) totalFila("Antes de los descuentos",bruto);
  if ((f.descuentoGlobal??0)>0) {
    totalFila("Antes del descuento global",t.subtotal);
    totalFila("Descuento global " + f.descuentoGlobal + "%",-t.descuentoGlobal);
  }
  if(hayDescuento) totalFila("Descuento total aplicado",-(t.descuentosLineas+t.descuentoGlobal));
  totalFila("TOTAL", t.total, true);
  if (f.pago.trim()) { espacio(15); parrafo("FORMA DE PAGO",178,8,true); parrafo(f.pago); y += 5; }
  if (f.notas.trim()) { espacio(15); parrafo("OBSERVACIONES",178,8,true); parrafo(f.notas); }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setDrawColor(220,220,220); doc.line(izquierda,282,derecha,282);
    texto([f.emisor.nombre.trim() && "Emitido por " + f.emisor.nombre.trim(), "Recibo " + f.numero].filter(Boolean).join(" · "), izquierda, 288, 8);
    derechaTexto(i + " / " + paginas, derecha, 288, 30);
  }
  doc.setProperties({ title: "Recibo " + f.numero, author: f.emisor.nombre });
  return doc;
}
const nombreArchivo = (f: Factura) => "Recibo-" + (f.numero.trim() || "borrador").replace(/[^a-zA-Z0-9_-]/g, "-") + ".pdf";
export async function descargarFactura(f: Factura) {
  const doc = await crearPdfFactura(f);
  doc.save(nombreArchivo(f));
}
/** El PDF como Blob, para enseñarlo en la vista previa sin descargarlo. */
export async function blobPdfFactura(f: Factura, opciones: OpcionesPdf = {}): Promise<Blob> {
  const doc = await crearPdfFactura(f, opciones);
  return doc.output("blob");
}
/** Descarga un PDF ya generado (el de la vista previa de un recibo emitido). */
export function descargarBlobPdf(blob: Blob, f: Factura) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo(f);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
