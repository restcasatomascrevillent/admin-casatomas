/**
 * «Cargar» según los permisos (dueño, 06/11/2026):
 *   · Solo «Facturas · Subida»: sube, ve su progreso y corrige aquí mismo lo que
 *     subió («Corregir»; no hay «Ver» en Compras). En un repetido solo decide
 *     sustituir o completar si la que ya estaba la subió él; «Dejar la que hay»
 *     siempre.
 *   · Subida + «Ver»: lo subido se abre en Compras («Ver»), como siempre.
 *   · «Editar»: decide sobre cualquiera, como siempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }), useUsuarioIdOpcional: () => "u1" }));
const h = vi.hoisted(() => ({ permisos: {} as Record<string, { view?: boolean; edit?: boolean }> }));
vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({ isAdmin: false, loading: false }),
  useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({ canAccess: !!h.permisos[seccion]?.[tipo], loading: false }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

import { doble, RESPUESTA_SERVIDOR_ANTIGUO } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";

const SOLO_SUBIDA = { facturas_subida: { view: true } };
const SUBIDA_VER = { facturas: { view: true }, facturas_subida: { view: true } };
const EDITA = { facturas: { view: true, edit: true } };

const sustituible = {
  trabajo_id: "33333333-3333-4333-8333-333333333333",
  existente: {
    id: 54, numero_documento: "ML/101511", proveedor: "LUGA", fecha: "2025-12-31", total: null,
    total_origen: null, lineas: 8, alertas: 0, alertas_graves: 0, updated_at: "2026-09-29T15:28:55",
  },
  nuevo: { total: 10, total_origen: "leido", lineas: 9, alertas: 0, proveedor: "LUGA", fecha: "2025-12-31" },
};

/** Lo que contesta la tabla facturas: el dueño del documento 54 (y lo que pide el aviso). */
function facturaExistente(subidoPor: string) {
  doble.fijarRespuestas((tabla) =>
    tabla === "facturas"
      ? { subido_por: subidoPor, numero_documento: "ML/101511", proveedor: "LUGA", fecha: "2025-12-31", total: 1, tipo: "factura", drive_url: null, archivo_path: null }
      : [],
  );
}

const enviarUno = async (nombre: string) => {
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: [new File(["x"], nombre, { type: "application/pdf" })] },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Enviar 1 documento/ }));
};

function duplicado() {
  doble.invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) => {
    if (opciones?.body?.modo === "iniciar") return RESPUESTA_SERVIDOR_ANTIGUO;
    return {
      data: {
        success: true, tipo: "factura", duplicado: true, message: "El documento ya existía (duplicado)",
        webhookResponse: { tipo: "factura", numero_documento: "ML/101511", duplicado: true }, sustituible,
      },
      error: null,
    };
  });
}

function guardado() {
  doble.invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) => {
    if (opciones?.body?.modo === "iniciar") return RESPUESTA_SERVIDOR_ANTIGUO;
    return {
      data: {
        success: true, tipo: "albaran", duplicado: false, message: "ok", alertas: [], archivo_guardado: true,
        webhookResponse: { tipo: "albaran", numero_documento: "A-7", factura_id: 77 },
      },
      error: null,
    };
  });
}

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
  h.permisos = {};
});

describe("Cargar · repetidos: sustituir o completar solo lo propio", () => {
  it("solo Subida y la que ya estaba es de OTRO: ni sustituir ni «Ver ficha»; «Dejar la que hay» sí", async () => {
    h.permisos = SOLO_SUBIDA;
    facturaExistente("otra-persona");
    duplicado();
    montarSubida();
    await enviarUno("ML101511.pdf");
    const aviso = await screen.findByRole("dialog");
    await waitFor(() => expect(within(aviso).getByText(/lo subió otra persona/)).toBeTruthy());
    expect(within(aviso).queryByRole("button", { name: "Sustituir por la nueva" })).toBeNull();
    expect(within(aviso).queryByRole("button", { name: "Ver ficha" })).toBeNull();
    fireEvent.click(within(aviso).getByRole("button", { name: "Cerrar" }));

    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    await waitFor(() => expect(within(seccion).getByText(/La que ya existe la subió otra persona/)).toBeTruthy());
    expect(within(seccion).queryByRole("button", { name: /Sustituir la existente/ })).toBeNull();
    expect(within(seccion).queryByRole("button", { name: /Ver la foto del que ya está/ })).toBeNull();
    expect(within(seccion).getByRole("button", { name: "Dejar la que hay" })).toBeTruthy();
  });

  it("solo Subida y la que ya estaba es SUYA: puede sustituirla (aviso y lista)", async () => {
    h.permisos = SOLO_SUBIDA;
    facturaExistente("u1");
    duplicado();
    montarSubida();
    await enviarUno("ML101511.pdf");
    const aviso = await screen.findByRole("dialog");
    expect(await within(aviso).findByRole("button", { name: "Sustituir por la nueva" })).toBeTruthy();
    expect(within(aviso).queryByRole("button", { name: "Ver ficha" })).toBeNull();
    fireEvent.click(within(aviso).getByRole("button", { name: "Decidir luego" }));
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(await within(seccion).findByRole("button", { name: /Sustituir la existente/ })).toBeTruthy();
    expect(within(seccion).queryByText(/subió otra persona/)).toBeNull();
  });

  it("con «Editar», sustituye la de cualquiera y ve la ficha (sin preguntar de quién es)", async () => {
    h.permisos = EDITA;
    facturaExistente("otra-persona");
    duplicado();
    montarSubida();
    await enviarUno("ML101511.pdf");
    const aviso = await screen.findByRole("dialog");
    expect(await within(aviso).findByRole("button", { name: "Sustituir por la nueva" })).toBeTruthy();
    expect(within(aviso).getByRole("button", { name: "Ver ficha" })).toBeTruthy();
  });
});

describe("Cargar · lo recién subido: «Ver» en Compras o «Corregir» aquí", () => {
  it("solo Subida: «Corregir» abre el documento con sus líneas para corregirlo (sin «verificada»)", async () => {
    h.permisos = SOLO_SUBIDA;
    guardado();
    doble.fijarRespuestas((tabla) => (tabla === "facturas" ? { subido_por: "u1" } : []));
    doble.fijarRpc((nombre, args) =>
      nombre === "documento_compras" && args.p_id === 77
        ? {
            id: 77, tipo: "albaran", numero_documento: "A-7", proveedor: "Pescados", fecha: "2026-11-02", subtotal: 10, iva: 1, total: 11,
            productos: [{ id: 1, nombre: "Merluza", cantidad: 2, unidad: "kg", precio_unitario: 5, total: 10 }],
          }
        : null,
    );
    montarSubida();
    await enviarUno("albaran.pdf");
    const fila = await screen.findByRole("button", { name: "Corregir albaran.pdf" });
    expect(screen.queryByRole("link", { name: "Ver albaran.pdf" })).toBeNull();
    fireEvent.click(fila);
    const dialogo = await screen.findByRole("dialog", { name: "Albarán A-7" });
    expect(await within(dialogo).findByRole("button", { name: "Editar Merluza" })).toBeTruthy();
    expect(within(dialogo).getByRole("button", { name: /Añadir línea/ })).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Corregir datos/ }));
    const cabecera = await screen.findByRole("dialog", { name: /Editar Factura A-7/ });
    expect(within(cabecera).getByLabelText("Proveedor")).toBeTruthy();
    expect(within(cabecera).queryByText("Marcar como verificada")).toBeNull();
  });

  it("solo Subida: si el documento no es suyo, se ve sin lápices", async () => {
    h.permisos = SOLO_SUBIDA;
    guardado();
    doble.fijarRespuestas((tabla) => (tabla === "facturas" ? { subido_por: "otra-persona" } : []));
    doble.fijarRpc((nombre) =>
      nombre === "documento_compras"
        ? { id: 77, tipo: "albaran", numero_documento: "A-7", productos: [{ id: 1, nombre: "Merluza", cantidad: 1, precio_unitario: 1, total: 1 }] }
        : null,
    );
    montarSubida();
    await enviarUno("albaran.pdf");
    fireEvent.click(await screen.findByRole("button", { name: "Corregir albaran.pdf" }));
    const dialogo = await screen.findByRole("dialog", { name: "Albarán A-7" });
    expect(await within(dialogo).findByText("Merluza")).toBeTruthy();
    expect(within(dialogo).getByText(/Solo puedes corregir los documentos que has subido tú/)).toBeTruthy();
    expect(within(dialogo).queryByRole("button", { name: "Editar Merluza" })).toBeNull();
    expect(within(dialogo).queryByRole("button", { name: /Corregir datos/ })).toBeNull();
  });

  it("Subida + «Ver»: «Ver» lo abre en Compras, como siempre", async () => {
    h.permisos = SUBIDA_VER;
    guardado();
    montarSubida();
    await enviarUno("albaran.pdf");
    const ver = await screen.findByRole("link", { name: "Ver albaran.pdf" });
    expect(ver).toHaveAttribute("href", "/facturas?tab=compras&modo=documentos&doc=77");
    expect(screen.queryByRole("button", { name: "Corregir albaran.pdf" })).toBeNull();
  });
});
