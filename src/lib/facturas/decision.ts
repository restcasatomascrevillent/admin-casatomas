// ============================================================================
//  Facturas › Análisis — «gráficas de decisión» (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  RPC `facturas_decision(desde, hasta, local)` (migración
//  20261115100000_facturas_decision): en una llamada, lo de las cuatro
//  preguntas del tablero:
//    · ¿En qué se va el dinero?  familias del periodo frente a su media;
//    · ¿Qué me están subiendo?   cambios de precio por € AL MES (no por %);
//    · ¿Cómo van los precios de lo que más compro?  minigráficas;
//    · ¿Dónde puedo ahorrar?     mismo producto más barato en otro proveedor.
//  Aquí: tipos, validación de la respuesta, cifras del resumen y la geometría
//  de las minigráficas.
// ============================================================================
import { normalizarAlertas, type AlertaFacturas } from "./alertas";
import type { DocumentoCifra, TipoDocumentoCifra } from "./documentosCifra";

export interface FamiliaDecision {
  id: number | null;
  familia: string;
  importe: number;
  mediaMes: number | null;
  /** Media mensual × duración del periodo (lo que «tocaría»). */
  referencia: number | null;
  variacionPct: number | null;
  /** Se sale más del umbral (familia_pct, 25 %) y genera aviso. */
  aviso: boolean;
  alerta: { id: string; titulo: string } | null;
}

/** Una alerta con lo que hace falta para actuar: documento de origen y € al mes. */
export interface CambioPrecio {
  alerta: AlertaFacturas;
  impactoMes: number | null;
  campana: boolean;
  doc: DocumentoCifra | null;
  docOtro: DocumentoCifra | null;
}

export interface MesPrecio {
  mes: string;
  precio: number | null;
}

export interface ProductoTop {
  clave: string;
  producto: string;
  productoId: number | null;
  unidad: string;
  importe90: number;
  proveedorId: number | null;
  proveedor: string | null;
  nombreNormalizado: string | null;
  /** Texto de línea más frecuente (lo que filtra el explorador). */
  linea: string | null;
  meses: MesPrecio[];
  alertas: { id: string; mes: string | null; titulo: string }[];
  pactado: { id: number; precio: number; unidad: string | null } | null;
}

export interface RevisarUnidades {
  clave: string;
  producto: string;
  importe90: number;
  unidades: { unidad: string; precio: number; importe90: number }[];
}

export interface DecisionFacturas {
  periodo: {
    desde: string;
    hasta: string;
    enCurso: boolean;
    mesesEquivalentes: number;
    mesesIncompletos: string[];
    /**
     * Tramo que comparan las familias (20261115300000): el periodo entero frente a los
     * meses anteriores («anteriores») o, si no los hay (Año, Todo), su último mes
     * completo frente a la media de los anteriores del propio periodo («ultimo_mes»).
     * null con la RPC de antes.
     */
    comparado: { modo: "anteriores" | "ultimo_mes"; desde: string; hasta: string } | null;
  };
  referencia: { meses: string[]; desde: string | null; hasta: string | null };
  resumen: { gasto: number; documentos: number; base: number; baseReferencia: number };
  familias: FamiliaDecision[];
  cambios: {
    sube: CambioPrecio[];
    baja: CambioPrecio[];
    mejor: CambioPrecio[];
    proveedor: CambioPrecio[];
    pactado: CambioPrecio[];
    familia: CambioPrecio[];
    /** Albaranes sin factura, proveedores nuevos, importes inusuales, revisión. */
    otros: CambioPrecio[];
  };
  top: ProductoTop[];
  revisarUnidades: RevisarUnidades[];
  topDesde: string | null;
  umbrales: { familiaPct: number; campanaMinEur: number; silencioDias: number };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const TIPOS_DOC: TipoDocumentoCifra[] = ["factura", "albaran", "abono"];

function documento(v: unknown): DocumentoCifra | null {
  const d = obj(v);
  const id = num(d.id);
  if (id === null) return null;
  const total = num(d.total);
  const tipo = TIPOS_DOC.includes(d.tipo as TipoDocumentoCifra) ? (d.tipo as TipoDocumentoCifra) : "factura";
  return {
    id,
    fecha: txt(d.fecha),
    proveedor: txt(d.proveedor) ?? "Proveedor",
    proveedorId: num(d.proveedor_id),
    numero: txt(d.numero),
    tipo: total !== null && total < 0 ? "abono" : tipo,
    local: d.local === "touza" ? "touza" : "casa_tomas",
    total,
    aporta: total ?? 0,
    cantidad: null,
    lineas: null,
    driveUrl: txt(d.drive_url),
    archivoPath: txt(d.archivo_path),
  };
}

function cambios(v: unknown): CambioPrecio[] {
  const filas = arr(v);
  const alertas = normalizarAlertas(filas);
  const porId = new Map(alertas.map((a) => [a.id, a]));
  const out: CambioPrecio[] = [];
  for (const f of filas) {
    const o = obj(f);
    const a = porId.get(txt(o.id) ?? "");
    if (!a) continue;
    out.push({
      alerta: a,
      impactoMes: num(o.impacto_mes) ?? a.datos.impactoMes,
      campana: o.campana !== false && a.datos.campana,
      doc: documento(o.doc),
      docOtro: documento(o.doc_otro),
    });
  }
  return out;
}

/** La respuesta de la RPC, validada (lo que no se entiende se descarta). */
export function normalizarDecision(data: unknown): DecisionFacturas {
  const d = obj(data);
  const p = obj(d.periodo);
  const r = obj(d.referencia);
  const res = obj(d.resumen);
  const c = obj(d.cambios);
  const u = obj(d.umbrales);
  return {
    periodo: {
      desde: txt(p.desde) ?? "",
      hasta: txt(p.hasta) ?? "",
      enCurso: p.en_curso === true,
      mesesEquivalentes: num(p.meses_equivalentes) ?? 1,
      mesesIncompletos: arr(p.meses_incompletos).filter((x): x is string => typeof x === "string"),
      comparado: (() => {
        const c = obj(p.comparado);
        const desde = txt(c.desde);
        const hasta = txt(c.hasta);
        return desde && hasta ? { modo: c.modo === "ultimo_mes" ? ("ultimo_mes" as const) : ("anteriores" as const), desde, hasta } : null;
      })(),
    },
    referencia: {
      meses: arr(r.meses).filter((x): x is string => typeof x === "string"),
      desde: txt(r.desde),
      hasta: txt(r.hasta),
    },
    resumen: { gasto: num(res.gasto) ?? 0, documentos: num(res.documentos) ?? 0, base: num(res.base) ?? 0, baseReferencia: num(res.base_referencia) ?? 0 },
    familias: arr(d.familias).flatMap((x) => {
      const f = obj(x);
      const familia = txt(f.familia);
      if (!familia) return [];
      const al = obj(f.alerta);
      return [
        {
          id: num(f.id),
          familia,
          importe: num(f.importe) ?? 0,
          mediaMes: num(f.media_mes),
          referencia: num(f.referencia),
          variacionPct: num(f.variacion_pct),
          aviso: f.aviso === true,
          alerta: txt(al.id) ? { id: txt(al.id) as string, titulo: txt(al.titulo) ?? "" } : null,
        },
      ];
    }),
    cambios: {
      sube: cambios(c.sube),
      baja: cambios(c.baja),
      mejor: cambios(c.mejor),
      proveedor: cambios(c.proveedor),
      pactado: cambios(c.pactado),
      familia: cambios(c.familia),
      otros: cambios(c.otros),
    },
    top: arr(d.top).flatMap((x) => {
      const t = obj(x);
      const clave = txt(t.clave);
      const producto = txt(t.producto);
      if (!clave || !producto) return [];
      const pac = obj(t.pactado);
      return [
        {
          clave,
          producto,
          productoId: num(t.producto_id),
          unidad: txt(t.unidad) ?? "ud",
          importe90: num(t.importe_90) ?? 0,
          proveedorId: num(t.proveedor_id),
          proveedor: txt(t.proveedor),
          nombreNormalizado: txt(t.nombre_normalizado),
          linea: txt(t.linea),
          meses: arr(t.meses).map((m) => ({ mes: txt(obj(m).mes) ?? "", precio: num(obj(m).precio) })).filter((m) => m.mes),
          alertas: arr(t.alertas).flatMap((a) => (txt(obj(a).id) ? [{ id: txt(obj(a).id) as string, mes: txt(obj(a).mes), titulo: txt(obj(a).titulo) ?? "" }] : [])),
          pactado: num(pac.id) !== null && num(pac.precio) !== null ? { id: num(pac.id) as number, precio: num(pac.precio) as number, unidad: txt(pac.unidad) } : null,
        },
      ];
    }),
    revisarUnidades: arr(d.revisar_unidades).flatMap((x) => {
      const t = obj(x);
      const clave = txt(t.clave);
      const producto = txt(t.producto);
      if (!clave || !producto) return [];
      return [
        {
          clave,
          producto,
          importe90: num(t.importe_90) ?? 0,
          unidades: arr(t.unidades).flatMap((y) => {
            const o = obj(y);
            const unidad = txt(o.unidad);
            const precio = num(o.precio);
            return unidad && precio !== null ? [{ unidad, precio, importe90: num(o.importe_90) ?? 0 }] : [];
          }),
        },
      ];
    }),
    topDesde: txt(d.top_desde),
    umbrales: {
      familiaPct: num(u.familia_pct) ?? 25,
      campanaMinEur: num(u.campana_impacto_min_eur) ?? 10,
      silencioDias: num(u.silencio_dias) ?? 90,
    },
  };
}

// ─── Resumen (las cifras de arriba) ─────────────────────────────────────────

export interface ResumenDecision {
  subidas: number;
  /** € más al mes que cuestan las subidas (solo las positivas). */
  impactoMes: number;
  /** Subidas con aviso en la campana (≥ campana_impacto_min_eur). */
  subidasCampana: number;
  masBarato: number;
  /** Ahorro posible en 90 días comprando al más barato que ya se usa. */
  ahorro90: number;
  familiasFuera: FamiliaDecision[];
  /** Base del periodo frente a la de referencia (−13 % …), o null sin referencia. */
  variacionBasePct: number | null;
}

export function resumenDecision(d: DecisionFacturas): ResumenDecision {
  const impacto = d.cambios.sube.reduce((s, c) => s + Math.max(0, c.impactoMes ?? 0), 0);
  const ahorro = d.cambios.mejor.reduce((s, c) => s + Math.max(0, c.alerta.datos.ahorro ?? 0), 0);
  const ref = d.resumen.baseReferencia;
  return {
    subidas: d.cambios.sube.length,
    impactoMes: Math.round(impacto * 100) / 100,
    subidasCampana: d.cambios.sube.filter((c) => c.campana).length,
    masBarato: d.cambios.mejor.length,
    ahorro90: Math.round(ahorro * 100) / 100,
    familiasFuera: d.familias.filter((f) => f.aviso),
    variacionBasePct: ref > 0 && d.referencia.meses.length > 0 ? Math.round((d.resumen.base / ref - 1) * 1000) / 10 : null,
  };
}

/** «mayo–agosto» (o «mayo de 2026» si es uno) a partir de «AAAA-MM». */
export function textoMesesReferencia(meses: string[]): string | null {
  if (meses.length === 0) return null;
  const nombre = (m: string) =>
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(m.slice(5, 7)) - 1] ?? m;
  if (meses.length === 1) return `${nombre(meses[0])} de ${meses[0].slice(0, 4)}`;
  return `${nombre(meses[0])}–${nombre(meses[meses.length - 1])}`;
}

/** Clase de color de un chip de variación: «flat» si apenas cambia. */
export function tonoVariacion(pct: number | null | undefined, plano = 5): "sube" | "baja" | "plano" {
  if (pct === null || pct === undefined || Math.abs(pct) < plano) return "plano";
  return pct > 0 ? "sube" : "baja";
}

/** «+12 %», «−13 %», «0 %» (signo menos de verdad). */
export function textoPctCorto(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  const r = Math.abs(pct) < 10 && !Number.isInteger(Math.round(pct * 10) / 10) ? Math.round(Math.abs(pct) * 10) / 10 : Math.round(Math.abs(pct));
  const t = r.toLocaleString("es-ES");
  return pct > 0 && r !== 0 ? `+${t} %` : pct < 0 && r !== 0 ? `−${t} %` : "0 %";
}

// ─── Minigráficas ───────────────────────────────────────────────────────────

export interface GeometriaMini {
  linea: string;
  area: string;
  ultimo: { x: number; y: number } | null;
  /** Meses con alerta de subida: punto rojo. */
  alertas: { x: number; y: number; mes: string }[];
  /** Variación del primer al último precio conocido. */
  variacionPct: number | null;
  ultimoPrecio: number | null;
}

/** Trazado de una minigráfica (viewBox ancho × alto) con los huecos sin compra saltados. */
export function geometriaMini(meses: MesPrecio[], mesesAlerta: string[], ancho = 150, alto = 42, margen = 4): GeometriaMini {
  const con = meses.map((m, i) => ({ i, m })).filter((p) => p.m.precio !== null) as { i: number; m: MesPrecio & { precio: number } }[];
  if (con.length === 0) return { linea: "", area: "", ultimo: null, alertas: [], variacionPct: null, ultimoPrecio: null };
  const ys = con.map((p) => p.m.precio);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const n = Math.max(1, meses.length - 1);
  const X = (i: number) => margen + (i * (ancho - 2 * margen)) / n;
  const Y = (y: number) => alto - margen - ((y - lo) / (hi - lo)) * (alto - 2 * margen);
  const f = (v: number) => Math.round(v * 10) / 10;
  const linea = con.map((p, k) => `${k ? "L" : "M"}${f(X(p.i))},${f(Y(p.m.precio))}`).join("");
  const primero = con[0];
  const ult = con[con.length - 1];
  const area = `${linea}L${f(X(ult.i))},${alto - margen}L${f(X(primero.i))},${alto - margen}Z`;
  const set = new Set(mesesAlerta);
  return {
    linea,
    area,
    ultimo: { x: f(X(ult.i)), y: f(Y(ult.m.precio)) },
    alertas: con.filter((p) => set.has(p.m.mes)).map((p) => ({ x: f(X(p.i)), y: f(Y(p.m.precio)), mes: p.m.mes })),
    variacionPct: primero.m.precio > 0 && con.length > 1 ? Math.round((ult.m.precio / primero.m.precio - 1) * 1000) / 10 : null,
    ultimoPrecio: ult.m.precio,
  };
}

export type PestanaCambios = "sube" | "mejor" | "baja";
