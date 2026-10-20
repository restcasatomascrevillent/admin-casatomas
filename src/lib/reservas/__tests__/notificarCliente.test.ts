/**
 * La ÚNICA forma de llamar a `notify-reservation-change` (`notificarCliente.ts`).
 *
 * Antes había tres: `{ id, ...cambios }` (`notificarCambioReserva`), la fila entera de
 * la reserva (`updateReservationStatus` de la lista) y `{ reserva_id }`
 * (`useSolicitudesPendientes`). El servidor solo lee `reserva_id ?? id` y se queda con
 * eso: lo demás del cuerpo se ignora. Y ninguna miraba la respuesta: `functions.invoke`
 * NO lanza ante un 4xx/5xx ni ante un `{ success: false }`, devuelve `{ data, error }`,
 * así que un correo que no salía (sin permiso, sin secreto, dirección bloqueada…) no lo
 * sabía nadie.
 *
 * CONTRATO DEL SERVIDOR (lo que hace que el cuerpo dé igual): `notify-reservation-change/index.ts`
 * solo lee `reserva_id ?? id` y se lo pasa a `emails-reserva`, que RELEE el estado de la reserva en
 * la BD para elegir la plantilla. Por eso se avisa siempre DESPUÉS de guardar.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  notificarAlCliente,
  notificarYAvisarSiFalla,
  seReintentaSolo,
  textoProblemaEnvio,
} from "../notificarCliente";

/** Lo que contesta `notify-reservation-change` cuando `emails-reserva` dice `cuerpo`. */
const respuestaDeEmails = (cuerpo: { ok: boolean; motivo?: string }) => ({
  data: { success: true, status: 200, resultado: JSON.stringify(cuerpo) },
  error: null,
});

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("notificarAlCliente · qué pide", () => {
  it("llama UNA vez a `notify-reservation-change` con `{ id, ...cambios }` y nada más", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuestaDeEmails({ ok: true }) as never);

    await notificarAlCliente("res-1", { hora: "21:00", espacio_id: "salon", estado: "verificada" });

    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-reservation-change", {
      body: { id: "res-1", hora: "21:00", espacio_id: "salon", estado: "verificada" },
    });
  });

  it("sin cambios manda solo el id", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuestaDeEmails({ ok: true }) as never);

    await notificarAlCliente("res-1");

    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-reservation-change", { body: { id: "res-1" } });
  });

  it("el id de la reserva manda sobre uno que venga dentro de los cambios", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuestaDeEmails({ ok: true }) as never);

    await notificarAlCliente("res-1", { id: "otra", estado: "cancelada" } as never);

    const [, opciones] = vi.mocked(supabase.functions.invoke).mock.calls[0];
    expect((opciones as { body: { id: string } }).body.id).toBe("res-1");
  });
});

describe("notificarAlCliente · qué devuelve (nunca lanza)", () => {
  it.each([
    ["enviado", respuestaDeEmails({ ok: true }), { resultado: "enviado" }],
    ["ya enviado (idempotente por reserva y tipo)", respuestaDeEmails({ ok: false, motivo: "ya_enviado_o_en_curso" }), { resultado: "ya_enviado" }],
    ["dirección bloqueada", respuestaDeEmails({ ok: false, motivo: "destinatario_suprimido" }), { resultado: "suprimido" }],
    ["otro motivo", respuestaDeEmails({ ok: false, motivo: "fallido_definitivo" }), { resultado: "no_enviado", motivo: "fallido_definitivo" }],
    ["respuesta ilegible: solo se sabe que se pidió", { data: { success: true, resultado: "no es json" }, error: null }, { resultado: "pedido" }],
    ["sin cuerpo", { data: null, error: null }, { resultado: "pedido" }],
    ["la función responde con error (la forma habitual de supabase-js ante un 4xx/5xx)", { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" } }, { resultado: "fallo" }],
    ["la función contesta 200 con success:false (emails-reserva caído)", { data: { success: false, status: 500, error: "x" }, error: null }, { resultado: "fallo" }],
  ])("%s", async (_nombre, respuesta, esperado) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuesta as never);

    await expect(notificarAlCliente("res-1", { estado: "confirmada" })).resolves.toEqual(esperado);
  });

  it("si la llamada LANZA (red caída) devuelve `fallo` y lo deja en el log", async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error("red caída"));

    await expect(notificarAlCliente("res-1")).resolves.toEqual({ resultado: "fallo" });
    expect(consolaError).toHaveBeenCalledWith("Error notificando cambio de reserva:", expect.any(Error));
  });

  it("si la función responde con un error también lo deja en el log (antes no lo sabía nadie)", async () => {
    const error = { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" };
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error } as never);

    await notificarAlCliente("res-1");

    expect(consolaError).toHaveBeenCalledWith("Error notificando cambio de reserva:", error);
  });

  it("un envío normal no ensucia el log", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuestaDeEmails({ ok: true }) as never);

    await notificarAlCliente("res-1");

    expect(consolaError).not.toHaveBeenCalled();
  });
});

describe("textoProblemaEnvio · cuándo hay algo que decirle al personal", () => {
  it.each([
    ["enviado", { resultado: "enviado" }],
    ["ya enviado antes: no es un problema, no se repite", { resultado: "ya_enviado" }],
    ["pedido sin más datos: no se afirma nada", { resultado: "pedido" }],
    ["reserva sin email (ya lo dice el aviso de éxito)", { resultado: "no_enviado", motivo: "reserva_sin_email" }],
    ["solicitud web pendiente (silencio por diseño)", { resultado: "no_enviado", motivo: "solicitud_recibida_silenciada_canal_web" }],
    ["estado sin plantilla", { resultado: "no_enviado", motivo: "sin_plantilla_para_estado_completada" }],
  ] as const)("%s: nada", (_nombre, envio) => {
    expect(textoProblemaEnvio(envio)).toBeNull();
  });

  it("no se pudo ni pedir: lo dice", () => {
    expect(textoProblemaEnvio({ resultado: "fallo" })).toBe("no se ha podido pedir el envío del correo.");
  });

  it("dirección bloqueada: lo dice", () => {
    expect(textoProblemaEnvio({ resultado: "suprimido" })).toBe("ese email está bloqueado porque antes rebotó o se quejó.");
  });

  it.each(["fallido_definitivo", "fallido_reintentable", "resend_no_configurado", "plantilla_no_configurada_propuesta", "reserva_no_encontrada"])(
    "otro motivo (%s): lo dice, con el motivo",
    (motivo) => {
      expect(textoProblemaEnvio({ resultado: "no_enviado", motivo })).toBe(`el correo no ha salido (${motivo}).`);
    },
  );
});

describe("seReintentaSolo · el envío falló pero el sistema lo reintenta", () => {
  // `emails-reserva` marca `fallido_reintentable` un fallo transitorio de Resend y el cron
  // `reintentar-fallidos` (cada 15 min, espera creciente de 10 a 80 min, hasta 5 intentos) lo vuelve a
  // enviar solo; al agotarse, avisa en la campana del panel.
  it("`fallido_reintentable` sí", () => {
    expect(seReintentaSolo({ resultado: "no_enviado", motivo: "fallido_reintentable" })).toBe(true);
  });

  it.each([
    { resultado: "no_enviado", motivo: "fallido_definitivo" },
    { resultado: "no_enviado", motivo: "resend_no_configurado" },
    { resultado: "no_enviado", motivo: "reserva_sin_email" },
    { resultado: "suprimido" },
    { resultado: "fallo" },
    { resultado: "enviado" },
    { resultado: "ya_enviado" },
    { resultado: "pedido" },
  ] as const)("%j no", (envio) => {
    expect(seReintentaSolo(envio)).toBe(false);
  });
});

describe("notificarYAvisarSiFalla · el aviso honesto al personal", () => {
  it("con el correo enviado no dice nada", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(respuestaDeEmails({ ok: true }) as never);

    const envio = await notificarYAvisarSiFalla("res-1", { estado: "verificada" }, { nombre: "Ana" });

    expect(envio).toEqual({ resultado: "enviado" });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("si el correo no sale avisa, con el nombre, SIN dar la reserva por no guardada y diciendo qué hacer", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: { message: "500" } } as never);

    const envio = await notificarYAvisarSiFalla("res-1", { estado: "verificada" }, { nombre: "Ana" });

    expect(envio).toEqual({ resultado: "fallo" });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", {
      description: "Ana: la reserva ya está guardada, pero no se ha podido pedir el envío del correo. Avísale por teléfono.",
      duration: 10_000,
    });
  });

  it("sin nombre, la frase empieza directamente", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(
      respuestaDeEmails({ ok: false, motivo: "destinatario_suprimido" }) as never,
    );

    await notificarYAvisarSiFalla("res-1", { estado: "verificada" });

    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", {
      description: "La reserva ya está guardada, pero ese email está bloqueado porque antes rebotó o se quejó. Avísale por teléfono.",
      duration: 10_000,
    });
  });

  it("un nombre en blanco cuenta como sin nombre", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: { message: "x" } } as never);

    await notificarYAvisarSiFalla("res-1", {}, { nombre: "   " });

    expect(vi.mocked(toast.error).mock.calls[0][1]).toMatchObject({ description: expect.stringMatching(/^La reserva ya está guardada/) });
  });

  it("si la llamada lanza, avisa igual y no revienta a quien llama", async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error("red caída"));

    await expect(notificarYAvisarSiFalla("res-1", {}, { nombre: "Ana" })).resolves.toEqual({ resultado: "fallo" });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("B4: si el envío falló pero se reintenta solo NO dice «Avísale por teléfono»: dice que se reintentará y que el panel avisará si no sale", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(
      respuestaDeEmails({ ok: false, motivo: "fallido_reintentable" }) as never,
    );

    await notificarYAvisarSiFalla("res-1", { estado: "verificada" }, { nombre: "Ana" });

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("El correo al cliente no ha salido todavía", {
      description:
        "Ana: la reserva ya está guardada y el correo se reintentará automáticamente en unos minutos; si no consigue salir, el panel te avisará.",
      duration: 10_000,
    });
    // No es un error que el personal tenga que resolver llamando: no sale el aviso rojo ni el «teléfono».
    expect(toast.error).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(toast.info).mock.calls)).not.toMatch(/teléfono/i);
  });

  it("y sin nombre, la frase empieza directamente", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(
      respuestaDeEmails({ ok: false, motivo: "fallido_reintentable" }) as never,
    );

    await notificarYAvisarSiFalla("res-1", {});

    expect(toast.info).toHaveBeenCalledWith("El correo al cliente no ha salido todavía", {
      description:
        "La reserva ya está guardada y el correo se reintentará automáticamente en unos minutos; si no consigue salir, el panel te avisará.",
      duration: 10_000,
    });
  });

  it("un fallo DEFINITIVO (ya agotado o permanente) sí pide llamar al cliente", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(
      respuestaDeEmails({ ok: false, motivo: "fallido_definitivo" }) as never,
    );

    await notificarYAvisarSiFalla("res-1", {}, { nombre: "Ana" });

    expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", {
      description: "Ana: la reserva ya está guardada, pero el correo no ha salido (fallido_definitivo). Avísale por teléfono.",
      duration: 10_000,
    });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("los motivos que no son un problema (sin email) no avisan", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce(
      respuestaDeEmails({ ok: false, motivo: "reserva_sin_email" }) as never,
    );

    await notificarYAvisarSiFalla("res-1", { estado: "confirmada" }, { nombre: "Ana" });

    expect(toast.error).not.toHaveBeenCalled();
  });
});
