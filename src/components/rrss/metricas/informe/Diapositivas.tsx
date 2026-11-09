/**
 * Diapositivas del informe mensual de redes sociales (16:9, lienzo 1280 × 720),
 * con las mismas piezas, colores y letra que el de tráfico web
 * (src/components/trafico-web/informe/piezas.tsx): titular que cuenta la
 * conclusión, cifras grandes, tarjeta pizarra y número de página.
 *
 * Al pie de cada diapositiva va de qué son los datos («Instagram de Casa
 * Tomás», «Webs de Casa Tomás y Touza»). Facebook no tiene diapositiva: no está
 * conectado y el informe lo dice en la portada y en las notas, sin cifras.
 */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { fmtCuota, fmtEntero, fmtMedia, fmtVariacion, mayusculaInicial } from "@/components/trafico-web/informe/formatoInforme";
import { GraficoBarras, GraficoEvolucion } from "@/components/trafico-web/informe/graficos";
import { Cifra, Etiqueta, Explicacion, Filete, Lienzo, LineaVariacion, Muestra, Tarjeta, Titular } from "@/components/trafico-web/informe/piezas";
import { COLOR, PILA_TITULOS } from "@/components/trafico-web/informe/tema";
import type { Cifra as CifraModelo } from "@/components/trafico-web/informe/modelo";
import type { InformeRrss } from "./modelo";

const PIE_INSTAGRAM = "Instagram de Casa Tomás";
const PIE_WEB = "Webs de Casa Tomás y Touza";
const PIE_REDES = "Redes sociales de Casa Tomás";

const valorOGuion = (v: number | null, f: (n: number) => string = fmtEntero) => (v === null ? "—" : f(v));

// ─── 1. Portada ──────────────────────────────────────────────────────────────
function Portada({ informe }: { informe: InformeRrss }) {
  return (
    <Lienzo titulo={informe.titulo}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingBottom: 24 }}>
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600 }}>
          {informe.marca} · Informe mensual
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
          <span style={{ display: "block" }}>Redes sociales</span>
          <span style={{ display: "block" }}>de {informe.marca}:</span>
          <span style={{ display: "block" }}>{informe.mes.nombreAnio}</span>
        </h1>
        <p style={{ margin: "28px 0 0", fontSize: 22, lineHeight: 1.4, color: COLOR.pizarra }}>
          Cuánta gente vio Instagram, qué publicaciones llegaron más lejos y cuántas visitas llevaron las redes a la web.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 17, color: COLOR.tenue }}>{informe.periodo}</p>
        <p style={{ margin: "4px 0 0", fontSize: 17, color: COLOR.tenue }}>Facebook aún no está conectado al panel: este informe no incluye sus datos.</p>
      </div>
    </Lienzo>
  );
}

// ─── 2. Resumen de Instagram ─────────────────────────────────────────────────
function CifraSecundaria({ valor, etiqueta, explicacion, variacion }: { valor: string; etiqueta: string; explicacion: string; variacion?: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Cifra tamano={64}>{valor}</Cifra>
      <Etiqueta style={{ marginTop: 14 }}>{etiqueta}</Etiqueta>
      {variacion}
      <Explicacion style={{ marginTop: 6, maxWidth: 260 }}>{explicacion}</Explicacion>
    </div>
  );
}

function ComparacionAlcance({ informe }: { informe: InformeRrss }) {
  const { resumen, mesAnterior } = informe;
  const v = resumen.alcance.variacion;
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
              ? `Alcance de todo el mes. ${mayusculaInicial(mesAnterior.nombre)}: ${fmtEntero(resumen.alcance.anterior ?? 0)}.`
              : `Alcance por día, porque faltan días con datos o el mes está en curso. ${mayusculaInicial(mesAnterior.nombre)}: ${fmtMedia(resumen.alcance.anterior ?? 0)} al día.`}
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

function textoSeguidores(s: InformeRrss["resumen"]["seguidores"], mesAnterior: string): ReactNode {
  if (s.cambio === null) return null;
  const sube = s.cambio > 0;
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
        {s.cambio > 0 ? `+${fmtEntero(s.cambio)}` : s.cambio < 0 ? `−${fmtEntero(-s.cambio)}` : "Igual"} frente a {mesAnterior}
      </span>
    </p>
  );
}

const lineaVariacion = (c: CifraModelo, mesAnterior: string) => <LineaVariacion variacion={c.variacion} mesAnterior={mesAnterior} />;

function Resumen({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const { resumen, mesAnterior } = informe;
  const ant = mesAnterior.nombre;
  return (
    <Lienzo numero={numero} titulo={resumen.titular} web={PIE_INSTAGRAM}>
      <Titular ancho={1040}>{resumen.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 28, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Cifra tamano={140}>{valorOGuion(resumen.alcance.valor)}</Cifra>
          <Etiqueta style={{ marginTop: 18 }}>Alcance</Etiqueta>
          <Explicacion style={{ marginTop: 6 }}>Cuentas que vieron alguna publicación, sumando cada día del mes.</Explicacion>
        </div>
        <ComparacionAlcance informe={informe} />
      </div>
      <div style={{ display: "flex", gap: 40, marginTop: "auto" }}>
        <CifraSecundaria
          valor={valorOGuion(resumen.visualizaciones.valor)}
          etiqueta="Visualizaciones"
          variacion={lineaVariacion(resumen.visualizaciones, ant)}
          explicacion="Veces que se vio el contenido (una cuenta puede verlo varias veces)."
        />
        <CifraSecundaria
          valor={valorOGuion(resumen.interacciones.valor)}
          etiqueta="Interacciones"
          variacion={lineaVariacion(resumen.interacciones, ant)}
          explicacion="Me gusta, comentarios, guardados y compartidos."
        />
        <CifraSecundaria
          valor={valorOGuion(resumen.seguidores.valor)}
          etiqueta="Seguidores"
          variacion={textoSeguidores(resumen.seguidores, ant)}
          explicacion={informe.enCurso ? "Los del último día medido." : "Los del último día medido del mes."}
        />
      </div>
    </Lienzo>
  );
}

// ─── 3. Evolución diaria del alcance ─────────────────────────────────────────
function Evolucion({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const { evolucion, resumen, mes, mesAnterior } = informe;
  const media = resumen.alcance.valor !== null && resumen.diasConDatos > 0 ? resumen.alcance.valor / resumen.diasConDatos : null;
  return (
    <Lienzo numero={numero} titulo={evolucion.titular} web={PIE_INSTAGRAM}>
      <Titular ancho={1060}>{evolucion.titular}</Titular>
      <div style={{ display: "flex", gap: 36, marginTop: 30, flex: 1, minHeight: 0 }}>
        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={96}>{valorOGuion(media, fmtMedia)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>Alcance al día de media</Etiqueta>
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
                <Muestra color={COLOR.oro} forma="punto" /> Día de más alcance
              </span>
            )}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {evolucion.huecos.length > 0 && (
              <Explicacion>La zona gris son días sin datos: no se pudieron leer de Instagram, no es que no llegara a nadie.</Explicacion>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GraficoEvolucion puntos={evolucion.puntos} mejorDia={evolucion.mejorDia} hayAnterior={evolucion.hayAnterior} huecos={evolucion.huecos} ancho={800} alto={470} />
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 4. Lo que se publicó ────────────────────────────────────────────────────
function Publicaciones({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const p = informe.publicaciones;
  if (!p) return null;
  const altoGrafico = Math.max(120, p.porTipo.length * 52);
  return (
    <Lienzo numero={numero} titulo={p.titular} web={PIE_INSTAGRAM}>
      <Titular ancho={1060}>{p.titular}</Titular>
      <div style={{ display: "flex", gap: 48, marginTop: 34, flex: 1, minHeight: 0 }}>
        <div style={{ width: 300, flexShrink: 0 }}>
          <Cifra tamano={140}>{fmtEntero(p.total)}</Cifra>
          <Etiqueta style={{ marginTop: 18 }}>{p.total === 1 ? "Publicación" : "Publicaciones"}</Etiqueta>
          <Explicacion style={{ marginTop: 6 }}>
            {p.totalAnterior > 0 ? `En ${informe.mesAnterior.nombre}: ${fmtEntero(p.totalAnterior)}.` : `Sin publicaciones medidas en ${informe.mesAnterior.nombre}.`}
          </Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta style={{ marginBottom: 14 }}>Por tipo</Etiqueta>
          <GraficoBarras items={p.porTipo} ancho={760} alto={altoGrafico} anchoNombres={170} />
          <div style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: "8px 28px" }}>
            {p.porTipo
              .filter((t) => t.alcanceMedio !== null)
              .map((t) => (
                <Explicacion key={t.nombre} style={{ fontSize: 17 }}>
                  <strong style={{ color: COLOR.pizarra }}>{t.nombre}:</strong> {fmtEntero(t.alcanceMedio ?? 0)} de alcance medio
                </Explicacion>
              ))}
          </div>
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 5. Las que más llegaron ─────────────────────────────────────────────────
function Mejores({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const p = informe.publicaciones;
  if (!p || p.mejores.length === 0) return null;
  const celda: CSSProperties = { padding: "12px 0", fontSize: 18, borderTop: "1px solid rgba(255,255,255,0.14)", verticalAlign: "top" };
  const cabecera: CSSProperties = { paddingBottom: 10, fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOR.tenueSobrePizarra, textAlign: "left" };
  return (
    <Lienzo numero={numero} titulo={p.titularMejores} web={PIE_INSTAGRAM}>
      <Titular ancho={1060}>{p.titularMejores}</Titular>
      <Tarjeta style={{ marginTop: 28, padding: "24px 36px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", color: COLOR.blanco }}>
          <thead>
            <tr>
              <th style={{ ...cabecera, width: 40 }}>#</th>
              <th style={{ ...cabecera, width: 110 }}>Día</th>
              <th style={{ ...cabecera, width: 120 }}>Tipo</th>
              <th style={cabecera}>Texto</th>
              <th style={{ ...cabecera, width: 120, textAlign: "right" }}>Alcance</th>
              <th style={{ ...cabecera, width: 150, textAlign: "right" }}>Interacciones</th>
            </tr>
          </thead>
          <tbody>
            {p.mejores.map((m, i) => (
              <tr key={m.mediaId}>
                <td style={{ ...celda, color: i === 0 ? COLOR.oroClaro : COLOR.tenueSobrePizarra, fontWeight: 700 }}>{i + 1}</td>
                <td style={celda}>{m.fechaCorta}</td>
                <td style={celda}>{m.tipo}</td>
                <td style={{ ...celda, paddingRight: 20, color: COLOR.tenueSobrePizarra, lineHeight: 1.35 }}>{m.texto}</td>
                <td style={{ ...celda, textAlign: "right", fontWeight: 700, color: i === 0 ? COLOR.oroClaro : COLOR.blanco }}>{fmtEntero(m.alcance)}</td>
                <td style={{ ...celda, textAlign: "right" }}>
                  {m.interacciones === null ? "—" : fmtEntero(m.interacciones)}
                  {m.tasa !== null && <span style={{ color: COLOR.tenueSobrePizarra, fontSize: 15 }}>{`  ${fmtCuota(m.tasa)}`}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
      <Explicacion style={{ marginTop: "auto", fontSize: 14 }}>
        Ordenadas por alcance. El porcentaje es interacciones entre alcance. Las publicadas al final del mes han tenido menos días para sumar.
      </Explicacion>
    </Lienzo>
  );
}

// ─── 6. Visitas a la web desde las redes ─────────────────────────────────────
function Web({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const w = informe.web;
  if (!w) return null;
  const altoGrafico = Math.max(110, w.redes.length * 52);
  return (
    <Lienzo numero={numero} titulo={w.titular} web={PIE_WEB}>
      <Titular ancho={1060}>{w.titular}</Titular>
      <div style={{ display: "flex", gap: 48, marginTop: 34, flex: 1, minHeight: 0 }}>
        <div style={{ width: 340, flexShrink: 0 }}>
          <Cifra tamano={130}>{fmtEntero(w.total)}</Cifra>
          <Etiqueta style={{ marginTop: 18 }}>Visitas desde redes</Etiqueta>
          <LineaVariacion variacion={w.variacion} mesAnterior={informe.mesAnterior.nombre} />
          <Explicacion style={{ marginTop: 10 }}>
            Visitas a las webs de Casa Tomás y Touza que llegan desde un enlace en una red social
            {w.cuota !== null ? `: el ${fmtCuota(w.cuota)} de todas las visitas del mes.` : "."}
          </Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Etiqueta style={{ marginBottom: 14 }}>Por red</Etiqueta>
          <GraficoBarras items={w.redes} ancho={720} alto={altoGrafico} anchoNombres={170} />
        </div>
      </div>
      <Explicacion style={{ marginTop: "auto", fontSize: 14 }}>
        Datos de Tráfico web (procedencia de cada visita). Quien llega desde la app de Instagram sin enlace puede contar como «Directo».
      </Explicacion>
    </Lienzo>
  );
}

// ─── 7. Conclusiones ─────────────────────────────────────────────────────────
function Conclusiones({ informe, numero }: { informe: InformeRrss; numero: number }) {
  const titular = `Qué nos dice ${informe.mes.nombre}`;
  return (
    <Lienzo numero={numero} titulo={titular} web={PIE_REDES}>
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

// ─── Montaje ─────────────────────────────────────────────────────────────────
type Pieza = (p: { informe: InformeRrss; numero: number }) => ReactNode;

interface DiapositivasInformeRrssProps {
  informe: InformeRrss;
  /** Envoltorio de cada diapositiva (la vista previa la escala al ancho disponible). */
  Envoltorio?: ComponentType<{ children: ReactNode; indice: number }>;
}

export function DiapositivasInformeRrss({ informe, Envoltorio }: DiapositivasInformeRrssProps) {
  const piezas: { clave: string; Pieza: Pieza }[] = [
    { clave: "resumen", Pieza: Resumen },
    { clave: "evolucion", Pieza: Evolucion },
  ];
  if (informe.publicaciones) {
    piezas.push({ clave: "publicaciones", Pieza: Publicaciones });
    if (informe.publicaciones.mejores.length > 0) piezas.push({ clave: "mejores", Pieza: Mejores });
  }
  if (informe.web) piezas.push({ clave: "web", Pieza: Web });
  if (informe.conclusiones.length > 0) piezas.push({ clave: "conclusiones", Pieza: Conclusiones });

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
