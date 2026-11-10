/**
 * PDF del informe mensual de Servicios (A4 vertical, texto y tabla: se lee y se
 * imprime bien y pesa poco). jsPDF se carga con `import()`: no entra en el
 * bundle de la pantalla hasta que se pulsa «PDF». Fuente Helvetica de jsPDF
 * (WinAnsi: acentos, «ñ» y «€» incluidos).
 */
import {
  type InformeMes,
  TEXTO_FALTA,
  TEXTO_ORIGEN,
  textoDiferenciaEur,
  textoDiferenciaPct,
  textoMes,
  textoMesCorto,
} from "@/lib/informeServicios";
import { formatearEur } from "@/lib/servicios";

const MARGEN = 40;
const ANCHO = 595.28;
const ALTO = 841.89;
const ORO: [number, number, number] = [158, 117, 47];
const GRIS: [number, number, number] = [100, 100, 100];

/** «12,50 €» con espacio normal (el irrompible de toLocaleString sale raro en Helvetica). */
const eur = (n: number | null) => (n == null ? "—" : formatearEur(n).replace(/\u00a0/g, " "));
const limpio = (t: string) => t.replace(/[\u00a0\u202f]/g, " ").replace(/−/g, "-");

export async function crearPdfInformeServicios(inf: InformeMes, generado: Date = new Date()): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const titulo = `Informe de servicios · ${textoMesCorto(inf.mes)}`;
  doc.setProperties({ title: titulo, subject: "Gasto mensual de los servicios contratados", author: "Casa Tomás", creator: "Panel de Casa Tomás" });

  let y = MARGEN;
  const nuevaPagina = () => {
    doc.addPage();
    y = MARGEN;
  };
  const sitio = (alto: number) => {
    if (y + alto > ALTO - MARGEN) nuevaPagina();
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ORO);
  doc.text("Casa Tomás · Servicios", MARGEN, y + 6);
  y += 28;
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(14);
  doc.text(limpio(`Informe de ${textoMes(inf.mes)}${inf.enCurso ? " (mes en curso)" : ""}`), MARGEN, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text(limpio(`Generado el ${generado.toLocaleDateString("es-ES")} a las ${generado.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} desde el panel.`), MARGEN, y);
  y += 22;

  // Cifras de cabecera.
  const cajas: Array<[string, string, string | null]> = [
    ["Total del mes", eur(inf.totalEur), inf.enCurso ? "hasta hoy" : null],
    [`${textoMesCorto(inf.anterior)}`, eur(inf.totalAnteriorEur), inf.totalAnteriorEur == null ? "sin datos" : null],
    ["Diferencia", limpio(textoDiferenciaEur(inf.diferenciaEur) ?? "—"), inf.diferenciaPct == null ? null : limpio(textoDiferenciaPct(inf.diferenciaPct) ?? "")],
  ];
  const anchoCaja = (ANCHO - MARGEN * 2 - 16) / 3;
  cajas.forEach(([etiqueta, valor, extra], i) => {
    const x = MARGEN + i * (anchoCaja + 8);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y, anchoCaja, 54, 4, 4);
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text(etiqueta, x + 10, y + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(20, 20, 20);
    doc.text(valor, x + 10, y + 36);
    doc.setFont("helvetica", "normal");
    if (extra) {
      doc.setFontSize(8);
      doc.setTextColor(...GRIS);
      doc.text(extra, x + 10, y + 48);
    }
  });
  y += 74;

  // Tabla por servicio.
  const columnas: Array<{ t: string; x: number; dcha?: boolean }> = [
    { t: "Servicio", x: MARGEN },
    { t: "Cuota", x: 265, dcha: true },
    { t: "Por uso", x: 325, dcha: true },
    { t: "Total", x: 390, dcha: true },
    { t: textoMesCorto(inf.anterior).slice(0, 3) + ".", x: 450, dcha: true },
    { t: "Origen", x: 462 },
  ];
  const cabecera = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    for (const c of columnas) doc.text(c.t, c.x, y, c.dcha ? { align: "right" } : undefined);
    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.line(MARGEN, y, ANCHO - MARGEN, y);
    y += 12;
    doc.setFont("helvetica", "normal");
  };
  cabecera();
  for (const f of inf.filas) {
    const nombre = doc.splitTextToSize(limpio(f.nombre), 190) as string[];
    const origen = f.origen === "falta" && f.falta ? `Falta: ${TEXTO_FALTA[f.falta].replace(/^Falta (el|la) /, "")}` : TEXTO_ORIGEN[f.origen];
    const lineasOrigen = doc.splitTextToSize(limpio(origen), ANCHO - MARGEN - 462) as string[];
    const alto = Math.max(nombre.length, lineasOrigen.length) * 11 + 4;
    if (y + alto > ALTO - MARGEN) {
      nuevaPagina();
      cabecera();
    }
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(nombre, MARGEN, y);
    doc.text(eur(f.fijoEur), 265, y, { align: "right" });
    doc.text(eur(f.usoEur), 325, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(eur(f.totalEur), 390, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRIS);
    doc.text(eur(f.anteriorEur), 450, y, { align: "right" });
    if (f.origen === "falta") doc.setTextColor(160, 90, 0);
    doc.text(lineasOrigen, 462, y);
    y += alto;
  }
  sitio(30);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGEN, y - 6, ANCHO - MARGEN, y - 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text("Total", MARGEN, y + 6);
  doc.text(eur(inf.totalEur), 390, y + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRIS);
  doc.text(eur(inf.totalAnteriorEur), 450, y + 6, { align: "right" });
  y += 30;

  // Lo que falta y las notas.
  const parrafo = (texto: string, color: [number, number, number] = GRIS, tam = 9) => {
    const lineas = doc.splitTextToSize(limpio(texto), ANCHO - MARGEN * 2) as string[];
    sitio(lineas.length * 12 + 4);
    doc.setFontSize(tam);
    doc.setTextColor(...color);
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 12 + 6;
  };
  doc.setFont("helvetica", "bold");
  parrafo(inf.faltan.length ? `Faltan por meter (${inf.faltan.length})` : "No falta ningún coste por meter", inf.faltan.length ? [160, 90, 0] : [20, 120, 60], 10);
  doc.setFont("helvetica", "normal");
  for (const f of inf.faltan) parrafo(`· ${f.nombre}: ${f.falta ? TEXTO_FALTA[f.falta].toLowerCase() : "sin dato"}. No suma al total.`);
  y += 6;
  parrafo(
    `Cómo se calcula: si se ha metido a mano el coste de un servicio ese mes (factura), cuenta ese; si no, la cuota del plan (precio actual) más lo gastado por uso según la última lectura del mes. ` +
      `Lo que está en dólares va en euros a 1 US$ = ${inf.eurPorUsd.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €.`,
  );

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text(limpio(`${titulo} · página ${i} de ${paginas}`), ANCHO / 2, ALTO - 20, { align: "center" });
  }
  return doc.output("blob");
}
