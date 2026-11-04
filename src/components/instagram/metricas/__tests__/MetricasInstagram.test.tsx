/**
 * Pestaña «Métricas»: estados cargando, error, vacío, permiso que falta y con
 * datos (resumen con variación, lista con enlace, «Qué funciona mejor») y el
 * botón «Actualizar ahora». jsdom no pinta el gráfico (ResponsiveContainer sin
 * tamaño): se comprueba la tabla accesible que lo acompaña.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { MetricasInstagram } from "../index";
import { ErrorMetricas } from "../api";
import { formatearNumero } from "../agregacion";
import type { ApiMetricas } from "../useMetricasInstagram";
import type { Comparacion, DatosMetricas, ResumenPeriodo } from "../tipos";

const c = (actual: number | null, anterior: number | null, variacion: number | null): Comparacion => ({ actual, anterior, variacion });
const resumen = (dias: number, alcance: number): ResumenPeriodo => ({
  dias,
  desde: "2026-10-29",
  hasta: "2026-11-04",
  diasConDatos: dias,
  diasConDatosAnterior: dias,
  metricas: {
    alcance: c(alcance, 1000, 40),
    visualizaciones: c(5000, 5000, 0),
    interacciones: c(80, 100, -20),
    cuentasInteraccion: c(30, null, null),
    visitasPerfil: c(null, null, null),
    toquesEnlaces: c(null, null, null),
    seguidores: { ...c(1100, 1000, 10), cambio: 100 },
  },
});

const DATOS: DatosMetricas = {
  igUserId: "1",
  hoy: "2026-11-05",
  ultimoDia: "2026-11-04",
  resumen: { d7: resumen(7, 1400), d28: resumen(28, 5600) },
  serie: [
    { fecha: "2026-11-03", alcance: 180, seguidores: null, visualizaciones: 400, interacciones: 10 },
    { fecha: "2026-11-04", alcance: 200, seguidores: 1100, visualizaciones: 500, interacciones: 12 },
  ],
  publicaciones: [
    {
      mediaId: "1790000000000001", piezaId: "p1", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: "ct-salon-1", tipoFoto: null,
      tipoMedio: "IMAGE", producto: "FEED", publicadoAt: "2026-11-03T12:00:00Z", permalink: "https://www.instagram.com/p/AAA/",
      miniaturaUrl: "https://cdn.example/1.jpg", caption: "Chuletón a la brasa", fechaCaptura: "2026-11-05",
      alcance: 300, meGusta: 20, comentarios: 3, guardados: 2, compartidos: 1, visualizaciones: 600, interacciones: 26,
    },
    {
      mediaId: "1790000000000002", piezaId: null, marca: null, plantilla: null, formato: null, foto: null, tipoFoto: null,
      tipoMedio: "VIDEO", producto: "REELS", publicadoAt: "2026-11-01T12:00:00Z", permalink: null,
      miniaturaUrl: null, caption: null, fechaCaptura: "2026-11-05",
      alcance: 900, meGusta: 50, comentarios: null, guardados: null, compartidos: null, visualizaciones: 2000, interacciones: null,
    },
  ],
  ultimaCaptura: { inicio: "2026-11-05T05:00:00Z", fin: "2026-11-05T05:00:20Z", ok: true, origen: "cron", errorTipo: null, error: null, avisos: [] },
  ultimaCorrecta: { inicio: "2026-11-05T05:00:00Z", fin: "2026-11-05T05:00:20Z", ok: true, origen: "cron", errorTipo: null, error: null, avisos: [] },
};

function pintar(api: ApiMetricas) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MetricasInstagram api={api} />
    </QueryClientProvider>,
  );
}

const capturaOk = vi.fn(async () => ({ fechaCaptura: "2026-11-05", dias: [], publicaciones: 2, avisos: [] }));

describe("MetricasInstagram", () => {
  it("cargando", () => {
    pintar({ leer: () => new Promise(() => {}), capturar: capturaOk });
    expect(screen.getByRole("status", { name: "Cargando las métricas" })).toBeInTheDocument();
  });

  it("error de lectura con «cómo arreglarlo» y reintento", async () => {
    const leer = vi.fn(async () => {
      throw new ErrorMetricas("La función de métricas de Instagram no está desplegada en este Supabase.", "no_desplegada", 404, ["npx supabase functions deploy instagram-metricas"]);
    });
    pintar({ leer, capturar: capturaOk });
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("no está desplegada");
    expect(alerta).toHaveTextContent("npx supabase functions deploy instagram-metricas");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(leer).toHaveBeenCalledTimes(2));
  });

  it("vacío: invita a «Actualizar ahora» y lanza la captura", async () => {
    const vacio = { ...DATOS, resumen: null, serie: [], publicaciones: [], ultimaCaptura: null, ultimaCorrecta: null };
    const capturar = vi.fn(async () => ({ fechaCaptura: "2026-11-05", dias: [], publicaciones: 0, avisos: [] }));
    pintar({ leer: async () => vacio, capturar });
    expect(await screen.findByText("Todavía no hay métricas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Actualizar ahora/ }));
    await waitFor(() => expect(capturar).toHaveBeenCalledTimes(1));
  });

  it("la última captura falló por el permiso: dice qué permiso añadir y dónde", async () => {
    const conFallo = {
      ...DATOS,
      resumen: null,
      serie: [],
      publicaciones: [],
      ultimaCaptura: { inicio: "2026-11-05T05:00:00Z", fin: null, ok: false, origen: "cron", errorTipo: "permiso_insights", error: "Falta permiso", avisos: [] },
    };
    pintar({ leer: async () => conFallo, capturar: capturaOk });
    const aviso = await screen.findByTestId("aviso-permiso");
    expect(aviso).toHaveTextContent("instagram_manage_insights");
    expect(aviso).toHaveTextContent("Configuración del negocio → Usuarios → Usuarios del sistema");
  });

  it("el botón muestra el error de permiso que devuelve la captura", async () => {
    const capturar = vi.fn(async () => {
      throw new ErrorMetricas("Al token le falta instagram_manage_insights", "permiso_insights", 502, ["…"]);
    });
    pintar({ leer: async () => DATOS, capturar });
    fireEvent.click(await screen.findByRole("button", { name: /Actualizar ahora/ }));
    expect(await screen.findByTestId("aviso-permiso")).toBeInTheDocument();
  });

  it("con datos: resumen con variación, gráfico accesible, lista con enlace y qué funciona mejor", async () => {
    pintar({ leer: async () => DATOS, capturar: capturaOk });
    const tira = await screen.findByTestId("resumen-metricas");
    expect(tira).toHaveTextContent(formatearNumero(1400));
    expect(tira).toHaveTextContent("+40 %");
    expect(tira).toHaveTextContent("−20 %");
    expect(tira).toHaveTextContent("+100"); // seguidores ganados

    // 28 días
    fireEvent.click(screen.getByRole("radio", { name: "28 días" }));
    expect(screen.getByTestId("resumen-metricas")).toHaveTextContent(formatearNumero(5600));

    expect(screen.getByRole("table", { name: "Alcance y seguidores de cada día" })).toBeInTheDocument();

    const lista = screen.getByTestId("lista-publicaciones");
    const filas = within(lista).getAllByTestId("publicacion");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent("Chuletón a la brasa");
    expect(filas[0]).toHaveTextContent("Sala"); // tipo de foto del catálogo estático
    expect(within(filas[0]).getByRole("link")).toHaveAttribute("href", "https://www.instagram.com/p/AAA/");
    expect(within(filas[0]).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    expect(filas[1]).toHaveTextContent("Reel");

    // Orden por alcance
    fireEvent.click(screen.getByRole("radio", { name: "Más alcance" }));
    expect(within(screen.getByTestId("lista-publicaciones")).getAllByTestId("publicacion")[0]).toHaveTextContent("Reel");

    const mejor = screen.getByTestId("que-funciona-mejor");
    expect(mejor).toHaveTextContent("1 publicaciones del panel · 1 de fuera no cuentan");
    expect(within(mejor).getByRole("region", { name: "Por tipo de foto" })).toHaveTextContent("Sala");
    expect(within(mejor).getByRole("region", { name: "Por marca" })).toHaveTextContent("Casa Tomás");
  });
});
