/**
 * Super Admin › Logs › Errores e incidencias: filtros (ocultar bots y pruebas,
 * tipo, búsqueda en la pila), causa conocida y texto para copiar.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsultaFiltrable, EventoWeb, FiltrosIncidencias, IncidenciaWeb } from "@/hooks/useLogsWeb";

const llamadas: FiltrosIncidencias[] = [];
let filas: IncidenciaWeb[] = [];
vi.mock("@/hooks/useLogsWeb", async (original) => {
  const real = await original<typeof import("@/hooks/useLogsWeb")>();
  return {
    ...real,
    useIncidencias: (f: FiltrosIncidencias) => {
      llamadas.push(f);
      return { data: { filas, total: filas.length }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
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
    in: (c, v) => (pasos.push(`in ${c}=${v.join(",")}`), q),
    gt: (c, v) => (pasos.push(`gt ${c}>${v}`), q),
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
});

describe("pestaña de incidencias", () => {
  beforeEach(() => {
    llamadas.length = 0;
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
    expect(screen.getByText("solo bots o pruebas")).toBeInTheDocument();
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
