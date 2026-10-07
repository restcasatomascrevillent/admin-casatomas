/**
 * «Lista de envío» se actualiza sola al abrir la pestaña Suscriptores mientras
 * no haya cron diario: una vez por montaje, en segundo plano, sin avisos y solo
 * con permiso de escritura en Marketing. Supabase mockeado: nunca se llama a
 * funciones reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

// Permiso de escritura en Marketing (lo que exige la función para sincronizar).
const permiso = { canAccess: true, loading: false };
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => permiso }));

import { toast } from "sonner";
import { SincronizacionResend } from "../SincronizacionResend";
import {
  contarEmailsActivos,
  motivoAutoSincronizacion,
  textoContactosAjenos,
  type EstadoResend,
  type PasadaResend,
} from "@/lib/newsletter/resend";

const HORA = 3_600_000;
const esperar = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function nuevoCliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function envolver(children: ReactNode) {
  return render(<QueryClientProvider client={nuevoCliente()}>{children}</QueryClientProvider>);
}

const pasada = (extra: Partial<PasadaResend> = {}): PasadaResend => ({
  id: "p1",
  origen: "panel",
  estado: "ok",
  iniciada_at: new Date(Date.now() - HORA).toISOString(),
  terminada_at: new Date(Date.now() - HORA + 10_000).toISOString(),
  segment_id: "seg-1",
  contactos_resend: 1,
  contactos_segmento: 1,
  contactos_ajenos: 0,
  destinatarios: 1,
  altas: 1,
  actualizados: 0,
  borrados: 0,
  bajas_resend: 0,
  errores: 0,
  pendientes: 0,
  mensaje_error: null,
  ...extra,
});

const estado = (p: PasadaResend | null, extra: Partial<EstadoResend> = {}): EstadoResend => ({
  success: true,
  canal: "transaccional",
  configurado: { api_key: true, segment_id: "seg-1", cron_secret: true },
  limite_contactos: 1000,
  contactos_resend: p?.contactos_resend ?? null,
  nivel_cuota: "ok",
  ultima_pasada: p,
  ultima_terminada: p && p.estado !== "en_curso" ? p : null,
  ...extra,
});

const resultadoOk = {
  success: true,
  estado: "ok",
  contactos_resend: 2,
  limite_contactos: 1000,
  destinatarios: 2,
  altas: 1,
  borrados: 0,
  bajas_resend: 0,
  pendientes: 0,
  bloquea_envio: false,
  total_errores: 0,
};

const llamadasSincronizar = () =>
  invoke.mock.calls.filter((c) => (c[1] as { body: { accion: string } }).body.accion === "sincronizar").length;

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
  permiso.canAccess = true;
  permiso.loading = false;
});

describe("motivoAutoSincronizacion", () => {
  const ahora = Date.parse("2026-10-05T12:00:00Z");
  const hace = (ms: number) => new Date(ahora - ms).toISOString();
  const p = (extra: Partial<PasadaResend> = {}) => pasada({ iniciada_at: hace(HORA), terminada_at: hace(HORA - 10_000), ...extra });
  const e = (ult: PasadaResend | null, term: PasadaResend | null = ult, api_key = true) => ({
    configurado: { api_key, segment_id: null, cron_secret: false },
    ultima_pasada: ult,
    ultima_terminada: term,
  });

  it("nunca sincronizada -> «nunca»", () => {
    expect(motivoAutoSincronizacion(e(null), 2, ahora)).toBe("nunca");
  });
  it("cuadra y es reciente -> null", () => {
    expect(motivoAutoSincronizacion(e(p({ destinatarios: 2 })), 2, ahora)).toBeNull();
  });
  it("los activos difieren de los de la lista -> «difiere» (el caso «1 de 1.000» con 2 activos)", () => {
    expect(motivoAutoSincronizacion(e(p({ destinatarios: 1, contactos_resend: 1 })), 2, ahora)).toBe("difiere");
  });
  it("compara con los destinatarios, no con el total de contactos (los ajenos no cuentan)", () => {
    expect(motivoAutoSincronizacion(e(p({ destinatarios: 2, contactos_resend: 5, contactos_ajenos: 3 })), 2, ahora)).toBeNull();
    expect(motivoAutoSincronizacion(e(p({ destinatarios: null, contactos_resend: 2 })), 2, ahora)).toBeNull();
  });
  it("más de 24 h -> «antigua», aunque cuadre", () => {
    const vieja = p({ iniciada_at: hace(25 * HORA), terminada_at: hace(25 * HORA - 10_000), destinatarios: 2 });
    expect(motivoAutoSincronizacion(e(vieja), 2, ahora)).toBe("antigua");
  });
  it("sin activos conocidos solo cuentan la antigüedad y si hubo alguna", () => {
    expect(motivoAutoSincronizacion(e(p({ destinatarios: 7 })), null, ahora)).toBeNull();
    expect(motivoAutoSincronizacion(e(null), null, ahora)).toBe("nunca");
  });
  it("otra pasada en curso (reciente) -> null; colgada más de 15 min -> decide la última terminada", () => {
    const enCurso = p({ estado: "en_curso", iniciada_at: hace(60_000), terminada_at: null });
    expect(motivoAutoSincronizacion(e(enCurso, p({ destinatarios: 1 })), 2, ahora)).toBeNull();
    const colgada = p({ estado: "en_curso", iniciada_at: hace(20 * 60_000), terminada_at: null });
    expect(motivoAutoSincronizacion(e(colgada, p({ destinatarios: 1 })), 2, ahora)).toBe("difiere");
  });
  it("la última falló hace poco -> null (no insistir); hace más de 15 min -> «fallida»", () => {
    expect(motivoAutoSincronizacion(e(p({ estado: "error", terminada_at: hace(60_000), destinatarios: null })), 2, ahora)).toBeNull();
    expect(motivoAutoSincronizacion(e(p({ estado: "error", destinatarios: null })), 2, ahora)).toBe("fallida");
  });
  it("sin clave del servicio de envío nunca se lanza", () => {
    expect(motivoAutoSincronizacion(e(null, null, false), 2, ahora)).toBeNull();
  });
  it("textoContactosAjenos: 1, varios, ninguno o sin datos", () => {
    expect(textoContactosAjenos(p({ contactos_resend: 3, contactos_ajenos: 1 }))).toMatch(/^Incluye 1 contacto que no es suscriptor \(normalmente la dirección de pruebas/);
    expect(textoContactosAjenos(p({ contactos_resend: 1500, contactos_ajenos: 1200 }))).toMatch(/^Incluye 1\.200 contactos que no son suscriptores/);
    expect(textoContactosAjenos(p({ contactos_ajenos: 0 }))).toBe("");
    expect(textoContactosAjenos(p({ contactos_resend: null, contactos_ajenos: null }))).toBe("");
    expect(textoContactosAjenos(null)).toBe("");
  });
  it("cuenta emails activos distintos (normalizados)", () => {
    expect(contarEmailsActivos([{ email: "A@x.es" }, { email: " a@x.es" }, { email: "b@x.es" }, { email: "" }])).toBe(2);
  });
});

describe("SincronizacionResend se actualiza sola al abrirse", () => {
  it("si los activos no cuadran con la lista: lanza UNA sincronización, sin avisos, y refresca el contador", async () => {
    let terminar: (v: unknown) => void = () => {};
    invoke
      .mockResolvedValueOnce({ data: estado(pasada({ destinatarios: 1, contactos_resend: 1 })), error: null })
      .mockReturnValueOnce(new Promise((r) => (terminar = r)))
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 2, contactos_resend: 2, terminada_at: new Date().toISOString() })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText("1 de 1.000")).toBeInTheDocument();
    expect(await screen.findByText("Actualizando lista de envío…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Actualizar lista de envío/ })).toBeDisabled();
    terminar({ data: resultadoOk, error: null });
    expect(await screen.findByText("2 de 1.000")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Actualizando lista de envío…")).not.toBeInTheDocument());
    expect(llamadasSincronizar()).toBe(1);
    expect(invoke).toHaveBeenCalledWith("newsletter-sync-resend", { body: { accion: "sincronizar" } });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("no repite aunque tras sincronizar siga sin cuadrar (una por montaje)", async () => {
    invoke
      .mockResolvedValueOnce({ data: estado(pasada({ destinatarios: 1 })), error: null })
      .mockResolvedValueOnce({ data: { ...resultadoOk, destinatarios: 1 }, error: null })
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 1, terminada_at: new Date().toISOString() })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    await waitFor(() => expect(llamadasSincronizar()).toBe(1));
    // Tras sincronizar se vuelve a pedir el estado y sigue sin cuadrar: no se lanza otra.
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(3));
    await esperar();
    expect(llamadasSincronizar()).toBe(1);
  });

  it("no lanza nada si cuadra y es reciente", async () => {
    invoke.mockResolvedValue({ data: estado(pasada({ destinatarios: 2, contactos_resend: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText("2 de 1.000")).toBeInTheDocument();
    await esperar();
    expect(llamadasSincronizar()).toBe(0);
    expect(screen.queryByText("Actualizando lista de envío…")).not.toBeInTheDocument();
  });

  it("si la última correcta tiene más de 24 h, lanza aunque cuadre", async () => {
    const hace30h = new Date(Date.now() - 30 * HORA).toISOString();
    invoke
      .mockResolvedValueOnce({ data: estado(pasada({ destinatarios: 2, iniciada_at: hace30h, terminada_at: hace30h })), error: null })
      .mockResolvedValueOnce({ data: resultadoOk, error: null })
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    await waitFor(() => expect(llamadasSincronizar()).toBe(1));
  });

  it("si nunca se ha sincronizado, lanza", async () => {
    invoke
      .mockResolvedValueOnce({ data: estado(null), error: null })
      .mockResolvedValueOnce({ data: resultadoOk, error: null })
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    await waitFor(() => expect(llamadasSincronizar()).toBe(1));
  });

  it("sin permiso de escritura en Marketing no lanza nada ni muestra error", async () => {
    permiso.canAccess = false;
    invoke.mockResolvedValue({ data: estado(pasada({ destinatarios: 1 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText("1 de 1.000")).toBeInTheDocument();
    await esperar();
    expect(llamadasSincronizar()).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("espera a que se resuelva el permiso y a que carguen los activos antes de decidir", async () => {
    permiso.loading = true;
    permiso.canAccess = false;
    invoke.mockResolvedValue({ data: estado(pasada({ destinatarios: 1 })), error: null });
    const qc = nuevoCliente();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <SincronizacionResend activos={undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1 de 1.000")).toBeInTheDocument();
    await esperar(30);
    expect(llamadasSincronizar()).toBe(0);
    permiso.loading = false;
    permiso.canAccess = true;
    invoke.mockResolvedValueOnce({ data: resultadoOk, error: null });
    rerender(
      <QueryClientProvider client={qc}>
        <SincronizacionResend activos={2} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(llamadasSincronizar()).toBe(1));
  });

  it("si hay otra pasada en curso no lanza", async () => {
    const enCurso = pasada({ estado: "en_curso", iniciada_at: new Date(Date.now() - 30_000).toISOString(), terminada_at: null });
    invoke.mockResolvedValue({ data: estado(enCurso, { ultima_terminada: pasada({ destinatarios: 1 }) }), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText(/Última actualización/)).toBeInTheDocument();
    await esperar();
    expect(llamadasSincronizar()).toBe(0);
  });

  it("si la función responde «ocupado» (409) o falla: ni aviso rojo ni reintento", async () => {
    invoke
      .mockResolvedValueOnce({ data: estado(pasada({ destinatarios: 1 })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 409 } } })
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 1 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    await waitFor(() => expect(llamadasSincronizar()).toBe(1));
    await waitFor(() => expect(screen.queryByText("Actualizando lista de envío…")).not.toBeInTheDocument());
    await esperar();
    expect(llamadasSincronizar()).toBe(1);
    expect(toast.error).not.toHaveBeenCalled();
    // La tarjeta sigue ahí, con el botón para reintentar a mano.
    expect(screen.getByRole("button", { name: /Actualizar lista de envío/ })).toBeEnabled();
  });

  it("sin la prop de activos, o sin clave del servicio, no se actualiza sola", async () => {
    invoke.mockResolvedValue({ data: estado(null), error: null });
    const { unmount } = envolver(<SincronizacionResend />);
    expect(await screen.findByText(/no se ha actualizado nunca/)).toBeInTheDocument();
    await esperar(30);
    expect(llamadasSincronizar()).toBe(0);
    unmount();

    invoke.mockResolvedValue({ data: estado(null, { configurado: { api_key: false, segment_id: null, cron_secret: false } }), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText(/no se ha actualizado nunca/)).toBeInTheDocument();
    await esperar(30);
    expect(llamadasSincronizar()).toBe(0);
  });

  it("el texto ya no promete una actualización diaria", async () => {
    invoke.mockResolvedValue({ data: estado(pasada({ destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    // La explicación vive tras el (i) del título (antes era una descripción fija que ocupaba alto).
    fireEvent.click(await screen.findByRole("button", { name: "Qué es la lista de envío" }));
    expect(await screen.findByText(/Se actualiza sola al abrir esta pestaña y\s+justo antes de cada envío\./)).toBeInTheDocument();
    expect(screen.queryByText(/cada día/)).not.toBeInTheDocument();
  });

  it("explica en llano por qué hay más contactos que destinatarios (dirección de pruebas = contacto ajeno)", async () => {
    // Producción el 2026-10-05: 3 contactos, 2 recibirían el envío; el tercero es delivered@resend.dev.
    invoke.mockResolvedValue({ data: estado(pasada({ contactos_resend: 3, contactos_ajenos: 1, destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText("3 de 1.000")).toBeInTheDocument();
    expect(screen.getByText(/2 recibirían el próximo envío/)).toBeInTheDocument();
    expect(
      screen.getByText("Incluye 1 contacto que no es suscriptor (normalmente la dirección de pruebas del botón «Enviar prueba»): no recibe la newsletter, pero cuenta para el máximo."),
    ).toBeInTheDocument();
    // Cuadra (2 activos = 2 destinatarios): el contacto de pruebas no provoca una actualización automática.
    await esperar();
    expect(llamadasSincronizar()).toBe(0);
  });

  it("sin contactos ajenos no añade ninguna explicación", async () => {
    invoke.mockResolvedValue({ data: estado(pasada({ contactos_resend: 2, contactos_ajenos: 0, destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    expect(await screen.findByText("2 de 1.000")).toBeInTheDocument();
    expect(screen.queryByText(/no es suscriptor|no son suscriptores/)).not.toBeInTheDocument();
  });

  it("el botón sigue avisando de los errores (solo la pasada automática va en silencio)", async () => {
    invoke
      .mockResolvedValueOnce({ data: estado(pasada({ destinatarios: 2 })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValue({ data: estado(pasada({ destinatarios: 2 })), error: null });
    envolver(<SincronizacionResend activos={2} />);
    fireEvent.click(await screen.findByRole("button", { name: /Actualizar lista de envío/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(llamadasSincronizar()).toBe(1);
  });
});
