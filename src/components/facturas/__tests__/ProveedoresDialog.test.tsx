/**
 * Facturas › Productos › Proveedores unificados (migración 20261007180000).
 * Con el doble de Supabase de dobleSupabaseProductos.ts más `proveedores_listado`.
 *
 * Cubre: los productos enseñan el proveedor canónico («ANGELMAR» → Herederos…);
 * el diálogo lista cada proveedor con CIF, documentos y variantes; buscar por
 * CIF con guion; fusionar (sugiere el que tiene CIF y avisa de CIF distintos);
 * editar (CIF normalizado); sin permiso de edición solo se consulta; sin la
 * migración, un aviso claro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseProductos");
  return { supabase: m.doble.supabase };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const permiso = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: permiso.editar, loading: false }),
}));

import { doble, cargarDatos } from "./dobleSupabaseProductos";
import { TabProductos } from "../productos/TabProductos";

const fila = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, nombre_comercial: null, cif: null, activo: true, origen: "carga_inicial", documentos: 1, facturas: 1,
  albaranes: 0, total_facturas: "100.00", total_albaranes: "0", ultima_fecha: "2026-09-28", variantes: [nombre], alias: [],
  cifs_extra: [], ...extra,
});

const PROVEEDORES = [
  fila(26, "Herederos Angel Mariño Hermo C.B.", {
    nombre_comercial: "Angelmar", cif: "E13781760", facturas: 0, albaranes: 1, total_albaranes: "1153.30",
    variantes: ["HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)"], alias: ["angelmar", "herederos angel marino hermo c.b"],
  }),
  fila(21, "Enchenta SLU", { cif: "B94186988", variantes: ["ENCHENTA SLU"], alias: ["enchenta"] }),
  fila(23, "Flopeinversiones, S.L.", { cif: "B32455032", documentos: 2, facturas: 2, variantes: ["FLOPEINVERSIONES, S.L."] }),
  fila(40, "Flope Inversiones", { documentos: 1, variantes: ["Flope Inversiones"] }),
  fila(25, "Grupo Insula Roma S.L.", { cif: "B73423998", variantes: ["GRUPO INSULA ROMA S.L."] }),
];

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <div style={{ height: 800 }}>
        <TabProductos />
      </div>
    </QueryClientProvider>,
  );
}

async function abrirProveedores() {
  await screen.findByText("Flor de Pingus");
  fireEvent.click(screen.getByRole("button", { name: /Proveedores/ }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  doble.reiniciar();
  permiso.editar = true;
  cargarDatos();
  doble.fijarRpc("proveedores_listado", () => ({ data: PROVEEDORES, error: null }));
});

describe("Proveedores unificados en Productos", () => {
  it("cada producto enseña su proveedor canónico, no el texto del documento", async () => {
    montar();
    await screen.findByText("Flor de Pingus");
    await waitFor(() => expect(screen.getAllByText(/Herederos Angel Mariño Hermo C\.B\./).length).toBeGreaterThan(0));
    const lista = screen.getByTestId("lista-productos");
    expect(within(lista).queryByText(/ANGELMAR/)).not.toBeInTheDocument();
    expect(within(lista).getByText(/Servicios · Herederos Angel Mariño Hermo C\.B\., Enchenta SLU/)).toBeInTheDocument();
  });

  it("el diálogo lista CIF, documentos y variantes; se busca por CIF con guion", async () => {
    montar();
    const dialogo = await abrirProveedores();
    const lista = await within(dialogo).findByTestId("lista-proveedores");
    expect(within(lista).getByText(/CIF E13781760/)).toBeInTheDocument();
    expect(within(lista).getByText(/Llega como: «HEREDEROS ANGEL MARIÑO HERMO C\.B\. \(ANGELMAR\)»/)).toBeInTheDocument();
    expect(within(lista).getByText(/1 albarán\(es\)/)).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText("Buscar proveedor"), { target: { value: "b-32455032" } });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
    expect(within(lista).getByText("Flopeinversiones, S.L.")).toBeInTheDocument();
  });

  it("fusionar: sugiere quedarse con el que tiene CIF y llama a proveedores_fusionar", async () => {
    doble.fijarRpc("proveedores_fusionar", () => ({ data: { documentos_movidos: 1, proveedores_borrados: 1 }, error: null }));
    montar();
    const dialogo = await abrirProveedores();
    await within(dialogo).findByTestId("lista-proveedores");
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Seleccionar Flope Inversiones" }));
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Seleccionar Flopeinversiones, S.L." }));
    fireEvent.click(within(dialogo).getByRole("button", { name: /Fusionar/ }));
    const grupo = await within(dialogo).findByRole("group", { name: "Fusionar proveedores" });
    expect(within(grupo).getByText(/Queda «Flopeinversiones, S\.L\.»/)).toBeInTheDocument();
    expect(within(grupo).queryByText(/CIF distintos/)).not.toBeInTheDocument();
    fireEvent.click(within(grupo).getByRole("button", { name: /Fusionar/ }));
    await waitFor(() =>
      expect(doble.rpc).toHaveBeenCalledWith("proveedores_fusionar", { p_origen_ids: [40], p_destino_id: 23 }),
    );
  });

  it("fusionar dos con CIF distinto avisa", async () => {
    montar();
    const dialogo = await abrirProveedores();
    await within(dialogo).findByTestId("lista-proveedores");
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Seleccionar Enchenta SLU" }));
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: "Seleccionar Grupo Insula Roma S.L." }));
    fireEvent.click(within(dialogo).getByRole("button", { name: /Fusionar/ }));
    expect(await within(dialogo).findByText(/CIF distintos \(B94186988, B73423998\)/)).toBeInTheDocument();
  });

  it("editar: guarda nombre, comercial y CIF normalizado", async () => {
    doble.fijarRpc("proveedores_editar", () => ({ data: { nombre: "Flope Inversiones" }, error: null }));
    montar();
    const dialogo = await abrirProveedores();
    await within(dialogo).findByTestId("lista-proveedores");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Editar Flope Inversiones" }));
    fireEvent.change(within(dialogo).getByLabelText("Nombre comercial"), { target: { value: "  Flope  " } });
    fireEvent.change(within(dialogo).getByLabelText("CIF"), { target: { value: "b-11111111" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(doble.rpc).toHaveBeenCalledWith("proveedores_editar", {
        p_id: 40, p_nombre: "Flope Inversiones", p_nombre_comercial: "Flope", p_cif: "B11111111",
      }),
    );
  });

  it("sin permiso de edición: se consulta, pero sin casillas ni editar", async () => {
    permiso.editar = false;
    montar();
    const dialogo = await abrirProveedores();
    await within(dialogo).findByTestId("lista-proveedores");
    expect(within(dialogo).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(dialogo).queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
  });

  it("sin la migración: Productos sigue igual y el diálogo lo avisa", async () => {
    doble.fijarRpc("proveedores_listado", () => ({
      data: null, error: { code: "PGRST202", message: "Could not find the function public.proveedores_listado" },
    }));
    montar();
    const dialogo = await abrirProveedores();
    expect(await within(dialogo).findByText(/20261007180000_proveedores_unificados/)).toBeInTheDocument();
    expect(within(screen.getByTestId("lista-productos")).getAllByText(/ANGELMAR/).length).toBeGreaterThan(0);
  });
});
