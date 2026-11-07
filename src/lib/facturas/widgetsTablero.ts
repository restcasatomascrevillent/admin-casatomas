// ============================================================================
//  Facturas › Análisis — qué módulos (widgets) se ven en el tablero y cómo
//  (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  «Personalizar» (06/11/2026): el dueño elige qué cifras salen arriba y qué
//  tarjetas («módulos») salen debajo, en qué orden y de qué tamaño:
//    · pequeño = 1 columna, mediano = 2, grande = 3 (o todo el ancho si no
//      caben) de una rejilla tipo «bento» que empaqueta los pequeños juntos
//      (`grid-auto-flow: dense`);
//    · «Explorar» es un módulo fijo (no se quita: la IA y las filas llevan a
//      él) que se puede mover; parte la rejilla en «antes» y «después».
//
//  Se guarda por usuario en `dashboard_config` (nombre_vista
//  «facturas_analisis»: tabla y RLS ya existentes, sin migración) y, como
//  copia rápida, en el localStorage de este navegador.
// ============================================================================

export type Tamano = "s" | "m" | "l";

export type IdCifra =
  | "gasto"
  | "abonos"
  | "regalado"
  | "por_revisar"
  | "gasto_este_mes"
  | "media_mes"
  | "documentos"
  | "proveedores"
  | "fijos_mes"
  | "retencion"
  // Gráficas de decisión (20261115100000_facturas_decision)
  | "precios_suben"
  | "ahorro_posible"
  | "familias_fuera";

export type IdModulo =
  | "explorar"
  | "proveedores"
  | "subidas"
  | "familias"
  | "fijos"
  | "abonos"
  | "locales"
  | "gasto_mes"
  | "productos"
  | "por_revisar"
  | "regalado"
  | "precio_producto"
  // Gráficas de decisión (20261115100000_facturas_decision)
  | "precios_top"
  | "ahorro";

export interface InfoCifra {
  id: IdCifra;
  titulo: string;
  descripcion: string;
}

export interface InfoModulo {
  id: IdModulo;
  titulo: string;
  descripcion: string;
  tamano: Tamano;
  /** No se puede quitar (sí mover). */
  fijo?: boolean;
  /** Solo admite este tamaño (Explorar ocupa siempre todo el ancho). */
  soloTamano?: Tamano;
}

export const CIFRAS: InfoCifra[] = [
  { id: "gasto", titulo: "Gasto con IVA", descripcion: "Total del periodo y cuánto cambia frente al anterior" },
  { id: "abonos", titulo: "Abonos", descripcion: "Importe devuelto y cuántos documentos" },
  { id: "regalado", titulo: "Regalado y descuentos", descripcion: "Lo que valía menos lo que se pagó" },
  { id: "por_revisar", titulo: "Por revisar", descripcion: "Albaranes que aún no están en una factura" },
  { id: "gasto_este_mes", titulo: "Gasto este mes", descripcion: "Lo que va del mes en curso, con IVA" },
  { id: "media_mes", titulo: "Media al mes", descripcion: "Gasto con IVA entre los meses con documentos" },
  { id: "documentos", titulo: "Documentos", descripcion: "Facturas, albaranes y abonos del periodo" },
  { id: "proveedores", titulo: "Proveedores", descripcion: "A cuántos proveedores se ha comprado" },
  { id: "fijos_mes", titulo: "Gastos fijos al mes", descripcion: "Lo que se paga casi todos los meses" },
  { id: "retencion", titulo: "Retención IRPF", descripcion: "IRPF retenido (alquileres, gestoría…)" },
  { id: "precios_suben", titulo: "Precios que han subido", descripcion: "Cuántos y cuánto te cuestan de más al mes" },
  { id: "ahorro_posible", titulo: "Más barato en otro proveedor", descripcion: "Cuántos y el ahorro posible en 90 días" },
  { id: "familias_fuera", titulo: "Familias fuera de lo normal", descripcion: "Familias que se salen de su media" },
];

export const MODULOS: InfoModulo[] = [
  { id: "explorar", titulo: "Explorar", descripcion: "La gráfica a medida (medida, eje, color y filtros)", tamano: "l", fijo: true, soloTamano: "l" },
  { id: "proveedores", titulo: "Proveedores con más gasto", descripcion: "Ranking con IVA y su % del total", tamano: "s" },
  { id: "subidas", titulo: "¿Qué me están subiendo?", descripcion: "Cambios de precio por € al mes: suben, más barato en otro, bajan", tamano: "m" },
  { id: "familias", titulo: "¿En qué se va el dinero?", descripcion: "Gasto por familia frente a su media, con avisos", tamano: "m" },
  { id: "fijos", titulo: "Gastos fijos al mes", descripcion: "Proveedores que facturan casi todos los meses", tamano: "s" },
  { id: "abonos", titulo: "Abonos por proveedor", descripcion: "Devoluciones y rectificativas", tamano: "s" },
  { id: "locales", titulo: "Casa Tomás y Touza", descripcion: "El gasto de los dos locales, frente a frente", tamano: "s" },
  { id: "gasto_mes", titulo: "Gasto por mes", descripcion: "Barras de cada mes, Casa Tomás y Touza", tamano: "m" },
  { id: "productos", titulo: "Productos más comprados", descripcion: "Lo que más se gasta por producto, sin IVA", tamano: "s" },
  { id: "por_revisar", titulo: "Albaranes por revisar", descripcion: "Los últimos albaranes que aún no tienen factura", tamano: "s" },
  { id: "regalado", titulo: "Regalado por proveedor", descripcion: "Quién regala o descuenta más", tamano: "s" },
  { id: "precio_producto", titulo: "Evolución de un producto", descripcion: "El precio medio de un producto mes a mes, por proveedor", tamano: "m" },
  { id: "precios_top", titulo: "¿Cómo van los precios de lo que más compro?", descripcion: "Minigráficas del precio de los 6 productos con más gasto", tamano: "l" },
  { id: "ahorro", titulo: "¿Dónde puedo ahorrar?", descripcion: "Mismo producto más barato en otro proveedor", tamano: "s" },
];

export const TAMANOS: { valor: Tamano; etiqueta: string; corta: string; columnas: number }[] = [
  { valor: "s", etiqueta: "Pequeño", corta: "S", columnas: 1 },
  { valor: "m", etiqueta: "Mediano", corta: "M", columnas: 2 },
  { valor: "l", etiqueta: "Grande", corta: "L", columnas: 3 },
];

export const infoCifra = (id: IdCifra): InfoCifra => CIFRAS.find((c) => c.id === id) as InfoCifra;
export const infoModulo = (id: IdModulo): InfoModulo => MODULOS.find((m) => m.id === id) as InfoModulo;
export const etiquetaTamano = (t: Tamano): string => TAMANOS.find((x) => x.valor === t)?.etiqueta ?? t;

export interface ModuloActivo {
  id: IdModulo;
  tamano: Tamano;
  /** «Evolución de un producto»: el producto elegido (nombre tal y como sale en las líneas). */
  producto?: string;
}

export interface ConfigTablero {
  /** Cifras de arriba, en orden (las que no están, no se ven). */
  cifras: IdCifra[];
  /** Módulos en orden, con su tamaño. Siempre lleva «explorar». */
  modulos: ModuloActivo[];
  /**
   * Versión del tablero guardado. Sin ella (o < VERSION_TABLERO) es de antes de las
   * gráficas de decisión: se le añaden una vez (ver `actualizarVersion`).
   */
  v?: number;
}

/** 2 = gráficas de decisión (15/11/2026). */
export const VERSION_TABLERO = 2;

/**
 * El tablero de gestión (15/11/2026, maqueta del dueño): arriba el gasto y las
 * tres cifras de decisión; luego las cuatro preguntas (subidas, ahorro, familias
 * y precios de lo más comprado) con los proveedores; Explorar; y el resto.
 */
export const CONFIG_TABLERO_POR_DEFECTO: ConfigTablero = {
  cifras: ["gasto", "precios_suben", "ahorro_posible", "familias_fuera", "por_revisar"],
  modulos: [
    { id: "subidas", tamano: "m" },
    { id: "ahorro", tamano: "s" },
    { id: "familias", tamano: "m" },
    { id: "proveedores", tamano: "s" },
    { id: "precios_top", tamano: "l" },
    { id: "explorar", tamano: "l" },
    { id: "fijos", tamano: "s" },
    { id: "abonos", tamano: "s" },
    { id: "locales", tamano: "s" },
  ],
  v: VERSION_TABLERO,
};

/**
 * Un tablero guardado antes de las gráficas de decisión: se le añaden UNA vez
 * (luego cada uno quita lo que no quiera) las tres cifras nuevas tras «Gasto»
 * (si caben), «¿Dónde puedo ahorrar?» tras las subidas y «¿Cómo van los
 * precios…?» tras las familias; subidas y familias pasan a medianas.
 */
export function actualizarVersion(c: ConfigTablero): ConfigTablero {
  if ((c.v ?? 1) >= VERSION_TABLERO) return c;
  const cifras = [...c.cifras];
  const pos = Math.max(0, cifras.indexOf("gasto") + 1);
  const nuevas = (["precios_suben", "ahorro_posible", "familias_fuera"] as IdCifra[]).filter((x) => !cifras.includes(x));
  cifras.splice(pos, 0, ...nuevas.slice(0, Math.max(0, MAX_CIFRAS - cifras.length)));
  const modulos = c.modulos.map((m) => (m.id === "subidas" || m.id === "familias") && m.tamano === "s" ? { ...m, tamano: "m" as Tamano } : m);
  const meter = (id: IdModulo, tras: IdModulo, tamano: Tamano) => {
    if (modulos.some((m) => m.id === id)) return;
    const i = modulos.findIndex((m) => m.id === tras);
    const j = i >= 0 ? i + 1 : Math.max(0, modulos.findIndex((m) => m.id === "explorar"));
    modulos.splice(j, 0, { id, tamano });
  };
  meter("ahorro", "subidas", "s");
  meter("precios_top", "familias", "l");
  return { cifras, modulos, v: VERSION_TABLERO };
}

export const NOMBRE_VISTA_TABLERO = "facturas_analisis";
export const CLAVE_CONFIG_TABLERO = "facturas-analisis-tablero";
export const MAX_CIFRAS = 8;

const esCifra = (v: unknown): v is IdCifra => CIFRAS.some((c) => c.id === v);
const esModulo = (v: unknown): v is IdModulo => MODULOS.some((m) => m.id === v);
const esTamano = (v: unknown): v is Tamano => v === "s" || v === "m" || v === "l";

/** El tamaño que vale para ese módulo (Explorar, siempre grande). */
export function tamanoValido(id: IdModulo, t: unknown): Tamano {
  const info = infoModulo(id);
  if (info.soloTamano) return info.soloTamano;
  return esTamano(t) ? t : info.tamano;
}

/**
 * Lee una configuración guardada sin fiarse: fuera lo desconocido y lo
 * repetido; «explorar» siempre (si falta, al principio). Sin nada válido, la
 * de por defecto.
 */
export function normalizarConfigTablero(entrada: unknown): ConfigTablero {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return CONFIG_TABLERO_POR_DEFECTO;
  const o = entrada as Record<string, unknown>;
  if (!Array.isArray(o.cifras) && !Array.isArray(o.modulos)) return CONFIG_TABLERO_POR_DEFECTO;
  const cifras: IdCifra[] = [];
  for (const c of Array.isArray(o.cifras) ? o.cifras : []) if (esCifra(c) && !cifras.includes(c)) cifras.push(c);
  const modulos: ModuloActivo[] = [];
  for (const x of Array.isArray(o.modulos) ? o.modulos : []) {
    const id = typeof x === "string" ? x : x && typeof x === "object" ? (x as Record<string, unknown>).id : null;
    if (!esModulo(id) || modulos.some((m) => m.id === id)) continue;
    const o = typeof x === "object" && x ? (x as Record<string, unknown>) : {};
    const producto = id === "precio_producto" && typeof o.producto === "string" && o.producto.trim() ? o.producto.trim().slice(0, 160) : null;
    modulos.push({ id, tamano: tamanoValido(id, o.tamano), ...(producto ? { producto } : {}) });
  }
  if (!modulos.some((m) => m.id === "explorar")) modulos.unshift({ id: "explorar", tamano: "l" });
  const v = typeof o.v === "number" ? o.v : undefined;
  return actualizarVersion({ cifras: cifras.slice(0, MAX_CIFRAS), modulos, v });
}

export const mismaConfig = (a: ConfigTablero, b: ConfigTablero): boolean => JSON.stringify(a) === JSON.stringify(b);

// ─── Cambios (siempre devuelven una configuración nueva) ────────────────────

/** Mueve el elemento de `desde` a `hasta` (arrastrar). */
export function moverEnLista<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= lista.length || hasta >= lista.length) return [...lista];
  const copia = [...lista];
  const [x] = copia.splice(desde, 1);
  copia.splice(hasta, 0, x);
  return copia;
}

export function activarCifra(c: ConfigTablero, id: IdCifra, activa: boolean): ConfigTablero {
  if (activa) return c.cifras.includes(id) || c.cifras.length >= MAX_CIFRAS ? c : { ...c, cifras: [...c.cifras, id] };
  return { ...c, cifras: c.cifras.filter((x) => x !== id) };
}

export function activarModulo(c: ConfigTablero, id: IdModulo, activo: boolean): ConfigTablero {
  if (infoModulo(id).fijo) return c;
  if (activo) return c.modulos.some((m) => m.id === id) ? c : { ...c, modulos: [...c.modulos, { id, tamano: infoModulo(id).tamano }] };
  return { ...c, modulos: c.modulos.filter((m) => m.id !== id) };
}

/** Sube (−1) o baja (+1) una cifra. */
export function moverCifra(c: ConfigTablero, id: IdCifra, paso: -1 | 1): ConfigTablero {
  const i = c.cifras.indexOf(id);
  return i < 0 ? c : { ...c, cifras: moverEnLista(c.cifras, i, i + paso) };
}

export function moverModulo(c: ConfigTablero, id: IdModulo, paso: -1 | 1): ConfigTablero {
  const i = c.modulos.findIndex((m) => m.id === id);
  return i < 0 ? c : { ...c, modulos: moverEnLista(c.modulos, i, i + paso) };
}

/** El producto de «Evolución de un producto» (null = volver a elegir). */
export function elegirProducto(c: ConfigTablero, producto: string | null): ConfigTablero {
  return {
    ...c,
    modulos: c.modulos.map((m) => {
      if (m.id !== "precio_producto") return m;
      const { producto: _antes, ...resto } = m;
      return producto && producto.trim() ? { ...resto, producto: producto.trim().slice(0, 160) } : resto;
    }),
  };
}

export function cambiarTamano(c: ConfigTablero, id: IdModulo, tamano: Tamano): ConfigTablero {
  return { ...c, modulos: c.modulos.map((m) => (m.id === id ? { ...m, tamano: tamanoValido(id, tamano) } : m)) };
}

/** Los módulos antes y después de «Explorar» (cada tramo es su propia rejilla). */
export function tramosModulos(c: ConfigTablero): { antes: ModuloActivo[]; despues: ModuloActivo[] } {
  const i = c.modulos.findIndex((m) => m.id === "explorar");
  return { antes: c.modulos.slice(0, Math.max(0, i)), despues: c.modulos.slice(i + 1) };
}

// ─── Rejilla «bento» ────────────────────────────────────────────────────────

/**
 * Columnas que ocupa un módulo en una rejilla de `columnas`: pequeño 1,
 * mediano 2 y grande 3, sin pasarse de las que hay.
 */
export const columnasDe = (t: Tamano, columnas: number): number => Math.min(TAMANOS.find((x) => x.valor === t)?.columnas ?? 1, Math.max(1, columnas));

/**
 * Coloca los módulos como lo hace CSS Grid con `grid-auto-flow: dense`
 * (para la vista previa del configurador y para probarlo): cada uno en el
 * primer hueco, fila a fila, donde quepa entero. Todas las filas miden 1.
 */
export function colocarBento(modulos: readonly ModuloActivo[], columnas: number): { id: IdModulo; fila: number; columna: number; ancho: number }[] {
  const ocupado: boolean[][] = [];
  const libre = (f: number, col: number, ancho: number) => {
    for (let k = col; k < col + ancho; k++) if (ocupado[f]?.[k]) return false;
    return true;
  };
  return modulos.map((m) => {
    const ancho = columnasDe(m.tamano, columnas);
    for (let f = 0; ; f++) {
      for (let col = 0; col + ancho <= columnas; col++) {
        if (libre(f, col, ancho)) {
          ocupado[f] = ocupado[f] ?? [];
          for (let k = col; k < col + ancho; k++) ocupado[f][k] = true;
          return { id: m.id, fila: f, columna: col, ancho };
        }
      }
    }
  });
}

// ─── Base de datos (`dashboard_config`) ─────────────────────────────────────

/**
 * Fila de `dashboard_config` (tabla de 2025 con RLS «cada usuario la suya»):
 * `widgets_activos` lleva lo que se ve, en orden, con su tamaño;
 * `orden_widgets`, solo los ids en orden (lo que dice su nombre).
 */
export function aFilaBd(c: ConfigTablero): { widgets_activos: unknown[]; orden_widgets: string[] } {
  const activos = [
    ...c.cifras.map((id) => ({ tipo: "cifra", id })),
    ...c.modulos.map((m) => ({ tipo: "modulo", id: m.id, tamano: m.tamano, ...(m.producto ? { producto: m.producto } : {}) })),
    // Al final: la versión del tablero (los de antes no la llevan y se actualizan una vez).
    { tipo: "version", id: String(c.v ?? VERSION_TABLERO) },
  ];
  return { widgets_activos: activos, orden_widgets: activos.map((a) => `${a.tipo}:${a.id}`) };
}

export function deFilaBd(fila: { widgets_activos?: unknown } | null | undefined): ConfigTablero | null {
  const w = fila?.widgets_activos;
  if (!Array.isArray(w) || w.length === 0) return null;
  const cifras: unknown[] = [];
  const modulos: unknown[] = [];
  let v: number | undefined;
  for (const x of w) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (o.tipo === "version") v = Number(o.id) || undefined;
    else if (o.tipo === "cifra") cifras.push(o.id);
    else if (o.tipo === "modulo") modulos.push({ id: o.id, tamano: o.tamano, producto: o.producto });
  }
  return normalizarConfigTablero({ cifras, modulos, v });
}
