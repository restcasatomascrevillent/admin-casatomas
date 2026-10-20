/**
 * Compras › ficha de producto › contenido por caja o unidad (productos_catalogo.contenido_*).
 * Doble de Supabase propio: lee la fila del catálogo y guarda por la RPC
 * productos_contenido_guardar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const base = vi.hoisted(() => {
  const estado = { fila: { contenido_cantidad: null as number | null, contenido_unidad: null as string | null } };
  const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    estado.fila = {
      contenido_cantidad: args.p_cantidad as number | null,
      contenido_unidad: args.p_unidad as string | null,
    };
    return { data: { producto_id: args.p_producto_id }, error: null };
  });
  const from = vi.fn(() => {
    const cadena: Record<string, unknown> = {
      select: () => cadena,
      eq: () => cadena,
      maybeSingle: async () => ({ data: { ...estado.fila }, error: null }),
    };
    return cadena;
  });
  return { estado, rpc, from };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: base.rpc, from: base.from } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ContenidoProducto } from "../compras/ContenidoProducto";
import { leerContenido } from "@/lib/facturas/contenido";

function montar(puedeEditar = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContenidoProducto productoId={115} puedeEditar={puedeEditar} />
    </QueryClientProvider>,
  );
}

const campo = () => screen.getByRole("textbox", { name: "Contenido por caja o unidad" });
/** Abre el editor (popover) desde la línea «Caja de … · Editar» / «Sin contenido · Añadir». */
const abrir = async (nombre: "Editar contenido por caja" | "Añadir contenido por caja" = "Añadir contenido por caja") => {
  fireEvent.click(await screen.findByRole("button", { name: nombre }));
  await waitFor(() => expect(campo()).not.toBeDisabled());
};

beforeEach(() => {
  base.estado.fila = { contenido_cantidad: null, contenido_unidad: null };
  base.rpc.mockClear();
});

describe("leerContenido", () => {
  it("acepta coma o punto y rechaza vacío, 0, negativos y más de 1.000", () => {
    expect(leerContenido("10")).toBe(10);
    expect(leerContenido("0,75")).toBe(0.75);
    expect(leerContenido(" 7.5 ")).toBe(7.5);
    for (const malo of ["", "  ", "0", "-3", "1001", "abc", "1,2,3"]) expect(leerContenido(malo)).toBeNull();
  });
});

describe("ContenidoProducto", () => {
  it("guarda «10 kg» por la RPC y los controles son táctiles (44 px)", async () => {
    montar();
    await abrir();
    expect(campo().className).toContain("h-11");
    const guardar = screen.getByRole("button", { name: "Guardar" });
    expect(guardar.className).toContain("h-11");
    expect(guardar).toBeDisabled(); // nada que guardar todavía
    fireEvent.change(campo(), { target: { value: "10" } });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    await waitFor(() => expect(base.rpc).toHaveBeenCalledTimes(1));
    expect(base.rpc).toHaveBeenCalledWith("productos_contenido_guardar", { p_producto_id: 115, p_cantidad: 10, p_unidad: "kg" });
  });

  it("cambia la unidad a litros y guarda 0,75", async () => {
    montar();
    await abrir();
    fireEvent.change(campo(), { target: { value: "0,75" } });
    const litros = screen.getByRole("button", { name: "litros" });
    fireEvent.click(litros);
    expect(litros).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(base.rpc).toHaveBeenCalled());
    expect(base.rpc).toHaveBeenCalledWith("productos_contenido_guardar", { p_producto_id: 115, p_cantidad: 0.75, p_unidad: "l" });
  });

  it("muestra lo guardado y «Quitar» lo borra (cantidad null)", async () => {
    base.estado.fila = { contenido_cantidad: 7.5, contenido_unidad: "kg" };
    montar();
    // La línea de resumen dice lo guardado sin abrir nada.
    expect(await screen.findByText("Caja de 7,5 kg")).toBeInTheDocument();
    await abrir("Editar contenido por caja");
    await waitFor(() => expect(campo()).toHaveValue("7,5"));
    expect(screen.getByRole("button", { name: "kg" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled(); // sin cambios
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(base.rpc).toHaveBeenCalled());
    expect(base.rpc).toHaveBeenCalledWith("productos_contenido_guardar", { p_producto_id: 115, p_cantidad: null, p_unidad: null });
  });

  it("un valor no válido avisa y no deja guardar", async () => {
    montar();
    await abrir();
    fireEvent.change(campo(), { target: { value: "0" } });
    expect(screen.getByRole("alert")).toHaveTextContent("mayor que 0");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("es una sola línea: «Sin contenido por caja · Añadir» y, guardado, «Caja de 7,5 kg · Editar»", async () => {
    montar();
    const linea = screen.getByRole("region", { name: "Contenido por caja o unidad" });
    expect(within(linea).getByText("Sin contenido por caja")).toBeInTheDocument();
    expect(within(linea).getByRole("button", { name: "Añadir contenido por caja" })).toHaveTextContent("Añadir");
    // Hasta que no se pide, no hay editor en pantalla.
    expect(screen.queryByRole("textbox", { name: "Contenido por caja o unidad" })).not.toBeInTheDocument();
  });

  it("sin permiso de edición: solo la línea de resumen, sin botón para cambiarlo", async () => {
    base.estado.fila = { contenido_cantidad: 10, contenido_unidad: "kg" };
    montar(false);
    expect(await screen.findByText("Caja de 10 kg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /contenido por caja/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
