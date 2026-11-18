/**
 * Diapositivas del «Informe mensual de auditoría» (18/11/2026, petición del dueño: «que se informe por lo que
 * hace cada usuario, no gráfico por días global sino lo que hace cada usuario, cuándo lo hace… varias slides por
 * usuario, y las acciones del servidor en unas slides finales dividiendo qué son cada una y explicándolo con
 * lenguaje entendible natural»).
 *
 *   1. Portada.
 *   2. «El equipo este mes»: una fila por persona (cuántas cosas, días, cuándo suele trabajar, dónde, delicadas).
 *   3. Por cada persona, hasta cuatro: su ficha (cifras y «En pocas palabras»), cuándo trabaja (calendario del
 *      mes, horas y días de la semana), qué toca (secciones y lo que pide al servidor) y lo último y lo delicado
 *      que hizo. Quien solo entró lleva la ficha; quien hizo poco, la ficha y lo último.
 *   4. Al final, lo que hace el sistema solo: el total y una tarjeta por proceso con qué es y qué hizo.
 *
 * Mismo lienzo, letra y colores que el resto de informes (src/components/trafico-web/informe/). Medidas en px y
 * estilos en línea: sale igual en la vista previa escalada y en el PDF (html2canvas). El modelo sale de
 * `src/lib/informes/auditoria/modelo.ts`.
 */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { fmtEntero } from "@/components/trafico-web/informe/formatoInforme";
import { Cifra, Etiqueta, Explicacion, Filete, Lienzo, Tarjeta, Titular } from "@/components/trafico-web/informe/piezas";
import { COLOR, PILA_TITULOS } from "@/components/trafico-web/informe/tema";
import {
  MAX_DELICADAS_PERSONA,
  POCAS_ACCIONES,
  type DiaCalendario,
  type InformeAuditoria,
  type LineaDelicada,
  type PersonaAuditoria,
  type ProcesoSistema,
} from "@/lib/informes/auditoria/modelo";

const PIE = "Auditoría del panel";
const FILAS_EQUIPO = 8;
const PROCESOS_POR_DIAPOSITIVA = 6;
const DELICADAS_POR_DIAPOSITIVA_EXTRA = 12;
const BOTONES_VISIBLES = 5;
const MAX_DIAPOSITIVAS_DELICADAS_EXTRA = 3;
const plural = (n: number, uno: string, varios: string) => `${fmtEntero(n)} ${n === 1 ? uno : varios}`;

/** Tonos del calendario (de pocas a muchas acciones): oro cada vez más intenso. Texto blanco en los dos últimos (≥ 4,5:1). */
const TONOS = ["#F1E6D2", "#DEC48F", "#A57B33", COLOR.oro] as const;
const SIN_ENTRAR = "#F2EEE9";

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Portada({ informe, generado }: { informe: InformeAuditoria; generado: string }) {
  return (
    <Lienzo titulo={informe.titulo}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingBottom: 24 }}>
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600 }}>
          Casa Tomás · Informe mensual
        </Etiqueta>
        <Filete ancho={72} style={{ marginTop: 18 }} />
        <h1 style={{ margin: "26px 0 0", fontFamily: PILA_TITULOS, fontSize: 68, lineHeight: 1.12, fontWeight: 700, letterSpacing: "-0.015em", color: COLOR.pizarra }}>
          <span style={{ display: "block" }}>Auditoría del panel:</span>
          <span style={{ display: "block" }}>{informe.nombreMes}</span>
        </h1>
        <p style={{ margin: "28px 0 0", maxWidth: 1040, fontSize: 22, lineHeight: 1.4, color: COLOR.pizarra }}>{informe.resumen.descripcion}</p>
        <p style={{ margin: "8px 0 0", fontSize: 17, color: COLOR.tenue }}>{informe.textoPeriodo} · hora de Madrid</p>
        <p style={{ margin: "4px 0 0", fontSize: 17, color: COLOR.tenue }}>Generado el {generado}</p>
      </div>
    </Lienzo>
  );
}

function CifraPequena({ valor, etiqueta, explicacion }: { valor: string; etiqueta: string; explicacion?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Cifra tamano={48}>{valor}</Cifra>
      <Etiqueta style={{ marginTop: 10, fontSize: 14 }}>{etiqueta}</Etiqueta>
      {explicacion && <Explicacion style={{ marginTop: 4, fontSize: 14 }}>{explicacion}</Explicacion>}
    </div>
  );
}

const th = (derecha = false, ancho?: number): CSSProperties => ({
  padding: "6px 12px",
  textAlign: derecha ? "right" : "left",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: COLOR.tenue,
  width: ancho,
  verticalAlign: "bottom",
});
const td = (derecha = false, extra?: CSSProperties): CSSProperties => ({
  height: 40,
  padding: "0 12px",
  textAlign: derecha ? "right" : "left",
  fontSize: 17,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontVariantNumeric: "tabular-nums",
  ...extra,
});

function Equipo({ informe, filas, numero, parte, partes }: { informe: InformeAuditoria; filas: InformeAuditoria["equipo"]; numero: number; parte: number; partes: number }) {
  const r = informe.resumen;
  return (
    <Lienzo numero={numero} titulo={r.titular} web={PIE}>
      <Titular ancho={1100}>{r.titular}</Titular>
      {parte === 1 ? (
        <div style={{ display: "flex", gap: 32, marginTop: 24 }}>
          <CifraPequena valor={fmtEntero(r.personas)} etiqueta={r.personas === 1 ? "Persona" : "Personas"} />
          <CifraPequena valor={fmtEntero(r.acciones)} etiqueta="Cosas hechas" />
          <CifraPequena valor={fmtEntero(r.delicadas)} etiqueta="Cosas delicadas" />
          <CifraPequena valor={fmtEntero(r.fallidos)} etiqueta="Intentos de entrar fallidos" />
        </div>
      ) : (
        <Explicacion style={{ marginTop: 10 }}>
          {informe.textoPeriodo} · {parte} de {partes}
        </Explicacion>
      )}
      <table style={{ width: "100%", marginTop: parte === 1 ? 26 : 22, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ borderBottom: `1.5px solid ${COLOR.pizarra}` }}>
            <th style={th()}>Persona</th>
            <th style={th(true, 120)}>Cosas</th>
            <th style={th(true, 90)}>Días</th>
            <th style={th(false, 170)}>Suele trabajar</th>
            <th style={th(false, 300)}>Donde más trabaja</th>
            <th style={th(true, 130)}>Delicadas</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} style={{ borderBottom: `1px solid ${COLOR.rejilla}` }}>
              <td style={td(false, { fontWeight: 600 })}>{f.nombre}</td>
              <td style={td(true)}>{fmtEntero(f.acciones)}</td>
              <td style={td(true)}>{fmtEntero(f.dias)}</td>
              <td style={td()}>{f.cuando}</td>
              <td style={td()}>{f.donde}</td>
              <td style={td(true, f.delicadas ? { color: COLOR.oro, fontWeight: 700 } : { color: COLOR.tenue })}>{f.delicadas ? fmtEntero(f.delicadas) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Explicacion style={{ marginTop: "auto", paddingTop: 12, fontSize: 15 }}>
        Una «cosa» es cada vez que alguien crea, cambia o borra algo, o le pide una tarea al servidor (solo entrar no cuenta). En las diapositivas siguientes,
        cada persona por separado; lo que hace el sistema solo va al final.
      </Explicacion>
    </Lienzo>
  );
}

/** Antetítulo de las diapositivas de una persona: «Persona 2 de 4 · ficha». */
const antetitulo = (p: PersonaAuditoria, i: number, total: number, que: string) => `Persona ${i + 1} de ${total} · ${que}${p.etiqueta ? ` · ${p.etiqueta}` : ""}`;

function Ficha({ p, i, total, numero, diasPeriodo }: { p: PersonaAuditoria; i: number; total: number; numero: number; diasPeriodo: number }) {
  // Con pocas acciones no hay más diapositivas suyas: la ficha enseña también lo que hizo.
  const compacta = p.acciones > 0 && p.acciones < POCAS_ACCIONES;
  return (
    <Lienzo numero={numero} titulo={p.titulares.ficha} web={p.etiqueta ?? p.nombre}>
      <Titular antetitulo={antetitulo(p, i, total, "ficha")} ancho={1100}>
        {p.titulares.ficha}
      </Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 28, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={104}>{fmtEntero(p.acciones)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>{p.acciones === 1 ? "Cosa hecha" : "Cosas hechas"}</Etiqueta>
          <div style={{ display: "flex", gap: 32, marginTop: 34 }}>
            <CifraPequena valor={fmtEntero(p.dias)} etiqueta="Días que entró" explicacion={`de ${diasPeriodo}`} />
            {p.entradas !== null && <CifraPequena valor={fmtEntero(p.entradas)} etiqueta="Veces que abrió el panel" />}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            <Explicacion>
              <strong style={{ color: COLOR.pizarra, fontWeight: 600 }}>Primera vez:</strong> {p.primera}
            </Explicacion>
            <Explicacion>
              <strong style={{ color: COLOR.pizarra, fontWeight: 600 }}>Última vez:</strong> {p.ultima}
            </Explicacion>
          </div>
        </div>
        <Tarjeta style={{ width: 560, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta color={COLOR.oroClaro} style={{ fontWeight: 600 }}>
            En pocas palabras
          </Etiqueta>
          <ul style={{ margin: "18px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: compacta ? 10 : 14 }}>
            {p.resumen.map((frase) => (
              <li key={frase} style={{ display: "flex", gap: 12, fontSize: compacta ? 17 : 18, lineHeight: 1.4, color: COLOR.blanco }}>
                <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, marginTop: 9, borderRadius: 4, background: COLOR.oroClaro }} />
                <span>{frase}</span>
              </li>
            ))}
          </ul>
          {compacta && p.recientes.length > 0 && (
            <>
              <Etiqueta color={COLOR.oroClaro} style={{ fontWeight: 600, marginTop: 22 }}>
                Lo que hizo
              </Etiqueta>
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {p.recientes.slice(0, 4).map((r, k) => (
                  <li key={k} style={{ display: "flex", gap: 12, fontSize: 15, lineHeight: 1.35 }}>
                    <span style={{ width: 120, flexShrink: 0, color: COLOR.tenueSobrePizarra }}>{r.cuando}</span>
                    <span style={{ color: COLOR.blanco }}>{r.frase}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tarjeta>
      </div>
    </Lienzo>
  );
}

// ─── Cuándo trabaja ──────────────────────────────────────────────────────────

const CELDA = { ancho: 62, alto: 50, hueco: 6 };

/** Nivel de 1 a 4 de un día con acciones, por cuartiles de sus días con actividad. */
function niveles(calendario: DiaCalendario[]): (n: number) => number {
  const valores = calendario.map((d) => d.n).filter((n) => n > 0).sort((a, b) => a - b);
  if (valores.length === 0) return () => 0;
  const q = (f: number) => valores[Math.min(valores.length - 1, Math.floor(f * valores.length))];
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
}

function Calendario({ dias }: { dias: DiaCalendario[] }) {
  const nivel = niveles(dias);
  const filas = Math.max(...dias.map((d) => d.fila)) + 1;
  const ancho = 7 * CELDA.ancho + 6 * CELDA.hueco;
  return (
    <div style={{ width: ancho }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELDA.ancho}px)`, columnGap: CELDA.hueco, marginBottom: 6 }}>
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
          <span key={d} style={{ textAlign: "center", fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", color: COLOR.tenue }}>
            {d}
          </span>
        ))}
      </div>
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(7, ${CELDA.ancho}px)`,
          gridTemplateRows: `repeat(${filas}, ${CELDA.alto}px)`,
          gap: CELDA.hueco,
        }}
      >
        {dias.map((d) => {
          const nv = nivel(d.n);
          const fondo = d.futuro ? "transparent" : nv > 0 ? TONOS[nv - 1] : d.entro ? COLOR.papel : SIN_ENTRAR;
          const claro = nv >= 3;
          return (
            <div
              key={d.dia}
              data-dia={d.dia}
              data-nivel={nv}
              style={{
                gridColumn: d.columna + 1,
                gridRow: d.fila + 1,
                boxSizing: "border-box",
                borderRadius: 8,
                background: fondo,
                border: d.futuro ? `1.5px dashed ${COLOR.rejilla}` : d.entro && nv === 0 ? `2px solid ${COLOR.piedra}` : "none",
                padding: "5px 7px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                color: claro ? COLOR.blanco : COLOR.pizarra,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1, opacity: d.futuro ? 0.5 : 0.85 }}>{d.numero}</span>
              {d.n > 0 && <span style={{ fontSize: 15, lineHeight: 1, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtEntero(d.n)}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, fontSize: 13, color: COLOR.tenue, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: SIN_ENTRAR }} /> No entró
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, boxSizing: "border-box", border: `2px solid ${COLOR.piedra}` }} /> Entró sin cambiar nada
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Pocas
          {TONOS.map((t) => (
            <span key={t} style={{ width: 14, height: 14, borderRadius: 4, background: t }} />
          ))}
          muchas cosas
        </span>
      </div>
    </div>
  );
}

function PorHoras({ horas, ancho, alto }: { horas: number[]; ancho: number; alto: number }) {
  const max = Math.max(1, ...horas);
  const columna = ancho / 24;
  const barra = Math.max(6, columna - 7);
  // Valor encima de las 3 barras más altas que no estén pegadas (si no, las cifras se pisan).
  const top3: number[] = [];
  for (const { h } of horas.map((n, h) => ({ n, h })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)) {
    if (top3.length < 3 && top3.every((o) => Math.abs(o - h) > 1)) top3.push(h);
  }
  const areaBarras = alto - 26;
  return (
    <div style={{ position: "relative", width: ancho, height: alto }}>
      {horas.map((n, h) => {
        const altura = n > 0 ? Math.max(3, (n / max) * (areaBarras - 22)) : 0;
        const destacado = n === max && n > 0;
        return (
          <div key={h} style={{ position: "absolute", left: h * columna + (columna - barra) / 2, bottom: 26, width: barra, height: altura, borderRadius: "3px 3px 0 0", background: destacado ? COLOR.oro : COLOR.piedra }}>
            {top3.includes(h) && (
              <span style={{ position: "absolute", bottom: altura + 4, left: "50%", transform: "translateX(-50%)", fontSize: 12, fontWeight: 600, color: COLOR.pizarra, whiteSpace: "nowrap" }}>
                {fmtEntero(n)}
              </span>
            )}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 25, height: 1, background: COLOR.grisMedio }} />
      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <span key={h} style={{ position: "absolute", bottom: 4, left: h * columna, width: columna * 3, fontSize: 12, color: COLOR.tenue }}>
          {h}:00
        </span>
      ))}
    </div>
  );
}

function PorSemana({ semana, ancho }: { semana: { dia: string; n: number }[]; ancho: number }) {
  const max = Math.max(1, ...semana.map((d) => d.n));
  const anchoBarra = ancho - 100 - 70;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: ancho }}>
      {semana.map((d) => (
        <div key={d.dia} style={{ display: "flex", alignItems: "center", height: 19, fontSize: 14 }}>
          <span style={{ width: 100, color: COLOR.pizarra }}>{d.dia}</span>
          <span style={{ width: anchoBarra, display: "flex" }}>
            <span style={{ display: "block", width: d.n > 0 ? Math.max(3, (d.n / max) * anchoBarra) : 0, height: 12, borderRadius: "0 3px 3px 0", background: d.n === max ? COLOR.oro : COLOR.piedra }} />
          </span>
          <span style={{ width: 70, textAlign: "right", fontVariantNumeric: "tabular-nums", color: d.n ? COLOR.pizarra : COLOR.tenue }}>{d.n ? fmtEntero(d.n) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

const fechaLarga = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function Cuando({ p, i, total, numero }: { p: PersonaAuditoria; i: number; total: number; numero: number }) {
  return (
    <Lienzo numero={numero} titulo={p.titulares.cuando} web={p.etiqueta ?? p.nombre}>
      <Titular antetitulo={antetitulo(p, i, total, "cuándo trabaja")} ancho={1100}>
        {p.titulares.cuando}
      </Titular>
      <div style={{ display: "flex", gap: 44, marginTop: 24, flex: 1, minHeight: 0 }}>
        <div style={{ flexShrink: 0 }}>
          <Etiqueta style={{ marginBottom: 10, fontSize: 14 }}>Cada día del mes</Etiqueta>
          <Calendario dias={p.calendario} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta style={{ fontSize: 14 }}>Por horas{p.franja ? ` · ${p.franja.texto}` : ""}</Etiqueta>
          <div style={{ marginTop: 10 }}>
            <PorHoras horas={p.horas} ancho={580} alto={150} />
          </div>
          <Etiqueta style={{ marginTop: 16, fontSize: 14 }}>Por días de la semana</Etiqueta>
          <div style={{ marginTop: 10 }}>
            <PorSemana semana={p.semana} ancho={580} />
          </div>
          {p.mejorDia && (
            <Explicacion style={{ marginTop: "auto", paddingTop: 8, fontSize: 15 }}>
              Su día con más actividad: {fechaLarga(p.mejorDia.dia)} ({plural(p.mejorDia.n, "cosa", "cosas")}).
            </Explicacion>
          )}
        </div>
      </div>
    </Lienzo>
  );
}

// ─── Qué hace ────────────────────────────────────────────────────────────────

function Que({ p, i, total, numero }: { p: PersonaAuditoria; i: number; total: number; numero: number }) {
  const conServidor = p.servidor.length > 0;
  return (
    <Lienzo numero={numero} titulo={p.titulares.que} web={p.etiqueta ?? p.nombre}>
      <Titular antetitulo={antetitulo(p, i, total, "qué hace")} ancho={1100}>
        {p.titulares.que}
      </Titular>
      <div style={{ display: "flex", gap: 36, marginTop: 24, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {p.secciones.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: `1.5px solid ${COLOR.pizarra}` }}>
                  <th style={th()}>Dónde</th>
                  <th style={th(true, 92)}>Crea</th>
                  <th style={th(true, 100)}>Cambia</th>
                  <th style={th(true, 88)}>Borra</th>
                  <th style={th(true, 100)}>Total</th>
                </tr>
              </thead>
              <tbody>
                {p.secciones.map((s, k) => (
                  <tr key={s.nombre} style={{ borderBottom: `1px solid ${COLOR.rejilla}` }}>
                    <td style={td(false, { fontWeight: k === 0 ? 600 : 400 })}>{s.nombre}</td>
                    <td style={td(true, { color: s.crear ? COLOR.pizarra : COLOR.tenue })}>{s.crear ? fmtEntero(s.crear) : "—"}</td>
                    <td style={td(true, { color: s.cambiar ? COLOR.pizarra : COLOR.tenue })}>{s.cambiar ? fmtEntero(s.cambiar) : "—"}</td>
                    <td style={td(true, { color: s.borrar ? COLOR.oro : COLOR.tenue, fontWeight: s.borrar ? 700 : 400 })}>{s.borrar ? fmtEntero(s.borrar) : "—"}</td>
                    <td style={td(true, { fontWeight: 700 })}>{fmtEntero(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Explicacion style={{ fontSize: 18 }}>No creó, cambió ni borró nada directamente: todo lo que hizo fue pedir tareas al servidor.</Explicacion>
          )}
          {p.seccionesResto.cuantas > 0 && (
            <Explicacion style={{ marginTop: 10 }}>
              Y {plural(p.seccionesResto.cuantas, "sitio más", "sitios más")}: {plural(p.seccionesResto.total, "cosa", "cosas")}.
            </Explicacion>
          )}
          <Explicacion style={{ marginTop: "auto", paddingTop: 12, fontSize: 14 }}>
            Cada fila de la base de datos cuenta como una cosa: subir una factura de 30 líneas son 31 (la factura y sus líneas).
          </Explicacion>
        </div>
        {conServidor && (
          <Tarjeta style={{ width: 430, flexShrink: 0, display: "flex", flexDirection: "column", padding: "28px 30px" }}>
            <Etiqueta color={COLOR.oroClaro} style={{ fontWeight: 600 }}>
              Lo que pide al servidor
            </Etiqueta>
            <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: 6, fontSize: 14 }}>
              Botones del panel que le encargan una tarea al servidor.
            </Explicacion>
            <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {p.servidor.slice(0, BOTONES_VISIBLES).map((s) => (
                <li key={s.nombre} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: 1.3, color: COLOR.blanco }}>
                    {s.nombre}
                    {s.fallidas > 0 && <span style={{ display: "block", fontSize: 13, color: COLOR.tenueSobrePizarra }}>{plural(s.fallidas, "vez no salió bien", "veces no salió bien")}</span>}
                  </span>
                  <span style={{ fontFamily: PILA_TITULOS, fontSize: 22, fontWeight: 700, color: COLOR.oroClaro, fontVariantNumeric: "tabular-nums" }}>{fmtEntero(s.n)}</span>
                </li>
              ))}
            </ul>
            {p.servidor.length > BOTONES_VISIBLES && (
              <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: "auto", paddingTop: 8, fontSize: 14 }}>
                Y {plural(p.servidor.length - BOTONES_VISIBLES, "tipo de tarea más", "tipos de tarea más")}.
              </Explicacion>
            )}
          </Tarjeta>
        )}
      </div>
    </Lienzo>
  );
}

// ─── Lo último y lo delicado ─────────────────────────────────────────────────
/** «Borró un archivo — 94 veces» (la fecha es la de la última). */
const conVeces = (l: LineaDelicada[]) => l.map((x) => ({ cuando: x.cuando, frase: x.veces > 1 ? `${x.frase} — ${fmtEntero(x.veces)} veces` : x.frase }));

function ListaTiempo({ lineas, tamano = 16 }: { lineas: { cuando: string; frase: string }[]; tamano?: number }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
      {lineas.map((l, k) => (
        <li key={k} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: `1px solid ${COLOR.rejilla}`, alignItems: "baseline" }}>
          <span style={{ width: 132, flexShrink: 0, fontSize: 14, color: COLOR.tenue, fontVariantNumeric: "tabular-nums" }}>{l.cuando}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: tamano, lineHeight: 1.3, color: COLOR.pizarra, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as CSSProperties}>
            {l.frase}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Ultimo({ p, i, total, numero }: { p: PersonaAuditoria; i: number; total: number; numero: number }) {
  const delicadas = p.delicadas.slice(0, MAX_DELICADAS_PERSONA);
  return (
    <Lienzo numero={numero} titulo={p.titulares.ultimo} web={p.etiqueta ?? p.nombre}>
      <Titular antetitulo={antetitulo(p, i, total, "lo último y lo delicado")} ancho={1100}>
        {p.titulares.ultimo}
      </Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 24, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Etiqueta style={{ fontSize: 14, marginBottom: 6 }}>Lo último que hizo</Etiqueta>
          {p.recientes.length ? <ListaTiempo lineas={p.recientes} tamano={15} /> : <Explicacion>No hay acciones suyas este mes.</Explicacion>}
        </div>
        <div style={{ width: 500, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta style={{ fontSize: 14, marginBottom: 6 }} color={delicadas.length ? COLOR.oro : COLOR.pizarra}>
            Lo delicado (borrar, precios, permisos)
          </Etiqueta>
          {delicadas.length ? (
            <>
              <ListaTiempo lineas={conVeces(delicadas)} tamano={15} />
              {(p.delicadas.length > delicadas.length || delicadas.some((x) => x.veces > 1)) && (
                <Explicacion style={{ marginTop: 8, fontSize: 14 }}>
                  {[delicadas.some((x) => x.veces > 1) && "Las que se repiten van juntas, con la fecha de la última.", p.delicadas.length > delicadas.length && "Sigue en la diapositiva siguiente."]
                    .filter(Boolean)
                    .join(" ")}
                </Explicacion>
              )}
              <Explicacion style={{ marginTop: "auto", paddingTop: 8, fontSize: 14 }}>Si algo no te suena, pregúntale. Todo se puede consultar (y muchas cosas deshacer) en Super Admin › Auditoría.</Explicacion>
            </>
          ) : (
            <div style={{ marginTop: 6, borderRadius: 20, background: "#F3EEE6", padding: "24px 26px" }}>
              <p style={{ margin: 0, fontFamily: PILA_TITULOS, fontSize: 24, fontWeight: 700, color: COLOR.pizarra }}>Nada delicado</p>
              <Explicacion style={{ marginTop: 8 }}>Este mes no borró nada, no cambió precios y no tocó permisos ni accesos.</Explicacion>
            </div>
          )}
        </div>
      </div>
    </Lienzo>
  );
}

function DelicadasExtra({ p, lineas, numero, parte, partes, quedan }: { p: PersonaAuditoria; lineas: LineaDelicada[]; numero: number; parte: number; partes: number; quedan: number }) {
  const titulo = `Lo delicado de ${p.nombre} (sigue)`;
  return (
    <Lienzo numero={numero} titulo={titulo} web={p.etiqueta ?? p.nombre}>
      <Titular antetitulo={`${parte} de ${partes}`} ancho={1100}>
        {titulo}
      </Titular>
      <div style={{ marginTop: 20 }}>
        <ListaTiempo lineas={conVeces(lineas)} tamano={15} />
      </div>
      {quedan > 0 && <Explicacion style={{ marginTop: "auto", fontSize: 14 }}>Y {plural(quedan, "más", "más")}: están todas en Super Admin › Auditoría y en el CSV.</Explicacion>}
    </Lienzo>
  );
}

// ─── El sistema ──────────────────────────────────────────────────────────────

function SistemaIntro({ informe, numero }: { informe: InformeAuditoria; numero: number }) {
  const s = informe.sistema;
  const top = s.procesos.slice(0, 8);
  const max = Math.max(1, ...top.map((p) => p.n));
  return (
    <Lienzo numero={numero} titulo={s.titular} web={PIE}>
      <Titular antetitulo="Lo que hace el sistema solo" ancho={1100}>
        {s.titular}
      </Titular>
      <div style={{ display: "flex", gap: 44, marginTop: 28, flex: 1, minHeight: 0 }}>
        <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={88}>{fmtEntero(s.total)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>Cosas automáticas</Etiqueta>
          <Explicacion style={{ marginTop: 18, fontSize: 17, color: COLOR.pizarra }}>
            Pasan sin que nadie pulse nada: tareas programadas, avisos de otros servicios (Stripe, el correo, Instagram) y reacciones de la propia base de datos.
          </Explicacion>
          <Explicacion style={{ marginTop: 12 }}>No cuentan en las diapositivas de cada persona. En las siguientes, qué es cada proceso y qué hizo.</Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <Etiqueta style={{ fontSize: 14 }}>Los procesos más activos</Etiqueta>
          {top.map((p, k) => (
            <div key={p.clave} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 16 }}>
                <span style={{ fontWeight: k === 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtEntero(p.n)}</span>
              </div>
              <span style={{ display: "block", width: `${Math.max(0.6, (p.n / max) * 100)}%`, height: 10, borderRadius: 3, background: k === 0 ? COLOR.oro : COLOR.piedra }} />
            </div>
          ))}
          {s.nota && <Explicacion style={{ marginTop: "auto", fontSize: 14 }}>{s.nota}</Explicacion>}
        </div>
      </div>
    </Lienzo>
  );
}

const recorte = (lineas: number): CSSProperties => ({ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: lineas, WebkitBoxOrient: "vertical" }) as CSSProperties;

function TarjetaProceso({ p }: { p: ProcesoSistema }) {
  return (
    <div style={{ boxSizing: "border-box", height: "100%", minHeight: 0, borderRadius: 20, border: `1px solid ${COLOR.rejilla}`, background: COLOR.blanco, padding: "16px 20px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <p style={{ margin: 0, fontFamily: PILA_TITULOS, fontSize: 18, lineHeight: 1.25, fontWeight: 700, color: COLOR.pizarra, ...recorte(2) }}>{p.nombre}</p>
        <span style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: COLOR.oro, fontVariantNumeric: "tabular-nums" }}>{fmtEntero(p.n)}</span>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.4, color: COLOR.pizarra, ...recorte(4) }}>{p.explicacion}</p>
      {p.detalle && (
        <p style={{ margin: "auto 0 0", paddingTop: 8, fontSize: 13.5, lineHeight: 1.35, color: COLOR.tenue, ...recorte(3) }}>
          <strong style={{ fontWeight: 600 }}>Este mes:</strong> {p.detalle}
        </p>
      )}
    </div>
  );
}

function SistemaProcesos({ procesos, numero, parte, partes }: { procesos: ProcesoSistema[]; numero: number; parte: number; partes: number }) {
  const titulo = partes > 1 ? `Qué es cada proceso (${parte} de ${partes})` : "Qué es cada proceso";
  return (
    <Lienzo numero={numero} titulo={titulo} web={PIE}>
      <Titular antetitulo="Lo que hace el sistema solo" ancho={1100}>
        {titulo}
      </Titular>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 1fr)", gap: 18, marginTop: 24, flex: 1, minHeight: 0 }}>
        {procesos.map((p) => (
          <TarjetaProceso key={p.clave} p={p} />
        ))}
      </div>
    </Lienzo>
  );
}

// ─── Todas ───────────────────────────────────────────────────────────────────

function trozos<T>(lista: T[], tamano: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) r.push(lista.slice(i, i + tamano));
  return r;
}

/** Lista de diapositivas (clave y nodo), numeradas en orden. Se exporta para las pruebas. */
export function diapositivasAuditoria(informe: InformeAuditoria, generado: string): { clave: string; nodo: ReactNode }[] {
  const lista: { clave: string; crear: (numero: number) => ReactNode }[] = [];
  lista.push({ clave: "portada", crear: () => <Portada informe={informe} generado={generado} /> });
  const equipo = trozos(informe.equipo, FILAS_EQUIPO);
  equipo.forEach((filas, k) =>
    lista.push({ clave: `equipo-${k}`, crear: (n) => <Equipo informe={informe} filas={filas} numero={n} parte={k + 1} partes={equipo.length} /> }),
  );
  const { diasPeriodo } = informe;
  const total = informe.personas.length;
  informe.personas.forEach((p, i) => {
    for (const tipo of p.diapositivas) {
      const clave = `${p.clave}-${tipo}`;
      if (tipo === "ficha") lista.push({ clave, crear: (n) => <Ficha p={p} i={i} total={total} numero={n} diasPeriodo={diasPeriodo} /> });
      if (tipo === "cuando") lista.push({ clave, crear: (n) => <Cuando p={p} i={i} total={total} numero={n} /> });
      if (tipo === "que") lista.push({ clave, crear: (n) => <Que p={p} i={i} total={total} numero={n} /> });
      if (tipo === "ultimo") {
        lista.push({ clave, crear: (n) => <Ultimo p={p} i={i} total={total} numero={n} /> });
        const resto = p.delicadas.slice(MAX_DELICADAS_PERSONA);
        const paginas = trozos(resto, DELICADAS_POR_DIAPOSITIVA_EXTRA).slice(0, MAX_DIAPOSITIVAS_DELICADAS_EXTRA);
        const mostradas = paginas.reduce((s, x) => s + x.length, 0);
        paginas.forEach((lineas, k) =>
          lista.push({
            clave: `${clave}-delicadas-${k}`,
            crear: (n) => <DelicadasExtra p={p} lineas={lineas} numero={n} parte={k + 1} partes={paginas.length} quedan={k === paginas.length - 1 ? resto.length - mostradas : 0} />,
          }),
        );
      }
    }
  });
  if (informe.sistema.total > 0) {
    lista.push({ clave: "sistema", crear: (n) => <SistemaIntro informe={informe} numero={n} /> });
    const grupos = trozos(informe.sistema.procesos, PROCESOS_POR_DIAPOSITIVA);
    grupos.forEach((procesos, k) =>
      lista.push({ clave: `sistema-${k}`, crear: (n) => <SistemaProcesos procesos={procesos} numero={n} parte={k + 1} partes={grupos.length} /> }),
    );
  }
  return lista.map((d, i) => ({ clave: d.clave, nodo: d.crear(i + 1) }));
}

interface DiapositivasAuditoriaProps {
  informe: InformeAuditoria;
  /** «18 de noviembre de 2026, 11:30» (el mismo en la vista previa y en el PDF). */
  generado: string;
  Envoltorio?: ComponentType<{ children: ReactNode; indice: number }>;
}

export function DiapositivasAuditoria({ informe, generado, Envoltorio }: DiapositivasAuditoriaProps) {
  const diapositivas = diapositivasAuditoria(informe, generado);
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
