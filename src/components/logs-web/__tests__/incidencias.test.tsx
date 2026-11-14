/**
 * Super Admin › Logs › Errores e incidencias: filtros (ocultar bots y pruebas,
 * tipo, búsqueda en la pila, origen), colores por origen, cuentas aparte,
 * causa conocida y texto para copiar.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsultaFiltrable, EventoWeb, FiltrosIncidencias, IncidenciaWeb } from "@/hooks/useLogsWeb";

const llamadas: FiltrosIncidencias[] = [];
let filas: IncidenciaWeb[] = [];
let conteos: { web: number; externo: number; no_depende: number } | undefined;
let sinOrigen = false;
vi.mock("@/hooks/useLogsWeb", async (original) => {
  const real = await original<typeof import("@/hooks/useLogsWeb")>();
  return {
    ...real,
    useIncidencias: (f: FiltrosIncidencias) => {
      llamadas.push(f);
      return { data: { filas, total: filas.length, conteos, sinOrigen }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    },
  };
});

const { aplicarFiltrosIncidencias } = await import("@/hooks/useLogsWeb");
const { causaDeFila, repartoTexto, textoParaCopiar } = await import("../calculos");
const { PestanaIncidencias } = await import("../PestanaIncidencias");

const inc = (o: Partial<IncidenciaWeb> = {}): IncidenciaWeb => ({
  id: 6, entorno: "produccion", huella: "a".repeat(32), titulo: "job startup timeout · cron:reanudar-trabajos-ocr", tipo: "error_integracion",
  fuente: "integracion", proyecto: "supabase", gravedad: "error", estado: "abierta", primera_vez: "2026-11-08T19:56:00Z", ultima_vez: "2026-11-08T21:53:00Z",
  ocurrencias: 49, sesiones_afectadas: 0, ocurrencias_ventana: 0, sesiones_ventana: 0, ocurrencias_24h: 0, rutas: [], version_primera: null, version_ultima: null,
  despliegue_ultimo: null, mensaje: "job startup timeout", pila: null, requiere_ticket: true, motivo_ticket: null, linear_estado: "creado", linear_issue_id: "x",
  linear_identificador: "PRUEBA-1", linear_url: null, linear_estado_remoto: null, linear_destino: "prueba", linear_intentos: 0, linear_ultimo_error: null,
  linear_proximo_intento: null, linear_creado_en: null, linear_pendiente_reapertura: false, analisis_ia: null, analisis_ia_en: null, analisis_ia_error: null,
  resuelta_en: null, reabierta_veces: 0, nota: null, ...o,
} as IncidenciaWeb);

function consultaFalsa() {
  const pasos: string[] = [];
  const q: ConsultaFiltrable = {
    eq: (c, v) => (pasos.push(`eq ${c}=${v}`), q),
    neq: (c, v) => (pasos.push(`neq ${c}=${v}`), q),
    in: (c, v) => (pasos.push(`in ${c}=${v.join(",")}`), q),
    gt: (c, v) => (pasos.push(`gt ${c}>${v}`), q),
    lte: (c, v) => (pasos.push(`lte ${c}<=${v}`), q),
    or: (f) => (pasos.push(`or ${f}`), q),
  };
  return { q, pasos };
}

describe("filtros de incidencias", () => {
  it("ocultar ruido = solo las que tienen alguna ocurrencia real; tipo; búsqueda también en la pila", () => {
    const { q, pasos } = consultaFalsa();
    aplicarFiltrosIncidencias(q, { entorno: "produccion", estado: "activas", gravedad: null, fuente: null, tipo: "error_react", ocultarRuido: true, texto: "preload, (css)" });
    expect(pasos).toEqual([
      "eq entorno=produccion",
      "in estado=nueva,abierta,reabierta",
      "eq tipo=error_react",
      "gt ocurrencias>0",
      "or titulo.ilike.%preload   css%,mensaje.ilike.%preload   css%,linear_identificador.ilike.%preload   css%,pila.ilike.%preload   css%",
    ]);
  });
  it("sin filtros no restringe nada", () => {
    const { q, pasos } = consultaFalsa();
    aplicarFiltrosIncidencias(q, { entorno: null, estado: null, gravedad: null, fuente: null, texto: "  " });
    expect(pasos).toEqual([]);
  });
  it("origen: por defecto fallos de la web y externos; cada grupo; todos", () => {
    const pasos = (origen: FiltrosIncidencias["origen"], ocultarRuido = false) => {
      const c = consultaFalsa();
      aplicarFiltrosIncidencias(c.q, { entorno: null, estado: null, gravedad: null, fuente: null, texto: "", origen, ocultarRuido });
      return c.pasos;
    };
    expect(pasos("web_externos")).toEqual(["lte origen_prioridad<=2"]);
    expect(pasos("web")).toEqual(["eq origen=web"]);
    expect(pasos("externo")).toEqual(["eq origen=externo"]);
    expect(pasos("no_depende")).toEqual(["eq origen_prioridad=3"]);
    expect(pasos(null)).toEqual([]);
    expect(pasos(undefined)).toEqual([]);
  });
  it("«Ocultar las de solo bots y pruebas» también quita las de origen «Bots y pruebas»", () => {
    const c = consultaFalsa();
    aplicarFiltrosIncidencias(c.q, { entorno: null, estado: null, gravedad: null, fuente: null, texto: "", origen: "no_depende", ocultarRuido: true });
    expect(c.pasos).toEqual(["gt ocurrencias>0", "eq origen_prioridad=3", "neq origen=bots"]);
    const d = consultaFalsa();
    aplicarFiltrosIncidencias(d.q, { entorno: null, estado: null, gravedad: null, fuente: null, texto: "", origen: "web_externos", ocultarRuido: true });
    expect(d.pasos).toEqual(["gt ocurrencias>0", "lte origen_prioridad<=2"]);
  });
});

describe("pestaña de incidencias", () => {
  beforeEach(() => {
    llamadas.length = 0;
    conteos = undefined;
    sinOrigen = false;
    filas = [inc(), inc({ id: 20, titulo: "Página no encontrada", tipo: "error_404", fuente: "navegador", ocurrencias: 0, mensaje: "Página no encontrada" })];
  });
  it("por defecto oculta lo de solo bots/pruebas y se puede ver", () => {
    render(<PestanaIncidencias desde="a" hasta="b" entorno="produccion" autoRefresco={false} onAbrirIncidencia={vi.fn()} onAbrirSesion={vi.fn()} />);
    expect(llamadas.at(-1)?.ocultarRuido).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /solo bots y pruebas/i }));
    expect(llamadas.at(-1)?.ocultarRuido).toBe(false);
  });
  it("marca la causa conocida y las de solo bots", () => {
    render(<PestanaIncidencias desde="a" hasta="b" entorno="produccion" autoRefresco={false} onAbrirIncidencia={vi.fn()} onAbrirSesion={vi.fn()} />);
    expect(screen.getByTestId("causa-conocida-fila")).toHaveTextContent(/pg_cron no pudo arrancar/);
    expect(screen.getAllByTestId("badge-origen").map((b) => b.textContent)).toEqual(["Servicio externo · Supabase", "Bots y pruebas"]);
  });
});

describe("colores y cuentas por origen", () => {
  const captura = (id: number, endpoint: string) => inc({
    id, titulo: `Sin respuesta de ${endpoint} (sin conexión) · ${endpoint}`, tipo: "error_peticion", fuente: "navegador", mensaje: `Sin respuesta de ${endpoint} (sin conexión)`,
    ocurrencias: 1, sesiones_afectadas: 1, rutas: [{ ruta: "/", n: 1 }], linear_estado: "sin_ticket", linear_identificador: null, linear_destino: null, origen: "conexion",
  });
  beforeEach(() => {
    llamadas.length = 0;
    sinOrigen = false;
    conteos = { web: 1, externo: 1, no_depende: 4 };
    filas = [
      inc({ id: 1, titulo: "TypeError: vino.precio is null", tipo: "error_js", fuente: "navegador", mensaje: "TypeError: vino.precio is null", origen: "web", gravedad: "critico" }),
      inc({ id: 2, titulo: "Google Maps JavaScript API error", tipo: "error_js", fuente: "navegador", mensaje: "Google Maps JavaScript API error", origen: "externo", origen_proveedor: "Google Maps" }),
      ...["rest:novedades", "rest:configuracion_web", "rest:tapas", "rest:menus_diarios"].map((e, n) => captura(30 + n, e)),
    ];
  });
  const pintar = () => render(<PestanaIncidencias desde="a" hasta="b" entorno="demo" autoRefresco={false} onAbrirIncidencia={vi.fn()} onAbrirSesion={vi.fn()} />);

  it("por defecto pide fallos de la web y externos, con las cuentas de cada color", () => {
    pintar();
    expect(llamadas.at(-1)?.origen).toBe("web_externos");
    expect(screen.getByTestId("conteo-web")).toHaveTextContent("Fallos de la web: 1");
    expect(screen.getByTestId("conteo-externo")).toHaveTextContent("Externos: 1");
    expect(screen.getByTestId("conteo-no_depende")).toHaveTextContent("No dependen de la web: 4");
    expect(screen.getByTestId("leyenda-origen")).toHaveTextContent(/Fallos de la web:.*Externos:.*No dependen de la web:/);
  });
  it("cada fila con su color: rojo la de la web, ámbar la externa, gris las de conexión (las de la captura)", () => {
    pintar();
    const insignias = screen.getAllByTestId("badge-origen");
    expect(insignias.map((b) => [b.dataset.origen, b.dataset.grupo])).toEqual([
      ["web", "web"], ["externo", "externo"], ["conexion", "no_depende"], ["conexion", "no_depende"], ["conexion", "no_depende"], ["conexion", "no_depende"],
    ]);
    expect(insignias[0].className).toMatch(/destructive/);
    expect(insignias[1].className).toMatch(/amber/);
    expect(insignias[2].className).toMatch(/slate/);
    expect(insignias[1]).toHaveTextContent("Servicio externo · Google Maps");
    expect(insignias[2]).toHaveTextContent("Conexión del visitante");
    // «Crítica» en rojo solo para un fallo de la web; las de conexión ya no llevan «Error» en rojo.
    expect(screen.getAllByText("Crítica")).toHaveLength(1);
    const filasTabla = screen.getAllByTestId("fila-incidencia");
    expect(within(filasTabla[2]).getByTestId("sencillo-fila")).toHaveTextContent(/Casi siempre es la conexión del visitante/);
    expect(within(filasTabla[1]).getByTestId("sencillo-fila")).toHaveTextContent("No es un fallo de nuestro código: depende de Google Maps.");
  });
  it("las cuentas filtran por su color y el filtro de origen tiene «todos»", () => {
    pintar();
    fireEvent.click(screen.getByTestId("conteo-no_depende"));
    expect(llamadas.at(-1)?.origen).toBe("no_depende");
    expect(screen.getByTestId("conteo-no_depende")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("conteo-no_depende")); // otra vez: vuelve al de siempre
    expect(llamadas.at(-1)?.origen).toBe("web_externos");
    expect(screen.getByRole("combobox", { name: "Origen" })).toBeInTheDocument();
  });
  it("debajo, plegadas: «No dependen de la web (N)» lleva a verlas", () => {
    pintar();
    fireEvent.click(screen.getByTestId("ver-no-dependen"));
    expect(llamadas.at(-1)?.origen).toBe("no_depende");
  });
  it("sin la migración del origen: sin filtro ni cuentas de origen (como antes)", () => {
    sinOrigen = true;
    conteos = undefined;
    pintar();
    expect(screen.queryByTestId("resumen-origenes")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Origen" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("ver-no-dependen")).not.toBeInTheDocument();
  });
});

describe("causa, repartos y texto para copiar", () => {
  it("la causa sale del título «mensaje · objetivo» si hace falta", () => {
    expect(causaDeFila(inc({ tipo: "error_recurso", fuente: "navegador", mensaje: null, titulo: "error_recurso · https://w.es/assets/client-CHi__bHm.js" }))?.id).toBe("chunk_caducado");
    expect(causaDeFila(inc({ tipo: "error_js", mensaje: "TypeError: x is null", titulo: "TypeError: x is null" }))).toBeNull();
  });
  it("reparto en porcentajes", () => {
    expect(repartoTexto([{ n: "Safari" }, { n: "Safari" }, { n: "Chrome" }, { n: null }], (f) => f.n)).toBe("Safari 50 % · Chrome 25 % · desconocido 25 %");
    expect(repartoTexto([], () => "x")).toBe("—");
  });
  it("texto para copiar: error completo, pila y datos técnicos de la ocurrencia", () => {
    const e = { ocurrido_en: "2026-11-10T01:26:53Z", ruta: "/en", objetivo: "novedades", navegador: "Chrome", so: "Android", dispositivo: "movil", version: "1.1.1",
      propiedades: { componente: "novedades" }, mensaje: "TypeError: Failed to fetch dynamically imported module", pila: "TypeError…\nat Lazy" } as unknown as EventoWeb;
    const t = textoParaCopiar(inc({ id: 10, titulo: "TypeError: Failed…", tipo: "error_react", rutas: [{ ruta: "/en", n: 1 }] }), e);
    expect(t).toContain("Incidencia #10");
    expect(t).toContain("/en · novedades · Chrome · Android · movil · v1.1.1");
    expect(t).toContain('Datos: {"componente":"novedades"}');
    expect(t).toContain("at Lazy");
  });
});
