import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { PLANTILLA_REGALO, textoRegalo, type PlantillaRegalo, type ChequeRegalo } from "./regalo";

/** Este generador también se utiliza en la Edge Function: la vista previa es el PDF enviado. */
export async function generarPdfRegalo(cheque: ChequeRegalo, plantilla: PlantillaRegalo, logoPorDefecto: string): Promise<Uint8Array> {
  const p = { ...PLANTILLA_REGALO, ...plantilla };
  const doc = await PDFDocument.create();
  const fecha = new Date(cheque.creado_en || cheque.created_at || "2026-01-01T00:00:00Z");
  doc.setCreationDate(fecha); doc.setModificationDate(fecha);
  doc.setTitle(`${p.pdf_titulo} · ${cheque.codigo}`); doc.setAuthor("Casa Tomás");
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const cursiva = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const color = (hex: string) => rgb(...([1,3,5].map(i => parseInt(hex.slice(i,i + 2),16) / 255) as [number,number,number]));
  const acento = color(/^#[\da-f]{6}$/i.test(p.color_acento) ? p.color_acento : PLANTILLA_REGALO.color_acento);
  const fondo = color(/^#[\da-f]{6}$/i.test(p.color_fondo) ? p.color_fondo : PLANTILLA_REGALO.color_fondo);
  const tinta = rgb(.20,.20,.20), suave = rgb(.39,.37,.35);
  const ancho = 595.28, alto = 841.89;
  const safe = (text: string) => Array.from(String(text)).map(c => {
    if (/\s/.test(c)) return c;
    try { fuente.encodeText(c); return c; } catch { return "?"; }
  }).join("");
  let page = doc.addPage([ancho, alto]);
  let y = 0;
  const decorar = () => {
    page.drawRectangle({ x: 0, y: 0, width: ancho, height: alto, color: fondo });
    page.drawRectangle({ x: 30, y: 30, width: ancho - 60, height: alto - 60, borderWidth: .7, borderColor: acento });
    page.drawText("CASA TOMÁS · CREVILLENT", { x: 48, y: 48, size: 8, font: fuente, color: suave });
    page.drawText(String(doc.getPageCount()), { x: ancho - 52, y: 48, size: 8, font: fuente, color: suave });
  };
  const envolver = (text: string, font: PDFFont, size: number, width = 465) => {
    const lineas: string[] = [];
    for (const parrafo of safe(text).split(/\r?\n/)) {
      let linea = "";
      for (const palabra of parrafo.split(/\s+/)) {
        let trozo = "";
        const trozos: string[] = [];
        for (const c of palabra) {
          if (font.widthOfTextAtSize(trozo + c, size) > width) { trozos.push(trozo); trozo = ""; }
          trozo += c;
        }
        trozos.push(trozo);
        for (const parte of trozos) {
          const candidata = linea ? linea + " " + parte : parte;
          if (font.widthOfTextAtSize(candidata, size) > width && linea) { lineas.push(linea); linea = parte; }
          else linea = candidata;
        }
      }
      lineas.push(linea);
    }
    return lineas;
  };
  const asegurar = (altura: number) => {
    if (y - altura >= 88) return;
    page = doc.addPage([ancho, alto]); decorar();
    page.drawText(safe(p.pdf_titulo + " · " + cheque.codigo), { x: 56, y: alto - 70, size: 14, font: serif, color: acento });
    y = alto - 110;
  };
  const bloque = (text: string, size = 11, font: PDFFont = fuente, colorTexto = tinta, centrado = true) => {
    for (const linea of envolver(text, font, size)) {
      asegurar(size + 7);
      page.drawText(linea, { x: centrado ? (ancho - font.widthOfTextAtSize(linea, size)) / 2 : 65, y, size, font, color: colorTexto });
      y -= size + 7;
    }
  };
  decorar();
  y = alto - 70;
  const logoData = p.logo_data || logoPorDefecto;
  if (/^data:image\/(png|jpeg);base64,/.test(logoData)) {
    const bytes = Uint8Array.from(atob(logoData.split(",")[1]), c => c.charCodeAt(0));
    const logo = logoData.startsWith("data:image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const escala = Math.min(170 / logo.width, 100 / logo.height);
    const h = logo.height * escala, w = logo.width * escala;
    page.drawImage(logo, { x: (ancho - w) / 2, y: y - h, width: w, height: h });
    y -= h + 30;
  } else { bloque("Casa Tomás", 30, serif, acento); y -= 15; }
  bloque(textoRegalo(p.pdf_titulo, cheque, cheque.ocultar_importe), 29, serif, acento);
  if (p.pdf_subtitulo) bloque(textoRegalo(p.pdf_subtitulo, cheque, cheque.ocultar_importe), 12, cursiva, suave);
  y -= 18;
  if (!cheque.ocultar_importe) { bloque(Number(cheque.importe_eur).toFixed(2).replace(".", ",") + " €", 38, negrita); y -= 16; }
  asegurar(100);
  page.drawRectangle({ x: 80, y: y - 68, width: ancho - 160, height: 90, color: rgb(1,1,1), borderColor: acento, borderWidth: .5 });
  bloque("CÓDIGO DEL CHEQUE", 9, fuente, suave);
  y -= 10; bloque(cheque.codigo, 26, negrita, acento); y -= 38;
  if (cheque.destinatario_nombre) { bloque("Para " + cheque.destinatario_nombre, 17, serif); y -= 8; }
  if (cheque.fecha_entrega_deseada) bloque("Entrega deseada: " + cheque.fecha_entrega_deseada.split("-").reverse().join("/"), 10, fuente, suave);
  if (cheque.mensaje) { y -= 14; bloque(cheque.mensaje, 13, cursiva, suave); }
  y -= 24;
  if (p.pdf_instrucciones) bloque(textoRegalo(p.pdf_instrucciones, cheque, cheque.ocultar_importe), 10, fuente, suave);
  y -= 16;
  if (p.pdf_pie) bloque(textoRegalo(p.pdf_pie, cheque, cheque.ocultar_importe), 9, fuente, suave);
  return doc.save();
}
