import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────
const rpcData: Record<string, unknown[]> = {};
const tablaData: Record<string, unknown[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const chain = (tabla: string) => {
    const resultado = () => Promise.resolve({ data: tablaData[tabla] ?? [], error: null });
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.eq = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => resultado().then(ok, ko);
    return q;
  };
  return {
    supabase: {
      rpc: vi.fn((nombre: string) => Promise.resolve({ data: rpcData[nombre] ?? [], error: null })),
      from: vi.fn((tabla: string) => chain(tabla)),
      // `SuperAdminLayout` comprueba la sesión al montarse. Sin esto el mock
      // no tiene `auth` y el render revienta con "Cannot read properties of
      // undefined (reading 'onAuthStateChange')". Devuelve "sin sesión": a
      // esta pantalla solo le importa que no lance, no quién ha entrado.
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    },
  };
});

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import TraficoWeb from "@/pages/TraficoWeb";

// `TraficoWeb` pasó a renderizarse dentro de `SuperAdminLayout`, cuyo menú
// lateral usa `useNavigate()` y `useLocation()`. Esos hooks lanzan si no
// encuentran un Router por encima, así que el render de prueba necesita uno.
// Antes no hacía falta: la página era autónoma y no montaba ningún menú.
const renderPagina = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TraficoWeb />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  for (const k of Object.keys(rpcData)) delete rpcData[k];
  for (const k of Object.keys(tablaData)) delete tablaData[k];
});

describe("TraficoWeb", () => {
  it("sin datos muestra el estado vacío (primera sincronización 03:30 UTC)", async () => {
    // La RPC real devuelve un día por fecha con visitas NULL cuando no hay datos.
    rpcData.trafico_web_serie = [
      { fecha: "2026-09-20", visitas: null, visitantes: null, n_dow: 0, es_anomalia: null },
      { fecha: "2026-09-21", visitas: null, visitantes: null, n_dow: 0, es_anomalia: null },
    ];
    renderPagina();
    expect(
      await screen.findByText("Aún no hay datos: la primera sincronización se ejecuta a las 03:30 UTC"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pesos por página/i })).toBeInTheDocument();
  });

  it("con pocos datos pinta KPIs, aviso de pocos datos, ESTIMACIÓN y 'sin datos' para métricas NULL", async () => {
    const hoy = new Date();
    const dia = (n: number) => {
      const d = new Date(hoy);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    rpcData.trafico_web_serie = [5, 4, 3, 2, 1].map((n, i) => ({
      fecha: dia(n),
      visitas: 10 + i,
      visitantes: null,
      media_7: 10,
      media_30: 10,
      desv_30: 1,
      media_dow: null,
      desv_dow: null,
      n_dow: 0,
      z_dow: null,
      desviacion_pct: null,
      es_anomalia: null,
    }));
    rpcData.trafico_web_tendencia = [
      { pendiente: 1, intercepto: 15, r2: 0.9, n: 5, fiable: false, proyeccion: [], total_30d: 900 },
    ];
    rpcData.trafico_web_fdt_mes = [
      {
        proyecto: "*",
        visitas_mes: 60,
        bytes_acumulados: 30000000,
        dias_con_dato: 5,
        dias_mes: 30,
        dias_restantes: 8,
        bytes_medios_por_visita: 500000,
        bytes_proy_lineal: null,
        bytes_proy_regresion: null,
        limite_bytes: 100e9,
        pct_limite: 0.03,
        pct_proyectado: null,
        alerta_80: false,
      },
    ];
    tablaData.trafico_web_sync_estado = [
      {
        proyecto: "casa-tomas-story",
        ultimo_ok_en: new Date().toISOString(),
        ultimo_intento_en: new Date().toISOString(),
        ultimo_error: null,
        fallos_consecutivos: 0,
        dias_ultimo_sync: 3,
      },
    ];
    renderPagina();

    expect(await screen.findByText("Pocos datos todavía")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument(); // total visitas 10+11+12+13+14
    expect(screen.getByText("ESTIMACIÓN")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver uso en vercel/i })).toHaveAttribute("target", "_blank");
    // Visitantes NULL y proyección FDT NULL → "sin datos", nunca 0
    expect(screen.getAllByText(/sin datos/).length).toBeGreaterThan(0);
    // Badge del KPI de tendencia (el texto se parte en varios nodos: "poco fiable (", "5", " días)")
    expect(screen.getAllByText(/poco fiable/).length).toBeGreaterThanOrEqual(2);
  });
});
