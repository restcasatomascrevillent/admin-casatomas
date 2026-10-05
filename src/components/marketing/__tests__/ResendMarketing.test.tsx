/**
 * Panel del newsletter por Resend Marketing: estado de sincronización, canal
 * de envío e historial. Supabase mockeado: nunca se llama a funciones reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invoke = vi.fn();
const rpc = vi.fn();
const tablas: Record<string, { data: unknown; error: unknown }[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  const chain = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve((tablas[tabla] ?? []).shift() ?? { data: [], error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
      rpc: (...a: unknown[]) => rpc(...a),
      from: (t: string) => chain(t),
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { SincronizacionResend, CanalEnvio } from "../SincronizacionResend";
import { HistorialEnvios } from "../HistorialEnvios";
import { useEnviarPruebaNewsletter } from "@/hooks/useEnviarNewsletter";
import {
  agruparEstadisticas,
  mensajeSincronizacion,
  porcentajeCuota,
  textoCanal,
  textoCuota,
  type EstadoResend,
} from "@/lib/newsletter/resend";

function envolver(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
}

const estado = (extra: Partial<EstadoResend> = {}): EstadoResend => ({
  success: true,
  canal: "broadcast",
  configurado: { api_key: true, segment_id: "seg-1", cron_secret: true },
  limite_contactos: 1000,
  contactos_resend: 420,
  nivel_cuota: "ok",
  ultima_pasada: {
    id: "p1",
    origen: "cron",
    estado: "ok",
    iniciada_at: new Date(Date.now() - 3_600_000).toISOString(),
    terminada_at: new Date(Date.now() - 3_590_000).toISOString(),
    segment_id: "seg-1",
    contactos_resend: 420,
    contactos_segmento: 415,
    contactos_ajenos: 5,
    destinatarios: 415,
    altas: 2,
    actualizados: 0,
    borrados: 1,
    bajas_resend: 0,
    errores: 0,
    pendientes: 0,
    mensaje_error: null,
  },
  ultima_terminada: null,
  ...extra,
});

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  for (const k of Object.keys(tablas)) delete tablas[k];
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("lib/newsletter/resend", () => {
  it("textos de canal y cuota", () => {
    expect(textoCanal("broadcast")).toBe("Por lista de envío");
    expect(textoCanal("transaccional")).toBe("Correo directo");
    expect(porcentajeCuota(850, 1000)).toBe(85);
    expect(porcentajeCuota(1500, 1000)).toBe(100);
    expect(textoCuota(500, 1000)).toBe("");
    expect(textoCuota(800, 1000)).toMatch(/más del 80 % de los contactos del plan \(máx\. 1\.000\)/);
    expect(textoCuota(1000, 1000)).toMatch(/máximo de contactos del plan \(1\.000\)/);
    expect(textoCuota(1000, 1000)).not.toMatch(/Resend|Broadcast/);
  });

  it("mensaje tras sincronizar", () => {
    const base = { success: true, estado: "ok" as const, contactos_resend: 10, limite_contactos: 1000, destinatarios: 9, altas: 3, borrados: 1, bajas_resend: 0, pendientes: 0, bloquea_envio: false, total_errores: 0 };
    expect(mensajeSincronizacion(base)).toEqual({ tipo: "ok", texto: "Lista de envío actualizada: 3 añadidos, 1 quitado." });
    expect(mensajeSincronizacion({ ...base, estado: "parcial", pendientes: 7 }).tipo).toBe("aviso");
    expect(mensajeSincronizacion({ ...base, success: false, estado: "error", error: "Resend respondió 500 (internal)" })).toEqual({ tipo: "error", texto: "No se pudo actualizar la lista de envío. Inténtalo de nuevo y, si sigue igual, avisa al equipo técnico." });
  });

  it("agrupa las estadísticas por Broadcast", () => {
    const m = agruparEstadisticas([
      { broadcast_id: "b1", tipo_evento: "delivered", eventos: 10, destinatarios: 9 },
      { broadcast_id: "b1", tipo_evento: "opened", eventos: 7, destinatarios: 4 },
      { broadcast_id: "b1", tipo_evento: "sent", eventos: 10, destinatarios: 10 },
      { broadcast_id: "b2", tipo_evento: "bounced", eventos: 1, destinatarios: 1 },
    ]);
    expect(m.get("b1")).toEqual({ entregados: 9, abiertos: 4, clics: 0, rebotes: 0, quejas: 0 });
    expect(m.get("b2")?.rebotes).toBe(1);
  });
});

describe("SincronizacionResend", () => {
  it("muestra canal, contactos usados de 1.000 y la última pasada", async () => {
    invoke.mockResolvedValueOnce({ data: estado(), error: null });
    envolver(<SincronizacionResend />);
    expect(await screen.findByText(/Envío actual: Por lista de envío/)).toBeInTheDocument();
    expect(screen.getByText("420 de 1.000")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "420");
    expect(screen.getByText(/415 recibirían el próximo envío/)).toBeInTheDocument();
    expect(screen.getByText(/Última actualización/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("newsletter-sync-resend", { body: { accion: "estado" } });
  });

  it("avisa al 80 % y al 100 % del límite", async () => {
    invoke.mockResolvedValueOnce({ data: estado({ contactos_resend: 850 }), error: null });
    const { unmount } = envolver(<SincronizacionResend />);
    expect(await screen.findByText(/más del 80 %/i)).toBeInTheDocument();
    unmount();
    invoke.mockResolvedValueOnce({ data: estado({ contactos_resend: 1000 }), error: null });
    envolver(<SincronizacionResend />);
    expect(await screen.findByText(/Has llegado al máximo de contactos del plan/)).toBeInTheDocument();
  });

  it("el botón sincroniza (≥ 44 px) y muestra el resultado", async () => {
    invoke
      .mockResolvedValueOnce({ data: estado(), error: null })
      .mockResolvedValueOnce({
        data: { success: true, estado: "ok", contactos_resend: 421, limite_contactos: 1000, destinatarios: 416, altas: 1, borrados: 0, bajas_resend: 0, pendientes: 0, bloquea_envio: false, total_errores: 0 },
        error: null,
      })
      .mockResolvedValue({ data: estado({ contactos_resend: 421 }), error: null });
    envolver(<SincronizacionResend />);
    const boton = await screen.findByRole("button", { name: /Actualizar lista de envío/ });
    expect(boton.className).toMatch(/\bh-11\b/);
    fireEvent.click(boton);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("newsletter-sync-resend", { body: { accion: "sincronizar" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lista de envío actualizada: 1 añadido."));
  });

  it("sin clave de Resend el botón está desactivado", async () => {
    invoke.mockResolvedValueOnce({ data: estado({ configurado: { api_key: false, segment_id: null, cron_secret: false } }), error: null });
    envolver(<SincronizacionResend />);
    expect(await screen.findByRole("button", { name: /Actualizar lista de envío/ })).toBeDisabled();
    expect(screen.getByText("El envío de newsletter no está disponible ahora mismo. Avisa al equipo técnico.")).toBeInTheDocument();
    // El nombre de la variable solo aparece dentro del desplegable «Detalle técnico».
    expect(screen.getByText(/RESEND_MARKETING_API_KEY/).closest("details")).not.toBeNull();
  });

  it("si la función no está desplegada, lo dice sin romper la página", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    envolver(<SincronizacionResend />);
    expect(await screen.findByText(/La lista de envío todavía no está disponible/)).toBeInTheDocument();
    expect(screen.getByText("Failed to send a request to the Edge Function").closest("details")).not.toBeNull();
  });
});

describe("CanalEnvio", () => {
  it("broadcast", async () => {
    invoke.mockResolvedValueOnce({ data: estado(), error: null });
    envolver(<CanalEnvio />);
    expect(
      await screen.findByText(/Cada correo incluye un enlace para darse de baja\. Las bajas se registran solas en la lista de suscriptores\./),
    ).toBeInTheDocument();
  });
  it("sin conexión con Resend: envío directo", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    envolver(<CanalEnvio />);
    await waitFor(() => expect(screen.getByText(/correo directo/)).toBeInTheDocument());
  });
});

describe("HistorialEnvios", () => {
  it("muestra el canal y las estadísticas de los Broadcasts", async () => {
    tablas.newsletter_envios = [
      {
        data: [
          { id: "e1", asunto: "Menú de otoño", created_at: "2026-10-03T10:00:00Z", total_destinatarios: 415, estado: "completado", tipo_newsletter: "nuevo_menu", canal: "broadcast", resend_broadcast_id: "b1" },
          { id: "e2", asunto: "Cerrado por vacaciones", created_at: "2026-09-01T10:00:00Z", total_destinatarios: 60, estado: "completado", tipo_newsletter: "anuncio", canal: "transaccional", resend_broadcast_id: null },
        ],
        error: null,
      },
    ];
    rpc.mockResolvedValueOnce({
      data: [
        { broadcast_id: "b1", tipo_evento: "delivered", eventos: 410, destinatarios: 410 },
        { broadcast_id: "b1", tipo_evento: "opened", eventos: 300, destinatarios: 200 },
      ],
      error: null,
    });
    envolver(<HistorialEnvios />);
    expect(await screen.findByText("Menú de otoño")).toBeInTheDocument();
    expect(screen.getByText("Lista de envío")).toBeInTheDocument();
    expect(screen.getByText("Correo directo")).toBeInTheDocument();
    expect(screen.getByText(/410 entregados · 200 abiertos/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("newsletter_estadisticas_broadcasts", { p_broadcast_ids: ["b1"] });
  });

  it("sin la migración aplicada (sin columna canal) el historial se sigue viendo", async () => {
    tablas.newsletter_envios = [
      { data: null, error: { message: 'column newsletter_envios.canal does not exist' } },
      { data: [{ id: "e2", asunto: "Viejo", created_at: "2026-09-01T10:00:00Z", total_destinatarios: 60, estado: "completado", tipo_newsletter: "anuncio" }], error: null },
    ];
    envolver(<HistorialEnvios />);
    expect(await screen.findByText("Viejo")).toBeInTheDocument();
    expect(screen.getByText("Correo directo")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("useEnviarPruebaNewsletter", () => {
  it("llama a enviar-newsletter con prueba: true y muestra el aviso", async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, prueba: true, message: "Prueba enviada como Broadcast a delivered@resend.dev" }, error: null });
    const qc = new QueryClient();
    const { result } = renderHook(() => useEnviarPruebaNewsletter(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ tipo: "anuncio", titulo: "T", mensaje: "M" });
    });
    expect(invoke).toHaveBeenCalledWith("enviar-newsletter", {
      body: { prueba: true, newsletter: { tipo: "anuncio", titulo: "T", mensaje: "M" } },
    });
    expect(toast.success).toHaveBeenCalledWith("Prueba enviada. Solo llega a la dirección de pruebas del equipo, no a ningún cliente.");
  });

  it("NO pone tipo/titulo/mensaje en la raíz: una enviar-newsletter antigua (sin modo prueba) respondería 400 en vez de mandarlo a todos", async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    const qc = new QueryClient();
    const { result } = renderHook(() => useEnviarPruebaNewsletter(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await result.current.mutateAsync({ tipo: "oferta", titulo: "T", mensaje: "M", imagen_url: "https://x.test/a.png" });
    });
    const cuerpo = (invoke.mock.calls.at(-1)?.[1] as { body: Record<string, unknown> }).body;
    // Lo que miraba la versión antigua: `if (!payload.tipo || !payload.titulo || !payload.mensaje) -> 400`.
    expect(cuerpo.tipo).toBeUndefined();
    expect(cuerpo.titulo).toBeUndefined();
    expect(cuerpo.mensaje).toBeUndefined();
  });
});
