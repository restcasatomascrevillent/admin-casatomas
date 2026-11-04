import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DatosInformeTrafico } from "@/hooks/useTraficoWeb";
import { DATOS_DEMO_OCTUBRE_2026, DATOS_DEMO_TOUZA_OCTUBRE_2026, DATOS_TOUZA_SIN_VISITAS } from "./fixtures/informeDemo";

// Pintar las 8 diapositivas con sus gráficas en jsdom tarda 1–2 s; con la
// máquina cargada (CI, varias suites a la vez) pasaba de los 5 s por defecto.
vi.setConfig({ testTimeout: 20_000 });

// ─── Supabase simulado: responde a las RPC del informe con los datos de la demo ──
// Cada web con los suyos (p_proyecto): Casa Tomás en `datos`, Touza en `datosTouza`.
let datos: DatosInformeTrafico = DATOS_DEMO_OCTUBRE_2026;
let datosTouza: DatosInformeTrafico = DATOS_DEMO_TOUZA_OCTUBRE_2026;
const llamadas: { nombre: string; params: Record<string, unknown> }[] = [];
const deLaWeb = (proyecto: unknown) => (proyecto === "touza-restaurant-website" ? datosTouza : datos);

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    let proyecto: unknown = null;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "gt", "order", "limit"]) q[m] = () => q;
    q.eq = (columna: string, valor: unknown) => {
      if (columna === "proyecto") proyecto = valor;
      return q;
    };
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const primer = deLaWeb(proyecto).primerDiaConVisitas;
      return Promise.resolve({ data: primer ? [{ fecha: primer }] : [], error: null }).then(ok, ko);
    };
    return q;
  };
  return {
    supabase: {
      rpc: vi.fn((nombre: string, params: Record<string, string>) => {
        llamadas.push({ nombre, params });
        const datos = deLaWeb(params.p_proyecto);
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
import { construirInforme, construirInformeMensual, type InformeTrafico } from "../informe/modelo";
import InformeTraficoDialog from "../informe/InformeTraficoDialog";

/** Los «%» del informe llevan espacio de no separación. */
const conPct = (s: string) => new RegExp(s.replace(/ %/g, "\u00A0%"));

/** La web que marca el pie de cada diapositiva (NULL si no lleva). */
const webDeCada = (diapositivas: HTMLElement[]) =>
  diapositivas.map((d) => d.querySelector("[data-web-diapositiva]")?.getAttribute("data-web-diapositiva") ?? null);

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
    // Y al pie, a la izquierda, de qué web son los datos (la portada tampoco lo lleva).
    expect(webDeCada(diapositivas)).toEqual([null, ...Array(7).fill("Web de Casa Tomás")]);

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

describe("DiapositivasInforme: la web principal y Touza al final", () => {
  const MES = { mes: "2026-10", hoy: "2026-11-03" };

  it("las 8 de Casa Tomás y dos de Touza al final, cada una con su web bien a la vista", () => {
    const informe = construirInformeMensual({ principal: DATOS_DEMO_OCTUBRE_2026, touza: DATOS_DEMO_TOUZA_OCTUBRE_2026 }, MES) as InformeTrafico;
    render(<DiapositivasInforme informe={informe} />);
    const diapositivas = screen.getAllByRole("region");
    expect(diapositivas).toHaveLength(10);
    expect(webDeCada(diapositivas)).toEqual([null, ...Array(7).fill("Web de Casa Tomás"), "Web de Touza", "Web de Touza"]);

    // La portada sigue siendo de Casa Tomás y avisa del apartado de Touza.
    expect(within(diapositivas[0]).getByRole("heading", { level: 1 })).toHaveTextContent("Tráfico de la webde Casa Tomás:octubre 2026");
    expect(within(diapositivas[0]).getByText("Al final, un apartado para la web de Touza.")).toBeInTheDocument();
    // El cuerpo, con las cifras de Casa Tomás solas (442, no 470).
    expect(within(diapositivas[1]).getByRole("heading", { name: "Octubre cierra con 442 páginas vistas de 91 visitantes" })).toBeInTheDocument();
    expect(within(diapositivas[7]).getByRole("heading", { name: "Qué nos dice octubre" })).toBeInTheDocument();

    // 9: resumen de Touza, con «Web de Touza» en oro sobre el titular.
    const resumen = diapositivas[8];
    expect(within(resumen).getByRole("heading", { name: "Touza cierra octubre con 28 páginas vistas de 14 visitantes" })).toBeInTheDocument();
    expect(within(resumen).getAllByText("Web de Touza")).toHaveLength(2); // antetítulo y pie
    expect(within(resumen).getByText("28")).toBeInTheDocument();
    expect(within(resumen).getByText("14")).toBeInTheDocument();
    expect(within(resumen).getByText("Septiembre solo tiene 8 días medidos: aún no se puede comparar.")).toBeInTheDocument();
    expect(within(resumen).getByText(/La zona gris son días sin datos/)).toBeInTheDocument();
    expect(resumen.querySelector("svg.recharts-surface")).not.toBeNull();
    expect(within(resumen).getByText("9")).toBeInTheDocument();

    // 10: lo más relevante de Touza.
    const detalle = diapositivas[9];
    expect(within(detalle).getByRole("heading", { name: "Lo más visto en Touza: Inicio y Carta" })).toBeInTheDocument();
    expect(within(detalle).getByText("8,0 %")).toBeInTheDocument(); // el normalizador cambia el espacio de no separación
    expect(within(detalle).getByText("Del tráfico de las dos webs")).toBeInTheDocument();
    expect(within(detalle).getByText("Llega de forma directa")).toBeInTheDocument();
    // 14 desde el móvil y 14 desde el ordenador: no se dice que «entra desde el móvil».
    expect(within(detalle).getByText("A partes iguales: móvil y ordenador")).toBeInTheDocument();
    expect(within(detalle).getByText("Galería")).toBeInTheDocument();
    expect(within(detalle).getByText("Touza empezó a registrar visitas el 23 de septiembre; antes no hay datos.")).toBeInTheDocument();
    expect(within(detalle).getByText("10")).toBeInTheDocument();
  });

  it("Touza sin visitas en el mes: una sola diapositiva que lo explica", () => {
    const informe = construirInformeMensual({ principal: DATOS_DEMO_OCTUBRE_2026, touza: DATOS_TOUZA_SIN_VISITAS }, MES) as InformeTrafico;
    render(<DiapositivasInforme informe={informe} />);
    const diapositivas = screen.getAllByRole("region");
    expect(diapositivas).toHaveLength(9);
    const ultima = diapositivas[8];
    expect(within(ultima).getByRole("heading", { name: "Touza: sin visitas que mostrar en octubre" })).toBeInTheDocument();
    expect(within(ultima).getByText("En octubre 2026 todavía no se medían las visitas de la web de Touza.")).toBeInTheDocument();
    expect(within(ultima).getByText(/solo de la web de Casa Tomás/)).toBeInTheDocument();
    expect(webDeCada(diapositivas).at(-1)).toBe("Web de Touza");
  });
});

describe("InformeTraficoDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T10:00:00"));
    datos = DATOS_DEMO_OCTUBRE_2026;
    datosTouza = DATOS_DEMO_TOUZA_OCTUBRE_2026;
    llamadas.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const abrir = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InformeTraficoDialog abierto onAbiertoChange={() => {}} />
      </QueryClientProvider>,
    );

  it("por defecto el último mes cerrado: la web de Casa Tomás y, al final, Touza; con vista previa y botón de PDF", async () => {
    abrir();
    expect(await screen.findByRole("heading", { name: "Octubre cierra con 442 páginas vistas de 91 visitantes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mes del informe" })).toHaveTextContent("Octubre 2026");
    // Ya no se elige web: el informe es siempre la principal con el apartado de Touza.
    expect(screen.queryByRole("combobox", { name: "Web del informe" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeEnabled();
    expect(screen.getByTestId("diapositiva-10")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Touza cierra octubre con 28 páginas vistas de 14 visitantes" })).toBeInTheDocument();

    // Pide octubre y la serie desde el 1 de septiembre (para comparar), de cada web por separado (nunca las dos sumadas)
    const series = llamadas.filter((l) => l.nombre === "trafico_web_serie").map((l) => l.params);
    expect(series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ p_proyecto: "casa-tomas-story", p_desde: "2026-09-01", p_hasta: "2026-10-31" }),
        expect.objectContaining({ p_proyecto: "touza-restaurant-website", p_desde: "2026-09-01", p_hasta: "2026-10-31" }),
      ]),
    );
    expect(llamadas.every((l) => l.params.p_proyecto !== null)).toBe(true);
    expect(llamadas.filter((l) => l.nombre === "trafico_web_desglose_resumen").map((l) => l.params.p_dimension).sort()).toEqual([
      "country",
      "country",
      "device",
      "device",
      "referrer",
      "referrer",
    ]);
  });

  it("mes sin datos: estado vacío explicado y sin botón de PDF activo", async () => {
    datos = { serie: [], paginas: [], dispositivos: [], paises: [], procedencias: [], primerDiaConVisitas: null };
    datosTouza = datos;
    abrir();
    expect(await screen.findByText("No hay datos para este informe")).toBeInTheDocument();
    expect(screen.getByText(/todavía no se medían las visitas de la web de Casa Tomás/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeDisabled();
  });
});
