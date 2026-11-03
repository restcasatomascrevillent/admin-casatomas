import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaServicio, ServicioContratado } from "@/lib/servicios";

const h = vi.hoisted(() => ({
  servicios: [] as unknown[],
  errorSelect: null as { code?: string; message: string } | null,
  invoke: vi.fn(),
  rpc: vi.fn(),
  updates: [] as Array<{ cambios: Record<string, unknown>; proveedor: string }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: async () => ({ data: h.errorSelect ? null : h.servicios, error: h.errorSelect }) }),
      update: (cambios: Record<string, unknown>) => ({
        eq: (_col: string, proveedor: string) => ({
          select: async () => {
            h.updates.push({ cambios, proveedor });
            return { data: [{ ...(h.servicios as ServicioContratado[]).find((s) => s.proveedor === proveedor), ...cambios }], error: null };
          },
        }),
      }),
    }),
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));

import SuperAdminServicios from "../SuperAdminServicios";

const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
  plan: "Free", precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null,
  panel_url: `https://${p.proveedor}.example/panel`, limites: {}, notas: null, actualizado_en: "2026-11-03T10:00:00Z", ...p,
});
const SERVICIOS: ServicioContratado[] = [
  servicio({ proveedor: "stripe", nombre: "Stripe", plan: "Sin cuota (comisión por cobro)", precio_mensual: null, moneda: "EUR", ciclo: "por_uso" }),
  servicio({ proveedor: "vercel", nombre: "Vercel", plan: "Hobby", limites: { peticiones_cdn: { orden: 1, etiqueta: "Visitas a las webs", limite: 1000000, unidad: "peticiones" } } }),
  servicio({
    proveedor: "supabase", nombre: "Supabase", limites: {
      bd_tamano: { orden: 1, etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", fuente: "https://supabase.com/docs/x" },
      egreso: { orden: 5, etiqueta: "Datos servidos (egress)", limite: 5, unidad: "GB", nota: "Supabase no da este dato por API en el plan Free." },
    },
  }),
  servicio({ proveedor: "resend", nombre: "Resend", limites: { correos_mes: { orden: 1, etiqueta: "Correos este mes", limite: 3000, unidad: "correos" } } }),
  servicio({ proveedor: "github", nombre: "GitHub" }),
];
const AHORA = new Date().toISOString();
const LECTURAS: LecturaServicio[] = [
  { proveedor: "vercel", tomado_en: AHORA, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN", detalles: { secreto: "SERVICIOS_VERCEL_TOKEN" } },
  { proveedor: "github", tomado_en: AHORA, metricas: {}, error: "credencial_rechazada", detalles: { http: 403 } },
  { proveedor: "stripe", tomado_en: AHORA, metricas: { cobros_mes: { etiqueta: "Cobros este mes", valor: 3, unidad: "cobros" } }, error: null, detalles: { modo: "prueba" } },
  { proveedor: "resend", tomado_en: AHORA, metricas: { correos_mes: { valor: 2950, unidad: "correos" } }, error: null, detalles: {} },
  {
    proveedor: "supabase", tomado_en: AHORA, error: null, desde_cache: true,
    metricas: { bd_tamano: { valor: 400 * 1024 ** 2, unidad: "bytes" } },
    detalles: { secreto_opcional: "SERVICIOS_SUPABASE_TOKEN", avisos: ["Sin SERVICIOS_SUPABASE_TOKEN no salen las peticiones a la API."] },
  },
];

function pintar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><SuperAdminServicios /></QueryClientProvider>);
}
const tarjeta = (nombre: string) => screen.getByRole("article", { name: nombre });

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.servicios = SERVICIOS;
  h.errorSelect = null;
  h.updates = [];
  h.invoke.mockReset().mockResolvedValue({ data: { lecturas: LECTURAS, generado_en: AHORA }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("Super Admin › Servicios", () => {
  it("una tarjeta por proveedor, en orden, con plan, consumo, semáforo y enlace al panel", async () => {
    pintar();
    await screen.findByText("Tamaño de la base de datos");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual(
      ["servicio-vercel", "servicio-supabase", "servicio-github", "servicio-resend", "servicio-stripe"],
    );
    const supa = tarjeta("Supabase");
    const barra = within(supa).getByRole("progressbar", { name: "Tamaño de la base de datos" });
    expect(barra).toHaveAttribute("aria-valuenow", "80");
    expect(barra.getAttribute("aria-valuetext")).toMatch(/80\s%.*cerca del límite/);
    expect(within(supa).getByText(/400 MB/)).toBeInTheDocument();
    expect(within(supa).getByText(/sin dato/)).toBeInTheDocument();
    expect(within(supa).getByText("Supabase no da este dato por API en el plan Free.")).toBeInTheDocument();
    expect(within(supa).getByText(/se renueva cada 15 min/)).toBeInTheDocument();
    expect(within(supa).getByText(/Para ver más datos, configura la clave/)).toBeInTheDocument();
    // Resend al 98 %: rojo, dicho con palabras.
    expect(within(tarjeta("Resend")).getAllByText(/Al límite/).length).toBeGreaterThan(0);
    // Stripe: modo prueba y datos informativos sin barra.
    const stripe = tarjeta("Stripe");
    expect(within(stripe).getByText("Modo prueba")).toBeInTheDocument();
    expect(within(stripe).queryByRole("progressbar")).toBeNull();
    expect(within(stripe).getByText("Pago por uso", { exact: false })).toBeInTheDocument();
    expect(within(stripe).getByRole("link", { name: /Panel de Stripe/ })).toHaveAttribute("href", "https://stripe.example/panel");
    // GitHub: clave rechazada.
    expect(within(tarjeta("GitHub")).getByRole("alert")).toHaveTextContent(/rechazado la clave/);
    expect(h.invoke).toHaveBeenCalledWith("servicios-uso", { body: { forzar: false } });
  });

  it("«Falta configurar la clave X»: cómo hacerlo, con el enlace para crearla", async () => {
    pintar();
    const vercel = await waitFor(() => tarjeta("Vercel"));
    await within(vercel).findByText(/Falta configurar la clave/);
    expect(within(vercel).getByText("SERVICIOS_VERCEL_TOKEN")).toBeInTheDocument();
    fireEvent.click(within(vercel).getByRole("button", { name: /Cómo hacerlo/ }));
    expect(within(vercel).getByText(/Create Token/)).toBeInTheDocument();
    expect(within(vercel).getByRole("link", { name: /Abrir los tokens de Vercel/ })).toHaveAttribute("href", "https://vercel.com/account/settings/tokens");
    expect(within(vercel).getByRole("link", { name: /secretos de Supabase/ })).toBeInTheDocument();
  });

  it("«Actualizar ahora» fuerza solo esa tarjeta; «Actualizar todo ahora», todas", async () => {
    pintar();
    const vercel = await waitFor(() => tarjeta("Vercel"));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(within(vercel).getByRole("button", { name: "Actualizar ahora el consumo de Vercel" }));
    await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("servicios-uso", { body: { forzar: true, proveedor: "vercel" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Actualizar todo ahora/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Actualizar todo ahora/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("servicios-uso", { body: { forzar: true } }));
  });

  it("editar el plan guarda solo columnas editables y valida el enlace", async () => {
    pintar();
    const vercel = await waitFor(() => tarjeta("Vercel"));
    fireEvent.click(within(vercel).getByRole("button", { name: "Editar el plan de Vercel" }));
    const dialogo = await screen.findByRole("dialog", { name: "Editar Vercel" });
    fireEvent.change(within(dialogo).getByLabelText("Enlace al panel del proveedor"), { target: { value: "http://inseguro.test" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialogo).findByText("El enlace tiene que empezar por https://")).toBeInTheDocument();
    expect(h.updates).toEqual([]);
    fireEvent.change(within(dialogo).getByLabelText("Enlace al panel del proveedor"), { target: { value: "https://vercel.com/casa-tomas/~/usage" } });
    fireEvent.change(within(dialogo).getByLabelText("Plan"), { target: { value: "Pro" } });
    fireEvent.change(within(dialogo).getByLabelText("Precio al mes"), { target: { value: "20" } });
    fireEvent.change(within(dialogo).getByLabelText("Límite", { selector: "#servicio-vercel-limite-peticiones_cdn" }), { target: { value: "10.000.000" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(1));
    const { cambios, proveedor } = h.updates[0];
    expect(proveedor).toBe("vercel");
    expect(Object.keys(cambios).sort()).toEqual(["ciclo", "cuenta", "limites", "moneda", "nombre", "notas", "panel_url", "plan", "precio_mensual", "renovacion"]);
    expect(cambios).toMatchObject({ plan: "Pro", precio_mensual: 20, panel_url: "https://vercel.com/casa-tomas/~/usage" });
    expect((cambios.limites as Record<string, { limite: number }>).peticiones_cdn.limite).toBe(10_000_000);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("si la función falla, enseña las últimas lecturas guardadas y lo dice", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    h.rpc.mockResolvedValue({ data: [LECTURAS[4]], error: null });
    pintar();
    expect(await screen.findByText(/No se pudo contactar con la función «servicios-uso»/)).toBeInTheDocument();
    expect(screen.getByText(/Se muestran las últimas lecturas guardadas/)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("servicios_uso_ultimas");
    expect(await within(tarjeta("Supabase")).findByRole("progressbar")).toBeInTheDocument();
  });

  it("sin la migración aplicada, lo explica y no llama a la función", async () => {
    h.errorSelect = { code: "PGRST205", message: "Could not find the table 'public.servicios_contratados' in the schema cache" };
    pintar();
    expect(await screen.findByText(/Falta aplicar en Supabase la migración de Servicios/)).toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
