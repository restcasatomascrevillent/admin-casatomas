/**
 * Pantalla «Estudio» (inicio de Instagram) con Supabase, permisos y la
 * función de métricas simulados (sin red): la semana con miniaturas, las
 * próximas publicaciones (sin las ya publicadas), 3 cifras con su tendencia,
 * los encargos abiertos (sin los cerrados) y la sugerencia de la semana; los
 * clics llevan a la pestaña o pieza que toca y la marca de la barra filtra.
 */
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sb = vi.hoisted(() => ({ datos: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "lt", "lte", "order", "limit", "not", "eq"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: sb.datos[tabla] ?? [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) },
      from: consulta,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: (k: string) => ({ canAccess: k === "marketing", loading: false }) }));

import { EstudioInstagram, cifrasEstudio, tituloSemana } from "../EstudioInstagram";
import { URL_METRICAS } from "@/components/instagram/metricas/api";
import { textoIndicador } from "@/components/instagram/BarraInstagram";
import type { DatosMetricas } from "@/components/instagram/metricas/tipos";

const AHORA = new Date("2026-11-05T10:00:00Z"); // jueves

const PIEZA = { marca: "casa-tomas", formato: "post", plantilla: "ct-foto-titular", imagen_ruta: null, estado: "generada" };
const c = (actual: number, anterior: number, variacion: number) => ({ actual, anterior, variacion });
const METRICAS: Partial<DatosMetricas> = {
  igUserId: "1",
  hoy: "2026-11-05",
  ultimoDia: "2026-11-04",
  resumen: {
    d7: null as never,
    d28: {
      dias: 28, desde: "2026-10-08", hasta: "2026-11-04", diasConDatos: 28, diasConDatosAnterior: 28,
      metricas: {
        alcance: c(18420, 16446, 12), visualizaciones: c(1, 1, 0), interacciones: c(1236, 1144, 8), cuentasInteraccion: c(1, 1, 0),
        visitasPerfil: c(1, 1, 0), toquesEnlaces: c(1, 1, 0), seguidores: { ...c(1500, 1358, -4), cambio: 142 },
      },
    },
  },
  serie: [
    { fecha: "2026-11-03", alcance: 500, seguidores: 1490, visualizaciones: 1, interacciones: 30 },
    { fecha: "2026-11-04", alcance: 700, seguidores: 1500, visualizaciones: 1, interacciones: 45 },
  ],
  publicaciones: [],
  ultimaCaptura: null,
  ultimaCorrecta: null,
};

const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  sb.datos = {
    instagram_programaciones: [
      { id: "a", pieza_id: "p1", marca: "casa-tomas", programada_para: "2026-11-06T12:00:00Z", estado: "programada", intentos: 0, ultimo_error: null, pieza: { ...PIEZA, id: "p1", datos: { titular: "Cocido del viernes" } } },
      { id: "t", pieza_id: "p3", marca: "touza", programada_para: "2026-11-07T20:00:00Z", estado: "programada", intentos: 0, ultimo_error: null, pieza: { ...PIEZA, marca: "touza", id: "p3", datos: { titular: "Noche de cócteles" } } },
    ],
    instagram_piezas: [
      { ...PIEZA, id: "p2", estado: "publicada", datos: { titular: "Pulpo del martes" }, publicada_at: "2026-11-03T12:00:00Z" },
      { ...PIEZA, id: "b1", estado: "borrador", datos: { titular: "Borrador de setas" }, fecha_prevista: "2026-11-10T12:00:00Z", programaciones: [] },
    ],
    instagram_encargos: [
      { id: "e1", numero: 1, estado: "para_revisar", modo: "oficiosos", formato: "reel", titulo: "Reel del mar", marca: "casa-tomas", fecha_deseada: "2026-11-09", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-04T10:00:00Z" },
      { id: "e2", numero: 2, estado: "publicado", modo: "automatico", formato: "post", titulo: "Ya publicado", marca: "casa-tomas", fecha_deseada: "2026-11-01", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" },
    ],
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).startsWith(URL_METRICAS) ? json({ ok: true, ...METRICAS }) : new Response("no", { status: 404 }))));
});

function pintar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const props = () => ({
  marca: "todas" as const,
  onIr: vi.fn(),
  onVerDia: vi.fn(),
  onAbrirPieza: vi.fn(),
  onNuevaPieza: vi.fn(),
  onCrearIdea: vi.fn(),
  onAbrirEncargo: vi.fn(),
  onPedirEncargo: vi.fn(),
});

describe("EstudioInstagram", () => {
  it("la semana con miniaturas, las próximas (sin las publicadas), 3 cifras y los encargos abiertos", async () => {
    const p = props();
    pintar(<EstudioInstagram {...p} />);
    expect(screen.getByRole("heading", { name: "Semana del 2 al 8 de noviembre" })).toBeInTheDocument();

    // Semana: la publicada del martes y las dos programadas (viernes y sábado); el borrador del 10 cae en la siguiente.
    await waitFor(() => expect(screen.getAllByTestId("mini-semana")).toHaveLength(3));
    expect(screen.getAllByTestId("mini-semana").map((m) => m.getAttribute("data-estado")).sort()).toEqual(["programada", "programada", "publicada"]);

    // Próximas: programadas y borradores con fecha, en orden; la publicada no.
    const proximas = screen.getByTestId("proximas-estudio");
    const filas = within(proximas).getAllByRole("button");
    expect(filas.map((f) => f.textContent)).toEqual([
      expect.stringContaining("Cocido del viernes"),
      expect.stringContaining("Noche de cócteles"),
      expect.stringContaining("Borrador de setas"),
    ]);
    expect(within(filas[0]).getByText("Programada")).toBeInTheDocument();
    expect(within(filas[2]).getByText("Borrador")).toBeInTheDocument();
    expect(within(proximas).queryByText("Pulpo del martes")).toBeNull();

    // Tres cifras de 28 días con su tendencia.
    const cifras = screen.getByTestId("cifras-estudio");
    await within(cifras).findByText("Alcance");
    expect(cifras).toHaveTextContent(/Alcance18\.?420\+12 %/);
    expect(cifras).toHaveTextContent(/Interacciones1\.?236\+8 %/);
    expect(cifras).toHaveTextContent(/Seguidores nuevos\+142−4 %/);

    // Encargos abiertos: el que espera tu revisión, no el publicado.
    const encargos = screen.getByTestId("encargos-estudio");
    expect(await within(encargos).findByText("Reel del mar")).toBeInTheDocument();
    expect(within(encargos).queryByText("Ya publicado")).toBeNull();
    expect(screen.getByText(/espera tu revisión/).closest("h2")).toHaveTextContent("Encargos abiertos · 1 espera tu revisión");

    // Sugerencia de la semana: la IA solo al pedirla.
    expect(within(screen.getByTestId("sugerencia-semana")).getByRole("button", { name: "Pedir ideas a la IA" })).toBeInTheDocument();
  });

  it("cada clic lleva a donde toca", async () => {
    const p = props();
    pintar(<EstudioInstagram {...p} />);
    const proximas = await screen.findByTestId("proximas-estudio");
    fireEvent.click(await within(proximas).findByText("Cocido del viernes"));
    expect(p.onAbrirPieza).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /^vie 6: 1 pieza\. Ver el día/ }));
    expect(p.onVerDia).toHaveBeenCalledWith("2026-11-06");
    fireEvent.click(screen.getByRole("button", { name: /Ver el mes/ }));
    expect(p.onIr).toHaveBeenCalledWith("calendario");
    fireEvent.click(screen.getByRole("button", { name: /Nueva pieza/ }));
    expect(p.onNuevaPieza).toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Reel del mar"));
    expect(p.onAbrirEncargo).toHaveBeenCalledWith("e1");
    fireEvent.click(screen.getByRole("button", { name: "Pedir un vídeo o una pieza" }));
    expect(p.onPedirEncargo).toHaveBeenCalled();
  });

  it("la marca de la barra filtra la semana, las próximas y los encargos", async () => {
    pintar(<EstudioInstagram {...props()} marca="touza" />);
    const proximas = await screen.findByTestId("proximas-estudio");
    await within(proximas).findByText("Noche de cócteles");
    expect(within(proximas).queryByText("Cocido del viernes")).toBeNull();
    expect(screen.getAllByTestId("mini-semana")).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByTestId("encargos-estudio")).getByText("No hay encargos abiertos.")).toBeInTheDocument());
  });
});

describe("piezas puras del Estudio", () => {
  it("indicador «● @cuenta» de la barra: la cuenta de la marca elegida, o la general", () => {
    const estado = { ok: true, cuenta: { username: "oficiososia" }, cuentasPorMarca: [{ marca: "touza", username: "touza_pruebas" }] };
    expect(textoIndicador({ estado, cargando: false, error: null }, "todas")).toEqual({ texto: "@oficiososia", tono: "ok" });
    expect(textoIndicador({ estado, cargando: false, error: null }, "touza")).toEqual({ texto: "@touza_pruebas", tono: "ok" });
    expect(textoIndicador({ estado: { ...estado, ok: false }, cargando: false, error: null }, "casa-tomas")).toEqual({ texto: "@oficiososia", tono: "aviso" });
    expect(textoIndicador({ estado: null, cargando: true, error: null }, "todas").texto).toBe("Comprobando…");
    expect(textoIndicador({ estado: null, cargando: false, error: new Error("x") }, "todas")).toEqual({ texto: "Sin comprobar", tono: "mal" });
  });

  it("tituloSemana, también entre dos meses", () => {
    expect(tituloSemana("2026-11-02")).toBe("Semana del 2 al 8 de noviembre");
    expect(tituloSemana("2026-11-30")).toBe("Semana del 30 de noviembre al 6 de diciembre");
  });

  it("cifrasEstudio: sin métricas, ninguna; con ellas, alcance, interacciones y seguidores nuevos", () => {
    expect(cifrasEstudio(null)).toEqual([]);
    const cifras = cifrasEstudio(METRICAS as DatosMetricas);
    expect(cifras.map((x) => [x.nombre, x.variacion])).toEqual([
      ["Alcance", 12],
      ["Interacciones", 8],
      ["Seguidores nuevos", -4],
    ]);
    expect(cifras[2].valor).toBe("+142");
    expect(cifras[0].serie).toEqual([500, 700]);
  });
});
