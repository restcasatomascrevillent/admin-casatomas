// ============================================================================
//  magnitudes.ts · Qué cantidad se guarda en una línea: unidades o kilos
// ----------------------------------------------------------------------------
//  Caso que lo motiva (dueño, 05-oct-2026): la factura ML/101511 de Luga (54)
//  trae las columnas «Uds | Kilos | Precio | Dto% | Importe | IVA», y cuando
//  hay kilos el precio es POR KILO:
//      NATOP          12 uds · 24,00 kg · 4,14  → 99,46   (24 × 4,14)
//      CG. PUNTAS      3 uds · 15,00 kg · 5,80  → 87,00   (15 × 5,80)
//      JAMON           8 uds · 75,48 kg · 20,50 → 1.547,26
//      ESPINAS         1 ud  ·  2,00 kg · 4,20  → 8,40
//  El modelo leía bien los dos números (`cantidad` = Uds, `peso_kg` = Kilos),
//  pero `normalizarDatos` tiraba `peso_kg` y se guardaba cantidad = Uds con
//  unidad «uds/unidades/ud»: 19 de 54 líneas no cuadraban (cantidad × precio
//  ≠ importe) y el panel lo avisaba con razón.
//
//  REGLA: la `cantidad` que se guarda es la magnitud POR LA QUE SE MULTIPLICA
//  EL PRECIO, y `unidad` va con ella ('kg', 'l', 'ud'…). Las unidades/bultos
//  no se pierden: van a `productos_factura.bultos`.
//
//  Se decide con la aritmética de la propia fila, no con lo que diga el modelo
//  de `base_precio` (que solo desempata): el importe impreso es el dato bueno.
//  Nunca se INVENTA una magnitud: si no hay columna de peso, aunque
//  importe/precio dé un número redondo, se deja la cantidad leída y se avisa.
//
//  Puro y sin imports: lo cargan Deno (Edge Functions) y vitest.
// ============================================================================

export type BaseMagnitud = "por_unidad" | "por_kg" | "por_litro" | "desconocida";

/** Lo que hace falta de una línea extraída (camino síncrono o pieza). */
export interface LineaMagnitud {
  cantidad: number | null | undefined;
  unidad: string | null | undefined;
  /** Kilos (o litros) de una columna APARTE de la de unidades. */
  peso_kg?: number | null;
  base_precio?: string | null;
  precio_unitario: number | null | undefined;
  total: number | null | undefined;
  bonificada?: boolean;
}

export type ReglaMagnitud =
  /** cantidad × precio = importe (al redondeo): se deja la cantidad. */
  | "cantidad_cuadra"
  /** peso × precio = importe y la cantidad no: se guarda el peso. */
  | "peso_cuadra"
  /** Ninguna cuadra exacta; con un Dto% solo encaja el peso. */
  | "peso_con_descuento"
  /** Ninguna cuadra exacta; con un Dto% solo encaja la cantidad. */
  | "cantidad_con_descuento"
  /** Sin precio o importe que comprobar: decide `base_precio`. */
  | "sin_comprobar"
  /** Nada cuadra: se deja lo leído (y avisa si importe/precio es redondo). */
  | "no_cuadra";

export interface MagnitudResuelta {
  cantidad: number | null;
  unidad: string;
  /** Unidades/bultos cuando `cantidad` pasa a ser el peso; null si no. */
  bultos: number | null;
  regla: ReglaMagnitud;
  /** importe / precio cuando sale un número redondo distinto de la cantidad
   *  y NO hay peso con que comprobarlo: posible precio por kilo sin la
   *  columna de kilos leída. Solo para avisar; no se aplica nunca. */
  sugerencia: number | null;
}

// ─── Unidades ────────────────────────────────────────────────────────────────

const SINONIMOS: [RegExp, string][] = [
  [/^(u|un|ud|uds|und|unds|uni|unid|unids|unidad|unidades)$/, "ud"],
  [/^(kg|kgs|kgr|kgrs|kilo|kilos|kilogramo|kilogramos)$/, "kg"],
  [/^(l|lt|lts|ltr|ltrs|litro|litros)$/, "l"],
];

/**
 * uds/unidades/ud/u/un → 'ud'; kg/kgs/kilos → 'kg'; l/lt/litros → 'l'.
 * Vacío → 'ud'. Cualquier otra (caja, docena, ca…) se deja en minúsculas:
 * no se sabe a qué equivale y es mejor conservarla que adivinar.
 */
export function normalizarUnidad(u: string | null | undefined): string {
  const original = String(u ?? "").trim().toLowerCase();
  const s = original.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.\s]/g, "");
  if (!s) return "ud";
  for (const [re, v] of SINONIMOS) if (re.test(s)) return v;
  return original;
}

// ─── Aritmética de la fila ───────────────────────────────────────────────────

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Margen del redondeo: el precio se imprime a 2 decimales (±0,005 por unidad
 *  de magnitud) y el importe a céntimos (+0,01). Suelo de 5 céntimos, el mismo
 *  ABS_LINEA_MIN de esquema.ts. Luga: 24 × 4,14 = 99,36 frente a 99,46 impreso
 *  (el precio real es 4,144): margen 0,13. */
export function toleranciaRedondeo(magnitud: number): number {
  return Math.max(0.05, Math.abs(magnitud) * 0.005 + 0.01);
}

/** Por debajo de esto un importe no se explica con un descuento (esquema.ts
 *  RATIO_LINEA_MIN, y validar_cordura_factura en SQL). */
const RATIO_DTO_MIN = 0.40;

/** magnitud × precio = importe, salvo redondeo. */
export function cuadraExacto(magnitud: number, precio: number, total: number): boolean {
  return Math.abs(Math.abs(magnitud * precio) - Math.abs(total)) <= toleranciaRedondeo(magnitud);
}

/** El importe es magnitud × precio con un descuento de línea (Dto%) de hasta
 *  el 60 %: menor que el bruto y no por debajo del 40 % de él. */
export function cuadraConDescuento(magnitud: number, precio: number, total: number): boolean {
  const bruto = Math.abs(magnitud * precio);
  const t = Math.abs(total);
  return bruto > 0 && t < bruto && t >= bruto * RATIO_DTO_MIN;
}

/** importe/precio "redondo": entero o media unidad, al 0,5 % (2 kg de una
 *  bolsa «B/ 2K», 24 kg de 12 bricks de 2 L…). null si no. */
function cocienteRedondo(precio: number, total: number): number | null {
  const r = Math.abs(total / precio);
  if (!(r >= 0.5)) return null;
  const medio = Math.round(r * 2) / 2;
  return Math.abs(r - medio) <= medio * 0.005 ? medio : null;
}

// ─── La decisión ─────────────────────────────────────────────────────────────

/**
 * Decide qué se guarda como cantidad/unidad/bultos de UNA línea. Pura.
 *
 *  1. cantidad × precio = importe            → cantidad (unidad normalizada)
 *  2. peso × precio = importe                → peso, 'kg' ('l' si por_litro), bultos = cantidad
 *  3. ninguna exacta; con Dto% solo una      → esa
 *     las dos con Dto%                       → la que diga base_precio
 *  4. sin precio/importe (albarán, regalo)   → peso solo si base_precio es por_kg/por_litro
 *  5. nada cuadra                            → lo leído; `sugerencia` si importe/precio es
 *                                              redondo y no hay peso (para avisar)
 */
export function resolverMagnitud(l: LineaMagnitud): MagnitudResuelta {
  const unidadLeida = normalizarUnidad(l.unidad);
  const cantidad = esNum(l.cantidad) ? l.cantidad : null;
  const peso = esNum(l.peso_kg) && l.peso_kg !== 0 ? Math.abs(l.peso_kg) : null;
  const base = (l.base_precio ?? "desconocida") as BaseMagnitud;
  const porPeso = base === "por_kg" || base === "por_litro";
  const unidadPeso = base === "por_litro" ? "l" : "kg";
  // El peso es OTRO número (si el modelo puso los kilos en los dos campos, es
  // una línea al peso de una sola columna).
  const pesoDistinto = peso !== null && (cantidad === null || Math.abs(Math.abs(cantidad) - peso) > 0.0005);
  const signo = cantidad !== null && cantidad < 0 ? -1 : 1;

  const conPeso = (regla: ReglaMagnitud): MagnitudResuelta => ({
    cantidad: signo * (peso as number),
    unidad: unidadPeso,
    bultos: pesoDistinto && cantidad !== null && cantidad !== 0 ? cantidad : null,
    regla,
    sugerencia: null,
  });
  const conCantidad = (regla: ReglaMagnitud, sugerencia: number | null = null): MagnitudResuelta => {
    let unidad = unidadLeida;
    // La cantidad ES el peso (una sola columna de kilos), o el modelo dice que
    // el precio es por kilo y la cantidad trae gramos (7,35): la unidad es la
    // del peso. Con una cantidad entera y sin peso no se toca: «3 ud» de un
    // por_kg mal etiquetado son más probables que «3 kg» con la unidad mal.
    const decimales = cantidad !== null && !Number.isInteger(cantidad);
    if (unidad === "ud" && ((peso !== null && !pesoDistinto) || (porPeso && peso === null && decimales))) {
      unidad = unidadPeso;
    }
    return { cantidad, unidad, bultos: null, regla, sugerencia };
  };

  const p = l.precio_unitario, t = l.total;
  const comprobable = !l.bonificada && esNum(p) && esNum(t) && p !== 0 && t !== 0;
  if (!comprobable) {
    return pesoDistinto && porPeso ? conPeso("sin_comprobar") : conCantidad("sin_comprobar");
  }

  const cantidadCuadra = cantidad !== null && cantidad !== 0 && cuadraExacto(cantidad, p, t);
  if (cantidadCuadra) return conCantidad("cantidad_cuadra");
  if (peso !== null && cuadraExacto(peso, p, t)) return conPeso("peso_cuadra");

  const dtoCantidad = cantidad !== null && cantidad !== 0 && cuadraConDescuento(cantidad, p, t);
  const dtoPeso = peso !== null && cuadraConDescuento(peso, p, t);
  if (dtoPeso && (!dtoCantidad || porPeso)) return conPeso("peso_con_descuento");
  if (dtoCantidad) return conCantidad("cantidad_con_descuento");

  const redondo = peso === null ? cocienteRedondo(p, t) : null;
  const sugerencia = redondo !== null && (cantidad === null || Math.abs(redondo - Math.abs(cantidad)) > 0.0005)
    ? redondo
    : null;
  return conCantidad("no_cuadra", sugerencia);
}

// ─── Aviso del documento ─────────────────────────────────────────────────────

export interface AvisoMagnitud {
  codigo: "cantidad_posible_peso";
  severidad: "media";
  mensaje: string;
  detalle: Record<string, unknown>;
}

/** Un único aviso con las líneas que tienen `sugerencia` (null si ninguna). */
export function avisoMagnitudes(
  lineas: { nombre: string; cantidad: number | null; unidad: string; precio_unitario: number | null; total: number | null; sugerencia: number | null }[],
): AvisoMagnitud | null {
  const sospechosas = lineas
    .map((l, i) => ({ ...l, indice: i }))
    .filter((l) => l.sugerencia !== null);
  if (sospechosas.length === 0) return null;
  const ej = sospechosas[0];
  return {
    codigo: "cantidad_posible_peso",
    severidad: "media",
    mensaje:
      `${sospechosas.length} línea(s) no cuadran (cantidad × precio ≠ importe) y el importe entre el precio da ` +
      `un número redondo: puede que el precio sea por kilo o litro y no se haya leído la columna de peso. ` +
      `Ej.: línea ${ej.indice + 1} («${ej.nombre}»), ${ej.cantidad} ${ej.unidad} × ${ej.precio_unitario} = ` +
      `${ej.total}, y ${ej.total} / ${ej.precio_unitario} = ${ej.sugerencia}. No se ha cambiado nada: ` +
      `revisa la cantidad con el papel.`,
    detalle: {
      lineas: sospechosas.slice(0, 20).map((l) => ({
        indice: l.indice, nombre: l.nombre, cantidad: l.cantidad, unidad: l.unidad,
        precio_unitario: l.precio_unitario, total: l.total, importe_entre_precio: l.sugerencia,
      })),
    },
  };
}
