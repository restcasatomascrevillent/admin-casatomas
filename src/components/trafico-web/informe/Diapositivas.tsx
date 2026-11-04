/**
 * Diapositivas del informe mensual de tráfico web (16:9, lienzo 1280 × 720).
 * Estructura del informe de redes sociales del dueño (titular que cuenta la
 * conclusión, cifras enormes con etiqueta en versalitas, tarjetas redondeadas,
 * número de página abajo a la derecha) con los colores y la letra de la marca:
 * papel cálido, pizarra, oro y piedra; titulares y cifras en Libre Baskerville.
 *
 * Medidas en px y estilos en línea a propósito: la diapositiva no depende del
 * tamaño de letra raíz ni de los puntos de corte de Tailwind, y html2canvas
 * la captura igual que se ve.
 */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { PROYECTO_TOUZA, type InformeTrafico, type ItemBarra, type ParteDispositivo } from "./modelo";
import { fmtCuota, fmtEntero, fmtMedia, fmtVariacion, mayusculaInicial, unirLista } from "./formatoInforme";
import { GraficoBarras, GraficoEvolucion, GraficoSemana } from "./graficos";
import { DIAS_SEMANA, nombreWeb, type GrupoProcedencia } from "./nombres";
import { ALTO_DIAPOSITIVA, ANCHO_DIAPOSITIVA, COLOR, PILA_FUENTES, PILA_TITULOS } from "./tema";

const MARGEN_X = 72;

/** «la web de Casa Tomás» → «Web de Casa Tomás»: la marca de la web al pie de cada diapositiva. */
const marcaWeb = (web: string): string => mayusculaInicial(web.replace(/^las? /, ""));
const MARCA_TOUZA = marcaWeb(nombreWeb(PROYECTO_TOUZA));
/** Barras como mucho en la gráfica de páginas de Touza (su diapositiva lleva antetítulo y notas). */
const MAX_BARRAS_TOUZA = 5;

// ─── Piezas comunes ──────────────────────────────────────────────────────────
/**
 * Lienzo de una diapositiva. `web` pone al pie, abajo a la izquierda, de qué
 * web son los datos («Web de Casa Tomás» / «Web de Touza»): el informe tiene
 * las dos y cada diapositiva tiene que decir a cuál se refiere.
 */
function Lienzo({ numero, titulo, web, children }: { numero?: number; titulo: string; web?: string; children: ReactNode }) {
  return (
    <section
      data-diapositiva={numero ?? 1}
      aria-label={titulo}
      style={{
        position: "relative",
        width: ANCHO_DIAPOSITIVA,
        height: ALTO_DIAPOSITIVA,
        boxSizing: "border-box",
        padding: `50px ${MARGEN_X}px 54px`,
        background: COLOR.papel,
        color: COLOR.pizarra,
        fontFamily: PILA_FUENTES,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {children}
      {web && (
        <span
          data-web-diapositiva={web}
          style={{
            position: "absolute",
            left: MARGEN_X,
            bottom: 22,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            lineHeight: "18px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: COLOR.tenue,
          }}
        >
          <span aria-hidden style={{ display: "block", width: 14, height: 2, borderRadius: 1, background: COLOR.oro }} />
          {web}
        </span>
      )}
      {numero !== undefined && (
        <span style={{ position: "absolute", right: 28, bottom: 22, fontSize: 15, color: COLOR.pizarra }}>{numero}</span>
      )}
    </section>
  );
}

/** Filete de oro (como los de la web): encabeza el titular de cada diapositiva. */
function Filete({ ancho = 48, style }: { ancho?: number; style?: CSSProperties }) {
  return <span aria-hidden style={{ display: "block", width: ancho, height: 3, borderRadius: 2, background: COLOR.oro, ...style }} />;
}

/** Titular con su filete de oro. `antetitulo` (en oro, encima): la web de las diapositivas de Touza. */
function Titular({ children, ancho = 1040, antetitulo }: { children: ReactNode; ancho?: number; antetitulo?: string }) {
  return (
    <>
      {antetitulo && (
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600, marginBottom: 12 }}>
          {antetitulo}
        </Etiqueta>
      )}
      <Filete style={{ marginBottom: 16 }} />
      <h2
        style={{
          margin: 0,
          maxWidth: ancho,
          fontFamily: PILA_TITULOS,
          fontSize: 38,
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: COLOR.pizarra,
          // Líneas equilibradas: sin una palabra suelta en la segunda línea.
          textWrap: "balance",
        } as CSSProperties}
      >
        {children}
      </h2>
    </>
  );
}

function Etiqueta({ children, color = COLOR.pizarra, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 15,
        lineHeight: 1.35,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

function Explicacion({ children, color = COLOR.tenue, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, color, ...style }}>{children}</p>;
}

function Cifra({ children, tamano, color = COLOR.pizarra }: { children: ReactNode; tamano: number; color?: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: PILA_TITULOS,
        fontSize: tamano,
        lineHeight: 1,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color,
      }}
    >
      {children}
    </p>
  );
}

function Tarjeta({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: COLOR.pizarra, color: COLOR.blanco, borderRadius: 28, padding: "32px 36px", boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

/** Muestra de leyenda: línea corta (series de línea/área) o punto (marcador). */
function Muestra({ color, forma = "linea" }: { color: string; forma?: "linea" | "punto" | "cuadro" }) {
  const base: CSSProperties = { display: "inline-block", flexShrink: 0, background: color };
  if (forma === "punto") return <span aria-hidden style={{ ...base, width: 14, height: 14, borderRadius: 7 }} />;
  if (forma === "cuadro") return <span aria-hidden style={{ ...base, width: 16, height: 16, borderRadius: 4 }} />;
  return <span aria-hidden style={{ ...base, width: 24, height: 4, borderRadius: 2 }} />;
}

/**
 * Insignia «+27,1 % frente a septiembre» bajo la etiqueta de una cifra: en oro
 * si sube y con borde de piedra si baja o se queda igual (nada si no hay
 * comparación válida). Blanco sobre oro: 5,1:1.
 */
function LineaVariacion({
  variacion,
  mesAnterior,
  esMediaDiaria = false,
}: {
  variacion: { valor: number; base: "total" | "media" } | null;
  mesAnterior: string;
  esMediaDiaria?: boolean;
}) {
  if (!variacion) return null;
  const porDia = variacion.base === "media" && !esMediaDiaria ? " por día" : "";
  const sube = variacion.valor >= 0.05;
  return (
    <p style={{ margin: "8px 0 0" }}>
      <span
        style={{
          display: "inline-block",
          padding: "3px 12px",
          borderRadius: 999,
          fontSize: 16,
          lineHeight: "22px",
          fontWeight: 600,
          background: sube ? COLOR.oro : "transparent",
          color: sube ? COLOR.blanco : COLOR.pizarra,
          border: `1.5px solid ${sube ? COLOR.oro : COLOR.piedra}`,
        }}
      >
        {fmtVariacion(variacion.valor)}
        {porDia} frente a {mesAnterior}
      </span>
    </p>
  );
}

// ─── 1. Portada ──────────────────────────────────────────────────────────────
/** «la web de Casa Tomás» → ["Tráfico de la web", "de Casa Tomás:", "octubre 2026"], como la portada del informe de redes. */
function lineasTitulo(informe: InformeTrafico): string[] {
  const i = informe.web.indexOf(" de ");
  const [antes, despues] = i > 0 ? [informe.web.slice(0, i), informe.web.slice(i + 1)] : [informe.web, ""];
  return [`Tráfico de ${antes}`, ...(despues ? [`${despues}:`] : []), informe.mes.nombreAnio];
}

function Portada({ informe }: { informe: InformeTrafico }) {
  return (
    <Lienzo titulo={informe.titulo}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingBottom: 24 }}>
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600 }}>
          Casa Tomás · Informe mensual
        </Etiqueta>
        <Filete ancho={72} style={{ marginTop: 18 }} />
        <h1
          style={{
            margin: "26px 0 0",
            fontFamily: PILA_TITULOS,
            fontSize: 72,
            lineHeight: 1.12,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: COLOR.pizarra,
          }}
        >
          {lineasTitulo(informe).map((linea, i) => (
            <span key={i} style={{ display: "block" }}>
              {linea}
            </span>
          ))}
        </h1>
        <p style={{ margin: "28px 0 0", fontSize: 22, lineHeight: 1.4, color: COLOR.pizarra }}>
          Quién entra en la web, qué mira y desde dónde llega.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 17, color: COLOR.tenue }}>{informe.periodo}</p>
        {informe.touza && (
          <p style={{ margin: "4px 0 0", fontSize: 17, color: COLOR.tenue }}>Al final, un apartado para la web de Touza.</p>
        )}
      </div>
    </Lienzo>
  );
}

// ─── 2. Resumen en cifras ────────────────────────────────────────────────────
function CifraSecundaria({ valor, etiqueta, explicacion, variacion }: { valor: string; etiqueta: string; explicacion: string; variacion?: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Cifra tamano={76}>{valor}</Cifra>
      <Etiqueta style={{ marginTop: 16 }}>{etiqueta}</Etiqueta>
      {variacion}
      <Explicacion style={{ marginTop: 6, maxWidth: 330 }}>{explicacion}</Explicacion>
    </div>
  );
}

function Comparacion({ informe }: { informe: InformeTrafico }) {
  const { resumen, mesAnterior } = informe;
  const v = resumen.paginasVistas.variacion;
  return (
    <Tarjeta style={{ width: 400, flexShrink: 0 }}>
      <Etiqueta color={COLOR.tenueSobrePizarra}>Frente a {mesAnterior.nombre}</Etiqueta>
      {v ? (
        <>
          <p
            style={{
              margin: "12px 0 0",
              fontFamily: PILA_TITULOS,
              fontSize: 68,
              lineHeight: 1,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              color: COLOR.oroClaro,
            }}
          >
            {fmtVariacion(v.valor)}
          </p>
          <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: 10 }}>
            {v.base === "total"
              ? `Páginas vistas en todo el mes. ${mayusculaInicial(mesAnterior.nombre)}: ${fmtEntero(resumen.paginasVistas.anterior ?? 0)}.`
              : `Páginas vistas por día, porque faltan días con datos. ${mayusculaInicial(mesAnterior.nombre)}: ${fmtMedia(resumen.paginasVistas.anterior ?? 0)} al día.`}
          </Explicacion>
        </>
      ) : (
        <>
          <p style={{ margin: "12px 0 0", fontFamily: PILA_TITULOS, fontSize: 28, lineHeight: 1.2, fontWeight: 700 }}>Aún sin comparación</p>
          <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: 10 }}>
            {mayusculaInicial(resumen.comparacion)}.
          </Explicacion>
        </>
      )}
    </Tarjeta>
  );
}

function Resumen({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const { resumen, mesAnterior } = informe;
  const ant = mesAnterior.nombre;
  return (
    <Lienzo numero={numero} titulo={resumen.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1000}>{resumen.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 30, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Cifra tamano={150}>{fmtEntero(resumen.paginasVistas.valor ?? 0)}</Cifra>
          <Etiqueta style={{ marginTop: 18 }}>Páginas vistas</Etiqueta>
          <Explicacion style={{ marginTop: 6 }}>Cada vez que alguien abre una página de la web.</Explicacion>
        </div>
        <Comparacion informe={informe} />
      </div>
      <div style={{ display: "flex", gap: 48, marginTop: "auto" }}>
        <CifraSecundaria
          valor={resumen.visitantes.valor === null ? "—" : fmtEntero(resumen.visitantes.valor)}
          etiqueta="Visitantes"
          variacion={<LineaVariacion variacion={resumen.visitantes.variacion} mesAnterior={ant} />}
          explicacion="Personas distintas que entraron cada día. Si alguien vuelve otro día, cuenta otra vez."
        />
        <CifraSecundaria
          valor={resumen.mediaDiaria.valor === null ? "—" : fmtMedia(resumen.mediaDiaria.valor)}
          etiqueta="Al día de media"
          variacion={<LineaVariacion variacion={resumen.mediaDiaria.variacion} mesAnterior={ant} esMediaDiaria />}
          explicacion="Páginas vistas en un día normal del mes."
        />
        <CifraSecundaria
          valor={resumen.paginasPorVisitante === null ? "—" : fmtMedia(Math.round(resumen.paginasPorVisitante * 10) / 10)}
          etiqueta="Páginas por visitante"
          explicacion="Cuántas páginas mira, de media, cada persona que entra."
        />
      </div>
    </Lienzo>
  );
}

// ─── 3. Evolución diaria ─────────────────────────────────────────────────────
function Evolucion({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const { evolucion, resumen, mes, mesAnterior } = informe;
  return (
    <Lienzo numero={numero} titulo={evolucion.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1060}>{evolucion.titular}</Titular>
      <div style={{ display: "flex", gap: 36, marginTop: 30, flex: 1, minHeight: 0 }}>
        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={96}>{resumen.mediaDiaria.valor === null ? "—" : fmtMedia(resumen.mediaDiaria.valor)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>Páginas vistas al día de media</Etiqueta>
          <LineaVariacion variacion={resumen.mediaDiaria.variacion} mesAnterior={mesAnterior.nombre} esMediaDiaria />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28, fontSize: 17 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Muestra color={COLOR.oro} /> {mayusculaInicial(mes.nombre)}
            </span>
            {evolucion.hayAnterior && (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Muestra color={COLOR.piedra} /> {mayusculaInicial(mesAnterior.nombre)}, mismo día del mes
              </span>
            )}
            {evolucion.mejorDia && (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Muestra color={COLOR.oro} forma="punto" /> Mejor día
              </span>
            )}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {evolucion.huecos.length > 0 && (
              <Explicacion>La zona gris son días sin datos: no se pudieron copiar, no es que no entrara nadie.</Explicacion>
            )}
            {evolucion.notaAnomalias && <Explicacion>{evolucion.notaAnomalias}</Explicacion>}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GraficoEvolucion
            puntos={evolucion.puntos}
            mejorDia={evolucion.mejorDia}
            hayAnterior={evolucion.hayAnterior}
            huecos={evolucion.huecos}
            ancho={800}
            alto={470}
          />
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 4. Páginas más vistas ───────────────────────────────────────────────────
function Paginas({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const paginas = informe.paginas;
  if (!paginas) return null;
  const altoGrafico = Math.max(140, paginas.items.length * 44);
  const lider = paginas.items[0];
  return (
    <Lienzo numero={numero} titulo={paginas.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1060}>{paginas.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 34, flex: 1, minHeight: 0, alignItems: "flex-start" }}>
        <div style={{ width: 330, flexShrink: 0, display: "flex", flexDirection: "column", gap: 34 }}>
          {paginas.cuotaCarta !== null ? (
            <div>
              <Cifra tamano={110}>{fmtCuota(paginas.cuotaCarta)}</Cifra>
              <Etiqueta style={{ marginTop: 14 }}>De lo que se mira es la carta</Etiqueta>
              <Explicacion style={{ marginTop: 6 }}>Sumando todas sus secciones: platos, vinos, novedades…</Explicacion>
            </div>
          ) : (
            <div>
              <Cifra tamano={110}>{fmtCuota(lider.pct)}</Cifra>
              <Etiqueta style={{ marginTop: 14 }}>De las páginas vistas son de «{lider.nombre}»</Etiqueta>
            </div>
          )}
          {paginas.visitasReservas !== null && (
            <div>
              <Cifra tamano={64}>{fmtEntero(paginas.visitasReservas)}</Cifra>
              <Etiqueta style={{ marginTop: 12 }}>Veces que se abrió Reservas</Etiqueta>
            </div>
          )}
        </div>
        <Tarjeta style={{ flex: 1, minWidth: 0, padding: "28px 32px" }}>
          <p style={{ margin: 0, fontFamily: PILA_TITULOS, fontSize: 22, fontWeight: 700 }}>Páginas más vistas</p>
          <p style={{ margin: "4px 0 14px", fontSize: 15, color: COLOR.tenueSobrePizarra }}>Páginas vistas en {informe.mes.nombre} y % del total</p>
          <GraficoBarras items={paginas.items} ancho={690} alto={altoGrafico} sobrePizarra anchoNombres={270} />
          {paginas.restantes > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 15, color: COLOR.tenueSobrePizarra }}>
              Y {paginas.restantes} {paginas.restantes === 1 ? "página más" : "páginas más"} con menos visitas.
            </p>
          )}
        </Tarjeta>
      </div>
    </Lienzo>
  );
}

// ─── 5. Desde dónde llegan ───────────────────────────────────────────────────
const ETIQUETA_GRUPO: Record<string, (nombre: string) => string> = {
  directo: () => "Llega de forma directa",
  buscador: (n) => `Llega desde ${n}`,
  redes: (n) => `Llega desde ${n}`,
};

/** «Llega de forma directa», «Llega desde Google», «Llega desde «tripadvisor.es»». */
const etiquetaProcedencia = (p: { nombre: string; grupo: GrupoProcedencia }): string =>
  (ETIQUETA_GRUPO[p.grupo] ?? ((n: string) => `Llega desde «${n}»`))(p.nombre);

/** «Entra desde el móvil», «Entra desde la tablet». */
const etiquetaDispositivo = (d: ParteDispositivo): string =>
  `Entra desde ${d.clave === "tablet" ? "la tablet" : `el ${d.nombre.toLowerCase()}`}`;

function Procedencias({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const p = informe.procedencias;
  if (!p) return null;
  const etiqueta = etiquetaProcedencia(p.principal);
  return (
    <Lienzo numero={numero} titulo={p.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1060}>{p.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 34, flex: 1, minHeight: 0 }}>
        <div style={{ width: 330, flexShrink: 0 }}>
          <Cifra tamano={110}>{fmtCuota(p.principal.pct)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>{etiqueta}</Etiqueta>
          <Explicacion style={{ marginTop: 6 }}>De cada 100 visitas, {Math.round(p.principal.pct)} entran así.</Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta style={{ marginBottom: 14 }}>Por dónde entra la gente · páginas vistas y % del total</Etiqueta>
          <GraficoBarras items={p.items} ancho={760} alto={Math.max(140, p.items.length * 50)} anchoNombres={230} />
          {p.explicaciones.length > 0 && (
            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${COLOR.rejilla}`, paddingTop: 18 }}>
              {p.explicaciones.map((e) => (
                <Explicacion key={e.nombre}>
                  <strong style={{ color: COLOR.pizarra, fontWeight: 600 }}>{e.nombre}:</strong> {e.texto}.
                </Explicacion>
              ))}
            </div>
          )}
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 6. Dispositivo, país e idioma ───────────────────────────────────────────
/** Color fijo por aparato (sigue a la entidad, no al puesto) y color del % que va dentro. */
const COLOR_DISPOSITIVO: Record<ParteDispositivo["clave"], { fondo: string; texto: string }> = {
  mobile: { fondo: COLOR.oro, texto: COLOR.blanco },
  desktop: { fondo: COLOR.pizarra, texto: COLOR.blanco },
  tablet: { fondo: COLOR.piedra, texto: COLOR.pizarra },
};

/** Barra segmentada alta (≤ 28 px): cada parte con su % dentro si cabe; la leyenda lista nombre y cifra. */
function BarraSegmentada({ partes, ancho }: { partes: ParteDispositivo[]; ancho: number }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 2, width: ancho, height: 28 }} role="img" aria-label={partes.map((p) => `${p.nombre} ${fmtCuota(p.pct)}`).join(", ")}>
        {partes.map((p) => {
          const anchoParte = ((ancho - 2 * (partes.length - 1)) * p.pct) / 100;
          return (
            <div
              key={p.clave}
              style={{
                width: anchoParte,
                height: 28,
                background: COLOR_DISPOSITIVO[p.clave].fondo,
                borderRadius: 4,
                // Letra grande en negrita (≥ 18,7 px): la piedra con pizarra da 4,3:1, suficiente así.
                color: COLOR_DISPOSITIVO[p.clave].texto,
                fontSize: 19,
                fontWeight: 700,
                lineHeight: "28px",
                paddingLeft: 8,
                boxSizing: "border-box",
                overflow: "visible",
                whiteSpace: "nowrap",
              }}
            >
              {anchoParte >= 72 ? fmtCuota(p.pct) : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18, fontSize: 17 }}>
        {partes.map((p) => (
          <span key={p.clave} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Muestra color={COLOR_DISPOSITIVO[p.clave].fondo} forma="cuadro" />
            {p.nombre}
            <span style={{ color: COLOR.tenue }}>
              {fmtEntero(p.visitas)} · {fmtCuota(p.pct)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FilasTabla({ titulo, filas }: { titulo: string; filas: ItemBarra[] }) {
  const celda: CSSProperties = { padding: "9px 0", fontSize: 17, borderTop: "1px solid rgba(255,255,255,0.14)" };
  return (
    <>
      <tr>
        <th style={{ textAlign: "left", fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 0 10px" }}>{titulo}</th>
        <th style={{ textAlign: "right", fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 0 10px" }}>
          Páginas vistas
        </th>
        <th style={{ textAlign: "right", fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 0 10px", width: 90 }}>
          %
        </th>
      </tr>
      {filas.map((f) => (
        <tr key={f.nombre}>
          <td style={celda}>{f.nombre}</td>
          {/* Sin tabular-nums: html2canvas no aplica esa variante al pintar y el «%» quedaría descolocado en el PDF. */}
          <td style={{ ...celda, textAlign: "right" }}>{fmtEntero(f.visitas)}</td>
          <td style={{ ...celda, textAlign: "right" }}>{fmtCuota(f.pct)}</td>
        </tr>
      ))}
    </>
  );
}

function Audiencia({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const a = informe.audiencia;
  if (!a) return null;
  const idiomas = informe.paginas?.idiomas ?? null;
  return (
    <Lienzo numero={numero} titulo={a.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1060}>{a.titular}</Titular>
      <div style={{ display: "flex", gap: 48, marginTop: 34, flex: 1, minHeight: 0, alignItems: "flex-start" }}>
        <div style={{ width: 540, flexShrink: 0 }}>
          {a.principal && a.dispositivos ? (
            <>
              <Cifra tamano={130}>{fmtCuota(a.principal.pct)}</Cifra>
              <Etiqueta style={{ marginTop: 14 }}>{etiquetaDispositivo(a.principal)}</Etiqueta>
              <Explicacion style={{ marginTop: 6, marginBottom: 34 }}>Páginas vistas según el aparato desde el que se abre la web.</Explicacion>
              <BarraSegmentada partes={a.dispositivos} ancho={540} />
            </>
          ) : (
            <>
              <Cifra tamano={130}>{fmtCuota(a.pctEspana ?? 0)}</Cifra>
              <Etiqueta style={{ marginTop: 14 }}>De las visitas llega desde España</Etiqueta>
            </>
          )}
        </div>
        {(a.paises || idiomas) && (
          <Tarjeta style={{ flex: 1, minWidth: 0, padding: "30px 36px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", color: COLOR.blanco }}>
              <tbody>
                {a.paises && <FilasTabla titulo="País" filas={a.paises} />}
                {a.paises && idiomas && (
                  <tr>
                    <td colSpan={3} style={{ height: 22 }} />
                  </tr>
                )}
                {idiomas && <FilasTabla titulo="Idioma de la web" filas={idiomas} />}
              </tbody>
            </table>
          </Tarjeta>
        )}
      </div>
    </Lienzo>
  );
}

// ─── 7. Días de la semana ────────────────────────────────────────────────────
function DiasSemana({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const d = informe.diasSemana;
  if (!d) return null;
  return (
    <Lienzo numero={numero} titulo={d.titular} web={marcaWeb(informe.web)}>
      <Titular ancho={1060}>{d.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 34, flex: 1, minHeight: 0 }}>
        <div style={{ width: 330, flexShrink: 0, display: "flex", flexDirection: "column", gap: 30 }}>
          <div>
            <Cifra tamano={96}>{d.mejor.media === null ? "—" : fmtMedia(d.mejor.media)}</Cifra>
            <Etiqueta style={{ marginTop: 14 }}>Páginas vistas de media cada {d.mejor.singular}</Etiqueta>
          </div>
          {d.mediaFinde !== null && d.mediaEntreSemana !== null && (
            <div style={{ display: "flex", gap: 32 }}>
              <div>
                <Cifra tamano={52}>{fmtMedia(d.mediaEntreSemana)}</Cifra>
                <Etiqueta style={{ marginTop: 10 }}>Entre semana</Etiqueta>
              </div>
              <div>
                <Cifra tamano={52}>{fmtMedia(d.mediaFinde)}</Cifra>
                <Etiqueta style={{ marginTop: 10 }}>Fin de semana</Etiqueta>
              </div>
            </div>
          )}
          <Explicacion style={{ marginTop: "auto" }}>
            Media de páginas vistas de cada día de la semana en {informe.mes.nombre} ({d.mejor.dias}{" "}
            {d.mejor.dias === 1 ? d.mejor.singular : DIAS_SEMANA.find((x) => x.singular === d.mejor.singular)?.plural} con datos): un solo día muy
            bueno puede mover la media.
          </Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GraficoSemana items={d.items} ancho={760} alto={430} />
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 8. Conclusiones ─────────────────────────────────────────────────────────
function Conclusiones({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const titular = `Qué nos dice ${informe.mes.nombre}`;
  return (
    <Lienzo numero={numero} titulo={titular} web={marcaWeb(informe.web)}>
      <Titular>{titular}</Titular>
      <Tarjeta style={{ marginTop: 30, padding: "30px 40px" }}>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 16 }}>
          {informe.conclusiones.map((c, i) => (
            <li key={c} style={{ display: "flex", gap: 18, alignItems: "flex-start", fontSize: 21, lineHeight: 1.35 }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  background: COLOR.oroClaro,
                  color: COLOR.pizarra,
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: "34px",
                  textAlign: "center",
                }}
              >
                {i + 1}
              </span>
              <span style={{ paddingTop: 2 }}>{c}</span>
            </li>
          ))}
        </ol>
      </Tarjeta>
      <div style={{ marginTop: "auto", paddingRight: 40, display: "flex", flexDirection: "column", gap: 2 }}>
        {informe.notas.map((n) => (
          <Explicacion key={n} style={{ fontSize: 14 }}>
            {n}
          </Explicacion>
        ))}
      </div>
    </Lienzo>
  );
}

// ─── 9. Touza: resumen del mes ───────────────────────────────────────────────
/**
 * Apartado final de Touza (encargo del dueño, 04-11-2026: el informe enfatiza
 * la web principal, «pero que haya alguna diapositiva para Touza»). Mismo
 * estilo que el resto, con «Web de Touza» en oro sobre el titular y al pie.
 */
function TouzaResumen({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const a = informe.touza;
  if (!a?.conDatos) return null;
  const { resumen, evolucion, mes, mesAnterior } = a.informe;
  return (
    <Lienzo numero={numero} titulo={a.titular} web={MARCA_TOUZA}>
      <Titular antetitulo={MARCA_TOUZA} ancho={1060}>
        {a.titular}
      </Titular>
      <div style={{ display: "flex", gap: 36, marginTop: 28, flex: 1, minHeight: 0 }}>
        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={96}>{fmtEntero(resumen.paginasVistas.valor ?? 0)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>Páginas vistas</Etiqueta>
          {resumen.paginasVistas.variacion ? (
            <LineaVariacion variacion={resumen.paginasVistas.variacion} mesAnterior={mesAnterior.nombre} />
          ) : (
            <Explicacion style={{ marginTop: 6 }}>{mayusculaInicial(resumen.comparacion)}.</Explicacion>
          )}
          <div style={{ display: "flex", gap: 32, marginTop: 26 }}>
            <div>
              <Cifra tamano={52}>{resumen.visitantes.valor === null ? "—" : fmtEntero(resumen.visitantes.valor)}</Cifra>
              <Etiqueta style={{ marginTop: 10 }}>Visitantes</Etiqueta>
            </div>
            <div>
              <Cifra tamano={52}>{resumen.mediaDiaria.valor === null ? "—" : fmtMedia(resumen.mediaDiaria.valor)}</Cifra>
              <Etiqueta style={{ marginTop: 10 }}>Al día de media</Etiqueta>
            </div>
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, fontSize: 17 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Muestra color={COLOR.oro} /> {mayusculaInicial(mes.nombre)}, día a día
            </span>
            {evolucion.hayAnterior && (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Muestra color={COLOR.piedra} /> {mayusculaInicial(mesAnterior.nombre)}, mismo día del mes
              </span>
            )}
            {evolucion.huecos.length > 0 && <Explicacion>La zona gris son días sin datos: no se pudieron copiar.</Explicacion>}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GraficoEvolucion
            puntos={evolucion.puntos}
            mejorDia={evolucion.mejorDia}
            hayAnterior={evolucion.hayAnterior}
            huecos={evolucion.huecos}
            ancho={800}
            alto={420}
          />
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 10. Touza: qué se mira y cómo llega ─────────────────────────────────────
function TouzaDetalle({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const a = informe.touza;
  if (!a?.conDatos || !a.titularDetalle) return null;
  const t = a.informe;
  const barras = t.paginas
    ? {
        titulo: "Páginas más vistas",
        subtitulo: `Páginas vistas en ${t.mes.nombre} y % del total`,
        items: t.paginas.items.slice(0, MAX_BARRAS_TOUZA),
        restantes: t.paginas.restantes + Math.max(0, t.paginas.items.length - MAX_BARRAS_TOUZA),
      }
    : t.procedencias
      ? { titulo: "Por dónde entra la gente", subtitulo: "Páginas vistas y % del total", items: t.procedencias.items.slice(0, MAX_BARRAS_TOUZA), restantes: 0 }
      : null;
  const procedencia = t.procedencias?.principal ?? null;
  const dispositivo = t.audiencia?.principal ?? null;
  // Con pocas visitas es fácil un empate (14 y 14): «entra desde el móvil» sería engañoso.
  const empatados = dispositivo ? (t.audiencia?.dispositivos ?? []).filter((d) => d.visitas === dispositivo.visitas) : [];
  const etiquetaAparato =
    empatados.length > 1 ? `A partes iguales: ${unirLista(empatados.map((d) => d.nombre.toLowerCase()))}` : dispositivo ? etiquetaDispositivo(dispositivo) : "";
  const enlaces: string[] = [];
  if (a.visitasPaginaTouzaEnCasaTomas !== null) {
    const n = a.visitasPaginaTouzaEnCasaTomas;
    enlaces.push(`En la web de Casa Tomás, la página de Touza se abrió ${fmtEntero(n)} ${n === 1 ? "vez" : "veces"}.`);
  }
  if (a.visitasDesdeCasaTomas !== null) {
    const n = a.visitasDesdeCasaTomas;
    enlaces.push(`${fmtEntero(n)} ${n === 1 ? "página vista llegó" : "páginas vistas llegaron"} a Touza desde un enlace de la web de Casa Tomás.`);
  }
  return (
    <Lienzo numero={numero} titulo={a.titularDetalle} web={MARCA_TOUZA}>
      <Titular antetitulo={MARCA_TOUZA} ancho={1060}>
        {a.titularDetalle}
      </Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 30, flex: 1, minHeight: 0, alignItems: "flex-start" }}>
        <div style={{ width: 330, flexShrink: 0, display: "flex", flexDirection: "column", gap: 28 }}>
          {a.cuotaSobreAmbas !== null && (
            <div>
              <Cifra tamano={96}>{fmtCuota(a.cuotaSobreAmbas)}</Cifra>
              <Etiqueta style={{ marginTop: 14 }}>Del tráfico de las dos webs</Etiqueta>
              <Explicacion style={{ marginTop: 6 }}>Páginas vistas al día de Touza frente a las de Casa Tomás.</Explicacion>
            </div>
          )}
          {(procedencia || dispositivo) && (
            <div style={{ display: "flex", gap: 28 }}>
              {procedencia && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Cifra tamano={52}>{fmtCuota(procedencia.pct)}</Cifra>
                  <Etiqueta style={{ marginTop: 10 }}>{etiquetaProcedencia(procedencia)}</Etiqueta>
                </div>
              )}
              {dispositivo && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Cifra tamano={52}>{fmtCuota(dispositivo.pct)}</Cifra>
                  <Etiqueta style={{ marginTop: 10 }}>{etiquetaAparato}</Etiqueta>
                </div>
              )}
            </div>
          )}
        </div>
        {barras && (
          <Tarjeta style={{ flex: 1, minWidth: 0, padding: "28px 32px" }}>
            <p style={{ margin: 0, fontFamily: PILA_TITULOS, fontSize: 22, fontWeight: 700 }}>{barras.titulo}</p>
            <p style={{ margin: "4px 0 14px", fontSize: 15, color: COLOR.tenueSobrePizarra }}>{barras.subtitulo}</p>
            <GraficoBarras items={barras.items} ancho={690} alto={Math.max(140, barras.items.length * 44)} sobrePizarra anchoNombres={270} />
            {barras.restantes > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 15, color: COLOR.tenueSobrePizarra }}>
                Y {barras.restantes} {barras.restantes === 1 ? "página más" : "páginas más"} con menos visitas.
              </p>
            )}
          </Tarjeta>
        )}
      </div>
      {(enlaces.length > 0 || a.notas.length > 0) && (
        <div style={{ marginTop: 18, paddingRight: 40, display: "flex", flexDirection: "column", gap: 2 }}>
          {enlaces.map((e) => (
            <Explicacion key={e}>{e}</Explicacion>
          ))}
          {a.notas.map((n) => (
            <Explicacion key={n} style={{ fontSize: 14 }}>
              {n}
            </Explicacion>
          ))}
        </div>
      )}
    </Lienzo>
  );
}

// ─── Touza sin datos en el mes ───────────────────────────────────────────────
/**
 * Si Touza no tiene visitas del mes, la diapositiva se queda y lo explica (no
 * se omite): así el dueño ve que Touza no se ha olvidado y por qué no hay cifras.
 */
function TouzaSinDatos({ informe, numero }: { informe: InformeTrafico; numero: number }) {
  const a = informe.touza;
  if (a?.conDatos !== false) return null;
  return (
    <Lienzo numero={numero} titulo={a.titular} web={MARCA_TOUZA}>
      <Titular antetitulo={MARCA_TOUZA}>{a.titular}</Titular>
      <Tarjeta style={{ marginTop: 34, width: 820 }}>
        <Etiqueta color={COLOR.tenueSobrePizarra}>Por qué no hay cifras</Etiqueta>
        <p style={{ margin: "14px 0 0", fontFamily: PILA_TITULOS, fontSize: 28, lineHeight: 1.3, fontWeight: 700 }}>{a.motivo}</p>
        <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: 14 }}>
          Las cifras de las diapositivas anteriores son solo de la web de Casa Tomás: Touza no se suma a ellas.
        </Explicacion>
      </Tarjeta>
    </Lienzo>
  );
}

// ─── Conjunto ────────────────────────────────────────────────────────────────
type Pieza = ComponentType<{ informe: InformeTrafico; numero: number }>;

interface DiapositivasInformeProps {
  informe: InformeTrafico;
  /** Envoltorio de cada diapositiva (la vista previa la escala al ancho disponible). */
  Envoltorio?: ComponentType<{ children: ReactNode; indice: number }>;
}

export function DiapositivasInforme({ informe, Envoltorio }: DiapositivasInformeProps) {
  const piezas: { clave: string; Pieza: Pieza }[] = [
    { clave: "resumen", Pieza: Resumen },
    { clave: "evolucion", Pieza: Evolucion },
  ];
  if (informe.paginas) piezas.push({ clave: "paginas", Pieza: Paginas });
  if (informe.procedencias) piezas.push({ clave: "procedencias", Pieza: Procedencias });
  if (informe.audiencia) piezas.push({ clave: "audiencia", Pieza: Audiencia });
  if (informe.diasSemana) piezas.push({ clave: "dias", Pieza: DiasSemana });
  if (informe.conclusiones.length > 0) piezas.push({ clave: "conclusiones", Pieza: Conclusiones });
  // Touza, siempre al final y aparte: una o dos diapositivas con sus datos, o una que explica que no hay.
  if (informe.touza?.conDatos) {
    piezas.push({ clave: "touza-resumen", Pieza: TouzaResumen });
    if (informe.touza.titularDetalle) piezas.push({ clave: "touza-detalle", Pieza: TouzaDetalle });
  } else if (informe.touza) {
    piezas.push({ clave: "touza-sin-datos", Pieza: TouzaSinDatos });
  }

  const diapositivas: { clave: string; nodo: ReactNode }[] = [
    { clave: "portada", nodo: <Portada informe={informe} /> },
    ...piezas.map(({ clave, Pieza }, i) => ({ clave, nodo: <Pieza informe={informe} numero={i + 2} /> })),
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
