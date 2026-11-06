import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }), useUsuarioIdOpcional: () => "u1" }));
// Con «Editar» en Facturas (todo, como antes del 06/11/2026); los perfiles, en SubidaFacturas.permisos.test.tsx.
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { doble } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";
import type { ResultadoProcesamiento } from "@/lib/facturas/colaSubida";
import { SinDocumentosLargos } from "@/lib/facturas/documentoLargo";

const servidorAntiguo = async (): Promise<never> => {
  throw new SinDocumentosLargos("Un documento de una sola pieza va por el camino normal");
};

const base = { alertas: [] as never[], archivoGuardado: true, duplicado: false };

/** Resultado según el nombre del fichero: así se prueba el orden sea cual sea el de llegada. */
const resultadoPorNombre = async (_f: File, nombre: string): Promise<ResultadoProcesamiento> => {
  if (nombre.startsWith("fallido")) return { nombre, success: false, error: "No se pudo leer: foto borrosa" };
  if (nombre.startsWith("aviso")) {
    return { nombre, success: true, tipo: "albaran", ...base, alertas: [{ codigo: "suma", severidad: "media", mensaje: "No cuadra el total" }] };
  }
  if (nombre.startsWith("duplicado")) return { nombre, success: true, tipo: "factura", ...base, duplicado: true, archivoGuardado: undefined };
  if (nombre.startsWith("albaran")) return { nombre, success: true, tipo: "albaran", ...base };
  if (nombre.startsWith("sinid")) return { nombre, success: true, tipo: "factura", ...base };
  return { nombre, success: true, tipo: "factura", ...base, facturaId: 4321 };
};

const elegir = (nombres: string[], tipo = "application/pdf") =>
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: nombres.map((n) => new File(["x".repeat(2048)], n, { type: tipo })) },
  });

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
});

describe("Cargar · diseño plano", () => {
  it("vacía: la zona de soltar es la superficie, sin tarjeta, título ni párrafo largo", () => {
    const { container } = montarSubida();
    expect(screen.queryByText("Subida de Facturas y Albaranes")).toBeNull();
    expect(screen.queryByText(/Se procesan en segundo plano/)).toBeNull();
    expect(container.querySelector("[data-zona='amplia']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hacer foto/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Elegir archivos/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
  });

  it("cola antes de enviar: fila con nombre y tamaño, icono (no imagen) para el PDF, quitar y «Enviar» abajo", () => {
    const { container } = montarSubida();
    elegir(["albaran-makro.pdf"]);
    const seccion = screen.getByRole("region", { name: "Archivos seleccionados" });
    expect(within(seccion).getByText("albaran-makro.pdf")).toBeTruthy();
    expect(within(seccion).getByText("2 KB")).toBeTruthy();
    expect(seccion.querySelector("img")).toBeNull(); // PDF: icono por tipo, no miniatura
    expect(container.querySelector("[data-zona='compacta']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enviar 1 documento/ })).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: "Quitar albaran-makro.pdf" }));
    expect(screen.queryByRole("region", { name: "Archivos seleccionados" })).toBeNull();
    expect(container.querySelector("[data-zona='amplia']")).toBeTruthy();
  });

  it("resultados: ordenados por gravedad (fallido → aviso → duplicado → ok), una línea de estado y tipo correcto", async () => {
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: resultadoPorNombre } });
    // En orden «inverso» al de gravedad a propósito.
    elegir(["albaran-ok.pdf", "factura-ok.pdf", "duplicado.pdf", "aviso.pdf", "fallido.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Enviar 5 documentos/ }));

    // El duplicado abre el pop-up modal (oculta el resto a los lectores): se cierra antes de mirar la lista.
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar" }));
    const seccion = await screen.findByRole("region", { name: "Documentos enviados" });
    await waitFor(() => expect(seccion.querySelectorAll("li[data-nivel='ok']")).toHaveLength(2));
    const filas = Array.from(seccion.querySelectorAll("li"));
    expect(filas.map((f) => f.getAttribute("data-nivel"))).toEqual(["fallido", "aviso", "duplicado", "ok", "ok"]);
    expect(within(filas[0]).getByText("fallido.pdf")).toBeTruthy();
    expect(within(filas[1]).getByText("aviso.pdf")).toBeTruthy();
    expect(within(filas[2]).getByText("duplicado.pdf")).toBeTruthy();

    // Una sola línea de estado por documento.
    expect(within(filas[0]).getByText("No se pudo leer: foto borrosa")).toBeTruthy();
    expect(within(filas[1]).getByText("1 aviso: No cuadra el total")).toBeTruthy();

    // Tipo real: el albarán dice «Albarán», la factura «Factura».
    expect(within(filas[1]).getByText("Albarán")).toBeTruthy();
    const albaran = filas.find((f) => within(f).queryByText("albaran-ok.pdf"))!;
    expect(within(albaran).getByText("Albarán")).toBeTruthy();
    expect(within(albaran).queryByText("Factura")).toBeNull();
    const factura = filas.find((f) => within(f).queryByText("factura-ok.pdf"))!;
    expect(within(factura).getByText("Factura")).toBeTruthy();
    // El fallido no tiene tipo; los guardados tienen «Ver»; el fallido, «Reintentar».
    expect(within(filas[0]).queryByText("Factura")).toBeNull();
    expect(within(factura).getByRole("link", { name: "Ver factura-ok.pdf" })).toBeTruthy();
    // «Ver» abre ESE documento en Compras (modo Documentos, ficha abierta).
    expect(within(factura).getByRole("link", { name: "Ver factura-ok.pdf" })).toHaveAttribute(
      "href",
      "/facturas?tab=compras&modo=documentos&doc=4321",
    );
    expect(within(filas[0]).getByRole("button", { name: "Reintentar fallido.pdf" })).toBeTruthy();

    // Botones ligeros de la tanda.
    expect(screen.getByRole("button", { name: "Reintentar fallidos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpiar terminados" })).toBeTruthy();
    // El toast también dice «Albarán» (y bien conjugado).
    expect(toastMock.warning).toHaveBeenCalledWith("Albarán guardado con 1 aviso", expect.anything());
    // UI-16: los avisos salen arriba (abajo tapaban la lista y «Limpiar terminados»).
    expect(toastMock.warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ position: "top-center" }));
  });

  it("UI-10: un fichero de 0 bytes se rechaza con aviso en español y no entra en la cola", () => {
    montarSubida();
    fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
      target: { files: [new File([], "vacio.png", { type: "image/png" })] },
    });
    expect(toastMock.error).toHaveBeenCalledWith("Archivo vacío", expect.objectContaining({ description: expect.stringMatching(/vacio\.png está vacío/) }));
    expect(screen.queryByRole("region", { name: "Archivos seleccionados" })).toBeNull();
  });

  it("UI-11: un documento subiendo se puede cancelar desde su fila", async () => {
    const nunca = new Promise<never>(() => {});
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: () => nunca } });
    elegir(["lento.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    const cancelar = await screen.findByRole("button", { name: "Cancelar lento.pdf" });
    fireEvent.click(cancelar);
    await waitFor(() => expect(screen.queryByText("lento.pdf")).toBeNull());
  });
});
