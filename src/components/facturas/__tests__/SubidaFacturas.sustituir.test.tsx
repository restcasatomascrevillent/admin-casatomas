import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseFacturas");
  return { supabase: m.doble.supabase };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { doble, filtra, RESPUESTA_SERVIDOR_ANTIGUO } from "./dobleSupabaseFacturas";
import { montarSubida } from "./montarSubida";
import { CLAVE_DESCARTADOS } from "@/lib/facturas/pendientesDecidir";

const sustituible = {
  trabajo_id: "33333333-3333-4333-8333-333333333333",
  existente: {
    id: 54, numero_documento: "ML/101511", proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31", total: null,
    total_origen: null, lineas: 8, alertas: 1, alertas_graves: 1, updated_at: "2026-09-29T15:28:55.00448",
  },
  nuevo: { total: 3787.53, total_origen: "deducido", lineas: 54, alertas: 1, proveedor: "LUGA SABORES S.L.", fecha: "2025-12-31" },
};

const invoke = doble.invoke;

beforeEach(() => {
  doble.reiniciar();
  window.localStorage.clear();
});

const enviarUno = async (nombre: string) => {
  fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
    target: { files: [new File(["x"], nombre, { type: "application/pdf" })] },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Enviar 1 documento/ }));
};

describe("SubidaFacturas · duplicado → «Pendientes de decidir» → «Sustituir la existente»", () => {
  it("no bloquea: queda en la lista y, al confirmar, pide la sustitución con lo que vio el usuario", async () => {
    invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) => {
      // Servidor sin trabajos de una pieza: el panel cae al camino síncrono.
      if (opciones?.body?.modo === "iniciar") return RESPUESTA_SERVIDOR_ANTIGUO;
      if (opciones?.body?.modo === "sustituir") {
        return { data: { success: true, message: "Factura 54 sustituida: 8 → 54 líneas.", alertas: [] }, error: null };
      }
      return {
        data: {
          success: true, tipo: "factura", duplicado: true, message: "El documento ya existía (duplicado)",
          webhookResponse: { tipo: "factura", numero_documento: "ML/101511", duplicado: true }, sustituible,
        },
        error: null,
      };
    });
    montarSubida();
    await enviarUno("ML101511.pdf");
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar" })); // pop-up de «ya estaba subido»

    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).getByText(/Ya existe la factura ML\/101511 \(8 líneas\)/)).toBeTruthy();
    expect(screen.getByText(/está arriba, en «Pendientes de decidir»/)).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: /Sustituir la existente/ }));

    expect(await screen.findByText(/¿Sustituir la factura ML\/101511\?/)).toBeTruthy();
    expect(screen.getByText("Ahora (factura 54)")).toBeTruthy();
    expect(screen.getByText(/1 graves/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sí, sustituir/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke.mock.calls[0][1].body.modo).toBe("iniciar");
    expect(invoke.mock.calls[1][1].body.archivo.nombre).toBe("ML101511.pdf");
    expect(invoke.mock.calls[2][1].body).toEqual({
      modo: "sustituir", factura_id: 54, trabajo_id: sustituible.trabajo_id,
      esperado: { lineas: 8, updated_at: "2026-09-29T15:28:55.00448" },
    });
    expect(await screen.findByText(/Factura existente sustituida/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Pendientes de decidir" })).toBeNull();
  });

  it("un duplicado sin `sustituible` (servidor antiguo) se pinta como siempre, sin botón", async () => {
    invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) =>
      opciones?.body?.modo === "iniciar"
        ? RESPUESTA_SERVIDOR_ANTIGUO
        : { data: { success: true, tipo: "factura", duplicado: true, webhookResponse: { tipo: "factura", duplicado: true } }, error: null },
    );
    montarSubida();
    await enviarUno("a.pdf");
    expect(await screen.findByText(/mismo número y proveedor/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sustituir la existente/ })).toBeNull();
    // El PDF falso no se puede trocear: va como una página; el servidor
    // antiguo no admite la pieza única y se manda por el camino síncrono.
    expect(invoke.mock.calls[0][1].body.modo).toBe("iniciar");
    expect(invoke.mock.calls[1][1].body.archivo.nombre).toBe("a.pdf");
  });

  it("servidor nuevo: una página va en segundo plano (pieza única) y su duplicado queda «por decidir»", async () => {
    const trabajoId = { valor: "" };
    invoke.mockImplementation(async (_f: string, opciones?: { body?: Record<string, unknown> }) => {
      if (opciones?.body?.modo === "iniciar") {
        trabajoId.valor = String(opciones.body.trabajo_id);
        return { data: { success: true, trabajo_id: trabajoId.valor, estado: "pagina1", num_paginas: 1 }, error: null };
      }
      throw new Error("no debería llamar al camino síncrono");
    });
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && filtra(llamadas, "id", trabajoId.valor)
        ? {
          id: trabajoId.valor, estado: "duplicado", num_paginas: 1, nombre_original: "ML101511.pdf", error: null, factura_id: null,
          updated_at: "", resultado: {
            success: true, tipo: "factura", duplicado: true, webhookResponse: { tipo: "factura", duplicado: true },
            sustituible: { ...sustituible, trabajo_id: trabajoId.valor },
          },
          ocr_trabajo_paginas: [],
        }
        : [],
    );
    montarSubida();
    await enviarUno("ML101511.pdf");
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar" })); // pop-up de «ya estaba subido»
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).getByText(/Ya existe la factura ML\/101511 \(8 líneas\)/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
    const body = invoke.mock.calls[0][1].body;
    expect(body).toMatchObject({ modo: "iniciar", nombre: "ML101511.pdf", origen: "pdf", piezas: [{ numero: 1, pieza: "pagina", pagina_doc: 1 }] });
    expect(doble.subidas).toEqual([{ bucket: "facturas-originales", path: body.piezas[0].path }]);
  });

  it("los pendientes se leen de la BD al entrar (sobreviven a recargar) y «Dejar la que hay» los quita", async () => {
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && filtra(llamadas, "estado", "duplicado")
        ? [{ id: sustituible.trabajo_id, nombre_original: "ML101511.pdf", created_at: "2026-10-05T10:00:00Z", resultado: { success: true, duplicado: true, sustituible } }]
        : [],
    );
    montarSubida();
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).getByText("ML101511.pdf")).toBeTruthy();
    fireEvent.click(within(seccion).getByRole("button", { name: "Dejar la que hay" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pendientes de decidir" })).toBeNull());
    expect(window.localStorage.getItem(CLAVE_DESCARTADOS)).toContain(sustituible.trabajo_id);
  });
});

describe("SubidaFacturas · páginas sueltas, relectura de la existente y unir fotos", () => {
  const anadible = {
    trabajo_id: "44444444-4444-4444-8444-444444444444",
    existente: {
      id: 352, numero_documento: "P26/24306", proveedor: "NICOLAS Y VALERO", fecha: "2026-10-09", total: 1029.64,
      total_origen: "leido", lineas: 2, alertas: 0, alertas_graves: 0, updated_at: "2026-10-10T10:00:00",
    },
    pagina: { actual: 1, total: 2 },
    nuevo: { total: null, total_origen: null, lineas: 2, alertas: 1, proveedor: "NICOLAS Y VALERO", fecha: "2026-10-09" },
  };

  it("otra página: ofrece «Añadir como página», nunca «Sustituir», y confirma con la factura RELEÍDA", async () => {
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && filtra(llamadas, "estado", "duplicado")
        ? [{ id: anadible.trabajo_id, nombre_original: "pag1.jpg", created_at: "2026-10-10T10:00:00Z", resultado: { success: true, duplicado: true, anadible } }]
        : [],
    );
    doble.fijarRpc((nombre) =>
      nombre === "ocr_resumen_factura" ? { ...anadible.existente, lineas: 3, updated_at: "2026-10-10T11:00:00", trabajo_pendiente: false } : null,
    );
    invoke.mockResolvedValue({ data: { success: true, message: "Página 1 añadida a la factura P26/24306: 3 + 2 líneas.", alertas: [] }, error: null });
    montarSubida();
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    expect(within(seccion).queryByRole("button", { name: /Sustituir/ })).toBeNull();
    fireEvent.click(within(seccion).getByRole("button", { name: /Añadir como página 1 a la factura P26\/24306/ }));
    expect(await screen.findByText(/¿Añadir como página 1 de 2 a la factura P26\/24306\?/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Sí, añadir la página/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].body).toEqual({
      modo: "anadir_pagina", factura_id: 352, trabajo_id: anadible.trabajo_id,
      esperado: { lineas: 3, updated_at: "2026-10-10T11:00:00" },
    });
    expect(doble.rpcs[0]).toEqual({ nombre: "ocr_resumen_factura", args: { p_factura_id: 352 } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pendientes de decidir" })).toBeNull());
  });

  it("no deja sustituir una existente sin líneas y, si la factura cambió, lo dice y deja confirmar de nuevo", async () => {
    doble.fijarRespuestas((tabla, llamadas) =>
      tabla === "ocr_trabajos" && filtra(llamadas, "estado", "duplicado")
        ? [{ id: sustituible.trabajo_id, nombre_original: "ML101511.pdf", created_at: "2026-10-05T10:00:00Z", resultado: { success: true, duplicado: true, sustituible } }]
        : [],
    );
    let lineas = 0;
    doble.fijarRpc(() => ({ ...sustituible.existente, lineas, trabajo_pendiente: false }));
    montarSubida();
    const seccion = await screen.findByRole("region", { name: "Pendientes de decidir" });
    fireEvent.click(within(seccion).getByRole("button", { name: /Sustituir la existente/ }));
    expect(await screen.findByText(/no tiene líneas todavía/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Sí, sustituir/ }) as HTMLButtonElement).disabled).toBe(true);

    // Se cierra y se vuelve a abrir cuando ya tiene líneas; el servidor aborta porque cambió otra vez.
    fireEvent.click(screen.getByRole("button", { name: /No, dejar la que hay/ }));
    lineas = 8;
    invoke.mockResolvedValue({
      data: { success: false, error: "No se ha sustituido nada: la factura 54 ha cambiado desde que la viste (ahora tiene 9 líneas; tú viste 8). Revisa y confirma de nuevo." },
      error: null,
    });
    fireEvent.click(within(seccion).getByRole("button", { name: /Sustituir la existente/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /Sí, sustituir/ }) as HTMLButtonElement).disabled).toBe(false));
    lineas = 9;
    fireEvent.click(screen.getByRole("button", { name: /Sí, sustituir/ }));
    expect(await screen.findByText(/La factura ha cambiado: revisa los datos y confirma de nuevo/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("9")).toBeTruthy());
    expect(screen.getByText(/¿Sustituir la factura ML\/101511\?/)).toBeTruthy();
  });

  it("marca dos fotos y las une como un documento de 2 páginas", async () => {
    montarSubida();
    fireEvent.change(screen.getByLabelText("Elegir facturas o albaranes (PDF o imágenes)"), {
      target: { files: [new File(["a"], "pag1.jpg", { type: "image/jpeg" }), new File(["b"], "pag2.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Marcar pag1.jpg/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Marcar pag2.jpg/ }));
    fireEvent.click(screen.getByRole("button", { name: /Unir 2 fotos como un documento \(páginas 1–2\)/ }));
    expect(await screen.findByText(/Un documento de 2 páginas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enviar 1 documento/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bajar la página 1 \(pag1.jpg\)/ }));
    expect(screen.getByRole("button", { name: /Bajar la página 1 \(pag2.jpg\)/ })).toBeTruthy();
  });
});
