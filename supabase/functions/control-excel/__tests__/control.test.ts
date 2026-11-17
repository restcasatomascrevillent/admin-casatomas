// @vitest-environment node
// control-excel: autorización (solo super admin), estado SOLO del cliente del
// panel calculado con las reglas del Excel (no con sus valores guardados),
// altas / ediciones / borrados que escriben únicamente en sus filas, control
// de concurrencia, validación, «no disponible» (sin secretos, sin acceso,
// solo lectura, sin cliente, formato cambiado) y que ningún secreto llegue al
// navegador. Google Drive está simulado: no sale nada a Internet.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { olvidarTokenDrive } from "../../_shared/google-drive.ts";
import { LibroXlsx } from "../../_shared/xlsx-celdas.ts";
import {
  calcularCobro,
  calcularGasto,
  CLIENTE_POR_DEFECTO,
  type ControlNoDisponible,
  crearManejador,
  type ErrorControlRespuesta,
  type EstadoControl,
  ID_EXCEL_POR_DEFECTO,
  leerEstado,
  normalizar,
  revisionDe,
} from "../control.ts";

const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/control-minimo.xlsx", import.meta.url)));
const TIPO = "application/vnd.ms-excel.sheet.macroenabled.12";

const SECRETOS = {
  GOOGLE_CLIENT_ID: "cliente-google.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-secreto-de-google-123",
  GOOGLE_REFRESH_TOKEN: "1//refresh-token-supersecreto-456",
};
const TOKEN_ACCESO = "ya29.token-de-acceso-secreto-789";
const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://sfonaclosuafvlhutkon.supabase.co",
  SUPABASE_ANON_KEY: "anon-jwt-publico",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
};
const USUARIOS: Record<string, { id: string; email: string; superadmin: boolean; admin?: boolean }> = {
  "jwt-super": { id: "11111111-1111-4111-8111-111111111111", email: "dueno@casatomas.test", superadmin: true },
  "jwt-admin": { id: "22222222-2222-4222-8222-222222222222", email: "admin@casatomas.test", superadmin: false, admin: true },
};

function crearCliente(_url: string, _key: string) {
  return {
    auth: {
      getUser: async (token: string) => {
        const u = USUARIOS[token];
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const u = Object.values(USUARIOS).find((x) => x.id === args._user_id);
      if (fn === "is_super_admin") return { data: !!u?.superadmin, error: null };
      if (fn === "is_admin") return { data: !!u?.admin, error: null };
      return { data: null, error: { message: `rpc ${fn} no simulada` } };
    },
  };
}

// ─── Google Drive simulado ──────────────────────────────────────────────────
interface Drive {
  bytes: Uint8Array;
  version: number;
  existe: boolean;
  puedeEditar: boolean;
  enPapelera: boolean;
  alcance: string;
  fallaDescarga: boolean;
  tokenRechazado: boolean;
  subidas: Uint8Array[];
  llamadas: string[];
}
let drive: Drive;

const resp = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

function buscar(pajar: Uint8Array, aguja: Uint8Array, desde = 0): number {
  bucle: for (let i = desde; i <= pajar.length - aguja.length; i++) {
    for (let j = 0; j < aguja.length; j++) if (pajar[i + j] !== aguja[j]) continue bucle;
    return i;
  }
  return -1;
}

/** El contenido del fichero dentro de una subida `multipart/related` (segunda parte). */
function contenidoDeSubida(cuerpo: Uint8Array, tipoContenido: string): Uint8Array {
  const cod = new TextEncoder();
  const frontera = /boundary=(.+)$/.exec(tipoContenido)![1];
  const cabecera = cod.encode(`Content-Type: ${TIPO}\r\n\r\n`);
  const ini = buscar(cuerpo, cabecera) + cabecera.length;
  const fin = buscar(cuerpo, cod.encode(`\r\n--${frontera}--`), ini);
  return cuerpo.slice(ini, fin);
}

const metadatos = () => ({
  id: ID_EXCEL_POR_DEFECTO,
  name: "Control_OFICIOSOSIA.xlsm",
  mimeType: TIPO,
  size: String(drive.bytes.length),
  modifiedTime: `2026-11-17T06:55:${String(drive.version).padStart(2, "0")}.000Z`,
  headRevisionId: `rev-${drive.version}`,
  md5Checksum: `md5-${drive.version}`,
  webViewLink: `https://drive.google.com/file/d/${ID_EXCEL_POR_DEFECTO}/view?usp=drivesdk`,
  trashed: drive.enPapelera,
  capabilities: { canEdit: drive.puedeEditar },
});

const fetchSimulado = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const metodo = init?.method ?? "GET";
  drive.llamadas.push(`${metodo} ${url.host}${url.pathname}${url.searchParams.get("alt") ? "?alt=media" : ""}`);
  if (url.host === "oauth2.googleapis.com") {
    if (drive.tokenRechazado) return resp({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    return resp({ access_token: TOKEN_ACCESO, expires_in: 3600, scope: drive.alcance });
  }
  if (new Headers(init?.headers).get("Authorization") !== `Bearer ${TOKEN_ACCESO}`) return resp({ error: { message: "sin token" } }, 401);
  if (url.pathname === "/drive/v3/about") return resp({ user: { emailAddress: "panel@oficiososia.test" } });
  if (url.pathname === `/drive/v3/files/${ID_EXCEL_POR_DEFECTO}`) {
    if (!drive.existe) return resp({ error: { message: `File not found: ${ID_EXCEL_POR_DEFECTO}.` } }, 404);
    if (url.searchParams.get("alt") === "media") {
      if (drive.fallaDescarga) return resp({ error: { message: "Internal Error" } }, 500);
      return new Response(drive.bytes.slice(), { status: 200, headers: { "Content-Type": TIPO } });
    }
    return resp(metadatos());
  }
  if (url.pathname === `/upload/drive/v3/files/${ID_EXCEL_POR_DEFECTO}` && metodo === "PATCH") {
    const nuevo = contenidoDeSubida(init!.body as Uint8Array, new Headers(init!.headers).get("Content-Type")!);
    drive.bytes = nuevo;
    drive.version += 1;
    drive.subidas.push(nuevo);
    return resp({ id: ID_EXCEL_POR_DEFECTO, name: "Control_OFICIOSOSIA.xlsm", mimeType: TIPO });
  }
  throw new Error(`ruta no simulada: ${metodo} ${url}`);
});

beforeEach(() => {
  olvidarTokenDrive();
  fetchSimulado.mockClear();
  drive = {
    bytes: FIXTURE.slice(),
    version: 1,
    existe: true,
    puedeEditar: true,
    enPapelera: false,
    alcance: "https://www.googleapis.com/auth/drive",
    fallaDescarga: false,
    tokenRechazado: false,
    subidas: [],
    llamadas: [],
  };
});

function manejador(env: Record<string, string> = SECRETOS) {
  const todo = { ...BASE_ENV, ...env };
  return crearManejador({ crearCliente, env: (n) => todo[n], fetch: fetchSimulado as unknown as typeof fetch, ahora: () => new Date("2026-11-17T10:00:00Z") });
}

async function pedir<T = EstadoControl>(cuerpo: unknown, opciones: { jwt?: string; env?: Record<string, string>; metodo?: string } = {}) {
  const res = await manejador(opciones.env)(new Request("https://sfonaclosuafvlhutkon.supabase.co/functions/v1/control-excel", {
    method: opciones.metodo ?? "POST",
    headers: { "Content-Type": "application/json", ...(opciones.jwt === "" ? {} : { Authorization: `Bearer ${opciones.jwt ?? "jwt-super"}` }) },
    body: opciones.metodo === "GET" ? undefined : JSON.stringify(cuerpo),
  }));
  const texto = await res.text();
  return { status: res.status, texto, json: JSON.parse(texto) as T };
}

const leer = async () => (await pedir({ accion: "leer" })).json;
const estadoEnDrive = async () => leerEstado(await LibroXlsx.abrir(drive.bytes), CLIENTE_POR_DEFECTO);
const subidas = () => drive.llamadas.filter((l) => l.startsWith("PATCH"));

/** Añade un cobro y un gasto de OTRO cliente a la fixture (filas 12 y 14). */
async function conMovimientosDeNexo(): Promise<void> {
  const libro = await LibroXlsx.abrir(drive.bytes);
  (await libro.hoja("COBROS")).escribir([{ ref: "C12", valor: "Nexo" }, { ref: "D12", valor: "Mensualidad" }, { ref: "F12", valor: 100 }, { ref: "G12", valor: 100 }]);
  (await libro.hoja("GASTOS CLIENTES")).escribir([{ ref: "B14", valor: "Nexo" }, { ref: "C14", valor: "OpenAI" }, { ref: "F14", valor: 20 }, { ref: "H14", valor: "Sí" }]);
  drive.bytes = await libro.guardar();
}

describe("fórmulas del Excel, en TS", () => {
  it("COBROS: pendiente, estado automático y comprobar", () => {
    expect(calcularCobro(1700, null, null, "")).toEqual({ pendiente: 1700, estado: "Pendiente", comprobar: "" });
    expect(calcularCobro(1700, 700, "2026-11-17", "Pablo")).toEqual({ pendiente: 1000, estado: "Parcial", comprobar: "" });
    expect(calcularCobro(1700, 1700, "2026-11-17", "Pablo")).toEqual({ pendiente: 0, estado: "Cobrado", comprobar: "" });
    expect(calcularCobro(null, null, null, "")).toEqual({ pendiente: 0, estado: "Revisar importe", comprobar: "Indicar importe" });
    expect(calcularCobro(100, 50, null, "Pablo").comprobar).toBe("Falta fecha cobro");
    expect(calcularCobro(100, 50, "2026-11-17", "").comprobar).toBe("Falta receptor");
    expect(calcularCobro(100, 150, "2026-11-17", "Pablo")).toEqual({ pendiente: 0, estado: "Cobrado", comprobar: "Exceso sobre pactado" });
    expect(calcularCobro(0.3, 0.1, "2026-11-17", "Pablo").pendiente).toBe(0.2);
  });

  it("GASTOS CLIENTES: comprobar", () => {
    expect(calcularGasto({ fecha: null, importe: null, pagadoPor: "", repercutir: "" })).toBe("");
    expect(calcularGasto({ fecha: null, importe: 5, pagadoPor: "", repercutir: "" })).toBe("Falta fecha");
    expect(calcularGasto({ fecha: "2026-11-01", importe: 5, pagadoPor: "", repercutir: "" })).toBe("Falta pagador");
    expect(calcularGasto({ fecha: "2026-11-01", importe: 5, pagadoPor: "Pablo", repercutir: "" })).toBe("Indica si repercute");
    expect(calcularGasto({ fecha: "2026-11-01", importe: 5, pagadoPor: "Pablo", repercutir: "No" })).toBe("");
  });

  it("normalizar compara como Excel (sin mayúsculas, acentos ni espacios de más)", () => {
    expect(normalizar("  CASA   Tomas ")).toBe(normalizar("Casa Tomás"));
    expect(revisionDe({ md5Checksum: "m", modifiedTime: "t" })).toBe("m");
    expect(revisionDe({})).toBe("");
  });
});

describe("autorización", () => {
  it("solo POST y solo super admin; sin autorizar no se toca Drive", async () => {
    expect((await manejador()(new Request("https://x.test/control-excel", { method: "OPTIONS" }))).headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await pedir({}, { metodo: "GET" })).status).toBe(405);
    expect((await pedir({ accion: "leer" }, { jwt: "" })).status).toBe(401);
    expect((await pedir({ accion: "leer" }, { jwt: "anon-jwt-publico" })).status).toBe(401);
    expect((await pedir({ accion: "leer" }, { jwt: "jwt-caducado" })).status).toBe(401);
    expect((await pedir({ accion: "leer" }, { jwt: "jwt-admin" })).status).toBe(403);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("petición sin acción o con una desconocida → 400", async () => {
    for (const cuerpo of [{}, { accion: 5 }, { accion: "borrar_todo" }, [1]]) {
      const r = await pedir<ErrorControlRespuesta>(cuerpo);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ ok: false, error: "peticion_invalida" });
    }
    expect(fetchSimulado).not.toHaveBeenCalled();
  });
});

describe("leer", () => {
  it("da el estado SOLO de Casa Tomás, calculado (no los valores guardados del Excel)", async () => {
    await conMovimientosDeNexo();
    const r = await pedir({ accion: "leer" });
    expect(r.status).toBe(200);
    const e = r.json;
    expect(e).toMatchObject({ ok: true, disponible: true, cliente: "Casa Tomás", revision: "rev-1", soloLectura: false });
    expect(e.archivo).toEqual({
      id: ID_EXCEL_POR_DEFECTO,
      nombre: "Control_OFICIOSOSIA.xlsm",
      modificado: "2026-11-17T06:55:01.000Z",
      url: `https://drive.google.com/file/d/${ID_EXCEL_POR_DEFECTO}/view?usp=drivesdk`,
    });
    expect(e.ficha).toEqual({ estado: "Activo", desde: "2026-11-09", instalacionPactada: 1500, cuotaPactada: 600, diaCobro: 28, notas: "Nota de prueba con acentos: instalación + mes" });
    expect(e.cobros.map((c) => [c.fila, c.tipo, c.detalle, c.pactado, c.cobrado, c.pendiente, c.estado])).toEqual([
      // El Excel tiene guardado 999 en H7 (viejo): manda la regla, 1500 − 0.
      [7, "Instalación", "Instalación inicial", 1500, null, 1500, "Pendiente"],
      [8, "Otro", "Extras de prueba", 300, null, 300, "Pendiente"],
      [9, "Mensualidad", "Noviembre", 600, null, 600, "Pendiente"],
    ]);
    expect(e.cobros[0]).toMatchObject({ fechaPrevista: "2026-11-13", fechaCobro: null, recibidoPor: "", metodo: "Efectivo", notas: "", comprobar: "" });
    expect(e.gastos.map((g) => [g.fila, g.proveedor, g.tipo, g.importe, g.repercutir])).toEqual([
      [7, "Herramientas iniciales", "Otros", 100.5, "No"],
      [8, "OpenAI", "IA", null, ""],
      [9, "Hostinger", "Dominio", 10.25, "Sí"],
      [10, "Hostinger", "Dominio", 2.5, "Sí"],
      [11, "Vercel", "Hosting", 20.75, "Sí"],
    ]);
    expect(e.gastos[2]).toMatchObject({ fecha: "2026-11-01", detalle: "Noviembre", pagadoPor: "Pablo", metodo: "Tarjeta", notas: "", comprobar: "" });
    expect(e.resumen).toEqual({
      cobradoTotal: 0, instalacionCobrada: 0, instalacionPendiente: 1500, cuotasCobradas: 0, reembolsosCobrados: 0, otrosCobrados: 0,
      pendienteCobro: 2400, cobrosPendientes: 3,
      // K7 del Excel dice 99,99 (viejo): 10,25 + 2,50 + 20,75.
      gastosRepercutibles: 33.5, costesPorRecuperar: 33.5, gastosTotal: 134, avisos: 0,
    });
    expect(e.listas).toEqual({
      estados: ["Activo", "Pausado", "Finalizado"],
      tiposCobro: ["Instalación", "Mensualidad", "Reembolso gastos", "Otro"],
      receptores: ["Caja común", "Miguel", "Pablo"],
      metodos: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
      tiposGasto: ["IA", "Hosting", "Dominio", "API", "Licencia", "Otros"],
      pagadores: ["Caja común", "Miguel", "Pablo"],
      metodosGasto: ["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"],
      repercutir: ["Sí", "No"],
    });
    expect(e.filasLibres).toEqual({ cobros: 20, gastos: 18 });
    // Nada de otros clientes ni datos internos.
    expect(r.texto).not.toContain("Nexo");
    expect(r.texto).not.toContain("filaCliente");
    expect(subidas()).toEqual([]);
  });

  it("el cliente se puede cambiar por configuración (otro proyecto, mismo Excel)", async () => {
    await conMovimientosDeNexo();
    const { json: e } = await pedir({ accion: "leer" }, { env: { ...SECRETOS, CONTROL_EXCEL_CLIENTE: "nexo" } });
    expect(e.cliente).toBe("Nexo");
    expect(e.ficha.estado).toBe("Pausado");
    expect(e.cobros.map((c) => [c.fila, c.cobrado, c.estado])).toEqual([[12, 100, "Cobrado"]]);
    // Cobrado sin fecha de cobro: el aviso del Excel.
    expect(e.cobros[0].comprobar).toBe("Falta fecha cobro");
    expect(e.gastos.map((g) => [g.fila, g.importe, g.comprobar])).toEqual([[14, 20, "Falta fecha"]]);
    expect(e.resumen).toMatchObject({ cobradoTotal: 100, cuotasCobradas: 100, gastosRepercutibles: 20, costesPorRecuperar: 20, avisos: 2 });
  });
});

describe("guardar", () => {
  it("alta de cobro: primera fila libre, el cliente lo pone el servidor y devuelve el estado nuevo", async () => {
    const antes = await leer();
    const r = await pedir({
      accion: "guardar_cobro",
      revision: antes.revision,
      cobro: { cliente: "Nexo", fechaPrevista: "2026-12-28", tipo: "mensualidad", detalle: "Diciembre", pactado: 600, metodo: "Bizum", notas: 'Con "comillas" & <signos>' },
    });
    expect(r.status).toBe(200);
    expect(r.json.revision).toBe("rev-2");
    expect(r.json.archivo.modificado).toBe("2026-11-17T06:55:02.000Z");
    expect(r.json.cobros).toHaveLength(4);
    expect(r.json.cobros[3]).toEqual({
      fila: 10, fechaPrevista: "2026-12-28", fechaCobro: null, tipo: "Mensualidad", detalle: "Diciembre", pactado: 600, cobrado: null,
      pendiente: 600, estado: "Pendiente", recibidoPor: "", metodo: "Bizum", notas: 'Con "comillas" & <signos>', comprobar: "",
    });
    expect(r.json.resumen.pendienteCobro).toBe(3000);
    expect(antes.filasLibres.cobros).toBe(21);
    expect(r.json.filasLibres.cobros).toBe(20);
    // Lo subido a Drive es un Excel que se vuelve a leer igual, con el cliente bien puesto.
    expect(subidas()).toHaveLength(1);
    const libro = await LibroXlsx.abrir(drive.bytes);
    const hoja = await libro.hoja("COBROS");
    expect(hoja.celda("C10")?.valor).toBe("Casa Tomás");
    expect(hoja.celda("H10")).toMatchObject({ formula: true, valor: 600 });
    expect(hoja.celda("I10")).toMatchObject({ formula: true, valor: "Pendiente" });
    expect((await estadoEnDrive()).cobros).toEqual(r.json.cobros);
  });

  it("«Marcar cobrado»: editar un cobro suyo actualiza estado, resumen y los valores guardados de las fórmulas", async () => {
    const antes = await leer();
    const c = antes.cobros[0];
    const r = await pedir({ accion: "guardar_cobro", revision: antes.revision, cobro: { ...c, cobrado: c.pactado, fechaCobro: "2026-11-17", recibidoPor: "Pablo" } });
    expect(r.status).toBe(200);
    expect(r.json.cobros[0]).toMatchObject({ fila: 7, cobrado: 1500, pendiente: 0, estado: "Cobrado", fechaCobro: "2026-11-17", recibidoPor: "Pablo", comprobar: "" });
    expect(r.json.resumen).toMatchObject({ cobradoTotal: 1500, instalacionCobrada: 1500, instalacionPendiente: 0, pendienteCobro: 900, cobrosPendientes: 2 });
    const libro = await LibroXlsx.abrir(drive.bytes);
    expect((await libro.hoja("COBROS")).celda("H7")).toMatchObject({ formula: true, valor: 0 });
    expect((await libro.hoja("COBROS")).celda("I7")).toMatchObject({ formula: true, valor: "Cobrado" });
    const clientes = await libro.hoja("CLIENTES");
    expect(clientes.celda("H7")).toMatchObject({ formula: true, valor: 1500 });
    expect(clientes.celda("I7")).toMatchObject({ formula: true, valor: 1500 });
    expect(clientes.celda("K7")).toMatchObject({ formula: true, valor: 33.5 });
    // La fila de otro cliente ni se ha mirado.
    expect(clientes.celda("A8")?.valor).toBe("Nexo");
    expect(clientes.celda("B8")?.valor).toBe("Pausado");
  });

  it("no deja tocar la fila de otro cliente ni una fila vacía como si fuera suya", async () => {
    await conMovimientosDeNexo();
    const antes = await leer();
    for (const peticion of [
      { accion: "guardar_cobro", cobro: { fila: 12, tipo: "Mensualidad", pactado: 1 } },
      { accion: "borrar_cobro", fila: 12 },
      { accion: "borrar_cobro", fila: 20 },
      { accion: "guardar_gasto", gasto: { fila: 14, proveedor: "x" } },
      { accion: "borrar_gasto", fila: 14 },
    ]) {
      const r = await pedir<ErrorControlRespuesta>({ ...peticion, revision: antes.revision });
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ ok: false, error: "fila_ajena" });
    }
    for (const fila of [6, 507, 7.5, "7", null]) {
      const r = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila, revision: antes.revision });
      expect(r.status).toBe(400);
    }
    expect(subidas()).toEqual([]);
    const libro = await LibroXlsx.abrir(drive.bytes);
    expect((await libro.hoja("COBROS")).celda("F12")?.valor).toBe(100);
  });

  it("si el Excel cambió desde la lectura → 409 y no se sube nada", async () => {
    const antes = await leer();
    drive.version = 5; // alguien lo ha guardado en Drive
    const r = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila: 8, revision: antes.revision });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ ok: false, error: "conflicto" });
    expect(r.json.mensaje).toMatch(/Recarga/);
    const sinRevision = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila: 8 });
    expect(sinRevision.status).toBe(400);
    expect(subidas()).toEqual([]);
  });

  it("valida importes, fechas, desplegables y textos antes de escribir", async () => {
    const { revision } = await leer();
    const malos: Array<[Record<string, unknown>, RegExp]> = [
      [{ accion: "guardar_cobro", cobro: { tipo: "Propina", pactado: 10 } }, /no es un valor de «Tipo de cobro»/],
      [{ accion: "guardar_cobro", cobro: { pactado: 10 } }, /Elige «Tipo de cobro»/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: -1 } }, /negativo/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 0 } }, /importe pactado/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro" } }, /importe pactado/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: "100" } }, /número/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 1e9 } }, /demasiado grande/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 10, cobrado: "5" } }, /número/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 10, fechaCobro: "2026-02-30" } }, /fecha válida/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 10, fechaPrevista: "1899-01-01" } }, /fecha válida|fuera de rango/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 10, recibidoPor: "Juan" } }, /Recibido por/],
      [{ accion: "guardar_cobro", cobro: { tipo: "Otro", pactado: 10, notas: "x".repeat(501) } }, /demasiado largo/],
      [{ accion: "guardar_cobro", cobro: "nada" }, /Faltan los datos/],
      [{ accion: "guardar_gasto", gasto: { importe: 5 } }, /proveedor/],
      [{ accion: "guardar_gasto", gasto: { proveedor: "OpenAI", tipo: "Luz" } }, /Tipo de gasto/],
      [{ accion: "guardar_gasto", gasto: { proveedor: "OpenAI", repercutir: "Quizá" } }, /Repercutir/],
      [{ accion: "guardar_gasto", gasto: { proveedor: 7 } }, /texto/],
      [{ accion: "guardar_ficha", ficha: { estado: "Moroso" } }, /Estado/],
      [{ accion: "guardar_ficha", ficha: { estado: "Activo", diaCobro: 32 } }, /entre 1 y 31/],
      [{ accion: "guardar_ficha", ficha: { estado: "Activo", cuotaPactada: -5 } }, /negativo/],
      [{ accion: "guardar_ficha" }, /Faltan los datos/],
    ];
    for (const [peticion, mensaje] of malos) {
      const r = await pedir<ErrorControlRespuesta>({ ...peticion, revision });
      expect([r.status, r.json.error], JSON.stringify(peticion)).toEqual([400, "datos_invalidos"]);
      expect(r.json.mensaje, JSON.stringify(peticion)).toMatch(mensaje);
    }
    expect(subidas()).toEqual([]);
    expect(drive.bytes).toEqual(FIXTURE);
  });

  it("borrar un cobro vacía sus datos y deja las fórmulas; la fila queda libre para el siguiente", async () => {
    const antes = await leer();
    const r = await pedir({ accion: "borrar_cobro", fila: 8, revision: antes.revision });
    expect(r.status).toBe(200);
    expect(r.json.cobros.map((c) => c.fila)).toEqual([7, 9]);
    expect(r.json.resumen.pendienteCobro).toBe(2100);
    const hoja = await (await LibroXlsx.abrir(drive.bytes)).hoja("COBROS");
    for (const col of ["A", "B", "C", "D", "E", "F", "G", "J", "K", "L"]) expect(hoja.celda(`${col}8`)?.valor, col).toBeNull();
    for (const col of ["H", "I", "M"]) expect(hoja.celda(`${col}8`), col).toMatchObject({ formula: true, valor: null });
    const alta = await pedir({ accion: "guardar_cobro", revision: r.json.revision, cobro: { tipo: "Reembolso gastos", detalle: "Noviembre", pactado: 33.5 } });
    expect(alta.json.cobros.map((c) => c.fila)).toEqual([7, 8, 9]);
    expect(alta.json.revision).toBe("rev-3");
  });

  it("gastos: alta, edición y borrado", async () => {
    let e = await leer();
    let r = await pedir({ accion: "guardar_gasto", revision: e.revision, gasto: { fecha: "2026-11-17", proveedor: "Supabase", tipo: "hosting", detalle: "Noviembre", importe: 25.499, pagadoPor: "Miguel", repercutir: "sí", metodo: "Tarjeta" } });
    expect(r.status).toBe(200);
    e = r.json;
    expect(e.gastos[5]).toEqual({ fila: 12, fecha: "2026-11-17", proveedor: "Supabase", tipo: "Hosting", detalle: "Noviembre", importe: 25.5, pagadoPor: "Miguel", repercutir: "Sí", metodo: "Tarjeta", notas: "", comprobar: "" });
    expect(e.resumen).toMatchObject({ gastosRepercutibles: 59, costesPorRecuperar: 59, gastosTotal: 159.5 });
    // Completar el de OpenAI que estaba a medias (sin importe).
    r = await pedir({ accion: "guardar_gasto", revision: e.revision, gasto: { ...e.gastos[1], importe: 12.3 } });
    e = r.json;
    expect(e.gastos[1]).toMatchObject({ fila: 8, proveedor: "OpenAI", importe: 12.3, comprobar: "Falta pagador" });
    expect(e.resumen.avisos).toBe(1);
    r = await pedir({ accion: "borrar_gasto", fila: 10, revision: e.revision });
    e = r.json;
    expect(e.gastos.map((g) => g.fila)).toEqual([7, 8, 9, 11, 12]);
    expect(e.resumen.gastosRepercutibles).toBe(56.5);
    expect(e.filasLibres.gastos).toBe(19);
    const libro = await LibroXlsx.abrir(drive.bytes);
    expect((await libro.hoja("GASTOS CLIENTES")).celda("B12")?.valor).toBe("Casa Tomás");
    expect((await libro.hoja("GASTOS CLIENTES")).celda("K10")?.formula).toBe(true);
    expect((await libro.hoja("CLIENTES")).celda("K7")).toMatchObject({ formula: true, valor: 56.5 });
    expect(subidas()).toHaveLength(3);
  });

  it("ficha: guarda estado, fecha, importes, día y notas (y vacía lo que llega vacío)", async () => {
    const e = await leer();
    const r = await pedir({ accion: "guardar_ficha", revision: e.revision, ficha: { estado: "pausado", desde: "2026-10-01", instalacionPactada: 1800, cuotaPactada: 650.5, diaCobro: 5, notas: "  Nueva nota  " } });
    expect(r.status).toBe(200);
    expect(r.json.ficha).toEqual({ estado: "Pausado", desde: "2026-10-01", instalacionPactada: 1800, cuotaPactada: 650.5, diaCobro: 5, notas: "Nueva nota" });
    expect(r.json.resumen.instalacionPendiente).toBe(1800);
    const r2 = await pedir({ accion: "guardar_ficha", revision: r.json.revision, ficha: { estado: "Activo", desde: null, instalacionPactada: null, cuotaPactada: null, diaCobro: null, notas: "" } });
    expect(r2.json.ficha).toEqual({ estado: "Activo", desde: null, instalacionPactada: null, cuotaPactada: null, diaCobro: null, notas: "" });
    // El nombre del cliente (columna A) no se toca nunca.
    expect((await (await LibroXlsx.abrir(drive.bytes)).hoja("CLIENTES")).celda("A7")?.valor).toBe("Casa Tomás");
  });

  it("cuando no quedan filas libres lo dice y no sube nada", async () => {
    const libro = await LibroXlsx.abrir(drive.bytes);
    const hoja = await libro.hoja("COBROS");
    hoja.escribir(Array.from({ length: 21 }, (_, i) => ({ ref: `E${10 + i}`, valor: "ocupada" })));
    drive.bytes = await libro.guardar();
    const e = await leer();
    expect(e.filasLibres.cobros).toBe(0);
    const r = await pedir<ErrorControlRespuesta>({ accion: "guardar_cobro", revision: e.revision, cobro: { tipo: "Otro", pactado: 5 } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("sin_filas");
    expect(subidas()).toEqual([]);
  });
});

describe("cuando no se puede usar el Excel", () => {
  it("sin secretos de Google (la demo): «sin_config» limpio, sin llamar a nadie", async () => {
    const r = await pedir<ControlNoDisponible>({ accion: "leer" }, { env: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, disponible: false, motivo: "sin_config", cliente: "Casa Tomás" });
    expect(r.json.mensaje).toMatch(/cuenta de Google/);
    const g = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila: 8, revision: "x" }, { env: {} });
    expect(g.status).toBe(409);
    expect(g.json).toMatchObject({ ok: false, error: "no_disponible" });
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("refresh token rechazado por Google → «sin_config» con qué hacer", async () => {
    drive.tokenRechazado = true;
    const r = await pedir<ControlNoDisponible>({ accion: "leer" });
    expect(r.json).toMatchObject({ disponible: false, motivo: "sin_config" });
    expect(r.json.mensaje).toMatch(/renovar/);
  });

  it("la cuenta del panel no ve el fichero → «sin_acceso» con la cuenta con la que compartirlo", async () => {
    drive.existe = false;
    const r = await pedir<ControlNoDisponible>({ accion: "leer" });
    expect(r.json).toMatchObject({ ok: true, disponible: false, motivo: "sin_acceso", cuentaGoogle: "panel@oficiososia.test" });
    expect(r.json.mensaje).toMatch(/panel@oficiososia\.test.*Compártelo.*editor/);
    // Con el permiso limitado (drive.file) se explica la trampa.
    olvidarTokenDrive();
    drive.alcance = "https://www.googleapis.com/auth/drive.file";
    const limitado = await pedir<ControlNoDisponible>({ accion: "leer" });
    expect(limitado.json.mensaje).toMatch(/drive\.file/);
    drive.existe = true;
    drive.enPapelera = true;
    expect((await pedir<ControlNoDisponible>({ accion: "leer" })).json.mensaje).toMatch(/papelera/);
  });

  it("solo lectura: se ve todo, pero guardar da 403 con la cuenta a la que dar permiso", async () => {
    drive.puedeEditar = false;
    const e = await leer();
    expect(e).toMatchObject({ disponible: true, soloLectura: true, cuentaGoogle: "panel@oficiososia.test" });
    expect(e.cobros).toHaveLength(3);
    const r = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila: 8, revision: e.revision });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ ok: false, error: "solo_lectura" });
    expect(r.json.mensaje).toMatch(/panel@oficiososia\.test/);
    expect(subidas()).toEqual([]);
  });

  it("el cliente no está en CLIENTES → «sin_cliente»", async () => {
    const r = await pedir<ControlNoDisponible>({ accion: "leer" }, { env: { ...SECRETOS, CONTROL_EXCEL_CLIENTE: "Bar Pepe" } });
    expect(r.json).toMatchObject({ disponible: false, motivo: "sin_cliente", cliente: "Bar Pepe" });
    expect(r.json.mensaje).toMatch(/«Bar Pepe» no está en la hoja CLIENTES/);
  });

  it("si alguien cambia las columnas del Excel → «formato» y no se escribe a ciegas", async () => {
    const libro = await LibroXlsx.abrir(drive.bytes);
    (await libro.hoja("COBROS")).escribir([{ ref: "G6", valor: "Descuento (€)" }]);
    drive.bytes = await libro.guardar();
    const r = await pedir<ControlNoDisponible>({ accion: "leer" });
    expect(r.json).toMatchObject({ disponible: false, motivo: "formato" });
    expect(r.json.mensaje).toMatch(/G6.*Descuento/);
    const g = await pedir<ErrorControlRespuesta>({ accion: "borrar_cobro", fila: 8, revision: "rev-1" });
    expect(g.status).toBe(409);
    expect(subidas()).toEqual([]);
    // Y si no es un Excel.
    drive.bytes = new TextEncoder().encode("<html>no soy un excel, soy una página de error bastante larga</html>");
    expect((await pedir<ControlNoDisponible>({ accion: "leer" })).json).toMatchObject({ disponible: false, motivo: "formato" });
  });

  it("fallo de Google Drive al descargar → 502 sin detalles técnicos", async () => {
    drive.fallaDescarga = true;
    const r = await pedir<ErrorControlRespuesta>({ accion: "leer" });
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ ok: false, error: "drive" });
    expect(r.json.mensaje).not.toMatch(/Internal Error|500/);
  });
});

it("ningún secreto ni token sale en las respuestas", async () => {
  const respuestas: string[] = [];
  const e = await pedir({ accion: "leer" });
  respuestas.push(e.texto);
  respuestas.push((await pedir({ accion: "guardar_cobro", revision: e.json.revision, cobro: { tipo: "Otro", pactado: 5 } })).texto);
  drive.existe = false;
  respuestas.push((await pedir({ accion: "leer" })).texto);
  drive.existe = true;
  drive.puedeEditar = false;
  respuestas.push((await pedir({ accion: "leer" })).texto);
  for (const texto of respuestas) {
    for (const secreto of [...Object.values(SECRETOS), TOKEN_ACCESO, BASE_ENV.SUPABASE_SERVICE_ROLE_KEY]) expect(texto).not.toContain(secreto);
  }
});
