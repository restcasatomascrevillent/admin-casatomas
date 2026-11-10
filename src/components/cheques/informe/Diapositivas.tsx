/**
 * Diapositivas del informe de cheques regalo (16:9, lienzo 1280 × 720), con las mismas piezas, colores, letra y
 * gráficas que el informe de tráfico web (src/components/trafico-web/informe/): titular que cuenta la conclusión,
 * cifras grandes, tarjeta pizarra y número de página. El modelo sale de `src/lib/informes/cheques`.
 *
 * Se exporta suelto para que el módulo «Informes» del Super Admin pueda pintar el mismo informe.
 */
import type { ComponentType, ReactNode } from "react";
import { fmtCifra, fmtEntero, mayusculaInicial } from "@/components/trafico-web/informe/formatoInforme";
import { GraficoBarras, GraficoEvolucion, GraficoSemana } from "@/components/trafico-web/informe/graficos";
import { Cifra, Etiqueta, Explicacion, Filete, Lienzo, LineaVariacion, Muestra, Tarjeta, Titular } from "@/components/trafico-web/informe/piezas";
import { COLOR, PILA_TITULOS } from "@/components/trafico-web/informe/tema";
import { fmtEuros, type CifraEuros, type InformeCheques } from "@/lib/informes/cheques/modelo";

const PIE = "Cheques regalo de Casa Tomás";
const plural = (cantidad: number, uno: string, varios: string) => `${fmtEntero(cantidad)} ${cantidad === 1 ? uno : varios}`;
const frente = (informe: InformeCheques) => (informe.periodo.enCurso && informe.periodo.tipo === "mes" ? `los mismos días de ${informe.periodo.nombreAnterior}` : informe.periodo.nombreAnterior);

// ─── 1. Portada ──────────────────────────────────────────────────────────────
function Portada({ informe }: { informe: InformeCheques }) {
  return (
    <Lienzo titulo={informe.titulo}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingBottom: 24 }}>
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600 }}>
          Casa Tomás · Informe {informe.periodo.tipo === "mes" ? "mensual" : "anual"}
        </Etiqueta>
        <Filete ancho={72} style={{ marginTop: 18 }} />
        <h1 style={{ margin: "26px 0 0", fontFamily: PILA_TITULOS, fontSize: 72, lineHeight: 1.12, fontWeight: 700, letterSpacing: "-0.015em", color: COLOR.pizarra }}>
          <span style={{ display: "block" }}>Cheques regalo:</span>
          <span style={{ display: "block" }}>{informe.periodo.nombre}</span>
        </h1>
        <p style={{ margin: "28px 0 0", fontSize: 22, lineHeight: 1.4, color: COLOR.pizarra }}>
          Cuánto se vendió, por dónde entró el dinero, lo que se llevó Stripe y cuánto queda por canjear.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 17, color: COLOR.tenue }}>{informe.periodo.descripcion}</p>
      </div>
    </Lienzo>
  );
}

// ─── 2. Resumen ──────────────────────────────────────────────────────────────
function CifraSecundaria({ valor, etiqueta, explicacion, variacion }: { valor: string; etiqueta: string; explicacion: string; variacion?: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Cifra tamano={60}>{valor}</Cifra>
      <Etiqueta style={{ marginTop: 14 }}>{etiqueta}</Etiqueta>
      {variacion}
      <Explicacion style={{ marginTop: 6, maxWidth: 300 }}>{explicacion}</Explicacion>
    </div>
  );
}

function FilaTarjeta({ etiqueta, cifra, detalle }: { etiqueta: string; cifra: CifraEuros; detalle: string }) {
  return (
    <div>
      <Etiqueta color={COLOR.tenueSobrePizarra}>{etiqueta}</Etiqueta>
      <p style={{ margin: "10px 0 0", fontFamily: PILA_TITULOS, fontSize: 52, lineHeight: 1, fontWeight: 700, color: COLOR.oroClaro, whiteSpace: "nowrap" }}>{fmtEuros(cifra.valor ?? 0)}</p>
      <Explicacion color={COLOR.tenueSobrePizarra} style={{ marginTop: 8 }}>
        {detalle}
      </Explicacion>
    </div>
  );
}

function Resumen({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const { resumen } = informe;
  const ant = frente(informe);
  return (
    <Lienzo numero={numero} titulo={resumen.titular} web={PIE}>
      <Titular ancho={1060}>{resumen.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 28, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={128}>{fmtEuros(resumen.vendido.valor ?? 0)}</Cifra>
          <Etiqueta style={{ marginTop: 18 }}>Vendido en cheques</Etiqueta>
          <LineaVariacion variacion={resumen.vendido.variacion} mesAnterior={ant} />
          <Explicacion style={{ marginTop: 6 }}>Valor de los cheques cobrados en la web y en el restaurante (sin cortesías).</Explicacion>
          <div style={{ display: "flex", gap: 40, marginTop: "auto" }}>
            <CifraSecundaria
              valor={fmtEntero(resumen.vendidos.valor ?? 0)}
              etiqueta="Cheques vendidos"
              variacion={<LineaVariacion variacion={resumen.vendidos.variacion} mesAnterior={ant} />}
              explicacion={`${fmtEntero(resumen.vendidos.anterior ?? 0)} en ${ant}.`}
            />
            <CifraSecundaria
              valor={resumen.vendidos.valor ? fmtEuros(resumen.ticketMedio.valor ?? 0) : "—"}
              etiqueta="Cheque medio"
              variacion={<LineaVariacion variacion={resumen.ticketMedio.variacion} mesAnterior={ant} />}
              explicacion="Lo que vale de media cada cheque vendido."
            />
          </div>
        </div>
        <Tarjeta style={{ width: 400, flexShrink: 0, display: "flex", flexDirection: "column", gap: 30 }}>
          <FilaTarjeta etiqueta="Canjeado" cifra={resumen.canjeado} detalle={`${plural(resumen.canjeado.cheques, "cheque", "cheques")} usados en el restaurante en el periodo.`} />
          <FilaTarjeta etiqueta="Pendiente de canjear" cifra={resumen.pendiente} detalle={`${plural(resumen.pendiente.cheques, "cheque", "cheques")} cobrados y aún sin usar al cierre.`} />
        </Tarjeta>
      </div>
    </Lienzo>
  );
}

// ─── 3. Evolución ────────────────────────────────────────────────────────────
function Evolucion({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const { evolucion, periodo } = informe;
  return (
    <Lienzo numero={numero} titulo={evolucion.titular} web={PIE}>
      <Titular ancho={1060}>{evolucion.titular}</Titular>
      <div style={{ display: "flex", gap: 36, marginTop: 30, flex: 1, minHeight: 0 }}>
        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Cifra tamano={80}>{fmtEuros(informe.resumen.vendido.valor ?? 0)}</Cifra>
          <Etiqueta style={{ marginTop: 14 }}>{periodo.tipo === "mes" ? "Vendido, acumulado" : "Vendido en el año"}</Etiqueta>
          {periodo.tipo === "mes" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28, fontSize: 17 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Muestra color={COLOR.oro} /> {mayusculaInicial(periodo.nombre)}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Muestra color={COLOR.piedra} /> {mayusculaInicial(periodo.nombreAnterior)}, mismo día del mes
              </span>
            </div>
          ) : null}
          <Explicacion style={{ marginTop: "auto" }}>
            {periodo.tipo === "mes"
              ? "Cada punto suma todo lo vendido desde el día 1: la línea sube cada día que hay ventas y se queda plana los días sin ventas."
              : "Valor de los cheques vendidos cada mes (sin cortesías ni reembolsos)."}
          </Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {periodo.tipo === "mes" ? (
            <GraficoEvolucion puntos={evolucion.puntos} mejorDia={null} hayAnterior huecos={[]} ancho={800} alto={470} />
          ) : (
            <GraficoSemana items={evolucion.meses} ancho={800} alto={450} />
          )}
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 4. Cobros y Stripe ──────────────────────────────────────────────────────
function Dato({ valor, etiqueta, explicacion }: { valor: string; etiqueta: string; explicacion?: string }) {
  return (
    <div>
      <Cifra tamano={48}>{valor}</Cifra>
      <Etiqueta style={{ marginTop: 10 }}>{etiqueta}</Etiqueta>
      {explicacion && <Explicacion style={{ marginTop: 4 }}>{explicacion}</Explicacion>}
    </div>
  );
}

function Cobros({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const { cobros } = informe;
  const w = cobros.web;
  return (
    <Lienzo numero={numero} titulo={cobros.titular} web={PIE}>
      <Titular ancho={1080}>{cobros.titular}</Titular>
      <div style={{ display: "flex", gap: 44, marginTop: 30, flex: 1, minHeight: 0 }}>
        <div style={{ width: 470, flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px 30px", alignContent: "start" }}>
          <Dato valor={fmtEuros(w.cobrado)} etiqueta="Cobrado por Stripe" explicacion={`${plural(w.cheques, "pago", "pagos")} en la web.`} />
          <Dato valor={fmtEuros(w.comision)} etiqueta="Se lleva Stripe" explicacion={w.comisionEstimada ? "Parte estimada (1,5 % + 0,25 €)." : "Comisión real de cada pago."} />
          <Dato valor={fmtEuros(w.gastos)} etiqueta="Gastos de gestión" explicacion="Pagados por el comprador." />
          <Dato valor={fmtEuros(w.neto)} etiqueta="Neto de la web" explicacion="Lo cobrado menos Stripe." />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta>Por dónde se vendió</Etiqueta>
          {cobros.canales.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <GraficoBarras items={cobros.canales} ancho={620} alto={Math.max(110, cobros.canales.length * 66)} anchoNombres={230} formatoValor={fmtEuros} />
            </div>
          ) : (
            <Explicacion style={{ marginTop: 14 }}>Sin ventas en este periodo.</Explicacion>
          )}
          <Explicacion style={{ marginTop: 6 }}>Euros en valor de cheques (sin gastos de gestión) y su parte sobre el total.</Explicacion>
          <Tarjeta style={{ marginTop: "auto", padding: "22px 30px", display: "flex", gap: 36 }}>
            <div>
              <Etiqueta color={COLOR.tenueSobrePizarra}>Cobrado en total</Etiqueta>
              <p style={{ margin: "8px 0 0", fontFamily: PILA_TITULOS, fontSize: 40, fontWeight: 700, color: COLOR.oroClaro }}>{fmtEuros(cobros.cobradoTotal)}</p>
            </div>
            <Explicacion color={COLOR.tenueSobrePizarra} style={{ alignSelf: "center" }}>
              Web (con gastos de gestión) + ventas en el restaurante.
              {cobros.cortesia.cheques > 0 ? ` Cortesías: ${plural(cobros.cortesia.cheques, "cheque", "cheques")} (${fmtEuros(cobros.cortesia.importe)}), sin cobro.` : ""}
              {cobros.reembolsos.cheques > 0 ? ` Reembolsos: ${fmtEuros(cobros.reembolsos.importe)}.` : ""}
            </Explicacion>
          </Tarjeta>
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 5. Canjes y pendientes ──────────────────────────────────────────────────
function Canjes({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const { canjes } = informe;
  return (
    <Lienzo numero={numero} titulo={canjes.titular} web={PIE}>
      <Titular ancho={1060}>{canjes.titular}</Titular>
      <div style={{ display: "flex", gap: 44, marginTop: 30, flex: 1, minHeight: 0 }}>
        <div style={{ width: 470, flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "26px 30px", alignContent: "start" }}>
          <div>
            <Dato valor={fmtEuros(canjes.canjeados.valor ?? 0)} etiqueta="Canjeado" explicacion={plural(canjes.canjeados.cheques, "cheque", "cheques")} />
            <LineaVariacion variacion={canjes.canjeados.variacion} mesAnterior={frente(informe)} />
          </div>
          <Dato
            valor={canjes.diasMediosHastaCanje === null ? "—" : fmtEntero(canjes.diasMediosHastaCanje)}
            etiqueta="Días hasta el canje"
            explicacion="De media, desde la compra."
          />
          <Dato valor={fmtEuros(canjes.caducanPronto.importe)} etiqueta={`Caducan en ${canjes.caducanPronto.dias} días`} explicacion={plural(canjes.caducanPronto.cheques, "cheque", "cheques")} />
          <Dato valor={fmtEuros(canjes.caducadosSinCanjear.importe)} etiqueta="Caducados sin usar" explicacion={plural(canjes.caducadosSinCanjear.cheques, "cheque en el periodo", "cheques en el periodo")} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Etiqueta>Importes más vendidos</Etiqueta>
          {canjes.importes.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <GraficoBarras items={canjes.importes} ancho={620} alto={Math.max(110, canjes.importes.length * 58)} anchoNombres={230} />
            </div>
          ) : (
            <Explicacion style={{ marginTop: 14 }}>Sin ventas en este periodo.</Explicacion>
          )}
          <Explicacion style={{ marginTop: "auto" }}>
            Pendiente de canjear: {fmtEuros(canjes.pendiente.valor ?? 0)} en {plural(canjes.pendiente.cheques, "cheque", "cheques")} al cierre
            {canjes.pendiente.anterior !== null ? ` (${fmtEuros(canjes.pendiente.anterior)} al cierre de ${informe.periodo.nombreAnterior})` : ""}. Es dinero ya
            cobrado que se servirá en comidas.
          </Explicacion>
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 6. Días de la semana ────────────────────────────────────────────────────
function DiasSemana({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const d = informe.diasSemana;
  if (!d) return null;
  const total = d.items.reduce((a, i) => a + (i.media ?? 0), 0);
  return (
    <Lienzo numero={numero} titulo={d.titular} web={PIE}>
      <Titular ancho={1060}>{d.titular}</Titular>
      <div style={{ display: "flex", gap: 40, marginTop: 34, flex: 1, minHeight: 0 }}>
        <div style={{ width: 330, flexShrink: 0, display: "flex", flexDirection: "column", gap: 30 }}>
          <div>
            <Cifra tamano={96}>{fmtEntero(d.mejor.media ?? 0)}</Cifra>
            <Etiqueta style={{ marginTop: 14 }}>Cheques vendidos en {d.mejor.singular}</Etiqueta>
          </div>
          <Explicacion style={{ marginTop: "auto" }}>
            Cheques vendidos cada día de la semana en {informe.periodo.nombre}: {fmtCifra(total > 0 ? (100 * (d.mejor.media ?? 0)) / total : 0, 0)}
            {"\u00A0"}% de las ventas fueron en {d.mejor.singular}.
          </Explicacion>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GraficoSemana items={d.items} ancho={760} alto={430} />
        </div>
      </div>
    </Lienzo>
  );
}

// ─── 7. Conclusiones ─────────────────────────────────────────────────────────
function Conclusiones({ informe, numero }: { informe: InformeCheques; numero: number }) {
  const titular = `Qué nos dice ${informe.periodo.tipo === "mes" ? informe.periodo.nombre.replace(/ \d{4}$/, "") : informe.periodo.nombre}`;
  return (
    <Lienzo numero={numero} titulo={titular} web={PIE}>
      <Titular>{titular}</Titular>
      <Tarjeta style={{ marginTop: 30, padding: "30px 40px" }}>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 14 }}>
          {informe.conclusiones.map((c, i) => (
            <li key={c} style={{ display: "flex", gap: 18, alignItems: "flex-start", fontSize: 20, lineHeight: 1.35 }}>
              <span
                aria-hidden
                style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 17, background: COLOR.oroClaro, color: COLOR.pizarra, fontSize: 18, fontWeight: 700, lineHeight: "34px", textAlign: "center" }}
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

// ─── Conjunto ────────────────────────────────────────────────────────────────
type Pieza = ComponentType<{ informe: InformeCheques; numero: number }>;

export interface DiapositivasInformeChequesProps {
  informe: InformeCheques;
  /** Envoltorio de cada diapositiva (la vista previa la escala al ancho disponible). */
  Envoltorio?: ComponentType<{ children: ReactNode; indice: number }>;
}

export function DiapositivasInformeCheques({ informe, Envoltorio }: DiapositivasInformeChequesProps) {
  const piezas: { clave: string; Pieza: Pieza }[] = [
    { clave: "resumen", Pieza: Resumen },
    { clave: "evolucion", Pieza: Evolucion },
    { clave: "cobros", Pieza: Cobros },
    { clave: "canjes", Pieza: Canjes },
  ];
  if (informe.diasSemana) piezas.push({ clave: "dias", Pieza: DiasSemana });
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
