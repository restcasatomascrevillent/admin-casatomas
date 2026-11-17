// @vitest-environment node
// xlsx-celdas: zip mínimo (lectura por directorio central, escritura sin «data
// descriptors»), hojas por nombre, textos compartidos, lectura de celdas y
// escritura quirúrgica (estilo conservado, fórmulas intocables, recálculo al
// abrir). Con un libro pequeño hecho aquí y con la copia reducida del Excel real.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  columnaDeNumero,
  contenidoEntrada,
  crc32,
  desescaparXml,
  entradaDesde,
  ErrorXlsx,
  escaparXml,
  escribirZip,
  fechaASerial,
  HojaXlsx,
  leerTextosCompartidos,
  leerZip,
  LibroXlsx,
  marcarRecalculo,
  numeroDeColumna,
  partirReferencia,
  serialAFecha,
} from "../xlsx-celdas.ts";

const cod = new TextEncoder();
const dec = new TextDecoder();
const AHORA = new Date("2026-11-17T10:00:00Z");

const HOJA = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E6"/><sheetData>` +
  `<row r="1" spans="1:5"><c r="A1" s="4" t="s"><v>0</v></c><c r="B1" s="4" t="s"><v>1</v></c><c r="C1" s="4" t="s"><v>2</v></c></row>` +
  `<row r="2"><c r="A2" s="5"><v>46339.0</v></c><c r="B2" s="7" t="s"><v>3</v></c><c r="C2" s="11"><v>1700.5</v></c><c r="D2" s="15"><f>C2*2</f><v>3401</v></c><c r="E2" s="16" t="str"><f t="shared" ref="E2:E4" si="0">IF(C2&gt;0,&quot;Sí&quot;,&quot;&quot;)</f><v>Sí</v></c></row>` +
  `<row r="3"><c r="A3" s="6"/><c r="B3" s="9"/><c r="C3" s="13"/><c r="D3" s="15" t="str"><f>IF(C3=&quot;&quot;,&quot;&quot;,C3*2)</f><v></v></c><c r="E3" s="16" t="str"><f t="shared" si="0"/><v></v></c></row>` +
  `<row r="4"><c r="B4" t="inlineStr"><is><t xml:space="preserve"> en línea &amp; tal </t></is></c><c r="E4" s="16" t="str"><f t="shared" si="0"/><v></v></c></row>` +
  `<row r="5" ht="12"/>` +
  `</sheetData><dataValidations count="2"><dataValidation type="list" allowBlank="1" sqref="B2:B4"><formula1>&quot;Uno,Dos y medio,Tres&quot;</formula1></dataValidation><dataValidation type="list" sqref="C2:C4 A9"><formula1>$Z$1:$Z$3</formula1></dataValidation></dataValidations></worksheet>`;
const CADENAS = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Fecha</t></si><si><t>Nombre</t></si><si><t>Importe</t></si><si><r><rPr><b/></rPr><t>Casa </t></r><r><t xml:space="preserve">Tomás &amp; Cía</t></r><rPh><t>fonética</t></rPh></si></sst>`;
const LIBRO = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DATOS &amp; MÁS" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" r:id="rId2"/></sheets><calcPr/></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const OTRA = `<worksheet><sheetData/></worksheet>`;

async function libroPequeno(): Promise<Uint8Array> {
  const partes: Array<[string, string]> = [
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", LIBRO],
    ["xl/_rels/workbook.xml.rels", RELS],
    ["xl/sharedStrings.xml", CADENAS],
    ["xl/worksheets/sheet1.xml", HOJA],
    ["xl/worksheets/sheet2.xml", OTRA],
    ["xl/media/imagen.bin", "\u0000\u0001binario que no se tocaÿ".repeat(40)],
  ];
  return escribirZip(await Promise.all(partes.map(([n, t]) => entradaDesde(n, cod.encode(t), AHORA))));
}

const FIXTURE = new URL("../../control-excel/__tests__/fixtures/control-minimo.xlsx", import.meta.url);
const fixture = () => new Uint8Array(readFileSync(FIXTURE));

describe("utilidades", () => {
  it("crc32 da el valor de referencia", () => {
    expect(crc32(cod.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("columnas y referencias", () => {
    expect(numeroDeColumna("A")).toBe(1);
    expect(numeroDeColumna("ab")).toBe(28);
    expect(columnaDeNumero(1)).toBe("A");
    expect(columnaDeNumero(26)).toBe("Z");
    expect(columnaDeNumero(27)).toBe("AA");
    expect(columnaDeNumero(703)).toBe("AAA");
    expect(partirReferencia("$ab$12")).toEqual({ col: "AB", fila: 12 });
    for (const mala of ["A0", "12", "A", "A1:B2", "ABCD1", ""]) expect(() => partirReferencia(mala)).toThrow(ErrorXlsx);
  });

  it("fechas ↔ número de serie de Excel", () => {
    expect(fechaASerial("2026-11-13")).toBe(46339);
    expect(serialAFecha(46339)).toBe("2026-11-13");
    expect(serialAFecha(46339.75)).toBe("2026-11-13");
    expect(fechaASerial("2026-01-01")).toBe(46023);
    expect(fechaASerial("2026-02-30")).toBeNull();
    expect(fechaASerial("13/11/2026")).toBeNull();
    expect(serialAFecha(0)).toBeNull();
    expect(serialAFecha(Number.NaN)).toBeNull();
  });

  it("escapa y desescapa XML (sin caracteres de control)", () => {
    expect(escaparXml('a<b>&"c\u0001\u000b')).toBe("a&lt;b&gt;&amp;&quot;c");
    expect(desescaparXml("&lt;a&gt; &amp;amp; &quot;x&quot; &apos;y&apos; &#225; &#xE9; &nope;")).toBe(`<a> &amp; "x" 'y' á é &nope;`);
  });

  it("textos compartidos: sencillos, con formato y sin la guía fonética", () => {
    expect(leerTextosCompartidos(CADENAS)).toEqual(["Fecha", "Nombre", "Importe", "Casa Tomás & Cía"]);
    expect(leerTextosCompartidos("<sst><si><t/></si><si/><si><t>x</t></si></sst>")).toEqual(["", "", "x"]);
  });

  it("marcarRecalculo pone fullCalcOnLoad donde toca", () => {
    expect(marcarRecalculo("<workbook><sheets></sheets><calcPr/></workbook>")).toContain('<calcPr fullCalcOnLoad="1"/>');
    expect(marcarRecalculo('<workbook><calcPr calcId="191029" fullCalcOnLoad="0"/></workbook>')).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    const ya = '<workbook><calcPr fullCalcOnLoad="1"/></workbook>';
    expect(marcarRecalculo(ya)).toBe(ya);
    expect(marcarRecalculo("<workbook><sheets></sheets><definedNames/><extLst/></workbook>")).toBe('<workbook><sheets></sheets><definedNames/><calcPr fullCalcOnLoad="1"/><extLst/></workbook>');
    expect(marcarRecalculo("<workbook><sheets></sheets><extLst/></workbook>")).toBe('<workbook><sheets></sheets><calcPr fullCalcOnLoad="1"/><extLst/></workbook>');
  });
});

describe("zip", () => {
  it("ida y vuelta: mismas entradas, mismo orden, mismo contenido", async () => {
    const zip = await libroPequeno();
    const entradas = leerZip(zip);
    expect(entradas.map((e) => e.nombre)).toEqual(["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/media/imagen.bin"]);
    expect(dec.decode(await contenidoEntrada(entradas[4]))).toBe(HOJA);
    // Lo muy corto no comprime: se guarda tal cual.
    expect(entradas[0].metodo).toBe(0);
    expect(entradas[4].metodo).toBe(8);
    expect(escribirZip(entradas)).toEqual(zip);
  });

  it("lee el zip del Excel real (con «data descriptors»: los tamaños solo están en el directorio)", async () => {
    const entradas = leerZip(fixture());
    expect(entradas.map((e) => e.nombre)).toContain("xl/worksheets/sheet3.xml");
    const hoja = dec.decode(await contenidoEntrada(entradas.find((e) => e.nombre === "xl/worksheets/sheet3.xml")!));
    expect(hoja).toContain("<sheetData>");
  });

  it("rechaza lo que no es un zip y lo dañado", async () => {
    expect(() => leerZip(cod.encode("esto no es un excel, ni de lejos, aunque sea largo"))).toThrow(/no es un zip/);
    const zip = await libroPequeno();
    const [e] = leerZip(zip).filter((x) => x.nombre === "xl/worksheets/sheet1.xml");
    await expect(contenidoEntrada({ ...e, crc: e.crc ^ 1 })).rejects.toThrow(/dañado/);
    await expect(contenidoEntrada({ ...e, comprimido: e.comprimido.subarray(0, 20) })).rejects.toThrow(/dañado/);
    await expect(LibroXlsx.abrir(escribirZip([await entradaDesde("hola.txt", cod.encode("hola"))]))).rejects.toThrow(/workbook/);
  });
});

describe("leer celdas", () => {
  it("hojas por nombre (con sus relaciones) y cada tipo de celda", async () => {
    const libro = await LibroXlsx.abrir(await libroPequeno());
    expect(libro.nombresHojas()).toEqual(["DATOS & MÁS", "Otra"]);
    expect(libro.tieneHoja("Otra")).toBe(true);
    await expect(libro.hoja("No existe")).rejects.toMatchObject({ motivo: "hoja" });
    const h = await libro.hoja("DATOS & MÁS");
    expect(h.numerosDeFila()).toEqual([1, 2, 3, 4, 5]);
    expect(h.celda("A1")).toEqual({ ref: "A1", valor: "Fecha", formula: false, estilo: "4" });
    expect(h.celda("A2")).toMatchObject({ valor: 46339, estilo: "5" });
    expect(h.celda("B2")?.valor).toBe("Casa Tomás & Cía");
    expect(h.celda("C2")?.valor).toBe(1700.5);
    expect(h.celda("D2")).toMatchObject({ valor: 3401, formula: true });
    expect(h.celda("E2")).toMatchObject({ valor: "Sí", formula: true });
    // Vacías: con estilo pero sin valor; la fórmula que da «» es null.
    expect(h.celda("A3")).toMatchObject({ valor: null, formula: false, estilo: "6" });
    expect(h.celda("D3")).toMatchObject({ valor: null, formula: true });
    expect(h.celda("E3")).toMatchObject({ valor: null, formula: true });
    expect(h.celda("B4")).toMatchObject({ valor: " en línea & tal ", estilo: null });
    // No existen en el XML.
    expect(h.celda("A4")).toBeNull();
    expect(h.celda("A5")).toBeNull();
    expect(h.celda("A99")).toBeNull();
    expect([...h.fila(2).keys()]).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("listas de validación: las escritas en la propia validación", async () => {
    const h = await (await LibroXlsx.abrir(await libroPequeno())).hoja("DATOS & MÁS");
    expect(h.validaciones()).toEqual([{ sqref: "B2:B4", valores: ["Uno", "Dos y medio", "Tres"] }, { sqref: "C2:C4 A9", valores: null }]);
    expect(h.listaDe("B3")).toEqual(["Uno", "Dos y medio", "Tres"]);
    expect(h.listaDe("B5")).toBeNull();
    expect(h.listaDe("C2")).toBeNull();
    expect(h.listaDe("A9")).toBeNull();
    expect(h.listaDe("D2")).toBeNull();
  });
});

describe("escribir celdas", () => {
  it("cambia solo esas celdas, conserva su estilo y el resto del XML", async () => {
    const libro = await LibroXlsx.abrir(await libroPequeno());
    const h = await libro.hoja("DATOS & MÁS");
    h.escribir([
      { ref: "A3", valor: { fecha: "2026-12-30" } },
      { ref: "B3", valor: 'Texto con <etiqueta> & "comillas"' },
      { ref: "C3", valor: 17.14 },
      { ref: "C2", valor: null },
    ]);
    expect(h.modificada).toBe(true);
    expect(h.xml).toContain('<c r="A3" s="6"><v>46386</v></c>');
    expect(h.xml).toContain('<c r="B3" s="9" t="inlineStr"><is><t xml:space="preserve">Texto con &lt;etiqueta&gt; &amp; &quot;comillas&quot;</t></is></c>');
    expect(h.xml).toContain('<c r="C3" s="13"><v>17.14</v></c>');
    expect(h.xml).toContain('<c r="C2" s="11"/>');
    expect(h.celda("B3")?.valor).toBe('Texto con <etiqueta> & "comillas"');
    expect(h.celda("C2")).toMatchObject({ valor: null, estilo: "11" });
    // Las fórmulas, la fila 1, las validaciones… igual que estaban.
    const fila = (xml: string, n: number) => /<row r="N"[\s\S]*?<\/row>/.source.replace("N", String(n));
    expect(new RegExp(fila(h.xml, 1)).exec(h.xml)![0]).toBe(new RegExp(fila(HOJA, 1)).exec(HOJA)![0]);
    expect(h.xml).toContain('<c r="D3" s="15" t="str"><f>IF(C3=&quot;&quot;,&quot;&quot;,C3*2)</f><v></v></c>');
    expect(h.xml.slice(h.xml.indexOf("</sheetData>"))).toBe(HOJA.slice(HOJA.indexOf("</sheetData>")));
  });

  it("no escribe ruido binario en los números ni admite números imposibles", async () => {
    const h = new HojaXlsx("x", HOJA);
    h.escribir([{ ref: "C3", valor: 0.1 + 0.2 }]);
    expect(h.xml).toContain('<c r="C3" s="13"><v>0.3</v></c>');
    expect(() => h.escribir([{ ref: "C3", valor: Number.POSITIVE_INFINITY }])).toThrow(ErrorXlsx);
    expect(() => h.escribir([{ ref: "A3", valor: { fecha: "2026-02-31" } }])).toThrow(/Fecha no válida/);
  });

  it("se niega a escribir sobre una fórmula, sin tocar nada (ni las otras celdas del mismo cambio)", () => {
    const h = new HojaXlsx("COBROS", HOJA);
    let error: unknown;
    try {
      h.escribir([{ ref: "A3", valor: 5 }, { ref: "D2", valor: 1 }]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorXlsx);
    expect((error as ErrorXlsx).motivo).toBe("formula");
    expect((error as ErrorXlsx).message).toContain("D2");
    expect(h.xml).toBe(HOJA);
    expect(h.modificada).toBe(false);
    // También las de fórmula compartida sin texto (`<f t="shared" si="0"/>`).
    expect(() => h.escribir([{ ref: "E3", valor: "x" }])).toThrow(/fórmula/);
  });

  it("inserta en su sitio la celda que no existía, abre la fila autocerrada y crea la que falta", () => {
    const h = new HojaXlsx("x", HOJA);
    h.escribir([{ ref: "A4", valor: "primera" }, { ref: "C4", valor: 3 }, { ref: "G4", valor: "última", estilo: "7" }]);
    expect([...h.fila(4).keys()]).toEqual(["A", "B", "C", "E", "G"]);
    expect(h.celda("G4")).toMatchObject({ valor: "última", estilo: "7" });
    expect(h.celda("B4")?.valor).toBe(" en línea & tal ");
    h.escribir([{ ref: "B5", valor: 9 }]);
    expect(h.xml).toContain('<row r="5" ht="12"><c r="B5"><v>9</v></c></row>');
    h.escribir([{ ref: "A8", valor: "nueva" }, { ref: "A6", valor: 1 }]);
    expect(h.numerosDeFila()).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(h.xml.indexOf('<row r="6">')).toBeLessThan(h.xml.indexOf('<row r="8">'));
    expect(h.xml.indexOf('<row r="8">')).toBeLessThan(h.xml.indexOf("</sheetData>"));
    // En una hoja sin datos también.
    const vacia = new HojaXlsx("Otra", OTRA);
    vacia.escribir([{ ref: "B2", valor: "hola" }]);
    expect(vacia.xml).toBe('<worksheet><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t xml:space="preserve">hola</t></is></c></row></sheetData></worksheet>');
    // `spans` es una pista: al añadir fuera se quita.
    const conSpans = new HojaXlsx("x", HOJA);
    conSpans.escribir([{ ref: "H1", valor: 1 }]);
    expect(conSpans.xml).toContain('<row r="1"><c r="A1"');
  });

  it("actualizarCache cambia el valor guardado de una fórmula sin tocar la fórmula", () => {
    const h = new HojaXlsx("x", HOJA);
    h.actualizarCache("D2", 10.5);
    h.actualizarCache("E2", "");
    h.actualizarCache("D3", 4);
    h.actualizarCache("E3", "Sí");
    h.actualizarCache("A2", 1); // no es fórmula: nada
    h.actualizarCache("Z9", 1); // no existe: nada
    expect(h.xml).toContain('<c r="D2" s="15"><f>C2*2</f><v>10.5</v></c>');
    expect(h.xml).toContain('<c r="E2" s="16" t="str"><f t="shared" ref="E2:E4" si="0">IF(C2&gt;0,&quot;Sí&quot;,&quot;&quot;)</f><v></v></c>');
    expect(h.xml).toContain('<c r="D3" s="15"><f>IF(C3=&quot;&quot;,&quot;&quot;,C3*2)</f><v>4</v></c>');
    expect(h.xml).toContain('<c r="E3" s="16" t="str"><f t="shared" si="0"/><v>Sí</v></c>');
    expect(h.celda("A2")?.valor).toBe(46339);
    // Mismo valor: no cuenta como cambio.
    const igual = new HojaXlsx("x", HOJA);
    igual.actualizarCache("D2", 3401);
    expect(igual.modificada).toBe(false);
  });
});

describe("guardar el libro", () => {
  it("sin cambios devuelve los mismos bytes", async () => {
    const zip = await libroPequeno();
    const libro = await LibroXlsx.abrir(zip);
    await libro.hoja("DATOS & MÁS");
    expect(libro.modificado).toBe(false);
    expect(await libro.guardar()).toBe(zip);
  });

  it("con cambios: reescribe solo esa hoja y workbook.xml (recálculo); lo demás, byte a byte", async () => {
    const zip = await libroPequeno();
    const libro = await LibroXlsx.abrir(zip);
    (await libro.hoja("DATOS & MÁS")).escribir([{ ref: "C3", valor: 99 }]);
    const salida = await libro.guardar(AHORA);
    const antes = leerZip(zip);
    const despues = leerZip(salida);
    expect(despues.map((e) => e.nombre)).toEqual(antes.map((e) => e.nombre));
    const cambiadas = despues.filter((e, i) => e.crc !== antes[i].crc).map((e) => e.nombre);
    expect(cambiadas).toEqual(["xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    for (const [i, e] of despues.entries()) {
      if (!cambiadas.includes(e.nombre)) expect(e.comprimido).toEqual(antes[i].comprimido);
    }
    const otra = await LibroXlsx.abrir(salida);
    expect((await otra.hoja("DATOS & MÁS")).celda("C3")?.valor).toBe(99);
    expect(dec.decode(await contenidoEntrada(despues[1]))).toContain('<calcPr fullCalcOnLoad="1"/>');
  });

  it("copia reducida del Excel real: lee textos compartidos, fechas y fórmulas, y escribe sin romper nada", async () => {
    const original = fixture();
    const libro = await LibroXlsx.abrir(original);
    expect(libro.nombresHojas()).toEqual(["CLIENTES", "COBROS", "GASTOS CLIENTES"]);
    const cobros = await libro.hoja("COBROS");
    expect(cobros.celda("C6")?.valor).toBe("Cliente");
    expect(cobros.celda("C7")?.valor).toBe("Casa Tomás");
    expect(serialAFecha(cobros.celda("A7")?.valor as number)).toBe("2026-11-13");
    expect(cobros.celda("F7")?.valor).toBe(1500);
    expect(cobros.celda("H7")).toMatchObject({ formula: true, valor: 999 });
    expect(cobros.celda("I8")).toMatchObject({ formula: true, valor: "Pendiente" });
    expect(cobros.listaDe("D7")).toEqual(["Instalación", "Mensualidad", "Reembolso gastos", "Otro"]);
    expect(cobros.listaDe("C7")).toEqual(["Casa Tomás", "Nexo", "Energym", "Cristalería BV"]);
    const estiloG = cobros.celda("G7")?.estilo;
    cobros.escribir([{ ref: "G7", valor: 1500 }, { ref: "B7", valor: { fecha: "2026-11-17" } }, { ref: "L7", valor: "Pagado en mano" }]);
    expect(() => cobros.escribir([{ ref: "H7", valor: 0 }])).toThrow(/fórmula/);
    const salida = await libro.guardar(AHORA);
    const releido = await LibroXlsx.abrir(salida);
    const c2 = await releido.hoja("COBROS");
    expect(c2.celda("G7")).toMatchObject({ valor: 1500, estilo: estiloG });
    expect(serialAFecha(c2.celda("B7")?.valor as number)).toBe("2026-11-17");
    expect(c2.celda("L7")?.valor).toBe("Pagado en mano");
    // Las fórmulas (incluidas las compartidas) siguen ahí, en las 24 filas.
    expect([...c2.xml.matchAll(/<f\b/g)]).toHaveLength([...cobros.xml.matchAll(/<f\b/g)].length);
    expect(c2.celda("H7")?.formula).toBe(true);
    expect(c2.celda("H30")?.formula).toBe(true);
    // Validaciones y formato condicional, intactos.
    expect(c2.validaciones()).toEqual(cobros.validaciones());
    expect([...c2.xml.matchAll(/<conditionalFormatting\b/g)]).toHaveLength(6);
    // Las otras hojas no se han tocado: mismos bytes comprimidos.
    const [antes, despues] = [leerZip(original), leerZip(salida)];
    for (const nombre of ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet5.xml", "xl/styles.xml", "xl/sharedStrings.xml"]) {
      expect(despues.find((e) => e.nombre === nombre)!.comprimido).toEqual(antes.find((e) => e.nombre === nombre)!.comprimido);
    }
  });
});
