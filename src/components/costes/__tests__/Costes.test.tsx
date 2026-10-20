import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";

// ─── Mocks ───────────────────────────────────────────────────────────────────
const rpcData: Record<string, unknown> = {};
/** Ventanas de gasto_ia_real_resumen, por p_dias. */
const ventanasReal: Record<number, unknown[]> = {};
const tablaData: Record<string, unknown[]> = {};
const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (tabla: string) => {
    const resultado = () => Promise.resolve({ data: tablaData[tabla] ?? [], error: null });
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.eq = () => q;
    q.limit = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => resultado().then(ok, ko);
    return q;
  };
  return {
    supabase: {
      rpc: vi.fn((nombre: string, args?: Record<string, unknown>) => {
        llamadas.push({ fn: nombre, args });
        if (nombre === "gasto_ia_real_resumen") {
          const v = ventanasReal[Number(args?.p_dias)];
          return Promise.resolve(v ? { data: v, error: null } : { data: [], error: null });
        }
        return Promise.resolve({ data: rpcData[nombre] ?? [], error: null });
      }),
      from: vi.fn((tabla: string) => chain(tabla)),
      // `SuperAdminLayout` comprueba la sesión al montarse: sin `auth` el
      // render revienta antes de pintar nada.
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
// `useLocation()` y `useAuth()`: hacen falta `<MemoryRouter>` y `<AuthProvider>`.
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

const fijo = (id: string, concepto: string, eur: number | null, proveedor = "Proveedor") => ({
  id,
  concepto,
  proveedor,
  categoria: "infraestructura",
  naturaleza: "fijo",
  activo: true,
  eur_mes: eur,
  orden: 1,
  verificado_en: "2026-10-01",
  notas: null,
});

const fila = (proceso: string, real: number, hoy = 0, corte = "2026-10-08") => ({
  proceso,
  usd_real: real,
  ultimo_dia_real: corte,
  usd_estimado_hoy: hoy,
  reparto: "clave_tarifa",
});

/** Hoy = 9 oct 2026, último día cerrado = 8 oct (8 días de mes, 38 desde el 1 de septiembre). Cambio 0,5 EUR/USD. */
function datosConReal() {
  tablaData.costes_fijos = [
    fijo("f1", "Supabase", 25, "Supabase"),
    fijo("f2", "Vercel", 20, "Vercel"),
    fijo("f3", "Dominio", 1.5, "Registrador"),
    fijo("f4", "Resend", null, "Resend"),
  ];
  const hoyOcr = 0.2;
  ventanasReal[1] = [fila("ocr", 0.1, hoyOcr), fila("chat", 0.1), fila("otros", 0.1)];
  ventanasReal[8] = [
    fila("ocr", 2, hoyOcr),
    fila("chat", 1),
    fila("chatweb", 0.5),
    fila("vinos", 0),
    fila("otros", 0.5),
  ];
  ventanasReal[38] = [fila("ocr", 5), fila("chat", 2), fila("chatweb", 1), fila("vinos", 0), fila("otros", 1)];
  rpcData.tipo_cambio_usd_eur_actual = [{ eur_por_usd: 0.5, fecha: "2026-10-08", fuente: "bce" }];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 9, 12, 0, 0));
  for (const k of Object.keys(rpcData)) delete rpcData[k];
  for (const k of Object.keys(ventanasReal)) delete ventanasReal[Number(k)];
  for (const k of Object.keys(tablaData)) delete tablaData[k];
  llamadas.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Costes · una sola vista del mes", () => {
  it("fila de tres cifras: Este mes (fijos + IA real), IA contra el tope y Previsión", async () => {
    datosConReal();
    renderPagina();

    const este = await screen.findByTestId("kpi-este-mes");
    // Fijos conocidos 46,50 + IA real (2,2+1+0,5+0,5)*0,5 = 2,10 → 48,60; "≥" porque Resend está sin verificar.
    expect(este).toHaveTextContent("≥ 48,60 €");
    expect(este).toHaveTextContent("Fijos 46,50 € + IA 2,10 €");
    expect(este).toHaveTextContent("1 fijo sin verificar");

    const ia = screen.getByTestId("kpi-ia-mes");
    expect(ia).toHaveTextContent("2,10 €");
    expect(ia).toHaveTextContent("42 % del tope de 5,00 €");
    expect(within(ia).getByRole("progressbar")).toHaveAttribute("data-nivel", "ok");

    // IA al ritmo del mes: real cerrado 2,00 € / 8 días * 31 + hoy 0,10 = 7,85 → 46,50 + 7,85 = 54,35
    const prev = screen.getByTestId("kpi-prevision");
    expect(prev).toHaveTextContent("≥ 54,35 €");
    expect(prev).toHaveTextContent("IA al ritmo del mes: 7,85 €");
  });

  it("una tabla única ordenada por gasto, con fijos e IA por proceso y el mes anterior", async () => {
    datosConReal();
    renderPagina();
    const tabla = await screen.findByTestId("tabla-partidas");

    const claves = within(tabla)
      .getAllByTestId(/^partida-/)
      .map((f) => f.getAttribute("data-testid"));
    expect(claves).toEqual([
      "partida-fijo:f1", // Supabase 25 €
      "partida-fijo:f2", // Vercel 20 €
      "partida-fijo:f3", // Dominio 1,50 €
      "partida-ia:ocr", // Lectura de facturas 1,10 €
      "partida-ia:chat", // Chatbot 0,50 €
      "partida-ia:chatweb", // Chat de la web 0,25 €
      "partida-ia:otros", // Otros 0,25 €
      "partida-fijo:f4", // Resend, sin verificar, al final
    ]);

    const ocr = within(tabla).getByTestId("partida-ia:ocr");
    expect(ocr).toHaveTextContent("Lectura de facturas");
    expect(ocr).toHaveTextContent("1,10 €"); // este mes: (2 + 0,2) * 0,5
    expect(ocr).toHaveTextContent("≈ 1,50 €"); // mes anterior: (5 - 2) * 0,5, aproximado
    expect(within(tabla).getByTestId("partida-fijo:f4")).toHaveTextContent("sin datos");
    expect(within(tabla).getByTestId("partida-fijo:f1")).toHaveTextContent("25,00 €");
    // Vinos desde foto sin gasto: no ocupa fila.
    expect(within(tabla).queryByText("Vinos desde foto")).not.toBeInTheDocument();
    // Sin las tarjetas sueltas de antes.
    expect(screen.queryByText("Costes fijos mensuales (EUR)")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimación inicial")).not.toBeInTheDocument();
  });

  it("la barra del tope pasa a ámbar al 80 % y a rojo al superarlo", async () => {
    datosConReal();
    tablaData.configuracion_facturas = [{ tope_ia_mes_eur: 2.5 }]; // 2,10 / 2,5 = 84 %
    renderPagina();
    const ia = await screen.findByTestId("kpi-ia-mes");
    await waitFor(() => expect(ia).toHaveTextContent("84 % del tope de 2,50 €"));
    expect(within(ia).getByRole("progressbar")).toHaveAttribute("data-nivel", "aviso");
    expect(ia).toHaveTextContent("cerca del tope");
  });

  it("con tope superado, rojo", async () => {
    datosConReal();
    tablaData.configuracion_facturas = [{ tope_ia_mes_eur: 2 }];
    renderPagina();
    const ia = await screen.findByTestId("kpi-ia-mes");
    await waitFor(() => expect(within(ia).getByRole("progressbar")).toHaveAttribute("data-nivel", "superado"));
    expect(ia).toHaveTextContent("superado");
  });

  it("sin gasto real de OpenAI: la IA es la estimada (ia_uso), una sola fila marcada como estimada", async () => {
    tablaData.costes_fijos = [fijo("f1", "Supabase", 25)];
    rpcData.ia_coste_mes = [
      {
        mes: "2026-10-01",
        coste_acumulado_usd: 2,
        peticiones: 10,
        dias_con_dato: 8,
        dias_mes: 31,
        dias_restantes: 22,
        usd_medio_dia: 0.25,
        proy_lineal_usd: 7.75,
        proy_media7_usd: 8,
        fijos_eur_mes: 25,
        fijos_sin_verificar: 0,
        estimado_ia_usd_mes: 9,
      },
    ];
    renderPagina();
    const este = await screen.findByTestId("kpi-este-mes");
    // 25 + 2 USD * 0,92 = 26,84
    await waitFor(() => expect(este).toHaveTextContent("26,84 €"));
    expect(este).toHaveTextContent("(estimada)");
    expect(screen.getByTestId("partida-ia:estimado")).toHaveTextContent("IA (OpenAI), estimada");
    expect(screen.queryByTestId("partida-ia:ocr")).not.toBeInTheDocument();
  });

  it("sin nada de nada no finge un coste de 0: «sin datos»", async () => {
    renderPagina();
    const este = await screen.findByTestId("kpi-este-mes");
    expect(este).toHaveTextContent("sin datos");
    expect(screen.getByTestId("kpi-prevision")).toHaveTextContent("sin datos");
    expect(await screen.findByText(/Un coste vacío no significa que no se esté gastando/)).toBeInTheDocument();
  });
});

describe("Costes · Detalles", () => {
  it("agrupa real/estimado, tipo de cambio y los avisos en un desplegable", async () => {
    datosConReal();
    rpcData.ia_funciones_sin_registro = [
      { funcion: "ocr_facturas", descripcion: "OCR de facturas", instrumentada: false, ultima_fila: null, dias_sin_registro: null },
    ];
    rpcData.ia_coste_por_modelo = [{ modelo: "gpt-nuevo", tarifado: false, coste_usd: null }];
    renderPagina();
    await screen.findByTestId("tabla-partidas");
    // Los avisos ya no son tarjetas sueltas…
    expect(screen.queryByText("Hay funciones de IA que todavía no registran su consumo")).not.toBeInTheDocument();
    // …están en «Detalles», que lleva un punto de aviso.
    await waitFor(() => expect(screen.getByTestId("detalles-aviso")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("boton-detalles"));

    expect(await screen.findByText("Hay funciones de IA que todavía no registran su consumo")).toBeInTheDocument();
    expect(screen.getByText("ocr_facturas")).toBeInTheDocument();
    expect(screen.getByText(/Modelos usados sin tarifa/)).toBeInTheDocument();
    expect(screen.getByText(/1 USD = 0,500 EUR, BCE 8 oct/)).toBeInTheDocument();
    expect(screen.getByText(/Real \(OpenAI\) hasta el 8 oct/)).toBeInTheDocument();
  });

  it("compara la lectura de facturas: estimado (ia_uso) frente a real (OpenAI) en la misma ventana", async () => {
    datosConReal();
    // Real del mes hasta el 8 oct = 2 USD (ventana de 8 días). Estimado de ia_uso: 1,2 + 0,5 + 0,1 = 1,8 USD (-10 %).
    rpcData.ia_coste_por_funcion = [
      { funcion: "procesar-factura", coste_usd: 1.2 },
      { funcion: "ocr-trabajo", coste_usd: 0.5 },
      { funcion: "clasificar-productos", coste_usd: 0.1 },
      { funcion: "chat-facturas", coste_usd: 9 }, // otro proceso: no cuenta
    ];
    renderPagina();
    await screen.findByTestId("tabla-partidas");
    fireEvent.click(screen.getByTestId("boton-detalles"));
    const linea = await screen.findByTestId("contraste-lectura");
    expect(linea).toHaveTextContent(/Lectura de facturas: estimado \(ia_uso\) 1,80 \$ vs real \(OpenAI\) 2,00 \$ \([-−]10 %\) hasta el 8 oct/);
    // La ventana pedida es del 1 de octubre al último día cerrado.
    const pedida = llamadas.find((l) => l.fn === "ia_coste_por_funcion");
    expect(pedida?.args).toEqual({ p_desde: "2026-10-01", p_hasta: "2026-10-08" });
  });

  it("si ia_uso no tiene tarifa para la lectura, el estimado sale «sin datos» (no 0)", async () => {
    datosConReal();
    rpcData.ia_coste_por_funcion = [{ funcion: "procesar-factura", coste_usd: null }];
    renderPagina();
    await screen.findByTestId("tabla-partidas");
    fireEvent.click(screen.getByTestId("boton-detalles"));
    expect(await screen.findByTestId("contraste-lectura")).toHaveTextContent("estimado (ia_uso) sin datos vs real (OpenAI) 2,00 $");
  });

  it("sin gasto real no hay contraste que hacer", async () => {
    tablaData.costes_fijos = [fijo("f1", "Supabase", 25)];
    renderPagina();
    await screen.findByTestId("tabla-partidas");
    fireEvent.click(screen.getByTestId("boton-detalles"));
    await screen.findByText(/Todavía no hay gasto real/);
    expect(screen.queryByTestId("contraste-lectura")).not.toBeInTheDocument();
  });

  it("sin avisos no hay punto", async () => {
    datosConReal();
    tablaData.costes_fijos = [fijo("f1", "Supabase", 25)]; // verificado y reciente
    renderPagina();
    await screen.findByTestId("tabla-partidas");
    expect(screen.queryByTestId("detalles-aviso")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("boton-detalles"));
    expect(await screen.findByText(/Sin avisos/)).toBeInTheDocument();
  });
});

describe("Costes · acciones", () => {
  it("«Sincronizar ahora» llama a la RPC y se apaga un minuto", async () => {
    datosConReal();
    rpcData.openai_sincronizar_ahora = 1;
    renderPagina();
    const boton = await screen.findByTestId("boton-sincronizar");
    expect(boton).toHaveTextContent("Sincronizar ahora");
    fireEvent.click(boton);
    await waitFor(() => expect(llamadas.some((l) => l.fn === "openai_sincronizar_ahora")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("boton-sincronizar")).toBeDisabled());
    expect(screen.getByTestId("boton-sincronizar")).toHaveTextContent(/Sincronizar \(\d+ s\)/);
  });

  it("el tope se cambia con la RPC fijar_tope_ia_mes", async () => {
    datosConReal();
    rpcData.fijar_tope_ia_mes = 8;
    renderPagina();
    fireEvent.click(await screen.findByTestId("editar-tope-ia"));
    const campo = await screen.findByLabelText("Tope mensual de IA (€)");
    fireEvent.change(campo, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar tope" }));
    await waitFor(() =>
      expect(llamadas.find((l) => l.fn === "fijar_tope_ia_mes")?.args).toEqual({ p_eur: 8 }),
    );
    await waitFor(() => expect(screen.getByTestId("kpi-ia-mes")).toHaveTextContent("de 8,00 €"));
  });

  it("un tope fuera de rango no se puede guardar", async () => {
    datosConReal();
    renderPagina();
    fireEvent.click(await screen.findByTestId("editar-tope-ia"));
    const campo = await screen.findByLabelText("Tope mensual de IA (€)");
    fireEvent.change(campo, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Guardar tope" })).toBeDisabled();
  });
});
