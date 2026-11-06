/**
 * Panel › Tienda (escaparate: se compra en el restaurante): Vinos (precios de
 * carta y tienda, interruptor «A la venta», filtros, contador, enlace a la web;
 * tabla en escritorio y tarjetas en el móvil) y Ajustes (validación, vista
 * previa y guardado), con un Supabase falso en memoria que imita la RLS y la
 * RPC de la migración 20261103150000.
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fila = Record<string, unknown>;
const h = vi.hoisted(() => ({
  puedeEditar: true,
  bdDejaEditar: true,
  sinMigracion: false,
  config: {} as Fila,
  vinos: [] as Fila[],
  updates: [] as Fila[],
  rpc: [] as Array<{ fn: string; args: Fila }>,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => null }));
// «Ver» en Tienda siempre; «Puede editar» según `h.puedeEditar` (un super admin, igual que «Editar»).
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const resolver = (tabla: string, e: { op: string; payload?: Fila }) => {
    if (tabla === "configuracion_tienda") {
      if (h.sinMigracion) return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.configuracion_tienda' in the schema cache" } };
      if (e.op === "update") {
        h.updates.push(e.payload as Fila);
        // La RLS no da error: sin permiso no actualiza ninguna fila.
        if (!h.bdDejaEditar) return { data: [], error: null };
        h.config = { ...h.config, ...e.payload, updated_at: "2026-11-03T12:00:00Z" };
        return { data: [h.config], error: null };
      }
      return { data: h.config, error: null };
    }
    return { data: h.vinos, error: null };
  };
  const desde = (tabla: string) => {
    const e: { op: string; payload?: Fila } = { op: "select" };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Fila) => { e.op = "update"; e.payload = p; return b; },
      eq: () => b,
      order: () => b,
      range: () => b,
      maybeSingle: async () => resolver(tabla, e),
      then: (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver(tabla, e)).then(ok, ko),
    };
    return b;
  };
  const rpc = async (fn: string, args: Fila) => {
    h.rpc.push({ fn, args });
    if (fn === "tienda_marcar_vinos") {
      const actuales = new Set(h.config.vinos_excluidos as string[]);
      (args.p_vino_ids as string[]).forEach((id) => (args.p_a_la_venta ? actuales.delete(id) : actuales.add(id)));
      h.config.vinos_excluidos = [...actuales].sort();
      return { data: h.config.vinos_excluidos, error: null };
    }
    return { data: null, error: { message: "rpc desconocida" } };
  };
  return { supabase: { from: desde, rpc } };
});

import Tienda from "../Tienda";

/** La primera carga encadena dos consultas: con el equipo cargado puede pasar de 1 s. */
const ESPERA = { timeout: 5000 };
/** En escritorio (1440 px, el ancho de `beforeEach`) los vinos son una tabla; en el móvil, una lista de tarjetas. */
const tablaVinos = () => screen.findByRole("table", { name: "Vinos de la tienda" }, ESPERA);
const filaDe = (contenedor: HTMLElement, nombre: string, rol: "row" | "listitem" = "row") =>
  within(contenedor).getAllByRole(rol).find((f) => f.textContent?.includes(nombre)) as HTMLElement;
const campoDescuento = () => screen.findByLabelText("Descuento sobre el precio de carta (%)", {}, ESPERA);

function pintar(ruta = "/tienda") {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}><Tienda /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  h.puedeEditar = true;
  h.bdDejaEditar = true;
  h.sinMigracion = false;
  h.config = { id: true, activa: true, descuento_pct: "30.00", vinos_excluidos: ["albarino"], aviso: null, recogida: "Pregunta en la barra", updated_at: "2026-11-03T10:00:00Z", updated_by: null };
  h.vinos = [
    { id: "rioja", nombre: "Rioja Crianza", categoria: "Tintos", precio_eur: 24, activado: true, restaurante: true },
    { id: "albarino", nombre: "Albariño", categoria: "Blancos", precio_eur: 19.99, activado: true, restaurante: true },
    { id: "sin_precio", nombre: "Vino sin precio", categoria: "Tintos", precio_eur: null, activado: true, restaurante: true },
  ];
  h.updates = [];
  h.rpc = [];
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("Tienda › Vinos", () => {
  it("sin pestaña de pedidos: Vinos y Ajustes, y Vinos es la de entrada", async () => {
    pintar();
    await tablaVinos();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Vinos", "Ajustes"]);
    expect(screen.getByRole("tab", { name: /Vinos/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Visible · 30 %")).toBeInTheDocument();
    // Sin aviso de «Maqueta» (dueño, 04/11/2026).
    expect(screen.queryByText(/maqueta/i)).toBeNull();
  });

  it("precio de carta y de tienda, interruptor «A la venta» y vinos que no pueden salir", async () => {
    pintar();
    const lista = await tablaVinos();
    expect(screen.getByText(/1 de 3/)).toBeInTheDocument();
    const rioja = filaDe(lista, "Rioja Crianza");
    expect(rioja).toHaveTextContent(/24,00\s€/);
    expect(rioja).toHaveTextContent(/16,80\s€/);
    const albarino = filaDe(lista, "Albariño");
    expect(albarino).toHaveTextContent(/13,99\s€/);
    expect(within(lista).getByRole("switch", { name: "A la venta: Rioja Crianza" })).toBeChecked();
    expect(within(lista).getByRole("switch", { name: "A la venta: Albariño" })).not.toBeChecked();
    expect(within(lista).getByRole("switch", { name: "A la venta: Vino sin precio" })).toBeDisabled();
    expect(within(lista).getByText("Sin precio de carta")).toBeInTheDocument();

    fireEvent.click(within(lista).getByRole("switch", { name: "A la venta: Albariño" }));
    await waitFor(() => expect(h.rpc).toEqual([{ fn: "tienda_marcar_vinos", args: { p_vino_ids: ["albarino"], p_a_la_venta: true } }]));
    await waitFor(() => expect(within(lista).getByRole("switch", { name: "A la venta: Albariño" })).toBeChecked());
    expect(h.toast.success).toHaveBeenCalledWith("«Albariño» a la venta en la tienda");
  });

  it("enlaza a la tienda de la web del entorno, en otra pestaña", async () => {
    pintar();
    const enlace = await screen.findByRole("link", { name: /Ver la tienda en la web/ }, ESPERA);
    expect(enlace).toHaveAttribute("href", "https://web-casatomas-git-staging-casa-tomas.vercel.app/tienda");
    expect(enlace).toHaveAttribute("target", "_blank");
    expect(enlace).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("el buscador filtra y permite quitar de la venta todos los mostrados (con confirmación)", async () => {
    pintar();
    await tablaVinos();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar vino" }), { target: { value: "rioja" } });
    expect(screen.queryByRole("switch", { name: "A la venta: Albariño" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quitar de la venta el vino mostrado" }));
    expect(h.rpc).toEqual([]);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar de la venta" }));
    await waitFor(() => expect(h.rpc).toEqual([{ fn: "tienda_marcar_vinos", args: { p_vino_ids: ["rioja"], p_a_la_venta: false } }]));
  });

  it("si falla, el interruptor vuelve a como estaba y se avisa", async () => {
    pintar();
    const lista = await tablaVinos();
    const { supabase } = await import("@/integrations/supabase/client");
    const espia = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({ data: null, error: { code: "42501", message: "No tienes permiso para cambiar los vinos de la tienda" } } as never);
    fireEvent.click(within(lista).getByRole("switch", { name: "A la venta: Rioja Crianza" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(within(lista).getByRole("switch", { name: "A la venta: Rioja Crianza" })).toBeChecked();
    espia.mockRestore();
  });

  // 06/11/2026 (decisión del dueño): con solo «Ver» se ve la lista con el precio de carta → tienda, sin
  // interruptores ni acciones sobre los mostrados (se ocultan, no se desactivan), y sin la pestaña Ajustes.
  it("sin «Puede editar»: la lista se ve, sin interruptores ni pestaña Ajustes, con la etiqueta «Solo lectura»", async () => {
    h.puedeEditar = false;
    pintar();
    const lista = await tablaVinos();
    expect(within(lista).queryAllByRole("switch")).toEqual([]);
    // Precios y estado siguen a la vista.
    expect(within(lista).getByText("Rioja Crianza")).toBeInTheDocument();
    expect(within(lista).getAllByText("A la venta").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Vinos"]);
    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    expect(screen.queryByText(/necesitas el permiso «Puede editar» de Tienda/)).toBeNull();
    // Ni con un filtro puesto salen las acciones sobre los mostrados.
    fireEvent.change(screen.getByLabelText("Buscar vino"), { target: { value: "rioja" } });
    expect(screen.queryByRole("button", { name: /a la venta/i })).toBeNull();
  });

  it("con «Puede editar» (o super admin): interruptores, pestaña Ajustes y sin etiqueta «Solo lectura»", async () => {
    pintar();
    const lista = await tablaVinos();
    expect(within(lista).getByRole("switch", { name: "A la venta: Rioja Crianza" })).toBeEnabled();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Vinos", "Ajustes"]);
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
  });

  it("escritorio: tabla con cabeceras, cada vino con su categoría debajo y su estado (a la venta, quitado o no vendible)", async () => {
    pintar();
    const tabla = await tablaVinos();
    expect(within(tabla).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Vino", "Precio de carta", "Precio de tienda", "A la venta"]);
    expect(screen.queryByRole("list", { name: "Vinos de la tienda" })).toBeNull();
    const rioja = filaDe(tabla, "Rioja Crianza");
    expect(rioja).toHaveAttribute("data-estado", "venta");
    expect(within(rioja).getByText("Tintos")).toBeInTheDocument();
    expect(filaDe(tabla, "Albariño")).toHaveAttribute("data-estado", "excluido");
    expect(filaDe(tabla, "Vino sin precio")).toHaveAttribute("data-estado", "no-vendible");
    // El interruptor lleva el estado (y el motivo) como descripción.
    expect(within(tabla).getByRole("switch", { name: "A la venta: Rioja Crianza" })).toHaveAccessibleDescription("A la venta");
    expect(within(tabla).getByRole("switch", { name: "A la venta: Albariño" })).toHaveAccessibleDescription("Quitado de la tienda");
    expect(within(tabla).getByRole("switch", { name: "A la venta: Vino sin precio" })).toHaveAccessibleDescription("Sin precio de carta");
    expect(screen.getByText(/se arreglan en Gestor Web › Carta/)).toBeInTheDocument();
  });

  it("móvil (390 px): tarjetas en vez de tabla, con los dos precios y el interruptor", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    pintar();
    const lista = await screen.findByRole("list", { name: "Vinos de la tienda" }, ESPERA);
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(lista).getAllByRole("listitem")).toHaveLength(3);
    const rioja = filaDe(lista, "Rioja Crianza", "listitem");
    expect(rioja).toHaveTextContent(/Tienda 16,80\s€/);
    expect(rioja).toHaveTextContent(/Carta 24,00\s€/);
    expect(filaDe(lista, "Vino sin precio", "listitem")).toHaveTextContent("Sin precio de carta");

    fireEvent.click(within(lista).getByRole("switch", { name: "A la venta: Albariño" }));
    await waitFor(() => expect(h.rpc).toEqual([{ fn: "tienda_marcar_vinos", args: { p_vino_ids: ["albarino"], p_a_la_venta: true } }]));
  });

  it("filtro A la venta / Fuera con sus cuentas, contador de resultados y estado vacío que quita los filtros", async () => {
    pintar();
    const tabla = await tablaVinos();
    expect(screen.getByText("vinos", { exact: false, selector: "p[aria-live]" })).toHaveTextContent("3 vinos");
    fireEvent.click(screen.getByRole("radio", { name: "Fuera 2" }));
    expect(within(tabla).getAllByRole("row").slice(1).map((f) => f.getAttribute("data-estado"))).toEqual(["excluido", "no-vendible"]);
    expect(screen.getByText(/Mostrando/)).toHaveTextContent("Mostrando 2 de 3 vinos");
    // Con el filtro puesto, la acción masiva solo toca los que se pueden conmutar (no el que no tiene precio).
    expect(screen.getByRole("button", { name: "Poner a la venta el vino mostrado" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar vino" }), { target: { value: "ribera" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Ningún vino coincide con el filtro")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Todos 0" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar filtros" })[0]);
    expect(within(await tablaVinos()).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("searchbox", { name: "Buscar vino" })).toHaveValue("");
  });
});

describe("Tienda › Ajustes", () => {
  it("valida, enseña la vista previa con el % nuevo y guarda con aviso", async () => {
    pintar("/tienda?tab=ajustes");
    const descuento = await campoDescuento();
    expect(descuento).toHaveValue("30");
    expect(screen.getByLabelText("Cómo comprar en el restaurante")).toHaveValue("Pregunta en la barra");
    expect(screen.queryByLabelText(/botellas/i)).toBeNull();
    const guardar = screen.getByRole("button", { name: "Guardar ajustes" });
    expect(guardar).toBeDisabled();

    fireEvent.change(descuento, { target: { value: "95" } });
    fireEvent.click(guardar);
    expect(await screen.findByText("Pon un descuento entre 0 y 90 %.")).toBeInTheDocument();
    expect(descuento).toHaveAttribute("aria-invalid", "true");
    expect(h.updates).toEqual([]);

    fireEvent.change(descuento, { target: { value: "25" } });
    const vista = screen.getByRole("region", { name: "Así quedan los precios" });
    await waitFor(() => expect(vista).toHaveTextContent(/Carta 24,00\s€→Tienda 18,00\s€/));
    fireEvent.change(screen.getByLabelText("Aviso para la web"), { target: { value: "  Navidad: 25 % en vinos  " } });
    fireEvent.click(screen.getByRole("switch", { name: "Tienda visible en la web" }));
    await act(async () => { fireEvent.click(guardar); });
    await waitFor(() => expect(h.updates).toEqual([
      { activa: false, descuento_pct: 25, aviso: "Navidad: 25 % en vinos", recogida: "Pregunta en la barra" },
    ]));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Ajustes guardados: la tienda está oculta en la web"));
    expect(screen.getByText("Oculta en la web")).toBeInTheDocument();
  });

  it("si la base de datos no deja guardar (la RLS no actualiza ninguna fila), lo dice", async () => {
    h.bdDejaEditar = false;
    pintar("/tienda?tab=ajustes");
    fireEvent.change(await campoDescuento(), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("No se pudieron guardar los ajustes", {
      description: "No se ha guardado: tu usuario no tiene permiso para cambiar la tienda.",
    }));
    expect(h.config.descuento_pct).toBe("30.00");
  });

  it("sin «Puede editar» no hay Ajustes: el enlace `?tab=ajustes` abre Vinos (06/11/2026)", async () => {
    h.puedeEditar = false;
    pintar("/tienda?tab=ajustes");
    await tablaVinos();
    expect(screen.getByRole("tab", { name: /Vinos/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Ajustes/ })).toBeNull();
    expect(screen.queryByLabelText(/Descuento/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar ajustes" })).toBeNull();
  });
});

describe("Tienda sin la migración aplicada", () => {
  it("avisa en vez de fallar", async () => {
    h.sinMigracion = true;
    pintar();
    expect(await screen.findByRole("alert", {}, ESPERA)).toHaveTextContent(/falta aplicar la migración «tienda_vinos»/);
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
