/**
 * Diapositivas de un informe de TABLA (src/lib/informes/tabla.ts) con el
 * formato del informe de Tráfico web: lienzo 16:9 de 1280 × 720, papel cálido,
 * titulares en Libre Baskerville con filete de oro y número de página. Una
 * portada y, por cada tabla, las diapositivas que hagan falta
 * (`FILAS_POR_DIAPOSITIVA` filas en cada una; el total y la nota, en la última).
 * Medidas en px y estilos en línea, como en las demás diapositivas: así sale
 * igual en la vista previa escalada y en el PDF (html2canvas).
 */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Etiqueta, Explicacion, Filete, Lienzo, MARGEN_X, Titular } from "@/components/trafico-web/informe/piezas";
import { ANCHO_DIAPOSITIVA, COLOR, PILA_TITULOS } from "@/components/trafico-web/informe/tema";
import { alineadaDerecha, esSubfila, paginarTablas, textoCelda, type ColumnaInforme, type FilaInforme, type InformeTabla, type PaginaTabla, type ValorCelda } from "@/lib/informes/tabla";

const ALTO_FILA = 38;
/** Ancho de la tabla: el del lienzo menos los márgenes. */
const ANCHO_TABLA = ANCHO_DIAPOSITIVA - 2 * MARGEN_X;
/** Relleno a cada lado de una celda; en las tablas de 9 columnas o más, menos, para que quepan los nombres (17/11/2026). */
const RELLENO_X = 12;
const RELLENO_X_DENSA = 9;
const COLUMNAS_TABLA_DENSA = 9;
const rellenoTabla = (columnas: readonly unknown[]) => (columnas.length >= COLUMNAS_TABLA_DENSA ? RELLENO_X_DENSA : RELLENO_X);
/** Ancho medio de un carácter de Inter, en «em» (medido con los nombres de la carta de vinos). */
const EM_POR_CARACTER = 0.52;

function Portada({ informe, generado }: { informe: InformeTabla; generado: string }) {
  return (
    <Lienzo titulo={informe.titulo}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingBottom: 24 }}>
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600 }}>
          Casa Tomás · Informe
        </Etiqueta>
        <Filete ancho={72} style={{ marginTop: 18 }} />
        <h1
          style={{
            margin: "26px 0 0",
            maxWidth: 1080,
            fontFamily: PILA_TITULOS,
            fontSize: 64,
            lineHeight: 1.12,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: COLOR.pizarra,
            textWrap: "balance",
          } as CSSProperties}
        >
          {informe.titulo}
        </h1>
        <p style={{ margin: "28px 0 0", maxWidth: 1000, fontSize: 22, lineHeight: 1.4, color: COLOR.pizarra }}>{informe.descripcion}</p>
        <p style={{ margin: "8px 0 0", fontSize: 17, color: COLOR.tenue }}>{informe.textoPeriodo}</p>
        <p style={{ margin: "4px 0 0", fontSize: 17, color: COLOR.tenue }}>Generado el {generado}</p>
      </div>
    </Lienzo>
  );
}

const celda = (derecha: boolean, relleno: number, extra?: CSSProperties): CSSProperties => ({
  height: ALTO_FILA,
  padding: `0 ${relleno}px`,
  textAlign: derecha ? "right" : "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
  ...extra,
});

/**
 * Ancho en px de cada columna: el suyo (`ancho`), el común de las cifras o, las de texto sin ancho, a
 * partes iguales lo que sobra (el mismo reparto que hace el navegador con `tableLayout: fixed`).
 */
function anchosColumnas(columnas: ColumnaInforme[]): { anchos: number[]; anchoCifra: number } {
  const numericas = columnas.filter((c) => alineadaDerecha(c.tipo) && !c.ancho).length;
  const anchoCifra = numericas > 0 ? Math.min(170, Math.floor(620 / numericas)) : 0;
  const fijos = columnas.map((c) => c.ancho ?? (alineadaDerecha(c.tipo) && numericas < columnas.length ? anchoCifra : null));
  const libres = fijos.filter((a) => a === null).length;
  const sobra = ANCHO_TABLA - fijos.reduce<number>((s, a) => s + (a ?? 0), 0);
  return { anchos: fijos.map((a) => a ?? Math.max(0, sobra / Math.max(1, libres))), anchoCifra };
}

const vacia = (v: ValorCelda | undefined) => v === null || v === undefined || v === "";

/**
 * Texto de una celda que no cabe en una línea (17/11/2026: nombres de vino largos, «Añada 2023 · no está
 * en carta», el margen): baja a una segunda línea dentro del alto de la fila, así cada diapositiva sigue
 * llevando las mismas filas. Si ni en dos líneas cabe, con letra más pequeña (2 o 4 px menos); lo que pase
 * de dos líneas se oculta.
 */
function letraTexto(texto: string, util: number, tamano: number): number {
  // En dos líneas se pierde algo al final de la primera (las palabras no se parten): hasta 1,6 veces el ancho.
  const cabe = (letra: number) => texto.length * letra * EM_POR_CARACTER <= Math.max(1, util) * 1.6;
  return cabe(tamano) ? tamano : cabe(tamano - 2) ? tamano - 2 : tamano - 4;
}

function Texto({ texto, util, tamano }: { texto: string; util: number; tamano: number }) {
  const letra = letraTexto(texto, util, tamano);
  // +3: html2canvas baja el texto un píxel y con menos recortaría los rabos de la «g» (2 × 19 = el alto de la fila).
  const linea = letra + 3;
  return <div style={{ whiteSpace: "normal", overflowWrap: "break-word", fontSize: letra, lineHeight: `${linea}px`, maxHeight: linea * 2, overflow: "hidden" }}>{texto}</div>;
}

function Fila({ pagina, fila, anchos, relleno, total = false }: { pagina: PaginaTabla; fila: FilaInforme; anchos: number[]; relleno: number; total?: boolean }) {
  // Subfila (16/11/2026): el detalle de la fila de encima, sangrado y más tenue («Cervezas» dentro de «Bebidas»).
  const sub = !total && esSubfila(fila);
  const { columnas } = pagina.tabla;
  // 17/11/2026: el nombre de una subfila ocupa también las celdas vacías que le siguen (en «Vinos: facturas y
  // carta», la añada se extiende por «Carta con IVA» y «Venta sin IVA», que no tienen nada), en vez de cortarse.
  let extension = 1;
  if (sub) while (extension < columnas.length && vacia(fila[columnas[extension].id])) extension++;
  return (
    <tr data-subfila={sub ? "" : undefined} style={total ? { borderTop: `2px solid ${COLOR.pizarra}` } : { borderBottom: `1px solid ${COLOR.rejilla}` }}>
      {columnas.map((c, i) => {
        if (i > 0 && i < extension) return null;
        const tamano = sub ? 15 : 16;
        const texto = textoCelda(fila[c.id] ?? null, c.tipo);
        const sangria = sub && i === 0 ? 40 : relleno;
        const ancho = i === 0 ? anchos.slice(0, extension).reduce((s, a) => s + a, 0) : anchos[i];
        return (
          <td
            key={c.id}
            colSpan={i === 0 && extension > 1 ? extension : undefined}
            style={celda(alineadaDerecha(c.tipo), relleno, {
              fontSize: tamano,
              fontWeight: total ? 700 : 400,
              color: sub ? COLOR.tenue : COLOR.pizarra,
              ...(sub && i === 0 ? { paddingLeft: sangria } : null),
            })}
          >
            {c.tipo === "texto" ? <Texto texto={texto} util={ancho - sangria - relleno} tamano={tamano} /> : texto}
          </td>
        );
      })}
    </tr>
  );
}

function DiapositivaTabla({ pagina, numero, textoPeriodo }: { pagina: PaginaTabla; numero: number; textoPeriodo: string }) {
  const { tabla } = pagina;
  // La primera columna (el nombre) se lleva el espacio que sobra; las de cifras, un ancho fijo.
  // Una columna con `ancho` propio lo usa (11/11/2026: «Vinos/Platos: facturas y carta», con 8-9 columnas).
  const numericas = tabla.columnas.filter((c) => alineadaDerecha(c.tipo) && !c.ancho).length;
  const { anchos, anchoCifra } = anchosColumnas(tabla.columnas);
  const relleno = rellenoTabla(tabla.columnas);
  return (
    <Lienzo numero={numero} titulo={tabla.titulo}>
      <Titular>{tabla.titulo}</Titular>
      <Explicacion style={{ marginTop: 10 }}>
        {textoPeriodo}
        {pagina.partes > 1 ? ` · ${pagina.parte} de ${pagina.partes}` : ""}
      </Explicacion>
      <table style={{ width: "100%", marginTop: 22, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          {tabla.columnas.map((c) => (
            <col
              key={c.id}
              style={c.ancho ? { width: c.ancho } : alineadaDerecha(c.tipo) && numericas < tabla.columnas.length ? { width: anchoCifra } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr style={{ borderBottom: `1.5px solid ${COLOR.pizarra}` }}>
            {tabla.columnas.map((c) => (
              <th
                key={c.id}
                // 14/11/2026: el encabezado puede ir en dos líneas («Compra sin IVA (base)») en vez de cortarse con «…».
                style={celda(alineadaDerecha(c.tipo), relleno, {
                  height: "auto",
                  minHeight: ALTO_FILA,
                  padding: `6px ${relleno}px`,
                  whiteSpace: "normal",
                  lineHeight: 1.2,
                  verticalAlign: "bottom",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: COLOR.tenue,
                })}
              >
                {c.etiqueta}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pagina.filas.map((f, i) => (
            <Fila key={i} pagina={pagina} fila={f} anchos={anchos} relleno={relleno} />
          ))}
          {pagina.ultima && tabla.total && <Fila pagina={pagina} fila={tabla.total} anchos={anchos} relleno={relleno} total />}
        </tbody>
      </table>
      {pagina.filas.length === 0 && !tabla.total && <Explicacion style={{ marginTop: 18 }}>Sin datos en este periodo.</Explicacion>}
      {pagina.ultima && tabla.nota && <Explicacion style={{ marginTop: 14 }}>{tabla.nota}</Explicacion>}
    </Lienzo>
  );
}

interface DiapositivasTablaProps {
  informe: InformeTabla;
  /** «10 nov 2026, 11:30» (se pasa desde fuera para que la vista previa y el PDF digan lo mismo). */
  generado: string;
  Envoltorio?: ComponentType<{ children: ReactNode; indice: number }>;
}

export function DiapositivasTabla({ informe, generado, Envoltorio }: DiapositivasTablaProps) {
  const diapositivas: { clave: string; nodo: ReactNode }[] = [
    { clave: "portada", nodo: <Portada informe={informe} generado={generado} /> },
    ...paginarTablas(informe.tablas).map((p, i) => ({
      clave: `${p.tabla.titulo}-${p.parte}`,
      nodo: <DiapositivaTabla pagina={p} numero={i + 2} textoPeriodo={informe.textoPeriodo} />,
    })),
  ];
  return (
    <>
      {diapositivas.map((d, i) =>
        Envoltorio ? (
          <Envoltorio key={d.clave} indice={i}>
            {d.nodo}
          </Envoltorio>
        ) : (
          <div key={d.clave}>{d.nodo}</div>
        ),
      )}
    </>
  );
}
