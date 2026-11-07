import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }), useUsuarioIdOpcional: () => "u1" }));
// Con «Editar» en Facturas (todo, como antes del 06/11/2026); los perfiles, en SubidaFacturas.permisos.test.tsx.
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { doble } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";
import { IndicadorSubidasFacturas } from "../IndicadorSubidasFacturas";
import type { ResultadoProcesamiento } from "@/lib/facturas/colaSubida";
import { type EstadoTrabajo, SinDocumentosLargos } from "@/lib/facturas/documentoLargo";

/** procesar-factura desplegada sin trabajos de una pieza: camino síncrono. */
const servidorAntiguo = async (): Promise<never> => {
  throw new SinDocumentosLargos("Un documento de una sola pieza va por el camino normal");
};

function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((ok) => { resolver = ok; });
  return { promesa, resolver };
}

const guardada = (nombre: string): ResultadoProcesamiento => ({
  nombre, success: true, tipo: "factura", alertas: [], archivoGuardado: true, duplicado: false,
});

/** ¿Algún oyente de `beforeunload` cancela el cierre? */
const cierreBloqueado = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

beforeEach(() => {
  doble.reiniciar();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.loading.mockClear();
  window.localStorage.clear();
});

const elegir = (nombre: string) =>
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: [new File(["x"], nombre, { type: "application/pdf" })] },
  });

describe("ColaSubidaProvider · tanda de varios documentos: un solo aviso (07/11/2026)", () => {
  it("3 albaranes: ningún toast por documento ni pop-up; un toast que avanza y un resumen al final", async () => {
    const sinTotal = (nombre: string): ResultadoProcesamiento => ({
      nombre, success: true, tipo: "albaran", archivoGuardado: true, duplicado: false,
      // Lo normal en un albarán: no cuenta como aviso.
      alertas: [{ codigo: "total_ausente", severidad: "alta", mensaje: "Sin total" }],
    });
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: async (_f, n) => sinTotal(n) } });
    fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
      target: { files: ["a1.pdf", "a2.pdf", "a3.pdf"].map((n) => new File(["x"], n, { type: "application/pdf" })) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar 3 documentos/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Subida terminada: 3 documentos", expect.objectContaining({ id: "subida-tanda-1", description: "3 guardadas" })));
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.loading.mock.calls.every(([, o]) => o.id === "subida-tanda-1")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ColaSubidaProvider · la subida sigue en segundo plano", () => {
  it("sigue al salir de Facturas (SubidaFacturas desmontado), avisa al terminar y apunta la tanda en la campana", async () => {
    const d = diferida<ResultadoProcesamiento>();
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: () => d.promesa } });
    elegir("a.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    expect(await screen.findByText(/Procesando 0 de 1/)).toBeTruthy();
    // Con la llamada abierta, cerrar la pestaña perdería el documento.
    await waitFor(() => expect(cierreBloqueado()).toBe(true));

    fireEvent.click(screen.getByRole("link", { name: "Ir a Reservas" }));
    expect(screen.queryByText(/Procesando/)).toBeNull(); // la pestaña Cargar ya no está montada
    const indicador = await screen.findByRole("button", { name: /Facturas: 1 procesando/ });
    expect(indicador).toBeTruthy();

    await act(async () => { d.resolver(guardada("a.pdf")); });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Factura guardada", expect.objectContaining({ description: "a.pdf" })));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Facturas:/ })).toBeNull());
    expect(cierreBloqueado()).toBe(false);
    // No estaba mirando «Cargar»: una entrada en la campana para toda la tanda.
    const campana = doble.inserts.filter((i) => i.tabla === "notificaciones_dashboard");
    expect(campana).toHaveLength(1);
    expect(campana[0].fila).toMatchObject({ tipo: "facturas_subida", referencia_tipo: "facturas_cargar", mensaje: "1 guardada" });

    // Al volver a «Cargar», el resultado sigue en la lista.
    fireEvent.click(screen.getByRole("link", { name: "Ir a Cargar" }));
    expect(await screen.findByText("a.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpiar terminados" })).toBeTruthy();
  });

  it("una página va al servidor: solo se avisa al cerrar mientras se SUBE el fichero, no mientras se lee", async () => {
    const subida = diferida<{ trabajoId: string; numPiezas: number }>();
    const fin = diferida<EstadoTrabajo>();
    const procesarUnico = vi.fn();
    montarSubida({
      deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: () => subida.promesa, esperar: () => fin.promesa, procesarUnico },
    });
    elegir("d.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    expect(await screen.findByText("Subiendo…")).toBeTruthy();
    await waitFor(() => expect(cierreBloqueado()).toBe(true));

    await act(async () => { subida.resolver({ trabajoId: "u1", numPiezas: 1 }); });
    expect(await screen.findByText("En cola…")).toBeTruthy();
    // Ya está en el servidor: los 10-40 s de lectura siguen aunque se cierre.
    expect(cierreBloqueado()).toBe(false);
    expect(screen.queryByText(/Documento largo/)).toBeNull();

    await act(async () => {
      fin.resolver({
        id: "u1", estado: "completado", num_paginas: 1, nombre_original: "d.pdf", error: null, factura_id: 9, updated_at: "",
        resultado: { success: true, tipo: "factura", webhookResponse: { tipo: "factura" }, alertas: [], archivo_guardado: true },
      });
    });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Factura guardada", expect.objectContaining({ description: "d.pdf" })));
    expect(procesarUnico).not.toHaveBeenCalled();
  });

  it("si el usuario está mirando «Cargar», no llena la campana (ya lo ve)", async () => {
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: async (_f, n) => guardada(n) } });
    elegir("b.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(doble.inserts.filter((i) => i.tabla === "notificaciones_dashboard")).toHaveLength(0);
  });

  it("adopta al cargar la página los documentos largos del usuario que siguen en el servidor", async () => {
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && llamadas.some((l) => l.metodo === "in")
        ? [{ id: "t1", estado: "paginas", num_paginas: 5, nombre_original: "luga.jpg", error: null, resultado: null, factura_id: null, updated_at: "", ocr_trabajo_paginas: [] }]
        : [],
    );
    const fin = diferida<EstadoTrabajo>();
    montarSubida({ ruta: "/reservas", deps: { esperar: () => fin.promesa } });
    expect(await screen.findByRole("button", { name: /Facturas: 1 procesando/ })).toBeTruthy();
    // Ya está en el servidor: cerrar la pestaña no lo pierde, no se avisa.
    expect(cierreBloqueado()).toBe(false);
    await act(async () => {
      fin.resolver({
        id: "t1", estado: "completado", num_paginas: 5, nombre_original: "luga.jpg", error: null, factura_id: 54, updated_at: "",
        resultado: { success: true, tipo: "factura", webhookResponse: { tipo: "factura" }, alertas: [] },
      });
    });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Factura guardada", expect.anything()));
  });
});

describe("ColaSubidaProvider · pop-up de documento ya subido", () => {
  const duplicada = (nombre: string, extra: Partial<ResultadoProcesamiento> = {}): ResultadoProcesamiento => ({
    nombre, success: true, tipo: "albaran", alertas: [], duplicado: true, facturaId: 7, ...extra,
  });
  const existente = { numero_documento: "A-123", proveedor: "Pescados Mari", fecha: "2026-10-01", total: 45.5, tipo: "albaran", drive_url: "https://drive.example.com/foto", archivo_path: null };
  const subir = async (res: ResultadoProcesamiento) => {
    doble.fijarRespuestas((tabla) => (tabla === "facturas" ? existente : []));
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: async () => res } });
    elegir("dup.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
  };

  it("duplicado: abre un diálogo con los datos del existente y el enlace a su foto, sin toast", async () => {
    await subir(duplicada("dup.pdf"));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.textContent).toContain("Este albarán ya estaba subido");
    expect(dialogo.textContent).toContain("dup.pdf");
    // UI-13: concordancia con el título.
    expect(dialogo.textContent).toContain("ya estaba guardado. No se ha creado otro.");
    expect(await screen.findByText("A-123")).toBeTruthy();
    expect(screen.getByText("Pescados Mari")).toBeTruthy();
    const foto = screen.getByRole("link", { name: /Ver la foto del que ya está|Ver documento original/ });
    expect(foto.getAttribute("href")).toBe("https://drive.example.com/foto");
    expect(screen.getByRole("button", { name: "Ver ficha" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decidir" })).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("duplicado sustituible: ofrece «Sustituir por la nueva» y «Dejar la que hay» (sin mandar a Cargar) y mantiene la foto del existente", async () => {
    const sustituible = { trabajo_id: "t-1", existente: { id: 7, numero_documento: "A-123", lineas: 3 } } as unknown as ResultadoProcesamiento["sustituible"];
    await subir(duplicada("dup.pdf", { sustituible }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.textContent).toContain("reemplazar");
    expect(screen.getByRole("button", { name: "Sustituir por la nueva" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dejar la que hay" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decidir" })).toBeNull();
    expect(await screen.findByRole("link", { name: /Ver la foto del que ya está|Ver documento original/ })).toBeTruthy();
    // «Sustituir por la nueva» abre la confirmación (relectura).
    fireEvent.click(screen.getByRole("button", { name: "Sustituir por la nueva" }));
    expect(await screen.findByText(/¿Sustituir la factura A-123\?/)).toBeTruthy();
  });

  it("UI-13: una factura duplicada dice «guardada» y «otra» (concordancia con «Esta factura»)", async () => {
    doble.fijarRespuestas((tabla) => (tabla === "facturas" ? { ...existente, tipo: "factura" } : []));
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: async () => duplicada("f.pdf", { tipo: "factura" }) } });
    elegir("f.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    const dialogo = await screen.findByRole("dialog");
    await waitFor(() => expect(dialogo.textContent).toContain("Esta factura ya estaba subida"));
    expect(dialogo.textContent).toContain("ya estaba guardada. No se ha creado otra.");
    expect(dialogo.textContent).not.toContain("ya estaba guardado.");
  });

  it("no aparece para una página añadible ni para un documento guardado", async () => {
    const anadible = { existente: { id: 7, numero_documento: "F-1", lineas: 3 }, pagina: { actual: 2, total: 3 } } as unknown as ResultadoProcesamiento["anadible"];
    await subir(duplicada("dup.pdf", { anadible }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no aparece para un documento guardado", async () => {
    await subir(guardada("dup.pdf"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("IndicadorSubidasFacturas", () => {
  it("fuera del provider no pinta nada (otras pantallas y sus tests)", () => {
    const { container } = render(<MemoryRouter><IndicadorSubidasFacturas variante="menu" /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });

  it("al tocarlo lleva a Facturas → Cargar", async () => {
    const d = diferida<ResultadoProcesamiento>();
    montarSubida({ deps: { planificar: async () => ({ camino: "unico" }), iniciarUnico: servidorAntiguo, procesarUnico: () => d.promesa } });
    elegir("c.pdf");
    fireEvent.click(screen.getByRole("button", { name: /Enviar 1 documento/ }));
    fireEvent.click(screen.getByRole("link", { name: "Ir a Reservas" }));
    fireEvent.click(await screen.findByRole("button", { name: /Facturas: 1 procesando/ }));
    expect(screen.getByTestId("ubicacion").textContent).toBe("/facturas?tab=cargar");
    await act(async () => { d.resolver(guardada("c.pdf")); });
  });
});
