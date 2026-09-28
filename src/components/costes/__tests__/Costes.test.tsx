import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";

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
      // `SuperAdminLayout` comprueba la sesión al montarse: sin `auth` el
      // render revienta antes de pintar nada. Devuelve "sin sesión": a esta
      // pantalla solo le importa que no lance, no quién ha entrado.
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

import Costes from "@/pages/Costes";

// `SuperAdminLayout` monta el menú lateral, que usa `useNavigate()`,
// `useLocation()` y `useAuth()`: hacen falta `<MemoryRouter>` y
// `<AuthProvider>` por encima o lanzan al montarse.
const renderPagina = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Costes />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  for (const k of Object.keys(rpcData)) delete rpcData[k];
  for (const k of Object.keys(tablaData)) delete tablaData[k];
});

describe("Costes", () => {
  it("sin consumo registrado muestra el estado vacío y no finge un coste de 0", async () => {
    // La RPC rellena el calendario: días presentes pero con coste NULL.
    rpcData.ia_coste_serie = [
      { dia: "2026-09-27", coste_usd: null, peticiones: null, es_anomalia: null },
      { dia: "2026-09-28", coste_usd: null, peticiones: null, es_anomalia: null },
    ];
    renderPagina();

    expect(
      await screen.findByText("Todavía no hay consumo de IA registrado en este periodo"),
    ).toBeInTheDocument();
    // El KPI de coste de IA no puede decir "0,00 $": no hay datos.
    expect(screen.getAllByText(/sin datos/i).length).toBeGreaterThan(0);
  });

  it("avisa de las funciones que no registran su consumo", async () => {
    rpcData.ia_funciones_sin_registro = [
      { funcion: "ocr_facturas", descripcion: "OCR de facturas", instrumentada: false, ultima_fila: null, dias_sin_registro: null },
      { funcion: "chat_web", descripcion: "Chat de la web", instrumentada: true, ultima_fila: "2026-09-01", dias_sin_registro: 27 },
    ];
    renderPagina();

    expect(await screen.findByText("Hay funciones de IA que todavía no registran su consumo")).toBeInTheDocument();
    expect(screen.getByText("Funciones que deberían registrar y no lo están haciendo")).toBeInTheDocument();
    expect(screen.getByText("ocr_facturas")).toBeInTheDocument();
  });

  it("pinta KPIs, proyección, desgloses y avisa de los modelos sin tarifa", async () => {
    rpcData.ia_coste_serie = [
      {
        dia: "2026-09-27",
        coste_usd: 1.25,
        llamadas: 10,
        peticiones: 10,
        errores: 0,
        prompt_tokens: 1000,
        completion_tokens: 500,
        razonamiento_tokens: 300,
        media_7: 1,
        media_30: 1,
        desv_30: 0.2,
        z_30: 1.2,
        desviacion_pct: 25,
        es_anomalia: false,
      },
      {
        dia: "2026-09-28",
        coste_usd: 0.75,
        llamadas: 8,
        peticiones: 8,
        errores: 1,
        prompt_tokens: 800,
        completion_tokens: 400,
        razonamiento_tokens: 100,
        media_7: 1,
        media_30: 1,
        desv_30: 0.2,
        z_30: -1.2,
        desviacion_pct: -25,
        es_anomalia: false,
      },
    ];
    rpcData.ia_coste_mes = [
      {
        mes: "2026-09-01",
        coste_acumulado_usd: 2,
        peticiones: 18,
        dias_con_dato: 2,
        dias_mes: 30,
        dias_restantes: 2,
        usd_medio_dia: 1,
        proy_lineal_usd: 30,
        proy_media7_usd: 28,
        fijos_eur_mes: 50,
        fijos_sin_verificar: 1,
        estimado_ia_usd_mes: 40,
      },
    ];
    rpcData.ia_coste_por_funcion = [
      {
        funcion: "chat_web",
        descripcion: "Chat de la web",
        instrumentada: true,
        llamadas: 18,
        peticiones: 18,
        errores: 1,
        prompt_tokens: 1800,
        completion_tokens: 900,
        razonamiento_tokens: 400,
        coste_usd: 2,
        pct: 100,
        usd_por_peticion: 0.1111,
      },
    ];
    rpcData.ia_coste_por_modelo = [
      {
        modelo: "gpt-5-mini",
        llamadas: 18,
        peticiones: 18,
        prompt_tokens: 1800,
        cached_tokens: 0,
        completion_tokens: 900,
        razonamiento_tokens: 400,
        pct_razonamiento: 30.8,
        coste_usd: 2,
        pct: 100,
        usd_por_peticion: 0.1111,
        tarifado: true,
      },
      {
        modelo: "gpt-6-pro",
        llamadas: 1,
        peticiones: 1,
        prompt_tokens: 10,
        cached_tokens: 0,
        completion_tokens: 10,
        razonamiento_tokens: 0,
        pct_razonamiento: null,
        coste_usd: null,
        pct: null,
        usd_por_peticion: null,
        tarifado: false,
      },
    ];
    tablaData.costes_fijos = [
      {
        id: "1",
        concepto: "Supabase Pro",
        proveedor: "Supabase",
        categoria: "infraestructura",
        eur_mes: 25,
        naturaleza: "fijo",
        notas: null,
        verificado_en: "2026-09-20",
        activo: true,
        orden: 0,
        creado_en: "2026-01-01T00:00:00Z",
        actualizado_en: "2026-01-01T00:00:00Z",
      },
      {
        id: "2",
        concepto: "VAPI",
        proveedor: "VAPI",
        categoria: "telefonia",
        eur_mes: null,
        naturaleza: "variable",
        notas: null,
        verificado_en: null,
        activo: true,
        orden: 1,
        creado_en: "2026-01-01T00:00:00Z",
        actualizado_en: "2026-01-01T00:00:00Z",
      },
    ];
    tablaData.ia_coste_estimado = [
      {
        funcion: "ocr_facturas",
        unidad: "documento",
        usd_por_unidad: 0.01,
        unidades_mes_estimadas: 200,
        modelo: "gpt-5-mini",
        medido_en: "2026-09-01",
        nota: null,
      },
    ];
    renderPagina();

    // Coste del periodo: 1,25 + 0,75 (sale también como acumulado del mes)
    expect((await screen.findAllByText("2,00 $")).length).toBeGreaterThan(0);
    // Coste fijo del mes (EUR) y total mixto marcado como aproximado
    expect(screen.getAllByText("50,00 €").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/≈/).length).toBeGreaterThan(0);
    // Modelo sin tarifa: aviso, y su coste como "sin datos", nunca 0
    expect(screen.getByText("Modelos usados sin tarifa en el catálogo de precios")).toBeInTheDocument();
    expect(screen.getByText("sin tarifa")).toBeInTheDocument();
    // Razonamiento: es el dato que justifica la pantalla
    expect(screen.getByText("30,8 %")).toBeInTheDocument();
    // La estimación va marcada como tal, y los fijos sin verificar se cuentan
    expect(screen.getByText("ESTIMACIÓN")).toBeInTheDocument();
    expect(screen.getByText("PROYECCIÓN")).toBeInTheDocument();
    expect(screen.getAllByText(/sin verificar/).length).toBeGreaterThan(0);
  });
});
