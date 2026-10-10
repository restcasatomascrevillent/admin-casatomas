// ============================================================================
//  calidad.ts · Reglas deterministas de calidad tras la extracción
// ----------------------------------------------------------------------------
//  Revisión foto a foto de 48 documentos de octubre (10/10/2026). Lo que se
//  puede decidir SIN volver a mirar la imagen se decide aquí, en código, y no
//  con más texto en el prompt (el dueño cuida los tokens):
//   · número provisional para documentos sin número (antes se perdían);
//   · CIF español con dígito de control (aviso; la corrección contra la ficha
//     del proveedor la hace SQL: proveedor_resolver / validar_cordura_factura);
//   · rótulos de talonario sin cantidad y «mercancía pendiente» fuera;
//   · líneas sin importe en un documento con precios → aviso;
//   · precio NETO cuando la línea lleva descuento;
//   · pescado/marisco/carne al peso → kg;
//   · documento a nombre de otro cliente → aviso;
//   · observaciones sin las notas internas de las franjas.
//  Puro: sin Deno ni red. Lo usa normalizarDatos (extraccion.ts), que es la
//  puerta común del camino de una página y del consolidado.
// ============================================================================

import { CIF_CLIENTE } from "./prompts.ts";

export interface AvisoCalidad {
  codigo: string;
  severidad: "alta" | "media";
  mensaje: string;
  detalle: Record<string, unknown>;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// ─── CIF / NIF / NIE ─────────────────────────────────────────────────────────

/** Mayúsculas, sin espacios, puntos ni guiones, sin «ES» delante. */
export function cifLimpio(cif: string | null | undefined): string {
  const s = String(cif ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^ES[0-9A-Z]{9}$/.test(s) ? s.slice(2) : s;
}

const LETRAS_NIF = "TRWAGMYFPDXBNJZSQVHLCKE";

/**
 * ¿Supera el dígito de control? CIF (letra + 7 cifras + control), NIF
 * (8 cifras + letra) y NIE (X/Y/Z + 7 cifras + letra). Misma regla que
 * `cif_control_valido` en SQL (migración 20261010160000).
 * Casos reales: B06805246 sí; B08605246 / B06050246 (lecturas de Nicolás y
 * Valero) no. F54450895 sí; F54650895 no. 29016276M y 33288687M sí.
 */
export function cifControlValido(cif: string | null | undefined): boolean {
  const c = cifLimpio(cif);
  if (/^[0-9]{8}[A-Z]$/.test(c)) return LETRAS_NIF[Number(c.slice(0, 8)) % 23] === c[8];
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(c)) {
    const n = Number("XYZ".indexOf(c[0]) + c.slice(1, 8));
    return LETRAS_NIF[n % 23] === c[8];
  }
  const m = c.match(/^([ABCDEFGHJKLMNPQRSUVW])([0-9]{7})([0-9A-J])$/);
  if (!m) return false;
  const d = m[2].split("").map(Number);
  let suma = 0;
  d.forEach((x, i) => {
    if (i % 2 === 1) suma += x;
    else { const y = x * 2; suma += Math.floor(y / 10) + (y % 10); }
  });
  const control = (10 - (suma % 10)) % 10;
  const letra = "JABCDEFGHI"[control];
  const ctl = m[3];
  if ("PQRSNW".includes(m[1]) || "KLM".includes(m[1])) return ctl === letra;
  if ("ABEH".includes(m[1])) return ctl === String(control);
  return ctl === String(control) || ctl === letra;
}

// ─── Número de documento ─────────────────────────────────────────────────────

const GENERICAS = new Set([
  "HERMANOS", "HNOS", "DISTRIBUCIONES", "DISTRIB", "SUMINISTROS", "COMERCIAL", "GRUPO", "CORPORACION",
  "EXCLUSIVAS", "INDUSTRIAS", "ALIMENTACION", "PRODUCTOS", "DE", "DEL", "LA", "LAS", "LOS", "EL", "Y",
]);
const FORMAS_LEGALES = /\b(S\s*\.?\s*L\s*\.?\s*U?|S\s*\.?\s*A\s*\.?\s*U?|S\s*\.?\s*R\s*\.?\s*L|S\s*\.?\s*COOP\b.*|C\s*\.?\s*B|SLU|SAU|SRL)\s*\.?\s*$/i;

/** «Hermanos Narejos S.L.» → «NAREJOS»; «Aceites Crevillente, S.L.» → «ACEITES». */
export function proveedorCorto(proveedor: string | null | undefined): string {
  let s = sinTildes(String(proveedor ?? "")).toUpperCase().replace(/\([^)]*\)/g, " ");
  s = s.replace(/[,]/g, " ").trim().replace(FORMAS_LEGALES, "").trim();
  const palabras = s.split(/[^A-Z0-9]+/).filter((p) => p.length >= 3 && !GENERICAS.has(p));
  return (palabras[0] ?? "DESCONOCIDO").slice(0, 12);
}

/** «SN-<proveedor corto>-<AAAAMMDD>» para un documento sin número impreso. */
export function numeroProvisional(proveedor: string | null | undefined, fecha: string | null | undefined): string {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? "")) ? String(fecha) : new Date().toISOString().slice(0, 10);
  return `SN-${proveedorCorto(proveedor)}-${f.replace(/-/g, "")}`;
}

// ─── Cliente ─────────────────────────────────────────────────────────────────

const NOMBRES_CLIENTE = /\b(MASIDE|CASA\s+TOMAS|TOUZA)\b/i;

/** Aviso si el destinatario impreso NO es el restaurante (Pulpería Compostela). */
export function avisoClienteAjeno(cliente: string | null | undefined): AvisoCalidad | null {
  const c = String(cliente ?? "").trim();
  if (!c) return null;
  if (NOMBRES_CLIENTE.test(sinTildes(c)) || cifLimpio(c).includes(CIF_CLIENTE)) return null;
  return {
    codigo: "cliente_ajeno",
    severidad: "media",
    mensaje: `El documento va a nombre de «${c.slice(0, 120)}», no de Casa Tomás / MASIDE 2011: comprueba que es nuestro.`,
    detalle: { cliente: c.slice(0, 200) },
  };
}

// ─── Líneas ──────────────────────────────────────────────────────────────────

/** Género que se vende al peso: pescado, marisco, carne. */
const AL_PESO = new RegExp(
  "\\b(" + [
    "lubina", "dorada", "rape", "merluza", "bacalao", "atun", "salmon", "emperador", "pez espada", "pulpo",
    "calamar", "chipiron", "sepia", "gamba", "langostino", "cigala", "carabinero", "mejillon", "almeja",
    "berberecho", "navaja", "ostra", "erizo", "langosta", "bogavante", "centolla", "percebe", "necora",
    "boqueron", "sardina", "jurel", "caballa", "rodaballo", "lenguado", "gallo", "mero", "corvina", "sargo",
    "besugo", "salmonete", "cabracho", "kama", "parpatana", "pescado", "marisco",
    "carrillada", "solomillo", "entrecot", "chuleta", "chuleton", "costilla", "lomo", "presa", "secreto",
    "pluma", "cordero", "ternera", "vaca", "cerdo", "pollo", "pavo", "conejo", "rabo", "carne", "picada",
    "magro", "panceta", "papada",
  ].join("|") + ")s?\\b",
  "i",
);
/** «ZANAHORIA GRANEL KILO», «TOMATE CHERRY RAMA KILO» (pero no «1 KG UNIDAD»). */
const VENDIDO_POR_KILO = /\b(granel|kilo)\b/i;

export interface LineaCalidad {
  nombre: string;
  cantidad: number;
  unidad: string;
  bultos: number | null;
  precio_unitario: number | null;
  total: number | null;
  bonificada: boolean;
  base_precio: string;
  regla_magnitud: string;
  [k: string]: unknown;
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Unidad «kg» para pescado/marisco/carne al peso que llega como «ud». */
export function unidadAlPeso(l: Pick<LineaCalidad, "nombre" | "cantidad" | "unidad" | "bultos" | "base_precio">): string {
  if (l.unidad !== "ud" || l.bultos !== null) return l.unidad;
  const n = sinTildes(l.nombre);
  if (VENDIDO_POR_KILO.test(n) && !/\d\s*(kg|k|kilos?)\b/i.test(n) && !/\bunidad/i.test(n)) return "kg";
  if (!AL_PESO.test(n)) return l.unidad;
  const decimales = esNum(l.cantidad) && !Number.isInteger(l.cantidad);
  return decimales || l.base_precio === "por_kg" ? "kg" : l.unidad;
}

/** Precio NETO si la línea lleva descuento (DIPER: bruto 12,83 → neto 9,196). */
export function precioNeto(l: Pick<LineaCalidad, "cantidad" | "precio_unitario" | "total" | "regla_magnitud" | "bonificada">): number | null {
  if (l.bonificada || !esNum(l.total) || !esNum(l.cantidad) || l.cantidad === 0) return l.precio_unitario;
  if (l.regla_magnitud !== "cantidad_con_descuento" && l.regla_magnitud !== "peso_con_descuento") return l.precio_unitario;
  return Math.round((l.total / l.cantidad) * 10000) / 10000;
}

const PENDIENTE = /pendiente(s)?\s+de\s+servir|mercanc[ií]a\s+pendiente/i;

/**
 * Limpia las líneas ya normalizadas y devuelve los avisos:
 *  - fuera los rótulos sin cantidad (talonario de Casimiro: PERCEBE, CENTOLLA,
 *    BOGAVANTE preimpresos) y la «mercancía pendiente de servir» sin importe;
 *  - aviso de líneas sin importe en un documento que sí tiene precios;
 *  - unidad kg al peso y precio neto.
 * `cantidadLeida[i]` es la cantidad que trajo el modelo (antes del `|| 1`).
 */
export function depurarLineas<T extends LineaCalidad>(
  lineas: T[],
  cantidadLeida: (number | null)[],
  sinImportes: boolean,
): { lineas: T[]; avisos: AvisoCalidad[] } {
  const avisos: AvisoCalidad[] = [];
  const quitadas: { nombre: string; motivo: string }[] = [];
  const conservadas: T[] = [];
  lineas.forEach((l, i) => {
    const sinDinero = !esNum(l.precio_unitario) && !esNum(l.total);
    const cant = cantidadLeida[i];
    if (sinDinero && !l.bonificada && (cant === null || cant === 0)) {
      quitadas.push({ nombre: l.nombre, motivo: "sin cantidad (rótulo impreso)" });
      return;
    }
    if (PENDIENTE.test(l.nombre) && (!esNum(l.total) || l.total === 0)) {
      quitadas.push({ nombre: l.nombre, motivo: "mercancía pendiente de servir" });
      return;
    }
    conservadas.push(l);
  });
  if (quitadas.length > 0) {
    avisos.push({
      codigo: "lineas_descartadas",
      severidad: "media",
      mensaje: `Se han descartado ${quitadas.length} fila(s) que no son compra: ` +
        quitadas.slice(0, 5).map((q) => `«${q.nombre}» (${q.motivo})`).join(", ") + ".",
      detalle: { lineas: quitadas.slice(0, 20) },
    });
  }

  const hayPrecios = !sinImportes && conservadas.some((l) => esNum(l.total) && l.total !== 0);
  if (hayPrecios) {
    const sinImporte = conservadas
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !l.bonificada && !esNum(l.total) && !esNum(l.precio_unitario));
    if (sinImporte.length > 0) {
      avisos.push({
        codigo: "linea_sin_importe",
        severidad: "media",
        mensaje: `${sinImporte.length} línea(s) sin precio ni importe en un documento con precios ` +
          `(¿mercancía pendiente de servir o rótulo sin rellenar?): ` +
          sinImporte.slice(0, 5).map(({ l }) => `«${l.nombre}»`).join(", ") + ". Bórrala si no se ha recibido.",
        detalle: { lineas: sinImporte.slice(0, 20).map(({ l, i }) => ({ indice: i, nombre: l.nombre })) },
      });
    }
  }

  const out = conservadas.map((l) => ({
    ...l,
    unidad: unidadAlPeso(l),
    precio_unitario: precioNeto(l),
  }));
  return { lineas: out, avisos };
}

// ─── Observaciones ───────────────────────────────────────────────────────────

/** Quita las notas internas que dejan las franjas («En esta franja solo se
 *  ve…», «La franja solo muestra iconos de la interfaz…»; factura 374). */
export function limpiarObservaciones(obs: string | null | undefined): string | null {
  if (!obs) return null;
  const partes = String(obs).split(/\s*·\s*|(?<=\.)\s+/)
    .filter((p) => p.trim() && !/\b(franja|esta imagen|esta pieza|interfaz|captura)\b/i.test(p));
  const s = partes.join(" ").trim();
  return s || null;
}
