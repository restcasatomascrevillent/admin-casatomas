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
import { Etiqueta, Explicacion, Filete, Lienzo, Titular } from "@/components/trafico-web/informe/piezas";
import { COLOR, PILA_TITULOS } from "@/components/trafico-web/informe/tema";
import { alineadaDerecha, paginarTablas, textoCelda, type FilaInforme, type InformeTabla, type PaginaTabla } from "@/lib/informes/tabla";

const ALTO_FILA = 38;

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

const celda = (derecha: boolean, extra?: CSSProperties): CSSProperties => ({
  height: ALTO_FILA,
  padding: "0 12px",
  textAlign: derecha ? "right" : "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
  ...extra,
});

function Fila({ pagina, fila, total = false }: { pagina: PaginaTabla; fila: FilaInforme; total?: boolean }) {
  return (
    <tr style={total ? { borderTop: `2px solid ${COLOR.pizarra}` } : { borderBottom: `1px solid ${COLOR.rejilla}` }}>
      {pagina.tabla.columnas.map((c) => (
        <td key={c.id} style={celda(alineadaDerecha(c.tipo), { fontSize: 16, fontWeight: total ? 700 : 400, color: COLOR.pizarra })}>
          {textoCelda(fila[c.id] ?? null, c.tipo)}
        </td>
      ))}
    </tr>
  );
}

function DiapositivaTabla({ pagina, numero, textoPeriodo }: { pagina: PaginaTabla; numero: number; textoPeriodo: string }) {
  const { tabla } = pagina;
  // La primera columna (el nombre) se lleva el espacio que sobra; las de cifras, un ancho fijo.
  // Una columna con `ancho` propio lo usa (11/11/2026: «Vinos/Platos: facturas y carta», con 8-9 columnas).
  const numericas = tabla.columnas.filter((c) => alineadaDerecha(c.tipo) && !c.ancho).length;
  const anchoCifra = numericas > 0 ? Math.min(170, Math.floor(620 / numericas)) : 0;
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
                style={celda(alineadaDerecha(c.tipo), {
                  height: "auto",
                  minHeight: ALTO_FILA,
                  padding: "6px 12px",
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
            <Fila key={i} pagina={pagina} fila={f} />
          ))}
          {pagina.ultima && tabla.total && <Fila pagina={pagina} fila={tabla.total} total />}
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
