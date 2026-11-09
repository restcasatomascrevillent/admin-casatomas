/**
 * RRSS › Métricas: un solo panel para todas las redes (Instagram con datos,
 * Facebook «No conectado» sin cifras, web desde redes solo para Super Admin) y
 * «Generar informe», que abre el informe mensual en diapositivas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import type { ReactNode } from "react";
import type { DatosMetricas, ResumenPeriodo } from "@/components/instagram/metricas/tipos";

vi.setConfig({ testTimeout: 20_000 });

// ─── Supabase simulado: tablas de Instagram y procedencias de Tráfico web ────
const CUENTA = "17841400000000001";
function filasCuenta() {
  const filas = [];
  for (let i = 0; i < 61; i++) {
    const fecha = format(addDays(parseISO("2026-09-01"), i), "yyyy-MM-dd");
    const octubre = fecha >= "2026-10-01";
    filas.push({
      fecha,
      ig_user_id: CUENTA,
      seguidores: fecha === "2026-09-30" ? 1000 : fecha === "2026-10-31" ? 1040 : null,
      alcance: octubre ? 120 : 100,
      visualizaciones: 300,
      interacciones: 12,
      cuentas_interaccion: 8,
      visitas_perfil: 5,
      toques_enlaces: 1,
    });
  }
  return filas;
}
const PUBLICACIONES = [
  {
    media_id: "3",
    ig_user_id: CUENTA,
    publicado_at: "2026-10-09T10:00:00Z",
    producto: "REELS",
    tipo_medio: "VIDEO",
    caption: "Arroz del senyoret",
    permalink: null,
    alcance: 900,
    me_gusta: 50,
    comentarios: 10,
    guardados: 20,
    compartidos: 10,
    visualizaciones: 2000,
    interacciones: 90,
  },
];
const PROCEDENCIAS = [
  { valor: "l.instagram.com", visitas: 80, visitantes: 70, pct: 8 },
  { valor: "m.facebook.com", visitas: 20, visitantes: 18, pct: 2 },
  { valor: "google.com", visitas: 500, visitantes: 400, pct: 50 },
];
const llamadasRpc: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "gte", "lte", "lt", "order", "limit"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tabla === "instagram_metricas_cuenta" ? filasCuenta() : tabla === "instagram_metricas_publicacion_ultima" ? PUBLICACIONES : [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      from: vi.fn((tabla: string) => consulta(tabla)),
      rpc: vi.fn((_nombre: string, params: Record<string, unknown>) => {
        llamadasRpc.push(params);
        return Promise.resolve({ data: PROCEDENCIAS, error: null });
      }),
    },
  };
});

const superAdmin = { isSuperAdmin: false, loading: false };
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => superAdmin }));
// El detalle de Instagram tiene sus propias pruebas (instagram/metricas): aquí basta con saber que está.
vi.mock("@/components/instagram/metricas/MetricasInstagram", () => ({ MetricasInstagram: () => <div>Detalle de Instagram</div> }));

import { MetricasRRSS } from "../MetricasRRSS";
import { DiapositivasInformeRrss } from "../informe/Diapositivas";
import { construirInformeRrss, type InformeRrss } from "../informe/modelo";

function resumen(dias: number): ResumenPeriodo {
  const c = (actual: number, anterior: number) => ({ actual, anterior, variacion: Math.round((1000 * (actual - anterior)) / anterior) / 10 });
  return {
    dias,
    desde: "2026-10-12",
    hasta: "2026-11-08",
    diasConDatos: dias,
    diasConDatosAnterior: dias,
    metricas: {
      alcance: c(3360, 2800),
      visualizaciones: c(8400, 8000),
      interacciones: c(336, 300),
      cuentasInteraccion: c(200, 190),
      visitasPerfil: c(140, 150),
      toquesEnlaces: c(28, 20),
      seguidores: { actual: 1040, anterior: 1000, variacion: 4, cambio: 40 },
    },
  };
}

const DATOS_IG: DatosMetricas = {
  igUserId: CUENTA,
  hoy: "2026-11-09",
  ultimoDia: "2026-11-08",
  resumen: { d7: resumen(7), d28: resumen(28) },
  serie: [],
  publicaciones: [],
  ultimaCaptura: null,
  ultimaCorrecta: { inicio: "2026-11-09T05:00:00Z", fin: "2026-11-09T05:01:00Z", ok: true, origen: "cron", errorTipo: null, error: null, avisos: [] },
};
const apiIg = { leer: vi.fn(async () => DATOS_IG), capturar: vi.fn() };

function montar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
  superAdmin.isSuperAdmin = false;
  llamadasRpc.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("MetricasRRSS", () => {
  it("una tarjeta por red: Instagram con cifras, Facebook «No conectado» sin cifras, y el detalle de Instagram", async () => {
    montar(<MetricasRRSS apiInstagram={apiIg} />);
    const ig = await screen.findByTestId("red-instagram");
    expect(await within(ig).findByText("Conectado")).toBeInTheDocument();
    expect(within(ig).getByText("Seguidores")).toBeInTheDocument();
    expect(within(ig).getByText("+40")).toBeInTheDocument();
    expect(within(ig).getByText(/Últimos 28 días/)).toBeInTheDocument();

    const fb = screen.getByTestId("red-facebook");
    expect(within(fb).getByText("No conectado")).toBeInTheDocument();
    expect(fb.textContent).not.toMatch(/\d/);

    expect(screen.getByText("Detalle de Instagram")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar informe/ })).toBeInTheDocument();
  });

  it("sin permiso de Tráfico web no enseña ni pide la web desde redes", async () => {
    montar(<MetricasRRSS apiInstagram={apiIg} />);
    await screen.findByTestId("red-instagram");
    expect(screen.queryByTestId("red-web")).toBeNull();
    expect(llamadasRpc).toHaveLength(0);
  });

  it("Super Admin ve las visitas a la web que llegan desde redes (últimos 28 días)", async () => {
    superAdmin.isSuperAdmin = true;
    montar(<MetricasRRSS apiInstagram={apiIg} />);
    const web = await screen.findByTestId("red-web");
    expect(await within(web).findByText("Instagram")).toBeInTheDocument();
    expect(within(web).getByText("Facebook")).toBeInTheDocument();
    expect(within(web).getByText(/10 % del total/)).toBeInTheDocument();
    expect(llamadasRpc[0]).toMatchObject({ p_dimension: "referrer", p_proyecto: null, p_desde: "2026-10-12", p_hasta: "2026-11-08" });
  });

  it("«Generar informe» abre el informe del último mes cerrado con sus diapositivas", async () => {
    montar(<MetricasRRSS apiInstagram={apiIg} />);
    fireEvent.click(screen.getByRole("button", { name: /Generar informe/ }));
    expect(await screen.findByRole("heading", { name: /Informe mensual de redes sociales/ })).toBeInTheDocument();
    expect(await screen.findByTestId("diapositiva-1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /El alcance de Instagram en octubre: 3\.720/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Descargar PDF/ })).toBeEnabled();
  });
});

describe("DiapositivasInformeRrss", () => {
  const informe = construirInformeRrss(
    {
      cuentas: filasCuenta(),
      publicaciones: PUBLICACIONES,
      web: { actual: PROCEDENCIAS, anterior: [{ valor: "instagram.com", visitas: 50, pct: 5 }] },
    },
    { mes: "2026-10", hoy: "2026-11-09" },
  ) as InformeRrss;

  it("portada + resumen, evolución, publicaciones, las que más llegaron, web y conclusiones", () => {
    render(<DiapositivasInformeRrss informe={informe} />);
    const diapositivas = screen.getAllByRole("region");
    expect(diapositivas).toHaveLength(7);
    expect(within(diapositivas[0]).getByRole("heading", { level: 1 })).toHaveTextContent("Redes socialesde Casa Tomás:octubre 2026");
    expect(within(diapositivas[0]).getByText(/Facebook aún no está conectado/)).toBeInTheDocument();
    const pies = diapositivas.map((d) => d.querySelector("[data-web-diapositiva]")?.getAttribute("data-web-diapositiva") ?? null);
    expect(pies).toEqual([
      null,
      "Instagram de Casa Tomás",
      "Instagram de Casa Tomás",
      "Instagram de Casa Tomás",
      "Instagram de Casa Tomás",
      "Webs de Casa Tomás y Touza",
      "Redes sociales de Casa Tomás",
    ]);
    expect(screen.getByRole("heading", { name: "Qué nos dice octubre" })).toBeInTheDocument();
    expect(screen.getByText("Arroz del senyoret")).toBeInTheDocument();
  });

  it("sin la web ni publicaciones, solo lo que hay", () => {
    const solo = construirInformeRrss({ cuentas: filasCuenta(), publicaciones: [], web: null }, { mes: "2026-10", hoy: "2026-11-09" }) as InformeRrss;
    render(<DiapositivasInformeRrss informe={solo} />);
    expect(screen.getAllByRole("region")).toHaveLength(4);
  });
});
