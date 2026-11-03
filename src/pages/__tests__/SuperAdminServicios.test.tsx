import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaServicio, ServicioContratado } from "@/lib/servicios";

type Estado = { op: "select" | "update"; cambios: Record<string, unknown> | null; filtros: Record<string, unknown> };

const h = vi.hoisted(() => ({
  servicios: [] as unknown[],
  errorSelect: null as { code?: string; message: string } | null,
  /** Base sin 20261103160000: la primera consulta (con las columnas nuevas) falla. */
  sinColumnasNuevas: false,
  config: { eur_por_usd: 0.9, actualizado_en: "2026-11-03T10:00:00Z" } as Record<string, unknown> | null,
  invoke: vi.fn(),
  rpc: vi.fn(),
  updates: [] as Array<{ cambios: Record<string, unknown>; proveedor: string }>,
  updatesConfig: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
}));

// Constructor de consultas encadenable (select/order/limit/update/eq) que se resuelve al hacer await.
function responder(tabla: string, e: Estado, columnas: string) {
  if (tabla === "servicios_contratados") {
    if (e.op === "update") {
      h.updates.push({ cambios: e.cambios!, proveedor: String(e.filtros.proveedor) });
      return { data: [{ ...(h.servicios as ServicioContratado[]).find((s) => s.proveedor === e.filtros.proveedor), ...e.cambios }], error: null };
    }
    h.selects.push(columnas);
    if (h.sinColumnasNuevas && columnas.includes("categoria")) return { data: null, error: { code: "42703", message: "column servicios_contratados.categoria does not exist" } };
    return { data: h.errorSelect ? null : h.servicios, error: h.errorSelect };
  }
  if (tabla === "servicios_config") {
    if (e.op === "update") {
      h.updatesConfig.push(e.cambios!);
      return { data: [{ eur_por_usd: e.cambios!.eur_por_usd }], error: null };
    }
    return h.config ? { data: [h.config], error: null } : { data: null, error: { code: "42P01", message: "relation does not exist" } };
  }
  if (tabla === "tipo_cambio_usd_eur") return { data: [{ fecha: "2026-10-26", eur_por_usd: 0.893815 }], error: null };
  return { data: null, error: { message: `tabla ${tabla} no simulada` } };
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const e: Estado = { op: "select", cambios: null, filtros: {} };
      let columnas = "";
      const b: Record<string, unknown> = {
        select: (c?: string) => { columnas = c ?? ""; return b; },
        order: () => b,
        limit: () => b,
        update: (c: Record<string, unknown>) => { e.op = "update"; e.cambios = c; return b; },
        eq: (col: string, v: unknown) => { e.filtros[col] = v; return b; },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(responder(tabla, e, columnas)).then(ok, ko),
      };
      return b;
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));

import SuperAdminServicios from "../SuperAdminServicios";

// La página carga servicios, lecturas y tipo de cambio en tres consultas: con la
// máquina cargada (CI en paralelo) el segundo por defecto se queda corto.
configure({ asyncUtilTimeout: 5000 });

const enDias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
  plan: "Free", precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null,
  panel_url: `https://${p.proveedor}.example/panel`, limites: {}, notas: null, actualizado_en: "2026-11-03T10:00:00Z",
  categoria: "otros", orden: 100, activo: true, por_confirmar: false, precio_anual: null, fuente_precio: null, ...p,
});
const SERVICIOS: ServicioContratado[] = [
  servicio({ proveedor: "stripe", nombre: "Stripe", plan: "Sin cuota (comisión por cobro)", precio_mensual: null, moneda: "EUR", ciclo: "por_uso", categoria: "pagos", orden: 50 }),
  servicio({ proveedor: "vercel", nombre: "Vercel", plan: "Hobby", categoria: "alojamiento", orden: 10, fuente_precio: "https://vercel.com/pricing", limites: { peticiones_cdn: { orden: 1, etiqueta: "Visitas a las webs", limite: 1000000, unidad: "peticiones" } } }),
  servicio({
    proveedor: "supabase", nombre: "Supabase", categoria: "base_datos", orden: 20, limites: {
      bd_tamano: { orden: 1, etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", fuente: "https://supabase.com/docs/x" },
      egreso: { orden: 5, etiqueta: "Datos servidos (egress)", limite: 5, unidad: "GB", nota: "Supabase no da este dato por API en el plan Free." },
    },
  }),
  servicio({ proveedor: "resend", nombre: "Resend", categoria: "correo", orden: 40, por_confirmar: true, limites: { correos_mes: { orden: 1, etiqueta: "Correos este mes", limite: 3000, unidad: "correos" } } }),
  servicio({ proveedor: "github", nombre: "GitHub", categoria: "codigo", orden: 30 }),
  servicio({ proveedor: "openai", nombre: "OpenAI", plan: "Pago por uso", precio_mensual: null, ciclo: "por_uso", categoria: "ia", orden: 60, limites: { gasto_ia_mes: { orden: 1, etiqueta: "Gasto de IA este mes", unidad: "EUR", limite_desde: "Tope de gasto de IA de Super Admin › Costes" } } }),
  servicio({ proveedor: "hostinger", nombre: "Hostinger", plan: "Premium", precio_mensual: null, precio_anual: 95.88, moneda: "EUR", ciclo: "anual", categoria: "dominio", orden: 95, por_confirmar: true }),
  servicio({ proveedor: "loading", nombre: "Loading", plan: "Por confirmar", precio_mensual: null, moneda: "EUR", ciclo: "anual", categoria: "dominio", orden: 96, por_confirmar: true, renovacion: enDias(20) }),
  servicio({ proveedor: "perplexity", nombre: "Perplexity", plan: "Pago por uso", precio_mensual: null, ciclo: "por_uso", categoria: "ia", orden: 65, activo: false, notas: "Hoy no se usa." }),
];
const AHORA = new Date().toISOString();
const LECTURAS: LecturaServicio[] = [
  { proveedor: "vercel", tomado_en: AHORA, metricas: {}, error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN", detalles: { secreto: "SERVICIOS_VERCEL_TOKEN" } },
  { proveedor: "github", tomado_en: AHORA, metricas: {}, error: "credencial_rechazada", detalles: { http: 403 } },
  {
    proveedor: "stripe", tomado_en: AHORA, metricas: { cobros_mes: { etiqueta: "Cobros este mes", valor: 3, unidad: "cobros" } }, error: null, detalles: { modo: "prueba" },
    coste_variable: { importe: 1.55, moneda: "EUR", periodo: "mes en curso", origen: "bd" },
  },
  { proveedor: "resend", tomado_en: AHORA, metricas: { correos_mes: { valor: 2950, unidad: "correos" } }, error: null, detalles: {} },
  {
    proveedor: "supabase", tomado_en: AHORA, error: null, desde_cache: true,
    metricas: { bd_tamano: { valor: 400 * 1024 ** 2, unidad: "bytes" } },
    detalles: { secreto_opcional: "SERVICIOS_SUPABASE_TOKEN", avisos: ["Sin SERVICIOS_SUPABASE_TOKEN no salen las peticiones a la API."] },
  },
  {
    proveedor: "openai", tomado_en: AHORA, error: null, detalles: {},
    metricas: { gasto_ia_mes: { etiqueta: "Gasto de IA este mes", valor: 2.61, unidad: "EUR", limite: 8, unidad_limite: "EUR" } },
    coste_variable: { importe: 2.9, moneda: "USD", periodo: "mes en curso", origen: "estimado" },
  },
  {
    proveedor: "hostinger", tomado_en: AHORA, error: null, metricas: { suscripciones_activas: { etiqueta: "Suscripciones activas", valor: 1, unidad: "suscripciones" } },
    detalles: { plan_detectado: "Premium Web Hosting", dominios: [{ dominio: "restaurantecasatomascrevillente.es", estado: "active", caduca: `${enDias(70)}T10:00:00Z` }] },
  },
];
const lecturaDe = (p: string) => LECTURAS.find((l) => l.proveedor === p)!;

function pintar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cliente}><SuperAdminServicios /></QueryClientProvider>);
}
const tarjeta = (nombre: string) => screen.getByRole("article", { name: nombre });
/** Intl separa cifra y moneda con espacio irrompible. */
const t = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.servicios = SERVICIOS;
  h.errorSelect = null;
  h.sinColumnasNuevas = false;
  h.config = { eur_por_usd: 0.9, actualizado_en: "2026-11-03T10:00:00Z" };
  h.updates = [];
  h.updatesConfig = [];
  h.selects = [];
  h.invoke.mockReset().mockResolvedValue({ data: { lecturas: LECTURAS, sin_lector: ["loading"], generado_en: AHORA }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("Super Admin › Servicios", () => {
  it("una tarjeta por servicio en uso, en orden, con plan, consumo, semáforo y enlace al panel", async () => {
    pintar();
    await screen.findByText("Tamaño de la base de datos");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual(
      ["servicio-vercel", "servicio-supabase", "servicio-github", "servicio-resend", "servicio-stripe", "servicio-openai", "servicio-hostinger", "servicio-loading"],
    );
    const supa = tarjeta("Supabase");
    // La barra necesita la lectura (llega después de los servicios).
    const barra = await within(supa).findByRole("progressbar", { name: "Tamaño de la base de datos" });
    expect(barra).toHaveAttribute("aria-valuenow", "80");
    expect(barra.getAttribute("aria-valuetext")).toMatch(/80\s%.*cerca del límite/);
    expect(within(supa).getByText(/400 MB/)).toBeInTheDocument();
    expect(within(supa).getByText(/sin dato/)).toBeInTheDocument();
    expect(within(supa).getByText("Supabase no da este dato por API en el plan Free.")).toBeInTheDocument();
    expect(within(supa).getByText(/se renueva cada 15 min/)).toBeInTheDocument();
    expect(within(supa).getByText(/Para ver más datos, configura la clave/)).toBeInTheDocument();
    expect(within(supa).getByText("Base de datos")).toBeInTheDocument(); // categoría
    // Resend al 98 %: rojo, dicho con palabras; y «por confirmar».
    expect(within(tarjeta("Resend")).getAllByText(/Al límite/).length).toBeGreaterThan(0);
    expect(within(tarjeta("Resend")).getByText("Por confirmar")).toBeInTheDocument();
    // Stripe: modo prueba, datos informativos sin barra y su gasto por uso.
    const stripe = tarjeta("Stripe");
    expect(within(stripe).getByText("Modo prueba")).toBeInTheDocument();
    expect(within(stripe).queryByRole("progressbar")).toBeNull();
    expect(within(stripe).getByText("Pago por uso", { exact: false })).toBeInTheDocument();
    expect(t(within(stripe).getByText(/1,55 €/).textContent)).toBe("1,55 €");
    expect(within(stripe).getByRole("link", { name: /Panel de Stripe/ })).toHaveAttribute("href", "https://stripe.example/panel");
    // OpenAI: el gasto en dólares con su equivalente en euros (tipo de cambio 0,9).
    expect(t(within(tarjeta("OpenAI")).getByText(/2,90 US\$/).textContent)).toBe("2,90 US$ (≈ 2,61 €)");
    // Vercel: enlace a los precios oficiales.
    expect(within(tarjeta("Vercel")).getByRole("link", { name: /Precios oficiales de Vercel/ })).toHaveAttribute("href", "https://vercel.com/pricing");
    // GitHub: clave rechazada.
    expect(within(tarjeta("GitHub")).getByRole("alert")).toHaveTextContent(/rechazado la clave/);
    expect(h.invoke).toHaveBeenCalledWith("servicios-uso", { body: { forzar: false } });
  });

  it("arriba: aviso de lo que pasa del 80 %, coste al mes y al año en euros, desglose y renovaciones", async () => {
    pintar();
    const aviso = await screen.findByRole("region", { name: /2 consumos pasan del 80/ });
    // Resend (98 %) antes que Supabase (80 %), con enlace a su tarjeta.
    const enlaces = within(aviso).getAllByRole("link");
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["#tarjeta-resend", "#tarjeta-supabase"]);
    expect(within(aviso).getByText(/98\s%/)).toBeInTheDocument();

    const coste = screen.getByRole("region", { name: "Coste y renovaciones" });
    // Cuotas: Hostinger 95,88 €/año = 7,99 €/mes. Uso: Stripe 1,55 € + OpenAI 2,90 US$ × 0,9 = 2,61 €.
    expect(t(coste.textContent)).toContain("12,15 €");
    expect(t(coste.textContent)).toContain("7,99 € de cuotas + 4,16 € por uso");
    expect(t(coste.textContent)).toContain("Cuotas: 95,88 € al año");
    expect([...coste.querySelectorAll("[data-coste]")].map((x) => x.getAttribute("data-coste"))).toEqual(["hostinger", "openai", "stripe"]);
    expect(t(within(coste).getByText(/uso 2,61 €/).textContent)).toBe("uso 2,61 € (2,90 US$)");
    expect(within(coste).getByText(/Gratis o sin gasto este mes:/).parentElement).toHaveTextContent(/Vercel/);
    expect(within(coste).getByText(/no tiene precio apuntado: Loading/)).toBeInTheDocument();
    // Renovaciones: la de Loading (20 días, apuntada) y el dominio de Hostinger (según su API).
    const renov = within(coste).getByRole("list", { name: "Próximas renovaciones" });
    const filas = within(renov).getAllByRole("listitem");
    expect(filas[0]).toHaveTextContent(/Loading.*en 20 días/);
    expect(filas[1]).toHaveTextContent(/Dominio restaurantecasatomascrevillente\.es \(según su API\).*en 70 días/);
    expect(t(coste.textContent)).toMatch(/Próxima renovación.*Loading · en 20 días/);
  });

  it("tipo de cambio: se ve, se cambia (solo con número válido) y se puede usar el del BCE", async () => {
    pintar();
    const coste = await screen.findByRole("region", { name: "Coste y renovaciones" });
    await within(coste).findByText(/1 US\$ = 0,9000 €/);
    expect(within(coste).getByText(/Banco Central Europeo: 0,893815 € \(26\/10\/2026\)/)).toBeInTheDocument();
    fireEvent.click(within(coste).getByRole("button", { name: "Cambiar el tipo de cambio del dólar" }));
    const campo = within(coste).getByLabelText("Euros por 1 dólar");
    fireEvent.change(campo, { target: { value: "7" } });
    fireEvent.click(within(coste).getByRole("button", { name: "Guardar" }));
    expect(await within(coste).findByText(/cuántos euros vale un dólar/)).toBeInTheDocument();
    expect(h.updatesConfig).toEqual([]);
    fireEvent.change(campo, { target: { value: "0,95" } });
    fireEvent.click(within(coste).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.updatesConfig).toEqual([{ eur_por_usd: 0.95 }]));
    fireEvent.click(await within(coste).findByRole("button", { name: "Usar el del BCE" }));
    await waitFor(() => expect(h.updatesConfig).toEqual([{ eur_por_usd: 0.95 }, { eur_por_usd: 0.893815 }]));
  });

  it("Hostinger enseña plan y dominios de su API; Loading, que no hay lectura automática; lo que no se usa va plegado", async () => {
    pintar();
    const hostinger = await waitFor(() => tarjeta("Hostinger"));
    expect(await within(hostinger).findByText(/plan Premium Web Hosting/)).toBeInTheDocument();
    expect(within(hostinger).getByText(/restaurantecasatomascrevillente\.es \(caduca el/)).toBeInTheDocument();
    expect(t(within(hostinger).getByText(/al año/).textContent)).toContain("95,88 € al año");
    const loading = tarjeta("Loading");
    expect(within(loading).getAllByText(/Sin lectura automática/).length).toBeGreaterThan(0);
    expect(within(loading).queryByRole("button", { name: /Actualizar ahora/ })).toBeNull();
    // Perplexity («no lo usamos»): fuera de las tarjetas y del coste, plegado al final.
    expect(screen.queryByRole("article", { name: "Perplexity" })).toBeNull();
    expect(screen.queryByText(/Hoy no se usa/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Servicios que no usamos ahora \(1\)/ }));
    expect(await screen.findByText(/Hoy no se usa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar el plan de Perplexity" })).toBeInTheDocument();
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
    expect(Object.keys(cambios).sort()).toEqual([
      "activo", "categoria", "ciclo", "cuenta", "fuente_precio", "limites", "moneda", "nombre", "notas", "orden", "panel_url", "plan", "por_confirmar", "precio_anual", "precio_mensual", "renovacion",
    ]);
    expect(cambios).toMatchObject({ plan: "Pro", precio_mensual: 20, precio_anual: null, panel_url: "https://vercel.com/casa-tomas/~/usage", categoria: "alojamiento", orden: 10, activo: true });
    expect((cambios.limites as Record<string, { limite: number }>).peticiones_cdn.limite).toBe(10_000_000);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("editar: plan anual con precio al año, «Lo usamos», «por confirmar» y el límite automático del tope de IA", async () => {
    pintar();
    const hostinger = await waitFor(() => tarjeta("Hostinger"));
    fireEvent.click(within(hostinger).getByRole("button", { name: "Editar el plan de Hostinger" }));
    const dialogo = await screen.findByRole("dialog", { name: "Editar Hostinger" });
    expect(within(dialogo).getByLabelText("Precio al año")).toHaveValue("95,88");
    fireEvent.change(within(dialogo).getByLabelText("Precio al año"), { target: { value: "107,88" } });
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: /Lo usamos/ }));
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: /por confirmar/ }));
    fireEvent.change(within(dialogo).getByLabelText("Página oficial del precio"), { target: { value: "https://www.hostinger.com/es" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0].cambios).toMatchObject({ precio_anual: 107.88, precio_mensual: null, ciclo: "anual", activo: false, por_confirmar: false, fuente_precio: "https://www.hostinger.com/es" });

    fireEvent.click(within(tarjeta("OpenAI")).getByRole("button", { name: "Editar el plan de OpenAI" }));
    const ia = await screen.findByRole("dialog", { name: "Editar OpenAI" });
    expect(within(ia).getByText(/Vacío = automático: Tope de gasto de IA/)).toBeInTheDocument();
    fireEvent.click(within(ia).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect("limite" in (h.updates[1].cambios.limites as Record<string, object>).gasto_ia_mes).toBe(false);
  });

  it("si la función falla, enseña las últimas lecturas guardadas y lo dice", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    h.rpc.mockResolvedValue({ data: [lecturaDe("supabase")], error: null });
    pintar();
    expect(await screen.findByText(/No se pudo contactar con la función «servicios-uso»/)).toBeInTheDocument();
    expect(screen.getByText(/Se muestran las últimas lecturas guardadas/)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("servicios_uso_ultimas");
    expect(await within(tarjeta("Supabase")).findByRole("progressbar")).toBeInTheDocument();
  });

  it("sin la migración de costes (20261103160000): carga con las columnas de antes y lo dice", async () => {
    h.sinColumnasNuevas = true;
    h.config = null;
    h.servicios = SERVICIOS.slice(0, 5).map(({ categoria: _c, orden: _o, activo: _a, por_confirmar: _p, precio_anual: _pa, fuente_precio: _f, ...viejo }) => viejo);
    pintar();
    expect(await screen.findByText(/Falta aplicar en Supabase la migración 20261103160000/)).toBeInTheDocument();
    expect(h.selects.length).toBe(2);
    expect(h.selects[1]).not.toContain("categoria");
    // Orden de siempre aunque no haya columna `orden`.
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual(
      ["servicio-vercel", "servicio-supabase", "servicio-github", "servicio-resend", "servicio-stripe"],
    );
    fireEvent.click(within(tarjeta("Vercel")).getByRole("button", { name: "Editar el plan de Vercel" }));
    const dialogo = await screen.findByRole("dialog", { name: "Editar Vercel" });
    expect(within(dialogo).queryByRole("checkbox", { name: /Lo usamos/ })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(Object.keys(h.updates[0].cambios)).not.toContain("categoria");
  });

  it("sin la migración aplicada, lo explica y no llama a la función", async () => {
    h.errorSelect = { code: "PGRST205", message: "Could not find the table 'public.servicios_contratados' in the schema cache" };
    pintar();
    expect(await screen.findByText(/Falta aplicar en Supabase la migración de Servicios/)).toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
