// Super Admin › Reseñas Google: lista con el estado del contestador, filtros, revisar/aprobar y ajustes.
// Supabase y la Edge Function simulados: nada sale a la red.
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resenas: [] as Array<Record<string, unknown>>,
  ajustes: null as Record<string, unknown> | null,
  invoke: vi.fn(),
  updates: [] as Array<{ tabla: string; cambios: Record<string, unknown>; filtros: Record<string, unknown> }>,
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      channel: () => canal,
      removeChannel: () => undefined,
      from: (tabla: string) => {
        let cambios: Record<string, unknown> | null = null;
        const filtros: Record<string, unknown> = {};
        const responder = () => {
          if (cambios) { h.updates.push({ tabla, cambios, filtros }); return { data: null, error: null }; }
          if (tabla === "resenas") return { data: h.resenas, error: null };
          if (tabla === "resenas_ajustes") return { data: h.ajustes, error: h.ajustes ? null : { message: "relation does not exist" } };
          if (tabla === "config_google_places") return { data: { id: "c1", place_id: "ChIJsS3PCWq5Yw0RL0gH6hiZvu0", place_name: "Casa Tomás", rating_promedio: 4.7, total_resenas: 400 }, error: null };
          return { data: null, error: null };
        };
        const b: Record<string, unknown> = {
          select: () => b, order: () => b, limit: () => b,
          eq: (c: string, v: unknown) => { filtros[c] = v; return b; },
          update: (c: Record<string, unknown>) => { cambios = c; return b; },
          single: async () => responder(),
          maybeSingle: async () => responder(),
          then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, ko),
        };
        return b;
      },
      functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    },
  };
});
vi.mock("@/components/SuperAdminLayout", () => ({ SuperAdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAlturaDisponible", () => ({ useAlturaDisponible: () => undefined }));
vi.mock("sonner", () => ({ toast: h.toast }));

import GestionResenas from "../GestionResenas";

configure({ asyncUtilTimeout: 5000 });

const fila = (i: number, x: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, fuente: "google", estado: "publicada", fecha: "2026-11-0" + i, comentario: "Texto",
  respuesta: null, respuesta_estado: "pendiente", respuesta_propuesta: null, google_maps_uri: null, valoracion: 5, ...x,
});

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><GestionResenas /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.updates = [];
  h.invoke.mockReset();
  Object.values(h.toast).forEach((f) => f.mockReset());
  h.invoke.mockImplementation(async (_n: string, { body }: { body: Record<string, unknown> }) => {
    if (body.accion === "estado") return { data: { ok: true, ia: true, google: { configurada: false, conectada: false, redirect_uri: "https://x.supabase.co/functions/v1/resenas-contestador" } }, error: null };
    if (body.accion === "aprobar") return { data: { ok: true, estado: "aprobada", publicada: false, motivo: "sin_conexion", mensaje: "Aprobada. Cópiala y respóndela en Google." }, error: null };
    return { data: { ok: true }, error: null };
  });
  h.ajustes = { id: true, proponer_automatico: true, autorespuesta_activa: false, autorespuesta_estrellas: [4, 5], autorespuesta_sin_texto: true, firma: "El equipo de Casa Tomás", indicaciones: "" };
  h.resenas = [
    fila(1, { nombre_cliente: "Marta", respuesta_estado: "propuesta", respuesta_propuesta: "Gracias, Marta.", respuesta_origen: "ia" }),
    fila(2, { nombre_cliente: "Javier", valoracion: 2 }),
    fila(3, { nombre_cliente: "Elena", respuesta: "Gracias, Elena.", respuesta_estado: "publicada" }),
    fila(4, { nombre_cliente: "Rosa", estado: "oculta", respuesta_estado: "aprobada", respuesta_propuesta: "Gracias, Rosa." }),
  ];
});

describe("GestionResenas", () => {
  it("enseña también las ocultas, con su estado, y abre en «Por responder»", async () => {
    pintar();
    const lista = await screen.findByTestId("lista-resenas");
    expect(within(lista).getByText("Marta")).toBeInTheDocument();
    expect(within(lista).getByText("Javier")).toBeInTheDocument();
    expect(within(lista).queryByText("Elena")).not.toBeInTheDocument();
    expect(within(lista).getByText("Propuesta lista")).toBeInTheDocument();
    expect(within(lista).getByText("Sin respuesta")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Todas · 4/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Todas · 4/ }));
    await waitFor(() => expect(within(lista).getByText("Rosa")).toBeInTheDocument());
    expect(within(lista).getByText("Oculta en la web")).toBeInTheDocument();
    expect(within(lista).getByText("Respondida")).toBeInTheDocument();
  });

  it("revisar → editar → aprobar llama a la función con el texto editado (sin Google, queda para copiar)", async () => {
    pintar();
    const lista = await screen.findByTestId("lista-resenas");
    fireEvent.click(within(lista).getAllByTestId("resena-abrir")[0]);
    const dialogo = await screen.findByTestId("dialogo-respuesta");
    const texto = within(dialogo).getByTestId("resena-texto");
    expect(texto).toHaveValue("Gracias, Marta.");
    fireEvent.change(texto, { target: { value: "Gracias, Marta. Te esperamos." } });
    fireEvent.click(within(dialogo).getByTestId("resena-aprobar"));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("resenas-contestador", { body: { accion: "aprobar", id: h.resenas[0].id, texto: "Gracias, Marta. Te esperamos." } }));
    expect(h.toast.success).toHaveBeenCalledWith("Aprobada. Cópiala y respóndela en Google.");
    expect(within(dialogo).getByText("Aprobar")).toBeInTheDocument();
  });

  it("ocultar en la web cambia el estado de la reseña", async () => {
    pintar();
    const lista = await screen.findByTestId("lista-resenas");
    fireEvent.click(within(lista).getAllByRole("button", { name: "Ocultar en la web" })[0]);
    await waitFor(() => expect(h.updates).toContainEqual({ tabla: "resenas", cambios: { estado: "oculta" }, filtros: { id: h.resenas[0].id } }));
  });

  it("los ajustes guardan solo las preferencias; la respuesta automática viene apagada", async () => {
    pintar();
    fireEvent.click(await screen.findByText("Contestador"));
    const form = await screen.findByTestId("resenas-ajustes-form");
    const sw = within(form).getByRole("switch", { name: "Responder solas algunas reseñas" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    fireEvent.click(within(form).getByRole("checkbox", { name: "4 estrellas" }));
    fireEvent.click(within(form).getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(h.updates.find((u) => u.tabla === "resenas_ajustes")).toBeTruthy());
    const u = h.updates.find((x) => x.tabla === "resenas_ajustes")!;
    expect(u.cambios).toEqual({ proponer_automatico: true, autorespuesta_activa: true, autorespuesta_estrellas: [5], autorespuesta_sin_texto: true, firma: "El equipo de Casa Tomás", indicaciones: "" });
    expect(u.filtros).toEqual({ id: true });
  });

  it("sin credenciales de Google explica los pasos y deja la URI de vuelta a mano", async () => {
    pintar();
    fireEvent.click(await screen.findByText("Google Business Profile"));
    const pasos = await screen.findByTestId("resenas-google-pasos");
    expect(pasos).toHaveTextContent("https://x.supabase.co/functions/v1/resenas-contestador");
    expect(screen.getByRole("button", { name: /Conectar cuenta de Google del negocio/ })).toBeDisabled();
  });

  it("«Sincronizar ahora» lanza el ciclo del contestador", async () => {
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: /Sincronizar ahora/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("resenas-contestador", { body: { accion: "ciclo" } }));
  });
});
