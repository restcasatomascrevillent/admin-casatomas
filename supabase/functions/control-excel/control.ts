// ============================================================================
//  control-excel — Super Admin › Gestor Gasto › «Control (Excel)»
// ----------------------------------------------------------------------------
//  El Excel de control de OficiosOsIA (Control_OFICIOSOSIA.xlsm, en Google
//  Drive) lo comparten todos los proyectos. Cada panel ve y edita SOLO lo de
//  su cliente (aquí «Casa Tomás»):
//    · su fila de CLIENTES (estado, desde, instalación, cuota, día de cobro, notas)
//    · sus filas de COBROS
//    · sus filas de GASTOS CLIENTES
//  Nada de GASTOS NEGOCIO, SOCIOS ni de otros clientes sale de aquí.
//
//  POST JSON, solo super admin:
//    { accion: "leer" }
//    { accion: "guardar_ficha",  revision, ficha }
//    { accion: "guardar_cobro",  revision, cobro }   (con `fila` edita; sin ella, alta)
//    { accion: "borrar_cobro",   revision, fila }
//    { accion: "guardar_gasto",  revision, gasto }
//    { accion: "borrar_gasto",   revision, fila }
//  Todas responden con el estado completo (`EstadoControl`). Si no se puede
//  usar el Excel: `{ ok: true, disponible: false, motivo, mensaje }`. Errores:
//  `{ ok: false, error, mensaje }` con 400 (datos), 403 (solo lectura), 409
//  (el Excel cambió desde que se leyó) o 502 (Google Drive).
//
//  Cómo se escribe: se descarga el fichero, se cambian las celdas en su XML
//  (`_shared/xlsx-celdas.ts`, sin regenerar el libro) y se sube encima con el
//  mismo id. Los campos calculados (pendiente, estado, «comprobar», resumen)
//  se calculan aquí con las mismas reglas que las fórmulas del Excel: los
//  valores que el Excel tiene guardados quedan viejos en cuanto se escribe.
//
//  Config (secretos de la función): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//  GOOGLE_REFRESH_TOKEN (los de las facturas) y, opcionales,
//  CONTROL_EXCEL_FILE_ID y CONTROL_EXCEL_CLIENTE. Ver docs/CONTROL-EXCEL.md.
// ============================================================================
import { exigirSuperAdmin, type FabricaCliente, respuestaJson } from "../_shared/autorizacion.ts";
import { ALCANCE_DRIVE, ClienteDrive, ErrorDrive, esIdDrive, type FicheroDrive, URL_DRIVE } from "../_shared/google-drive.ts";
import { type CambioCelda, ErrorXlsx, type HojaXlsx, LibroXlsx, serialAFecha, fechaASerial, type ValorCelda, type ValorEscrito } from "../_shared/xlsx-celdas.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Control_OFICIOSOSIA.xlsm (el mismo fichero para todos los proyectos). */
export const ID_EXCEL_POR_DEFECTO = "1N-V65dStG5umn0j3gKRZzT1REzlIaciL";
export const CLIENTE_POR_DEFECTO = "Casa Tomás";

export const HOJA_CLIENTES = "CLIENTES";
export const HOJA_COBROS = "COBROS";
export const HOJA_GASTOS = "GASTOS CLIENTES";
/** Las hojas de registro tienen los datos de la fila 7 a la 506 (cabeceras en la 6). */
export const FILA_CABECERA = 6;
export const PRIMERA_FILA = 7;
export const ULTIMA_FILA = 506;

const MAX_IMPORTE = 10_000_000;
const MAX_DETALLE = 200;
const MAX_NOTAS = 500;
const MAX_PROVEEDOR = 120;

// ─── Contrato ───────────────────────────────────────────────────────────────

export interface FichaCliente {
  estado: string;
  /** «AAAA-MM-DD». */
  desde: string | null;
  instalacionPactada: number | null;
  cuotaPactada: number | null;
  diaCobro: number | null;
  notas: string;
}

export interface Cobro {
  /** Fila del Excel (identifica el movimiento). */
  fila: number;
  fechaPrevista: string | null;
  fechaCobro: string | null;
  tipo: string;
  detalle: string;
  pactado: number | null;
  cobrado: number | null;
  /** Calculado: max(0, pactado − cobrado). */
  pendiente: number;
  /** Calculado: «Pendiente», «Parcial», «Cobrado» o «Revisar importe». */
  estado: string;
  recibidoPor: string;
  metodo: string;
  notas: string;
  /** Calculado: aviso del Excel («Falta fecha cobro»…) o «». */
  comprobar: string;
}

export interface Gasto {
  fila: number;
  fecha: string | null;
  proveedor: string;
  tipo: string;
  detalle: string;
  importe: number | null;
  pagadoPor: string;
  /** «Sí», «No» o «» (sin decidir). */
  repercutir: string;
  metodo: string;
  notas: string;
  comprobar: string;
}

export interface ResumenCliente {
  cobradoTotal: number;
  instalacionCobrada: number;
  /** max(0, instalación pactada − cobrada). */
  instalacionPendiente: number;
  cuotasCobradas: number;
  reembolsosCobrados: number;
  otrosCobrados: number;
  /** Suma de lo pendiente de todos los cobros apuntados. */
  pendienteCobro: number;
  /** Cuántos cobros tienen algo pendiente. */
  cobrosPendientes: number;
  /** Gastos del cliente marcados «¿Repercutir? Sí». */
  gastosRepercutibles: number;
  /** Repercutibles − reembolsos cobrados (puede ser negativo). */
  costesPorRecuperar: number;
  /** Todos los gastos del cliente, se repercutan o no. */
  gastosTotal: number;
  /** Movimientos con algún aviso en «Comprobar». */
  avisos: number;
}

export interface ListasControl {
  estados: string[];
  tiposCobro: string[];
  /** «Recibido por» de COBROS. */
  receptores: string[];
  /** «Método» de COBROS. */
  metodos: string[];
  tiposGasto: string[];
  /** «Pagado por» de GASTOS CLIENTES. */
  pagadores: string[];
  /** «Método» de GASTOS CLIENTES. */
  metodosGasto: string[];
  /** «¿Repercutir?» de GASTOS CLIENTES. */
  repercutir: string[];
}

export interface ArchivoControl {
  id: string;
  nombre: string;
  /** Última modificación en Drive (ISO). */
  modificado: string | null;
  url: string;
}

export interface EstadoControl {
  ok: true;
  disponible: true;
  cliente: string;
  archivo: ArchivoControl;
  /** Hay que devolverla tal cual al guardar: si el Excel cambió entretanto, 409. */
  revision: string;
  /** La cuenta de Google del panel solo puede leer el Excel: no se puede guardar. */
  soloLectura: boolean;
  /** Cuenta de Google del panel (solo se da cuando hace falta para compartir el Excel). */
  cuentaGoogle?: string | null;
  ficha: FichaCliente;
  cobros: Cobro[];
  gastos: Gasto[];
  resumen: ResumenCliente;
  listas: ListasControl;
  /** Filas libres que quedan para apuntar movimientos. */
  filasLibres: { cobros: number; gastos: number };
}

export type MotivoNoDisponible = "sin_config" | "sin_acceso" | "solo_lectura" | "sin_cliente" | "formato";

export interface ControlNoDisponible {
  ok: true;
  disponible: false;
  motivo: MotivoNoDisponible;
  mensaje: string;
  cliente: string;
  cuentaGoogle?: string | null;
}

export type CodigoError = "metodo_no_permitido" | "peticion_invalida" | "datos_invalidos" | "no_disponible" | "solo_lectura" | "conflicto" | "fila_ajena" | "sin_filas" | "drive" | "error_interno";

export interface ErrorControlRespuesta {
  ok: false;
  error: CodigoError;
  mensaje: string;
}

export type RespuestaControl = EstadoControl | ControlNoDisponible | ErrorControlRespuesta;

export type CobroEntrada = Partial<Pick<Cobro, "fila" | "fechaPrevista" | "fechaCobro" | "tipo" | "detalle" | "pactado" | "cobrado" | "recibidoPor" | "metodo" | "notas">>;
export type GastoEntrada = Partial<Pick<Gasto, "fila" | "fecha" | "proveedor" | "tipo" | "detalle" | "importe" | "pagadoPor" | "repercutir" | "metodo" | "notas">>;

export type PeticionControl =
  | { accion: "leer" }
  | { accion: "guardar_ficha"; revision: string; ficha: Partial<FichaCliente> }
  | { accion: "guardar_cobro"; revision: string; cobro: CobroEntrada }
  | { accion: "borrar_cobro"; revision: string; fila: number }
  | { accion: "guardar_gasto"; revision: string; gasto: GastoEntrada }
  | { accion: "borrar_gasto"; revision: string; fila: number };

// ─── Errores ────────────────────────────────────────────────────────────────

export class ErrorControl extends Error {
  readonly estado: number;
  readonly codigo: CodigoError;
  constructor(estado: number, codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = "ErrorControl";
    this.estado = estado;
    this.codigo = codigo;
  }
}

class NoDisponible extends Error {
  readonly motivo: MotivoNoDisponible;
  constructor(motivo: MotivoNoDisponible, mensaje: string) {
    super(mensaje);
    this.name = "NoDisponible";
    this.motivo = motivo;
  }
}

const invalido = (mensaje: string) => new ErrorControl(400, "datos_invalidos", mensaje);

// ─── Lectura de celdas ──────────────────────────────────────────────────────

const centimos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Minúsculas, sin acentos ni espacios de más: para comparar nombres como lo hace Excel (SUMIF no distingue mayúsculas). */
export function normalizar(v: unknown): string {
  return String(v ?? "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function aTexto(v: ValorCelda | undefined): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v).trim();
}

function aNumero(v: ValorCelda | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s|€/g, "");
  if (!t) return null;
  // «1.700,50» → 1700.5; «1700.5» se queda.
  const n = Number(/,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

function aFecha(v: ValorCelda | undefined): string | null {
  if (typeof v === "number") return serialAFecha(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return fechaASerial(`${iso[1]}-${iso[2]}-${iso[3]}`) != null ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  const es = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (es) {
    const f = `${es[3]}-${es[2].padStart(2, "0")}-${es[1].padStart(2, "0")}`;
    return fechaASerial(f) != null ? f : null;
  }
  return null;
}

// ─── Esquema de las hojas ───────────────────────────────────────────────────

/** Columna → comienzo de la cabecera que tiene que tener (fila 6), ya normalizado. */
const CABECERAS: Record<string, Record<string, string>> = {
  [HOJA_CLIENTES]: { A: "cliente", B: "estado", C: "desde", D: "instalacion", E: "cuota", F: "dia", G: "notas" },
  [HOJA_COBROS]: { A: "fecha prevista", B: "fecha cobro", C: "cliente", D: "tipo", E: "mes", F: "importe pactado", G: "cobrado", H: "pendiente", I: "estado", J: "recibido", K: "metodo", L: "notas", M: "comprobar" },
  [HOJA_GASTOS]: { A: "fecha", B: "cliente", C: "proveedor", D: "tipo", E: "periodo", F: "importe", G: "pagado", H: "¿repercutir", I: "metodo", J: "notas", K: "comprobar" },
};

/** Columnas que escribe una persona (las demás son fórmulas). */
const ENTRADA_COBROS = ["A", "B", "C", "D", "E", "F", "G", "J", "K", "L"] as const;
const ENTRADA_GASTOS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

const LISTAS_POR_DEFECTO: ListasControl = {
  estados: ["Activo", "Pausado", "Finalizado"],
  tiposCobro: ["Instalación", "Mensualidad", "Reembolso gastos", "Otro"],
  receptores: ["Caja común", "Miguel", "Pablo"],
  metodos: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
  tiposGasto: ["IA", "Hosting", "Dominio", "API", "Licencia", "Otros"],
  pagadores: ["Caja común", "Miguel", "Pablo"],
  metodosGasto: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
  repercutir: ["Sí", "No"],
};

function comprobarCabeceras(hoja: HojaXlsx): void {
  const fila = hoja.fila(FILA_CABECERA);
  for (const [col, esperado] of Object.entries(CABECERAS[hoja.nombre] ?? {})) {
    const hay = normalizar(fila.get(col)?.valor);
    if (!hay.startsWith(esperado)) {
      throw new NoDisponible(
        "formato",
        `La hoja «${hoja.nombre}» del Excel ha cambiado: en ${col}${FILA_CABECERA} se esperaba «${esperado}…» y pone «${aTexto(fila.get(col)?.valor) || "nada"}». No se toca hasta revisarlo.`,
      );
    }
  }
}

interface Hojas {
  clientes: HojaXlsx;
  cobros: HojaXlsx;
  gastos: HojaXlsx;
}

async function abrirHojas(libro: LibroXlsx): Promise<Hojas> {
  for (const nombre of [HOJA_CLIENTES, HOJA_COBROS, HOJA_GASTOS]) {
    if (!libro.tieneHoja(nombre)) throw new NoDisponible("formato", `El Excel no tiene la hoja «${nombre}». ¿Es el fichero de control?`);
  }
  const hojas = { clientes: await libro.hoja(HOJA_CLIENTES), cobros: await libro.hoja(HOJA_COBROS), gastos: await libro.hoja(HOJA_GASTOS) };
  for (const h of Object.values(hojas)) comprobarCabeceras(h);
  return hojas;
}

function leerListas(h: Hojas): ListasControl {
  const lista = (hoja: HojaXlsx, col: string, defecto: string[]) => {
    const v = hoja.listaDe(`${col}${PRIMERA_FILA}`);
    return v && v.length ? v : defecto;
  };
  return {
    estados: lista(h.clientes, "B", LISTAS_POR_DEFECTO.estados),
    tiposCobro: lista(h.cobros, "D", LISTAS_POR_DEFECTO.tiposCobro),
    receptores: lista(h.cobros, "J", LISTAS_POR_DEFECTO.receptores),
    metodos: lista(h.cobros, "K", LISTAS_POR_DEFECTO.metodos),
    tiposGasto: lista(h.gastos, "D", LISTAS_POR_DEFECTO.tiposGasto),
    pagadores: lista(h.gastos, "G", LISTAS_POR_DEFECTO.pagadores),
    metodosGasto: lista(h.gastos, "I", LISTAS_POR_DEFECTO.metodosGasto),
    repercutir: lista(h.gastos, "H", LISTAS_POR_DEFECTO.repercutir),
  };
}

/** Fila de CLIENTES del cliente (y su nombre tal cual está escrito). */
function filaDelCliente(clientes: HojaXlsx, cliente: string): { fila: number; nombre: string } | null {
  const buscado = normalizar(cliente);
  for (const n of clientes.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const a = clientes.fila(n).get("A");
    if (a && normalizar(a.valor) === buscado) return { fila: n, nombre: aTexto(a.valor) };
  }
  return null;
}

// ─── Las fórmulas del Excel, en TS ──────────────────────────────────────────

/** COBROS!H, I y M. */
export function calcularCobro(pactado: number | null, cobrado: number | null, fechaCobro: string | null, recibidoPor: string): Pick<Cobro, "pendiente" | "estado" | "comprobar"> {
  const f = pactado ?? 0;
  const g = cobrado ?? 0;
  const estado = f <= 0 ? "Revisar importe" : g <= 0 ? "Pendiente" : g < f ? "Parcial" : "Cobrado";
  const comprobar = f <= 0 ? "Indicar importe" : g > 0 && !fechaCobro ? "Falta fecha cobro" : g > 0 && !recibidoPor ? "Falta receptor" : g > f ? "Exceso sobre pactado" : "";
  return { pendiente: centimos(Math.max(0, f - g)), estado, comprobar };
}

/** GASTOS CLIENTES!K (el cliente nunca falta: lo pone el servidor). */
export function calcularGasto(g: Pick<Gasto, "fecha" | "importe" | "pagadoPor" | "repercutir">): string {
  if (g.importe == null) return "";
  if (!g.fecha) return "Falta fecha";
  if (!g.pagadoPor) return "Falta pagador";
  if (!g.repercutir) return "Indica si repercute";
  return "";
}

export function resumir(ficha: FichaCliente, cobros: readonly Cobro[], gastos: readonly Gasto[]): ResumenCliente {
  const suma = (lista: readonly Cobro[], tipo?: string) =>
    centimos(lista.filter((c) => tipo === undefined || normalizar(c.tipo) === normalizar(tipo)).reduce((t, c) => t + (c.cobrado ?? 0), 0));
  const instalacionCobrada = suma(cobros, "Instalación");
  const reembolsosCobrados = suma(cobros, "Reembolso gastos");
  const gastosRepercutibles = centimos(gastos.filter((g) => normalizar(g.repercutir) === "si").reduce((t, g) => t + (g.importe ?? 0), 0));
  return {
    cobradoTotal: suma(cobros),
    instalacionCobrada,
    instalacionPendiente: centimos(Math.max(0, (ficha.instalacionPactada ?? 0) - instalacionCobrada)),
    cuotasCobradas: suma(cobros, "Mensualidad"),
    reembolsosCobrados,
    otrosCobrados: suma(cobros, "Otro"),
    pendienteCobro: centimos(cobros.reduce((t, c) => t + c.pendiente, 0)),
    cobrosPendientes: cobros.filter((c) => c.pendiente > 0).length,
    gastosRepercutibles,
    costesPorRecuperar: centimos(gastosRepercutibles - reembolsosCobrados),
    gastosTotal: centimos(gastos.reduce((t, g) => t + (g.importe ?? 0), 0)),
    avisos: cobros.filter((c) => c.comprobar).length + gastos.filter((g) => g.comprobar).length,
  };
}

// ─── Leer el estado del cliente ─────────────────────────────────────────────

export interface EstadoLibro {
  cliente: string;
  filaCliente: number;
  ficha: FichaCliente;
  cobros: Cobro[];
  gastos: Gasto[];
  resumen: ResumenCliente;
  listas: ListasControl;
  filasLibres: { cobros: number; gastos: number };
}

function filaVacia(celdas: Map<string, { valor: ValorCelda }>, columnas: readonly string[]): boolean {
  return columnas.every((c) => aTexto(celdas.get(c)?.valor) === "");
}

/** Estado del cliente en el libro. Lanza `NoDisponible` si falta el cliente o el formato cambió. */
export async function leerEstado(libro: LibroXlsx, cliente: string): Promise<EstadoLibro> {
  const h = await abrirHojas(libro);
  const encontrado = filaDelCliente(h.clientes, cliente);
  if (!encontrado) {
    throw new NoDisponible("sin_cliente", `El cliente «${cliente}» no está en la hoja CLIENTES del Excel. Añádelo allí (columna A) y vuelve a cargar.`);
  }
  const buscado = normalizar(encontrado.nombre);
  const fc = h.clientes.fila(encontrado.fila);
  const dia = aNumero(fc.get("F")?.valor);
  const ficha: FichaCliente = {
    estado: aTexto(fc.get("B")?.valor),
    desde: aFecha(fc.get("C")?.valor),
    instalacionPactada: aNumero(fc.get("D")?.valor),
    cuotaPactada: aNumero(fc.get("E")?.valor),
    diaCobro: dia == null ? null : Math.round(dia),
    notas: aTexto(fc.get("G")?.valor),
  };

  const cobros: Cobro[] = [];
  let libresCobros = 0;
  for (const n of h.cobros.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const c = h.cobros.fila(n);
    if (filaVacia(c, ENTRADA_COBROS)) {
      libresCobros++;
      continue;
    }
    if (normalizar(c.get("C")?.valor) !== buscado) continue;
    const pactado = aNumero(c.get("F")?.valor);
    const cobrado = aNumero(c.get("G")?.valor);
    const fechaCobro = aFecha(c.get("B")?.valor);
    const recibidoPor = aTexto(c.get("J")?.valor);
    cobros.push({
      fila: n,
      fechaPrevista: aFecha(c.get("A")?.valor),
      fechaCobro,
      tipo: aTexto(c.get("D")?.valor),
      detalle: aTexto(c.get("E")?.valor),
      pactado,
      cobrado,
      ...calcularCobro(pactado, cobrado, fechaCobro, recibidoPor),
      recibidoPor,
      metodo: aTexto(c.get("K")?.valor),
      notas: aTexto(c.get("L")?.valor),
    });
  }

  const gastos: Gasto[] = [];
  let libresGastos = 0;
  for (const n of h.gastos.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const c = h.gastos.fila(n);
    if (filaVacia(c, ENTRADA_GASTOS)) {
      libresGastos++;
      continue;
    }
    if (normalizar(c.get("B")?.valor) !== buscado) continue;
    const base = {
      fecha: aFecha(c.get("A")?.valor),
      importe: aNumero(c.get("F")?.valor),
      pagadoPor: aTexto(c.get("G")?.valor),
      repercutir: aTexto(c.get("H")?.valor),
    };
    gastos.push({
      fila: n,
      ...base,
      proveedor: aTexto(c.get("C")?.valor),
      tipo: aTexto(c.get("D")?.valor),
      detalle: aTexto(c.get("E")?.valor),
      metodo: aTexto(c.get("I")?.valor),
      notas: aTexto(c.get("J")?.valor),
      comprobar: calcularGasto(base),
    });
  }

  return {
    cliente: encontrado.nombre,
    filaCliente: encontrado.fila,
    ficha,
    cobros,
    gastos,
    resumen: resumir(ficha, cobros, gastos),
    listas: leerListas(h),
    filasLibres: { cobros: libresCobros, gastos: libresGastos },
  };
}

// ─── Validar lo que llega ───────────────────────────────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function texto(v: unknown, campo: string, max: number): string {
  if (v == null) return "";
  if (typeof v !== "string") throw invalido(`«${campo}» tiene que ser un texto.`);
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  if (t.length > max) throw invalido(`«${campo}» es demasiado largo (máximo ${max} caracteres).`);
  return t;
}

function importe(v: unknown, campo: string): number | null {
  if (v == null || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw invalido(`«${campo}» tiene que ser un número.`);
  if (v < 0) throw invalido(`«${campo}» no puede ser negativo.`);
  if (v > MAX_IMPORTE) throw invalido(`«${campo}» es demasiado grande.`);
  return centimos(v);
}

function fecha(v: unknown, campo: string): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || fechaASerial(v) == null) throw invalido(`«${campo}» no es una fecha válida (AAAA-MM-DD).`);
  const anio = Number(v.slice(0, 4));
  if (anio < 2000 || anio > 2100) throw invalido(`«${campo}» tiene un año fuera de rango.`);
  return v;
}

/** Valor de un desplegable: «» o uno de la lista del Excel (se devuelve como está escrito allí). */
function deLista(v: unknown, campo: string, lista: readonly string[], obligatorio = false): string {
  const t = texto(v, campo, 80);
  if (!t) {
    if (obligatorio) throw invalido(`Elige «${campo}».`);
    return "";
  }
  const encontrado = lista.find((x) => normalizar(x) === normalizar(t));
  if (!encontrado) throw invalido(`«${t}» no es un valor de «${campo}» en el Excel (${lista.join(", ")}).`);
  return encontrado;
}

function numeroDeFila(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < PRIMERA_FILA || v > ULTIMA_FILA) throw invalido("La fila indicada no es válida.");
  return v;
}

const vacioANull = (t: string): ValorEscrito => (t === "" ? null : t);
const fechaCelda = (f: string | null): ValorEscrito => (f ? { fecha: f } : null);

function primeraFilaLibre(hoja: HojaXlsx, columnas: readonly string[], colFormula: string): number {
  for (const n of hoja.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const c = hoja.fila(n);
    // Solo filas preparadas por la plantilla (con su fórmula): fuera de ellas el Excel no calcularía nada.
    if (filaVacia(c, columnas) && c.get(colFormula)?.formula) return n;
  }
  throw new ErrorControl(409, "sin_filas", `La hoja «${hoja.nombre}» del Excel no tiene filas libres: hay que ampliarla en el propio Excel.`);
}

function exigirFilaDelCliente(hoja: HojaXlsx, fila: number, colCliente: string, cliente: string): void {
  if (normalizar(hoja.fila(fila).get(colCliente)?.valor) !== normalizar(cliente)) {
    throw new ErrorControl(409, "fila_ajena", "Ese movimiento ya no está en esa fila del Excel (alguien lo ha cambiado). Recarga y vuelve a intentarlo.");
  }
}

// ─── Escribir ───────────────────────────────────────────────────────────────

/**
 * Aplica una acción de guardado al libro (en memoria). Valida todo antes de
 * escribir; el cliente de cada fila lo pone siempre el servidor.
 */
export async function aplicarAccion(libro: LibroXlsx, cliente: string, peticion: Record<string, unknown>): Promise<void> {
  const estado = await leerEstado(libro, cliente);
  const h = await abrirHojas(libro);
  const nombre = estado.cliente;
  const { listas } = estado;
  const celdas = (cols: readonly string[], fila: number, valores: Record<string, ValorEscrito>): CambioCelda[] =>
    cols.filter((c) => c in valores).map((c) => ({ ref: `${c}${fila}`, valor: valores[c] }));

  switch (peticion.accion) {
    case "guardar_ficha": {
      if (!esObjeto(peticion.ficha)) throw invalido("Faltan los datos de la ficha.");
      const f = peticion.ficha;
      const dia = f.diaCobro == null || f.diaCobro === "" ? null : f.diaCobro;
      if (dia != null && (typeof dia !== "number" || !Number.isInteger(dia) || dia < 1 || dia > 31)) throw invalido("El día de cobro tiene que estar entre 1 y 31.");
      const fila = estado.filaCliente;
      h.clientes.escribir(celdas(["B", "C", "D", "E", "F", "G"], fila, {
        B: vacioANull(deLista(f.estado, "Estado", listas.estados, true)),
        C: fechaCelda(fecha(f.desde, "Desde")),
        D: importe(f.instalacionPactada, "Instalación pactada"),
        E: importe(f.cuotaPactada, "Cuota pactada"),
        F: dia as number | null,
        G: vacioANull(texto(f.notas, "Notas", MAX_NOTAS)),
      }));
      break;
    }
    case "guardar_cobro": {
      if (!esObjeto(peticion.cobro)) throw invalido("Faltan los datos del cobro.");
      const c = peticion.cobro;
      const pactado = importe(c.pactado, "Importe pactado");
      if (pactado == null || pactado <= 0) throw invalido("Escribe el importe pactado (más de 0).");
      const valores: Record<string, ValorEscrito> = {
        A: fechaCelda(fecha(c.fechaPrevista, "Fecha prevista")),
        B: fechaCelda(fecha(c.fechaCobro, "Fecha de cobro")),
        C: nombre,
        D: deLista(c.tipo, "Tipo de cobro", listas.tiposCobro, true),
        E: vacioANull(texto(c.detalle, "Mes / detalle", MAX_DETALLE)),
        F: pactado,
        G: importe(c.cobrado, "Cobrado"),
        J: vacioANull(deLista(c.recibidoPor, "Recibido por", listas.receptores)),
        K: vacioANull(deLista(c.metodo, "Método", listas.metodos)),
        L: vacioANull(texto(c.notas, "Notas", MAX_NOTAS)),
      };
      let fila: number;
      if (c.fila == null) fila = primeraFilaLibre(h.cobros, ENTRADA_COBROS, "H");
      else {
        fila = numeroDeFila(c.fila);
        exigirFilaDelCliente(h.cobros, fila, "C", nombre);
      }
      h.cobros.escribir(celdas(ENTRADA_COBROS, fila, valores));
      break;
    }
    case "borrar_cobro": {
      const fila = numeroDeFila(peticion.fila);
      exigirFilaDelCliente(h.cobros, fila, "C", nombre);
      h.cobros.escribir(ENTRADA_COBROS.map((col) => ({ ref: `${col}${fila}`, valor: null })));
      break;
    }
    case "guardar_gasto": {
      if (!esObjeto(peticion.gasto)) throw invalido("Faltan los datos del gasto.");
      const g = peticion.gasto;
      const proveedor = texto(g.proveedor, "Proveedor", MAX_PROVEEDOR);
      if (!proveedor) throw invalido("Escribe el proveedor del gasto.");
      const valores: Record<string, ValorEscrito> = {
        A: fechaCelda(fecha(g.fecha, "Fecha de pago")),
        B: nombre,
        C: proveedor,
        D: vacioANull(deLista(g.tipo, "Tipo de gasto", listas.tiposGasto)),
        E: vacioANull(texto(g.detalle, "Periodo / detalle", MAX_DETALLE)),
        F: importe(g.importe, "Importe"),
        G: vacioANull(deLista(g.pagadoPor, "Pagado por", listas.pagadores)),
        H: vacioANull(deLista(g.repercutir, "¿Repercutir?", listas.repercutir)),
        I: vacioANull(deLista(g.metodo, "Método", listas.metodosGasto)),
        J: vacioANull(texto(g.notas, "Notas", MAX_NOTAS)),
      };
      let fila: number;
      if (g.fila == null) fila = primeraFilaLibre(h.gastos, ENTRADA_GASTOS, "K");
      else {
        fila = numeroDeFila(g.fila);
        exigirFilaDelCliente(h.gastos, fila, "B", nombre);
      }
      h.gastos.escribir(celdas(ENTRADA_GASTOS, fila, valores));
      break;
    }
    case "borrar_gasto": {
      const fila = numeroDeFila(peticion.fila);
      exigirFilaDelCliente(h.gastos, fila, "B", nombre);
      h.gastos.escribir(ENTRADA_GASTOS.map((col) => ({ ref: `${col}${fila}`, valor: null })));
      break;
    }
    default:
      throw new ErrorControl(400, "peticion_invalida", "Acción desconocida.");
  }
  await refrescarCaches(libro, cliente);
}

/**
 * Deja al día los valores guardados de las fórmulas que dependen SOLO de lo
 * que se ve aquí: las de cada movimiento del cliente y su fila de CLIENTES.
 * El resto del libro (INICIO, MES A MES) se recalcula al abrirlo.
 */
async function refrescarCaches(libro: LibroXlsx, cliente: string): Promise<void> {
  const estado = await leerEstado(libro, cliente);
  const h = await abrirHojas(libro);
  for (const n of h.cobros.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const c = h.cobros.fila(n);
    const propio = estado.cobros.find((x) => x.fila === n);
    if (propio) {
      h.cobros.actualizarCache(`H${n}`, propio.pendiente);
      h.cobros.actualizarCache(`I${n}`, propio.estado);
      h.cobros.actualizarCache(`M${n}`, propio.comprobar);
    } else if (aTexto(c.get("C")?.valor) === "") {
      // Fila sin cliente: las tres fórmulas dan «».
      for (const col of ["H", "I", "M"]) if (c.get(col)?.valor != null) h.cobros.actualizarCache(`${col}${n}`, "");
    }
  }
  for (const n of h.gastos.numerosDeFila()) {
    if (n < PRIMERA_FILA || n > ULTIMA_FILA) continue;
    const c = h.gastos.fila(n);
    const propio = estado.gastos.find((x) => x.fila === n);
    if (propio) h.gastos.actualizarCache(`K${n}`, propio.comprobar);
    else if (aTexto(c.get("F")?.valor) === "" && c.get("K")?.valor != null) h.gastos.actualizarCache(`K${n}`, "");
  }
  const f = estado.filaCliente;
  const r = estado.resumen;
  h.clientes.actualizarCache(`H${f}`, r.cobradoTotal);
  h.clientes.actualizarCache(`I${f}`, r.instalacionCobrada);
  h.clientes.actualizarCache(`J${f}`, r.cuotasCobradas);
  h.clientes.actualizarCache(`K${f}`, r.gastosRepercutibles);
  h.clientes.actualizarCache(`L${f}`, r.reembolsosCobrados);
  h.clientes.actualizarCache(`M${f}`, r.costesPorRecuperar);
}

// ─── Manejador HTTP ─────────────────────────────────────────────────────────

export interface DependenciasControl {
  crearCliente: FabricaCliente;
  env?: (nombre: string) => string | undefined;
  fetch?: typeof fetch;
  ahora?: () => Date;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nombre);
}

const json = (cuerpo: RespuestaControl, status = 200) => respuestaJson(cuerpo, status, CORS);

type MetadatosExcel = FicheroDrive & { modifiedTime?: string; headRevisionId?: string; md5Checksum?: string; webViewLink?: string };
const CAMPOS_EXCEL = "id,name,mimeType,size,modifiedTime,headRevisionId,md5Checksum,webViewLink,trashed,capabilities(canEdit)";
const TIPO_XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";

/** Lo que identifica una versión del fichero en Drive. */
export function revisionDe(m: { headRevisionId?: string; md5Checksum?: string; modifiedTime?: string }): string {
  return m.headRevisionId || m.md5Checksum || m.modifiedTime || "";
}

async function cuentaGoogle(drive: ClienteDrive): Promise<string | null> {
  try {
    const j = await drive.json<{ user?: { emailAddress?: string } }>(`${URL_DRIVE}/about?fields=${encodeURIComponent("user(emailAddress)")}`);
    return typeof j.user?.emailAddress === "string" ? j.user.emailAddress : null;
  } catch {
    return null;
  }
}

function mensajeDrive(e: ErrorDrive): string {
  if (e.motivo === "red") return "No se pudo contactar con Google Drive. Inténtalo de nuevo en un momento.";
  if (e.motivo === "limite") return "Google Drive está limitando las peticiones. Espera un minuto y vuelve a intentarlo.";
  return "Google Drive ha devuelto un error al acceder al Excel. Inténtalo de nuevo.";
}

export function crearManejador(deps: DependenciasControl): (req: Request) => Promise<Response> {
  const env = deps.env ?? envDeDeno;
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ ok: false, error: "metodo_no_permitido", mensaje: "Solo se admite POST." }, 405);

    const autorizado = await exigirSuperAdmin(req, { crearCliente: deps.crearCliente, env, corsHeaders: CORS });
    if (!autorizado.ok) return autorizado.response;

    let peticion: Record<string, unknown>;
    try {
      const cuerpo: unknown = await req.json();
      if (!esObjeto(cuerpo) || typeof cuerpo.accion !== "string") throw new Error("sin acción");
      peticion = cuerpo;
    } catch {
      return json({ ok: false, error: "peticion_invalida", mensaje: "La petición no es válida." }, 400);
    }
    const ACCIONES = ["leer", "guardar_ficha", "guardar_cobro", "borrar_cobro", "guardar_gasto", "borrar_gasto"];
    if (!ACCIONES.includes(peticion.accion as string)) return json({ ok: false, error: "peticion_invalida", mensaje: "Acción desconocida." }, 400);
    const escribe = peticion.accion !== "leer";

    const cliente = (env("CONTROL_EXCEL_CLIENTE") ?? "").trim() || CLIENTE_POR_DEFECTO;
    const idExcel = (env("CONTROL_EXCEL_FILE_ID") ?? "").trim() || ID_EXCEL_POR_DEFECTO;
    const noDisponible = (motivo: MotivoNoDisponible, mensaje: string, cuenta?: string | null): Response =>
      // Al guardar, «no disponible» es un error: no se ha guardado nada.
      escribe
        ? json({ ok: false, error: motivo === "solo_lectura" ? "solo_lectura" : "no_disponible", mensaje }, motivo === "solo_lectura" ? 403 : 409)
        : json({ ok: true, disponible: false, motivo, mensaje, cliente, ...(cuenta !== undefined ? { cuentaGoogle: cuenta } : {}) });

    const drive = new ClienteDrive({
      config: { clientId: env("GOOGLE_CLIENT_ID"), clientSecret: env("GOOGLE_CLIENT_SECRET"), refreshToken: env("GOOGLE_REFRESH_TOKEN") },
      fetch: deps.fetch,
    });
    if (!drive.configurado) {
      return noDisponible("sin_config", "Este entorno no tiene configurada la cuenta de Google (secretos GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN), así que no puede abrir el Excel.");
    }
    if (!esIdDrive(idExcel)) return noDisponible("sin_config", "El id del Excel (CONTROL_EXCEL_FILE_ID) no es válido.");

    try {
      let meta: MetadatosExcel | null;
      let alcances: string[] = [];
      try {
        ({ alcances } = await drive.token());
        meta = await drive.metadatos(idExcel, CAMPOS_EXCEL);
      } catch (e) {
        if (e instanceof ErrorDrive && (e.motivo === "token" || e.motivo === "sin_config")) {
          return noDisponible("sin_config", "Google ha rechazado las credenciales de la cuenta del panel (el refresh token puede haber caducado). Hay que renovarlo en los secretos de Supabase.");
        }
        if (e instanceof ErrorDrive && e.motivo === "permiso") meta = null;
        else throw e;
      }
      if (!meta || meta.trashed) {
        const cuenta = await cuentaGoogle(drive);
        const soloLoSuyo = alcances.length > 0 && !alcances.includes(ALCANCE_DRIVE);
        return noDisponible(
          "sin_acceso",
          meta?.trashed
            ? "El Excel de control está en la papelera de Drive."
            : soloLoSuyo
            ? `La cuenta de Google del panel${cuenta ? ` (${cuenta})` : ""} tiene un permiso limitado (drive.file): solo ve los ficheros que crea el propio panel, no el Excel. Hace falta un refresh token con el permiso «drive» completo y compartir el Excel con esa cuenta como editor.`
            : `La cuenta de Google del panel${cuenta ? ` (${cuenta})` : ""} no puede ver el Excel de control. Compártelo con esa cuenta como editor.`,
          cuenta,
        );
      }
      const soloLectura = meta.capabilities?.canEdit === false;
      const archivo: ArchivoControl = {
        id: meta.id,
        nombre: meta.name,
        modificado: meta.modifiedTime ?? null,
        url: meta.webViewLink ?? `https://drive.google.com/file/d/${meta.id}/view`,
      };

      if (escribe) {
        if (typeof peticion.revision !== "string" || !peticion.revision) throw new ErrorControl(400, "peticion_invalida", "Falta la revisión del Excel: recarga y vuelve a intentarlo.");
        if (soloLectura) {
          const cuenta = await cuentaGoogle(drive);
          return noDisponible("solo_lectura", `La cuenta de Google del panel${cuenta ? ` (${cuenta})` : ""} solo puede leer el Excel. Compártelo con esa cuenta como editor para poder guardar.`, cuenta);
        }
        if (peticion.revision !== revisionDe(meta)) {
          throw new ErrorControl(409, "conflicto", "El Excel ha cambiado desde que lo cargaste (alguien lo ha editado). Recarga para ver lo último y repite el cambio.");
        }
      }

      const { bytes } = await drive.descargar(idExcel);
      let libro = await LibroXlsx.abrir(bytes);
      let revision = revisionDe(meta);
      if (escribe) {
        await aplicarAccion(libro, cliente, peticion);
        const salida = await libro.guardar((deps.ahora ?? (() => new Date()))());
        // Se vuelve a abrir lo que se va a subir: si no se lee bien, no se sube.
        libro = await LibroXlsx.abrir(salida);
        await leerEstado(libro, cliente);
        await drive.reemplazar(idExcel, meta.name, meta.mimeType || TIPO_XLSM, salida);
        const nueva = (await drive.metadatos(idExcel, CAMPOS_EXCEL)) as MetadatosExcel | null;
        if (nueva) {
          revision = revisionDe(nueva);
          archivo.modificado = nueva.modifiedTime ?? archivo.modificado;
        }
      }
      const estado = await leerEstado(libro, cliente);
      const { filaCliente: _fila, ...publico } = estado;
      return json({
        ok: true,
        disponible: true,
        ...publico,
        archivo,
        revision,
        soloLectura,
        ...(soloLectura ? { cuentaGoogle: await cuentaGoogle(drive) } : {}),
      });
    } catch (e) {
      if (e instanceof NoDisponible) return noDisponible(e.motivo, e.message);
      if (e instanceof ErrorControl) return json({ ok: false, error: e.codigo, mensaje: e.message }, e.estado);
      if (e instanceof ErrorXlsx) {
        console.error("[control-excel] xlsx:", e.motivo, e.message);
        return noDisponible("formato", e.motivo === "formula"
          ? "El Excel tiene una fórmula donde debería ir un dato: no se ha tocado. Revísalo en el propio Excel."
          : `No se pudo leer el Excel de control: ${e.message}.`);
      }
      if (e instanceof ErrorDrive) {
        console.error("[control-excel] drive:", e.motivo, e.estado);
        if (e.motivo === "permiso" || e.motivo === "no_encontrado") {
          return noDisponible(escribe ? "solo_lectura" : "sin_acceso", "La cuenta de Google del panel no tiene permiso para esta operación sobre el Excel. Compártelo con esa cuenta como editor.");
        }
        return json({ ok: false, error: "drive", mensaje: mensajeDrive(e) }, 502);
      }
      console.error("[control-excel] error:", e instanceof Error ? e.name : "desconocido");
      return json({ ok: false, error: "error_interno", mensaje: "No se pudo completar la operación sobre el Excel." }, 500);
    }
  };
}
