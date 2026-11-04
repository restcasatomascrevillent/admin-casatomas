import { readFileSync } from "node:fs";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type LecturaServicio, type ServicioContratado, formatearEur } from "@/lib/servicios";
import { rutaServicios } from "@/components/servicios/pestanas";

type Estado = { op: "select" | "update" | "insert" | "delete"; cambios: Record<string, unknown> | null; filtros: Record<string, unknown> };
type Toast = { action?: { label: string; onClick: () => void } };

const h = vi.hoisted(() => ({
  servicios: [] as unknown[],
  errorSelect: null as { code?: string; message: string } | null,
  /** Base sin 20261103160000: la primera consulta (con las columnas nuevas) falla. */
  sinColumnasNuevas: false,
  /** Base sin 20261104121000: el alta y el borrado dan «permission denied». */
  errorAltaBaja: null as { code?: string; message: string } | null,
  config: { eur_por_usd: 0.9, actualizado_en: "2026-11-03T10:00:00Z" } as Record<string, unknown> | null,
  invoke: vi.fn(),
  rpc: vi.fn(),
  updates: [] as Array<{ cambios: Record<string, unknown>; proveedor: string }>,
  inserts: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Record<string, unknown>>,
  updatesConfig: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Supabase falso que guarda los cambios: tras «Quitar», «Añadir» o «Borrar», la pantalla vuelve a leer y los ve.
function responder(tabla: string, e: Estado, columnas: string) {
  if (tabla === "servicios_contratados") {
    const lista = h.servicios as ServicioContratado[];
    if (e.op === "update") {
      h.updates.push({ cambios: e.cambios!, proveedor: String(e.filtros.proveedor) });
      h.servicios = lista.map((s) => (s.proveedor === e.filtros.proveedor ? { ...s, ...e.cambios } : s));
      return { data: [(h.servicios as ServicioContratado[]).find((s) => s.proveedor === e.filtros.proveedor)], error: null };
    }
    if (e.op === "insert") {
      if (h.errorAltaBaja) return { data: null, error: h.errorAltaBaja };
      h.inserts.push(e.cambios!);
      const fila = { ...e.cambios, actualizado_en: "2026-11-04T10:00:00Z" } as unknown as ServicioContratado;
      h.servicios = [...lista, fila];
      return { data: [fila], error: null };
    }
    if (e.op === "delete") {
      if (h.errorAltaBaja) return { data: null, error: h.errorAltaBaja };
      h.deletes.push({ ...e.filtros });
      const borrar = lista.filter((s) => s.proveedor === e.filtros.proveedor && s.activo === e.filtros.activo);
      h.servicios = lista.filter((s) => !borrar.includes(s));
      return { data: borrar.map((s) => ({ proveedor: s.proveedor })), error: null };
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
        insert: (c: Record<string, unknown>) => { e.op = "insert"; e.cambios = c; return b; },
        delete: () => { e.op = "delete"; return b; },
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
vi.mock("sonner", () => ({ toast: h.toast }));

import SuperAdminServicios from "../SuperAdminServicios";

// La página carga servicios, lecturas, tipo de cambio y los avisos de IA: con
// la máquina cargada (CI en paralelo) el segundo por defecto se queda corto.
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
  servicio({ proveedor: "openai", nombre: "OpenAI", plan: "Pago por uso", precio_mensual: null, ciclo: "por_uso", categoria: "ia", orden: 60, limites: { gasto_ia_mes: { orden: 1, etiqueta: "Gasto de IA este mes", unidad: "EUR", limite_desde: "Tope de gasto de IA de Super Admin › Servicios › Costes" } } }),
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

/** Dónde está el router (para comprobar la URL de las pestañas y la redirección). */
function Ubicacion() {
  const l = useLocation();
  return <output data-testid="ubicacion">{`${l.pathname}${l.search}`}</output>;
}
function pintar(ruta = "/super-admin/servicios") {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          {/* Igual que App.tsx (comprobado abajo): la ruta vieja de Costes lleva a su pestaña. */}
          <Route path="/super-admin/costes" element={<Navigate to={rutaServicios("costes")} replace />} />
          <Route path="/super-admin/servicios" element={<SuperAdminServicios />} />
        </Routes>
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const ubicacion = () => screen.getByTestId("ubicacion").textContent;
const pestana = (nombre: string) => screen.getByRole("tab", { name: new RegExp(`^${nombre}`) });
const abrirPestana = (nombre: string) => fireEvent.mouseDown(pestana(nombre), { button: 0, ctrlKey: false });
const tarjeta = (nombre: string) => screen.getByRole("article", { name: nombre });
/** Intl separa cifra y moneda con espacio irrompible. */
const t = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");
const eur = (n: number) => t(formatearEur(n));

/** Lo que dan las cuentas con estos datos: cuotas 7,99 €/mes (Hostinger), uso 4,16 € (Stripe 1,55 + OpenAI 2,90 US$ × 0,9). */
function previsiones() {
  const hoy = new Date();
  const dias = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();
  const mes = 7.99 + 4.16 * (dias / Math.max(1, hoy.getUTCDate()));
  return { mes: Math.round(mes * 100) / 100, anio: Math.round(mes * 12 * 100) / 100 };
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.servicios = [...SERVICIOS];
  h.errorSelect = null;
  h.sinColumnasNuevas = false;
  h.errorAltaBaja = null;
  h.config = { eur_por_usd: 0.9, actualizado_en: "2026-11-03T10:00:00Z" };
  h.updates = [];
  h.inserts = [];
  h.deletes = [];
  h.updatesConfig = [];
  h.selects = [];
  h.invoke.mockReset().mockResolvedValue({ data: { lecturas: LECTURAS, sin_lector: ["loading"], generado_en: AHORA }, error: null });
  h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  for (const f of Object.values(h.toast)) f.mockReset();
});

describe("Super Admin › Servicios · pestañas y URL", () => {
  it("cuatro pestañas; sin `?tab=` abre el Resumen y cada pestaña queda en la URL", async () => {
    pintar();
    expect(screen.getByRole("heading", { level: 1, name: "Servicios" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((x) => x.textContent?.replace(/\d+$/, ""))).toEqual(["Resumen", "Servicios", "Costes", "Configurar"]);
    expect(pestana("Resumen")).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("region", { name: /Requiere atención/ });

    abrirPestana("Costes");
    expect(pestana("Costes")).toHaveAttribute("aria-selected", "true");
    expect(ubicacion()).toBe("/super-admin/servicios?tab=costes");
    abrirPestana("Configurar");
    expect(ubicacion()).toBe("/super-admin/servicios?tab=configurar");
    abrirPestana("Resumen");
    expect(ubicacion()).toBe("/super-admin/servicios");
  });

  it("`?tab=servicios` abre directamente esa pestaña; un `?tab=` desconocido, el Resumen", async () => {
    const { unmount } = pintar("/super-admin/servicios?tab=servicios");
    expect(pestana("Servicios")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => tarjeta("Vercel"));
    unmount();
    pintar("/super-admin/servicios?tab=otra");
    expect(pestana("Resumen")).toHaveAttribute("aria-selected", "true");
  });

  it("la ruta vieja /super-admin/costes lleva a la pestaña Costes", async () => {
    pintar("/super-admin/costes");
    await waitFor(() => expect(ubicacion()).toBe("/super-admin/servicios?tab=costes"));
    expect(pestana("Costes")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Inteligencia artificial (OpenAI)" })).toBeInTheDocument();
  });

  it("App.tsx redirige la ruta vieja y ya no carga la página Costes", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="\/super-admin\/costes" element=\{<Navigate to=\{rutaServicios\("costes"\)\} replace \/>\}/);
    expect(app).not.toMatch(/pages\/Costes/);
    expect(rutaServicios("costes")).toBe("/super-admin/servicios?tab=costes");
    expect(rutaServicios()).toBe("/super-admin/servicios");
  });
});

describe("Super Admin › Servicios › Resumen", () => {
  it("de un vistazo: gasto del mes, previsión a fin de mes y del año", async () => {
    pintar();
    const mes = await screen.findByTestId("cifra-mes");
    // Cuotas: Hostinger 95,88 €/año = 7,99 €/mes. Uso: Stripe 1,55 € + OpenAI 2,90 US$ × 0,9 = 2,61 €.
    await waitFor(() => expect(t(mes.textContent)).toContain("12,15 €"));
    expect(t(mes.textContent)).toContain("7,99 € de cuotas + 4,16 € por uso, hasta hoy");
    expect(t(mes.textContent)).toContain("No incluye Loading: falta su precio.");
    const { mes: finMes, anio } = previsiones();
    expect(t(screen.getByTestId("cifra-fin-mes").textContent)).toContain(`≈ ${eur(finMes)}`);
    expect(t(screen.getByTestId("cifra-anio").textContent)).toContain(`≈ ${eur(anio)}`);
    expect(t(screen.getByTestId("cifra-anio").textContent)).toContain("Cuotas: 95,88 € al año");
  });

  it("«Requiere atención»: lo urgente primero (rojo), luego avisos y lo que hay que revisar", async () => {
    pintar();
    const bloque = await screen.findByRole("region", { name: /Requiere atención \(6\)/ });
    const filas = within(bloque).getAllByRole("listitem");
    expect(filas.map((f) => [f.getAttribute("data-pendiente")?.split(":").slice(0, 2).join(":"), f.getAttribute("data-gravedad")])).toEqual([
      ["consumo:resend", "rojo"],
      ["error:credencial_rechazada", "rojo"],
      ["consumo:supabase", "ambar"],
      ["renovacion:loading", "ambar"],
      ["error:falta_secreto", "ambar"],
      ["configurar:por-confirmar", "info"],
    ]);
    expect(t(filas[0].textContent)).toMatch(/Resend · Correos este mes.*98 % del límite \(2950 de 3000 correos\)/);
    expect(filas[1]).toHaveTextContent("GitHub: rechaza la clave guardada");
    expect(filas[3]).toHaveTextContent(/Loading · Renovación \(dominio o plan\).*Se renueva en 20 días/);
    expect(filas[4]).toHaveTextContent("Vercel: falta configurar la clave");
    expect(filas[5]).toHaveTextContent("3 servicios con el plan o el precio por confirmar");
    expect(filas[5]).toHaveTextContent("Loading, Resend, Hostinger");
    // Dos urgentes: el contador de la pestaña lo dice.
    expect(within(bloque).getByText(/2 son urgentes/)).toBeInTheDocument();
    expect(pestana("Resumen")).toHaveTextContent("2");
  });

  it("avisa de la IA que no registra su gasto y lleva a Costes", async () => {
    h.rpc.mockImplementation(async (fn: string) => fn === "ia_funciones_sin_registro"
      ? { data: [{ funcion: "ocr_facturas", descripcion: "OCR", instrumentada: false, ultima_fila: null, dias_sin_registro: null }], error: null }
      : { data: [], error: null });
    pintar();
    const bloque = await screen.findByRole("region", { name: /Requiere atención/ });
    const fila = await within(bloque).findByText("Una función de IA no registra su gasto");
    fireEvent.click(within(fila.closest("li")!).getByRole("button", { name: /Ver en Costes/ }));
    expect(pestana("Costes")).toHaveAttribute("aria-selected", "true");
    expect(ubicacion()).toBe("/super-admin/servicios?tab=costes");
  });

  it("«Ver» lleva a la tarjeta del servicio en la pestaña Servicios y la enfoca", async () => {
    pintar();
    const bloque = await screen.findByRole("region", { name: /Requiere atención/ });
    fireEvent.click(await within(bloque).findByRole("button", { name: "Ver: Resend · Correos este mes" }));
    expect(pestana("Servicios")).toHaveAttribute("aria-selected", "true");
    expect(ubicacion()).toBe("/super-admin/servicios?tab=servicios");
    await waitFor(() => expect(document.activeElement).toBe(tarjeta("Resend")));
  });

  it("lo más cerca del límite (con barra y %) y las próximas renovaciones", async () => {
    pintar();
    const cerca = await screen.findByRole("region", { name: "Lo más cerca del límite" });
    await waitFor(() => expect(within(cerca).getAllByRole("progressbar")).toHaveLength(3));
    expect(within(cerca).getAllByRole("progressbar").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Resend · Correos este mes", "Supabase · Tamaño de la base de datos", "OpenAI · Gasto de IA este mes",
    ]);
    expect(within(cerca).getAllByRole("progressbar")[0].getAttribute("aria-valuetext")).toMatch(/98\s%.*al límite/);
    const renov = screen.getByRole("list", { name: "Próximas renovaciones" });
    const filas = within(renov).getAllByRole("listitem");
    expect(filas[0]).toHaveTextContent(/Loading.*en 20 días/);
    expect(filas[1]).toHaveTextContent(/Dominio restaurantecasatomascrevillente\.es \(según su API\).*en 70 días/);
    fireEvent.click(within(cerca).getByRole("button", { name: /Ver todo el consumo/ }));
    expect(pestana("Servicios")).toHaveAttribute("aria-selected", "true");
  });

  it("sin nada pendiente lo dice en verde", async () => {
    h.servicios = [servicio({ proveedor: "supabase", nombre: "Supabase", limites: { bd_tamano: { etiqueta: "BD", limite: 500, unidad: "MB" } } })];
    h.invoke.mockResolvedValue({ data: { lecturas: [{ proveedor: "supabase", tomado_en: AHORA, error: null, detalles: {}, metricas: { bd_tamano: { valor: 10, unidad: "MB" } } }], sin_lector: [], generado_en: AHORA }, error: null });
    pintar();
    expect(await screen.findByText(/Nada pendiente/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Requiere atención" })).toBeInTheDocument();
  });
});

describe("Super Admin › Servicios › Servicios (tarjetas)", () => {
  it("una tarjeta por servicio en uso, en orden, con plan, consumo, semáforo y enlace al panel", async () => {
    pintar("/super-admin/servicios?tab=servicios");
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
    // Sin el coste ni los avisos de antes: están en Resumen y en Costes.
    expect(screen.queryByRole("region", { name: "Coste y renovaciones" })).toBeNull();
  });

  it("Hostinger enseña plan y dominios de su API; Loading, que no hay lectura automática; lo quitado no sale (está en Configurar)", async () => {
    pintar("/super-admin/servicios?tab=servicios");
    const hostinger = await waitFor(() => tarjeta("Hostinger"));
    expect(await within(hostinger).findByText(/plan Premium Web Hosting/)).toBeInTheDocument();
    expect(within(hostinger).getByText(/restaurantecasatomascrevillente\.es \(caduca el/)).toBeInTheDocument();
    expect(t(within(hostinger).getByText(/al año/).textContent)).toContain("95,88 € al año");
    const loading = tarjeta("Loading");
    expect(within(loading).getAllByText(/Sin lectura automática/).length).toBeGreaterThan(0);
    expect(within(loading).queryByRole("button", { name: /Actualizar ahora/ })).toBeNull();
    expect(screen.queryByRole("article", { name: "Perplexity" })).toBeNull();
    expect(screen.getByText(/Hay 1 servicio quitado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verlos en Configurar/ }));
    expect(pestana("Configurar")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("list", { name: /Quitados \(1\)/ })).toHaveTextContent("Perplexity");
  });

  it("«Falta configurar la clave X»: cómo hacerlo, con el enlace para crearla", async () => {
    pintar("/super-admin/servicios?tab=servicios");
    const vercel = await waitFor(() => tarjeta("Vercel"));
    await within(vercel).findByText(/Falta configurar la clave/);
    expect(within(vercel).getByText("SERVICIOS_VERCEL_TOKEN")).toBeInTheDocument();
    fireEvent.click(within(vercel).getByRole("button", { name: /Cómo hacerlo/ }));
    expect(within(vercel).getByText(/Create Token/)).toBeInTheDocument();
    expect(within(vercel).getByRole("link", { name: /Abrir los tokens de Vercel/ })).toHaveAttribute("href", "https://vercel.com/account/settings/tokens");
    expect(within(vercel).getByRole("link", { name: /secretos de Supabase/ })).toBeInTheDocument();
  });

  it("«Actualizar ahora» fuerza solo esa tarjeta; «Actualizar todo ahora», todas", async () => {
    pintar("/super-admin/servicios?tab=servicios");
    const vercel = await waitFor(() => tarjeta("Vercel"));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(within(vercel).getByRole("button", { name: "Actualizar ahora el consumo de Vercel" }));
    await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("servicios-uso", { body: { forzar: true, proveedor: "vercel" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Actualizar todo ahora/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Actualizar todo ahora/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("servicios-uso", { body: { forzar: true } }));
  });

  it("editar el plan guarda solo columnas editables y valida el enlace", async () => {
    pintar("/super-admin/servicios?tab=servicios");
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
    pintar("/super-admin/servicios?tab=servicios");
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
    expect(within(ia).getByText(/Vacío = automático: Tope de gasto de IA de Super Admin › Servicios › Costes/)).toBeInTheDocument();
    fireEvent.click(within(ia).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect("limite" in (h.updates[1].cambios.limites as Record<string, object>).gasto_ia_mes).toBe(false);
  });
});

describe("Super Admin › Servicios › Costes", () => {
  it("coste del mes por proveedor (cuota y uso, en euros) con el total, y la IA por proceso debajo", async () => {
    pintar("/super-admin/servicios?tab=costes");
    const bloque = await screen.findByRole("region", { name: "Coste de este mes por proveedor" });
    await waitFor(() => expect([...bloque.querySelectorAll("[data-coste]")].map((x) => x.getAttribute("data-coste"))).toEqual(["hostinger", "openai", "stripe"]));
    expect(t(within(bloque).getByText(/uso 2,61 €/).textContent)).toBe("uso 2,61 € (2,90 US$)");
    expect(t(within(bloque).getByTestId("desglose-total").textContent)).toContain("Total este mes12,15 €7,99 € de cuotas + 4,16 € por uso");
    expect(within(bloque).getByText(/Gratis o sin gasto este mes:/).parentElement).toHaveTextContent(/Vercel/);
    expect(within(bloque).getByText(/no tiene precio apuntado: Loading/)).toBeInTheDocument();
    expect(t(within(bloque).getByText(/Lo que se paga en dólares/).textContent)).toContain("1 US$ = 0,9000 € (se cambia en «Configurar»)");
    // La IA (lo que era la pantalla Costes), con su tope, «Sincronizar ahora» y «Detalles».
    const ia = screen.getByRole("region", { name: "Inteligencia artificial (OpenAI)" });
    expect(within(ia).getByTestId("boton-sincronizar")).toBeInTheDocument();
    expect(within(ia).getByTestId("boton-detalles")).toBeInTheDocument();
    expect(await within(ia).findByTestId("kpi-ia-mes")).toBeInTheDocument();
    // Sin duplicar el Resumen: ni las cifras de cabecera ni lo que requiere atención.
    expect(screen.queryByTestId("cifra-mes")).toBeNull();
    expect(screen.queryByRole("region", { name: /Requiere atención/ })).toBeNull();
  });
});

describe("Super Admin › Servicios › Configurar", () => {
  it("lista lo que está en uso y lo quitado, cada uno con sus acciones", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    const enUso = await screen.findByRole("list", { name: /En uso \(8\)/ });
    expect(within(enUso).getAllByRole("listitem").map((l) => l.getAttribute("data-servicio"))).toEqual(
      ["vercel", "supabase", "github", "resend", "stripe", "openai", "hostinger", "loading"],
    );
    const vercel = within(enUso).getAllByRole("listitem")[0];
    expect(vercel).toHaveTextContent(/Vercel.*Webs y alojamiento.*Plan Hobby · Gratis/);
    expect(within(vercel).getByRole("button", { name: "Editar Vercel" })).toBeInTheDocument();
    expect(within(vercel).getByRole("button", { name: "Quitar Vercel del panel" })).toBeInTheDocument();
    expect(within(vercel).queryByRole("button", { name: /Borrar/ })).toBeNull(); // lo que está en uso no se borra
    const quitados = screen.getByRole("list", { name: /Quitados \(1\)/ });
    const perplexity = within(quitados).getByRole("listitem");
    expect(within(perplexity).getByRole("button", { name: "Volver a usar Perplexity" })).toBeInTheDocument();
    expect(within(perplexity).getByRole("button", { name: "Borrar Perplexity del todo" })).toBeInTheDocument();
    // Editar abre el mismo diálogo que las tarjetas.
    fireEvent.click(within(vercel).getByRole("button", { name: "Editar Vercel" }));
    expect(await screen.findByRole("dialog", { name: "Editar Vercel" })).toBeInTheDocument();
  });

  it("quitar = «no lo usamos» (no se borra), con «Deshacer»; y volver a usarlo", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    const enUso = await screen.findByRole("list", { name: /En uso \(8\)/ });
    fireEvent.click(within(enUso).getByRole("button", { name: "Quitar Resend del panel" }));
    await waitFor(() => expect(h.updates).toEqual([{ proveedor: "resend", cambios: { activo: false } }]));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /Quitados \(2\)/ })).getByText("Resend")).toBeInTheDocument());
    expect(h.deletes).toEqual([]);
    // «Deshacer» del aviso lo vuelve a poner.
    const [texto, opciones] = h.toast.success.mock.calls[0] as [string, Toast];
    expect(texto).toMatch(/Resend quitado/);
    opciones.action!.onClick();
    await waitFor(() => expect(h.updates[1]).toEqual({ proveedor: "resend", cambios: { activo: true } }));
    await screen.findByRole("list", { name: /En uso \(8\)/ });
    fireEvent.click(within(screen.getByRole("list", { name: /Quitados \(1\)/ })).getByRole("button", { name: "Volver a usar Perplexity" }));
    await waitFor(() => expect(h.updates[2]).toEqual({ proveedor: "perplexity", cambios: { activo: true } }));
    await screen.findByRole("list", { name: /En uso \(9\)/ });
  });

  it("borrar del todo (solo lo quitado) pide confirmación", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    const quitados = await screen.findByRole("list", { name: /Quitados \(1\)/ });
    fireEvent.click(within(quitados).getByRole("button", { name: "Borrar Perplexity del todo" }));
    const confirmar = await screen.findByRole("alertdialog", { name: "¿Borrar Perplexity del todo?" });
    expect(confirmar).toHaveTextContent(/sus lecturas de consumo\. No se puede deshacer/);
    fireEvent.click(within(confirmar).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.deletes).toEqual([]);

    fireEvent.click(within(quitados).getByRole("button", { name: "Borrar Perplexity del todo" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Borrar del todo" }));
    await waitFor(() => expect(h.deletes).toEqual([{ proveedor: "perplexity", activo: false }]));
    await waitFor(() => expect(screen.queryByRole("list", { name: /Quitados/ })).toBeNull());
    expect(h.toast.success).toHaveBeenCalledWith("Perplexity: borrado");
  });

  it("añadir un servicio: el nombre es obligatorio y la clave sale del nombre", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio" }));
    const dialogo = await screen.findByRole("dialog", { name: "Añadir un servicio" });
    expect(within(dialogo).queryByRole("checkbox", { name: /Lo usamos/ })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir servicio" }));
    expect(await within(dialogo).findByText(/Pon un nombre/)).toBeInTheDocument();
    expect(h.inserts).toEqual([]);

    fireEvent.change(within(dialogo).getByLabelText("Nombre"), { target: { value: "Google Analytics" } });
    fireEvent.change(within(dialogo).getByLabelText("Plan"), { target: { value: "Gratis" } });
    fireEvent.change(within(dialogo).getByLabelText("Precio al mes"), { target: { value: "12,50" } });
    fireEvent.change(within(dialogo).getByLabelText("Enlace al panel del proveedor"), { target: { value: "https://analytics.google.com" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir servicio" }));
    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0]).toMatchObject({
      proveedor: "google_analytics", nombre: "Google Analytics", plan: "Gratis", precio_mensual: 12.5, moneda: "EUR", ciclo: "mensual",
      categoria: "otros", orden: 106, activo: true, panel_url: "https://analytics.google.com", limites: {},
    });
    expect(Object.keys(h.inserts[0])).not.toContain("actualizado_por");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.toast.success).toHaveBeenCalledWith("Google Analytics: añadido");
    // Sale en la lista y en el coste (12,50 € de cuota).
    const enUso = await screen.findByRole("list", { name: /En uso \(9\)/ });
    expect(within(enUso).getAllByRole("listitem").at(-1)).toHaveAttribute("data-servicio", "google_analytics");
  });

  it("si un nombre ya existe, la clave nueva no choca", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio" }));
    const dialogo = await screen.findByRole("dialog", { name: "Añadir un servicio" });
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), { target: { value: "Vercel" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir servicio" }));
    await waitFor(() => expect(h.inserts[0]).toMatchObject({ proveedor: "vercel_2", nombre: "Vercel" }));
  });

  it("sin la migración 20261104121000, explica que falta al añadir", async () => {
    h.errorAltaBaja = { code: "42501", message: "permission denied for table servicios_contratados" };
    pintar("/super-admin/servicios?tab=configurar");
    fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio" }));
    const dialogo = await screen.findByRole("dialog", { name: "Añadir un servicio" });
    fireEvent.change(within(dialogo).getByLabelText("Nombre"), { target: { value: "n8n" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Añadir servicio" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Para añadir servicios falta aplicar en Supabase la migración 20261104121000_servicios_configurables."));
    expect(screen.getByRole("dialog", { name: "Añadir un servicio" })).toBeInTheDocument();
  });

  it("tipo de cambio: se ve, se cambia (solo con número válido) y se puede usar el del BCE", async () => {
    pintar("/super-admin/servicios?tab=configurar");
    const cambio = await screen.findByRole("region", { name: "Tipo de cambio del dólar" });
    await within(cambio).findByText(/1 US\$ = 0,9000 €/);
    expect(within(cambio).getByText(/Banco Central Europeo: 0,893815 € \(26\/10\/2026\)/)).toBeInTheDocument();
    fireEvent.click(within(cambio).getByRole("button", { name: "Cambiar el tipo de cambio del dólar" }));
    const campo = within(cambio).getByLabelText("Euros por 1 dólar");
    fireEvent.change(campo, { target: { value: "7" } });
    fireEvent.click(within(cambio).getByRole("button", { name: "Guardar" }));
    expect(await within(cambio).findByText(/cuántos euros vale un dólar/)).toBeInTheDocument();
    expect(h.updatesConfig).toEqual([]);
    fireEvent.change(campo, { target: { value: "0,95" } });
    fireEvent.click(within(cambio).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.updatesConfig).toEqual([{ eur_por_usd: 0.95 }]));
    fireEvent.click(await within(cambio).findByRole("button", { name: "Usar el del BCE" }));
    await waitFor(() => expect(h.updatesConfig).toEqual([{ eur_por_usd: 0.95 }, { eur_por_usd: 0.893815 }]));
  });
});

describe("Super Admin › Servicios · sin migraciones o con fallos", () => {
  it("si la función falla, enseña las últimas lecturas guardadas y lo dice", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    h.rpc.mockImplementation(async (fn: string) => ({ data: fn === "servicios_uso_ultimas" ? [lecturaDe("supabase")] : [], error: null }));
    pintar("/super-admin/servicios?tab=servicios");
    expect(await screen.findByText(/No se pudo contactar con la función «servicios-uso»/)).toBeInTheDocument();
    expect(screen.getByText(/Se muestran las últimas lecturas guardadas/)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("servicios_uso_ultimas");
    expect(await within(tarjeta("Supabase")).findByRole("progressbar")).toBeInTheDocument();
  });

  it("sin la migración de costes (20261103160000): carga con las columnas de antes, lo dice y no deja añadir", async () => {
    h.sinColumnasNuevas = true;
    h.config = null;
    h.servicios = SERVICIOS.slice(0, 5).map(({ categoria: _c, orden: _o, activo: _a, por_confirmar: _p, precio_anual: _pa, fuente_precio: _f, ...viejo }) => viejo);
    pintar("/super-admin/servicios?tab=servicios");
    await waitFor(() => tarjeta("Vercel"));
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    abrirPestana("Costes");
    expect(await screen.findByText(/Falta aplicar en Supabase la migración 20261103160000/)).toBeInTheDocument();
    abrirPestana("Configurar");
    await screen.findByRole("list", { name: /En uso \(5\)/ });
    expect(screen.queryByRole("button", { name: "Añadir servicio" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Quitar/ })).toBeNull();
  });

  it("sin la migración aplicada, lo explica y no llama a la función (la IA de Costes sigue)", async () => {
    h.errorSelect = { code: "PGRST205", message: "Could not find the table 'public.servicios_contratados' in the schema cache" };
    pintar();
    expect(await screen.findByText(/Falta aplicar en Supabase la migración de Servicios/)).toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
    abrirPestana("Costes");
    expect(await screen.findByText(/Falta aplicar en Supabase la migración de Servicios/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inteligencia artificial (OpenAI)" })).toBeInTheDocument();
  });
});
