import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DatosInformeTrafico } from "@/hooks/useTraficoWeb";
import { DATOS_DEMO_OCTUBRE_2026 } from "./fixtures/informeDemo";

// Pintar las 8 diapositivas con sus gráficas en jsdom tarda 1–2 s; con la
// máquina cargada (CI, varias suites a la vez) pasaba de los 5 s por defecto.
vi.setConfig({ testTimeout: 20_000 });

// ─── Supabase simulado: responde a las RPC del informe con los datos de la demo ──
let datos: DatosInformeTrafico = DATOS_DEMO_OCTUBRE_2026;
const llamadas: { nombre: string; params: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "order", "limit"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: datos.primerDiaConVisitas ? [{ fecha: datos.primerDiaConVisitas }] : [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      rpc: vi.fn((nombre: string, params: Record<string, string>) => {
        llamadas.push({ nombre, params });
        const delMes = (params.p_desde ?? "") >= "2026-10-01" && (params.p_hasta ?? "") <= "2026-10-31";
        let data: unknown[] = [];
        if (nombre === "trafico_web_serie") data = datos.serie.filter((f) => f.fecha >= params.p_desde && f.fecha <= params.p_hasta);
        else if (nombre === "trafico_web_top_paginas") data = delMes ? datos.paginas : [];
        else if (nombre === "trafico_web_desglose_resumen")
          data = !delMes ? [] : params.p_dimension === "device" ? datos.dispositivos : params.p_dimension === "country" ? datos.paises : datos.procedencias;
        return Promise.resolve({ data, error: null });
      }),
      from: vi.fn(() => consulta()),
    },
  };
});

import { DiapositivasInforme } from "../informe/Diapositivas";
import { construirInforme, type InformeTrafico } from "../informe/modelo";
import InformeTraficoDialog from "../informe/InformeTraficoDialog";

/** Los «%» del informe llevan espacio de no separación. */
const conPct = (s: string) => new RegExp(s.replace(/ %/g, "\u00A0%"));

const informeDemo = construirInforme(DATOS_DEMO_OCTUBRE_2026, {
  proyecto: "casa-tomas-story",
  mes: "2026-10",
  hoy: "2026-11-03",
}) as InformeTrafico;

describe("DiapositivasInforme", () => {
  it("pinta portada + 7 diapositivas con titulares que cuentan la conclusión", () => {
    render(<DiapositivasInforme informe={informeDemo} />);
    const diapositivas = screen.getAllByRole("region");
    expect(diapositivas).toHaveLength(8);

    // Portada: «Tráfico de la web / de Casa Tomás: / octubre 2026»
    expect(within(diapositivas[0]).getByRole("heading", { level: 1 })).toHaveTextContent("Tráfico de la webde Casa Tomás:octubre 2026");
    expect(within(diapositivas[0]).getByText("Casa Tomás · Informe mensual")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Octubre cierra con 442 páginas vistas de 91 visitantes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: conPct("La carta reúne el 48 % de todo lo que se mira en la web") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: conPct("El 90 % llega directamente") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: conPct("El 67 % entra desde el móvil") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Qué nos dice octubre" })).toBeInTheDocument();

    // Cifras grandes y explicaciones en llano
    expect(screen.getByText("442")).toBeInTheDocument();
    expect(screen.getByText("4,9")).toBeInTheDocument();
    expect(screen.getByText(/Personas distintas que entraron cada día/)).toBeInTheDocument();
    expect(screen.getByText("Aún sin comparación")).toBeInTheDocument();
    expect(screen.getByText(/La zona gris son días sin datos/)).toBeInTheDocument();

    // Número de página abajo a la derecha (la portada no lleva)
    expect(within(diapositivas[1]).getByText("2")).toBeInTheDocument();
    expect(within(diapositivas[7]).getByText("8")).toBeInTheDocument();

    // Las gráficas se dibujan (Recharts con tamaño fijo, sin ResponsiveContainer)
    expect(document.querySelectorAll("svg.recharts-surface").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("Carta de vinos").length).toBeGreaterThan(0);
  });

  it("sin desgloses no pinta las diapositivas que dependen de ellos", () => {
    const sinDesgloses = construirInforme(
      { ...DATOS_DEMO_OCTUBRE_2026, paginas: [], dispositivos: [], paises: [], procedencias: [] },
      { proyecto: "casa-tomas-story", mes: "2026-10", hoy: "2026-11-03" },
    ) as InformeTrafico;
    render(<DiapositivasInforme informe={sinDesgloses} />);
    expect(screen.getAllByRole("region")).toHaveLength(5); // portada, resumen, evolución, días, conclusiones
  });
});

describe("InformeTraficoDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T10:00:00"));
    datos = DATOS_DEMO_OCTUBRE_2026;
    llamadas.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const abrir = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InformeTraficoDialog abierto onAbiertoChange={() => {}} proyectoInicial="ambos" />
      </QueryClientProvider>,
    );

  it("por defecto el último mes cerrado de la web de Casa Tomás, con vista previa y botón de PDF", async () => {
    abrir();
    expect(await screen.findByRole("heading", { name: "Octubre cierra con 442 páginas vistas de 91 visitantes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mes del informe" })).toHaveTextContent("Octubre 2026");
    expect(screen.getByRole("combobox", { name: "Web del informe" })).toHaveTextContent("Casa Tomás");
    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeEnabled();
    expect(screen.getByTestId("diapositiva-8")).toBeInTheDocument();

    // Pide octubre y la serie desde el 1 de septiembre (para comparar), de la web de Casa Tomás
    const serie = llamadas.find((l) => l.nombre === "trafico_web_serie");
    expect(serie?.params).toMatchObject({ p_proyecto: "casa-tomas-story", p_desde: "2026-09-01", p_hasta: "2026-10-31" });
    expect(llamadas.filter((l) => l.nombre === "trafico_web_desglose_resumen").map((l) => l.params.p_dimension).sort()).toEqual([
      "country",
      "device",
      "referrer",
    ]);
  });

  it("mes sin datos: estado vacío explicado y sin botón de PDF activo", async () => {
    datos = { serie: [], paginas: [], dispositivos: [], paises: [], procedencias: [], primerDiaConVisitas: null };
    abrir();
    expect(await screen.findByText("No hay datos para este informe")).toBeInTheDocument();
    expect(screen.getByText(/todavía no se medían las visitas de la web de Casa Tomás/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeDisabled();
  });
});
