import { erroresFactura, totalesFactura, euros, type Factura } from "./modelo";

/** PDF vectorial con paginación: no depende del tamaño de pantalla ni de capturas del DOM. */
export async function crearPdfFactura(f: Factura) {
  const errores = erroresFactura(f);
  if (errores.length) throw new Error(errores.join(" "));
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cargarBase64 = async (ruta: string) => {
    const response = await fetch(ruta);
    if (!response.ok) throw new Error("No se han podido cargar los recursos de la factura.");
    const recurso = await response.blob();
    return new Promise<string>((resolve,reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(",")[1]);
      lector.onerror = () => reject(new Error("No se ha podido leer un recurso de la factura."));
      lector.readAsDataURL(recurso);
    });
  };
  // Fuentes incrustadas: la tipografía y los acentos no dependen del visor PDF.
  const [regular, negrita] = await Promise.all([
    cargarBase64("/branding/fonts/DejaVuSans.ttf"), cargarBase64("/branding/fonts/DejaVuSans-Bold.ttf"),
  ]);
  doc.addFileToVFS("DejaVuSans.ttf",regular); doc.addFont("DejaVuSans.ttf","OficiosSans","normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf",negrita); doc.addFont("DejaVuSans-Bold.ttf","OficiosSans","bold");
  const respuesta = await fetch("/branding/oficiososia-logo.png");
  if (!respuesta.ok) throw new Error("No se ha podido cargar el logo de la factura.");
  const blob = await respuesta.blob();
  const logo = await new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error("No se ha podido leer el logo."));
    lector.readAsDataURL(blob);
  });
  const t = totalesFactura(f);
  const bruto = t.lineas.reduce((sum,l)=>sum+l.bruto,0);
  const hayDescuento = t.descuentosLineas > 0 || (f.descuentoGlobal??0)>0;
  let y = 48;
  const izquierda = 16, derecha = 194, limite = 274;
  const fecha = (v: string) => v.split("-").reverse().join("/");
  const texto = (valor: string, x: number, posY: number, size = 10, bold = false) => {
    doc.setFont("OficiosSans", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(25, 25, 25);
    doc.text(valor, x, posY);
  };
  const encabezado = () => {
    doc.setFillColor(24, 25, 26); doc.rect(0, 0, 210, 33, "F");
    doc.addImage(logo, "PNG", izquierda, 9, 60, 17, undefined, "FAST");
    doc.setFont("OficiosSans", "bold"); doc.setFontSize(17); doc.setTextColor(255, 179, 0);
    doc.text("FACTURA", derecha, 16, { align: "right" });
    doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text(f.numero, derecha, 23, { align: "right" });
    doc.setFillColor(255, 179, 0); doc.rect(0, 33, 210, 1.5, "F");
  };
  const pagina = () => { doc.addPage(); encabezado(); y = 46; };
  const espacio = (alto: number) => { if (y + alto > limite) pagina(); };
  const parrafo = (valor: string, ancho = 178, size = 9, bold = false) => {
    doc.setFont("OficiosSans", bold ? "bold" : "normal"); doc.setFontSize(size);
    const partes: string[] = doc.splitTextToSize(valor, ancho);
    for (const linea of partes) { espacio(5); texto(linea, izquierda, y, size, bold); y += 5; }
  };
  encabezado();
  texto("EMISOR", izquierda, y, 8, true); texto("CLIENTE", 110, y, 8, true); y += 7;
  const dibujarParte = (p: Factura["emisor"], x: number) => {
    let pos = y;
    for (const [contenido, negrita] of [[p.nombre, true], ["NIF: " + p.nif, false], [p.direccion, false], [p.email, false]] as const) {
      if (!contenido) continue;
      doc.setFont("OficiosSans", negrita ? "bold" : "normal"); doc.setFontSize(9);
      const lineas: string[] = doc.splitTextToSize(contenido, 82);
      for (const l of lineas) { texto(l, x, pos, 9, negrita); pos += 4.5; }
    }
    return pos;
  };
  y = Math.max(dibujarParte(f.emisor, izquierda), dibujarParte(f.cliente, 110)) + 8;
  espacio(20);
  texto("Fecha: " + fecha(f.fecha), izquierda, y, 9);
  texto("Vencimiento: " + fecha(f.vencimiento), 110, y, 9); y += 10;
  const cabeceraTabla = () => {
    espacio(10);
    doc.setFillColor(238, 236, 231); doc.rect(izquierda, y - 5, 178, 9, "F");
    texto("CONCEPTO", 18, y, 8, true); texto("UD.", 105, y, 8, true);
    texto("PRECIO", 119, y, 8, true); if (f.aplicarIva!==false && f.ivaGlobal===undefined) texto("IVA", 151, y, 8, true);
    texto("BASE", 170, y, 8, true); y += 10;
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
    const detalle = l.categoria + " · " + l.periodicidad + (l.descuento ? " · Dto. " + l.descuento + "%" : "");
    const alto = Math.max(15, descripcion.length * 4.5 + 9);
    if (y + alto > limite) { pagina(); cabeceraTabla(); }
    descripcion.forEach((v, i) => texto(v, 18, y + i * 4.5, 9));
    texto(detalle, 18, y + descripcion.length * 4.5 + 1, 7);
    derechaTexto(String(l.cantidad), 115, y, 13);
    derechaTexto(euros(l.precio), 146, y, 27);
    if (f.aplicarIva!==false && f.ivaGlobal===undefined) derechaTexto(l.iva + "%", 162, y, 14);
    derechaTexto(euros(l.baseAntesGlobal), 192, y, 28);
    y += alto;
    doc.setDrawColor(220,220,220); doc.line(izquierda, y-4, derecha, y-4);
  }
  const altoTotales = 22 + t.grupos.length * 7 + (f.retencion ? 7 : 0) + (hayDescuento ? 14 : 0) + (t.descuentosLineas>0 ? 7 : 0) + ((f.descuentoGlobal??0)>0 ? 14 : 0);
  espacio(altoTotales); y += 4;
  const totalFila = (label: string, importe: number, destacado = false) => {
    if (destacado) { doc.setFillColor(255,179,0); doc.rect(88,y-5,106,10,"F"); }
    texto(label, 91, y, destacado ? 10 : 9, destacado);
    derechaTexto(euros(importe), 192, y, 40); y += destacado ? 14 : 7;
  };
  if(hayDescuento) totalFila("Antes de los descuentos",bruto);
  if(t.descuentosLineas>0) totalFila("Descuentos por concepto",-t.descuentosLineas);
  if ((f.descuentoGlobal??0)>0) {
    totalFila("Antes del descuento global",t.subtotal);
    totalFila("Descuento global " + f.descuentoGlobal + "%",-t.descuentoGlobal);
  }
  if(hayDescuento) totalFila("Descuento total aplicado",-(t.descuentosLineas+t.descuentoGlobal));
  totalFila(hayDescuento ? "Después de los descuentos" : "Base imponible", t.base);
  t.grupos.forEach(g => totalFila("IVA " + g.tipo + "%", g.importe));
  if (f.retencion) totalFila("Retención " + f.retencion + "%", -t.retencion);
  totalFila("TOTAL", t.total, true);
  if (f.pago.trim()) { espacio(15); parrafo("FORMA DE PAGO",178,8,true); parrafo(f.pago); y += 5; }
  if (f.notas.trim()) { espacio(15); parrafo("OBSERVACIONES",178,8,true); parrafo(f.notas); }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setDrawColor(220,220,220); doc.line(izquierda,282,derecha,282);
    texto("OficiosOsIA · " + f.numero, izquierda, 288, 8);
    derechaTexto(i + " / " + paginas, derecha, 288, 30);
  }
  doc.setProperties({ title: "Factura " + f.numero, author: f.emisor.nombre });
  return doc;
}
export async function descargarFactura(f: Factura) {
  const doc = await crearPdfFactura(f);
  doc.save("Factura-" + f.numero.replace(/[^a-zA-Z0-9_-]/g, "-") + ".pdf");
}
