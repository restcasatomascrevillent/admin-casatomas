/**
 * `src/lib/realtimeCanal.ts`: nombre de canal único, vigilancia de la suscripción, invalidación
 * diferida y sondeo.
 *
 * Lo que se protege aquí (los hooks lo usan; sus tests comprueban que lo enchufan):
 *   · dos suscripciones nunca comparten nombre (realtime-js devolvería el MISMO canal);
 *   · un canal que falla avisa por consola UNA vez, con el prefijo `[realtime]`, y de cada TABLA
 *     se avisa una sola vez por sesión (sin migración, cada pestaña/día abre su canal);
 *   · el aviso también sale con el `system` de error del servidor (tabla fuera de la publicación),
 *     que es la ÚNICA señal de ese fallo: el canal sí llega a SUBSCRIBED;
 *   · nuestra propia salida al desmontar (`cerrar()` + CLOSED) no avisa ni relee;
 *   · `alSuscribirse` cuenta las veces: 1 al suscribirse, 2+ al recuperarse;
 *   · la invalidación diferida: 1 s tras el último evento y como mucho 5 s tras el primero;
 *   · el sondeo solo corre con la pestaña a la vista y se para.
 * El comportamiento contra realtime-js DE VERDAD está en realtimeCanal.realtimejs.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  crearInvalidacionDiferida,
  ESPERA_INVALIDACION_MS,
  ESPERA_MAXIMA_INVALIDACION_MS,
  INTERVALO_SONDEO_MS,
  nombreCanalUnico,
  olvidarAvisosRealtime,
  PREFIJO_AVISO_REALTIME,
  programarSondeo,
  REFRESCO_PERIODICO,
  vigilarCanal,
} from "@/lib/realtimeCanal";

describe("nombreCanalUnico", () => {
  it("dos llamadas con el mismo prefijo dan nombres distintos, los dos con el prefijo", () => {
    const a = nombreCanalUnico("notificaciones_realtime");
    const b = nombreCanalUnico("notificaciones_realtime");
    expect(a).not.toBe(b);
    expect(a.startsWith("notificaciones_realtime-")).toBe(true);
    expect(b.startsWith("notificaciones_realtime-")).toBe(true);
  });
});

describe("vigilarCanal", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    olvidarAvisosRealtime();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("CHANNEL_ERROR, TIMED_OUT, CLOSED y un `system` de error: UN solo aviso, con el prefijo y el nombre del canal", () => {
    const v = vigilarCanal("canal-de-prueba-1");
    v.alCambiarEstado("CHANNEL_ERROR", new Error("mismatch between server and client bindings for postgres changes"));
    v.alCambiarEstado("TIMED_OUT");
    v.alCambiarEstado("CLOSED");
    v.alMensajeSistema({ extension: "postgres_changes", status: "error", message: "Unable to subscribe" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(PREFIJO_AVISO_REALTIME);
    expect(String(warn.mock.calls[0][0])).toContain("canal-de-prueba-1");
    expect(String(warn.mock.calls[0][0])).toContain("CHANNEL_ERROR");
  });

  it("el `system` de error del servidor avisa aunque el canal esté SUBSCRIBED (tabla fuera de la publicación)", () => {
    const v = vigilarCanal("canal-de-prueba-2");
    v.alCambiarEstado("SUBSCRIBED");
    v.alMensajeSistema({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" });
    expect(warn).not.toHaveBeenCalled();

    const mensaje =
      "Unable to subscribe to changes with given parameters. Please check Realtime is enabled for the given connect parameters: [event: *, schema: public, table: reservas, filters: []]";
    v.alMensajeSistema({ extension: "postgres_changes", status: "error", message: mensaje });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("postgres_changes");
    expect(warn.mock.calls[0][1]).toBe(mensaje);
  });

  it("de cada TABLA se avisa una vez por sesión: otro canal de la misma tabla calla; uno de otra tabla, no", () => {
    vigilarCanal("reservas-en-vivo-reservas-1", { tabla: "reservas" }).alMensajeSistema({ status: "error" });
    vigilarCanal("ocupacion-salas-2026-10-02-r1", { tabla: "reservas" }).alCambiarEstado("CHANNEL_ERROR");
    vigilarCanal("servicio-sala-reservas-r2", { tabla: "reservas" }).alCambiarEstado("TIMED_OUT");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("(tabla reservas)");

    vigilarCanal("reservas-en-vivo-asignaciones_mesa-2", { tabla: "asignaciones_mesa" }).alMensajeSistema({ status: "error" });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain("(tabla asignaciones_mesa)");
  });

  it("tras `cerrar()` (lo que hace el hook al desmontar) el CLOSED de nuestra salida no avisa y SUBSCRIBED no relee", () => {
    const alSuscribirse = vi.fn();
    const v = vigilarCanal("canal-de-prueba-3", { alSuscribirse });
    v.cerrar();
    v.alCambiarEstado("CLOSED");
    v.alCambiarEstado("CHANNEL_ERROR");
    v.alMensajeSistema({ status: "error", message: "x" });
    v.alCambiarEstado("SUBSCRIBED");

    expect(warn).not.toHaveBeenCalled();
    expect(alSuscribirse).not.toHaveBeenCalled();
  });

  it("`alSuscribirse` recibe la vez: 1 al suscribirse y 2, 3… cada vez que el canal se recupera", () => {
    const alSuscribirse = vi.fn();
    const v = vigilarCanal("canal-de-prueba-4", { alSuscribirse });
    v.alCambiarEstado("SUBSCRIBED");
    v.alCambiarEstado("CHANNEL_ERROR"); // se cae la red…
    v.alCambiarEstado("SUBSCRIBED"); // …y realtime-js lo vuelve a unir
    v.alCambiarEstado("SUBSCRIBED");

    expect(alSuscribirse.mock.calls.map(([vez]) => vez)).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("un `system` que no es de error (o que no trae nada) no avisa", () => {
    const v = vigilarCanal("canal-de-prueba-5");
    v.alMensajeSistema(undefined);
    v.alMensajeSistema(null);
    v.alMensajeSistema({ status: "ok" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("crearInvalidacionDiferida", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("una ráfaga corta (20 eventos seguidos) se queda en UNA ejecución, 1 s después del último evento", () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const diferida = crearInvalidacionDiferida(accion);

    for (let i = 0; i < 20; i++) {
      diferida.programar();
      vi.advanceTimersByTime(30);
    }
    expect(accion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS - 31);
    expect(accion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(accion).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("con eventos sin parar ejecuta como mucho cada 5 s (tope), no espera a que acabe la ráfaga", () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const diferida = crearInvalidacionDiferida(accion);

    // Un evento cada 200 ms durante 12 s: la cola de 1 s no llega nunca a cumplirse.
    for (let t = 0; t < 12_000; t += 200) {
      diferida.programar();
      vi.advanceTimersByTime(200);
    }
    // A los 5 s y a los ~10 s (tope desde el primer evento pendiente de cada tanda).
    expect(accion).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ESPERA_INVALIDACION_MS);
    expect(accion).toHaveBeenCalledTimes(3); // la cola tras el último evento
    expect(ESPERA_MAXIMA_INVALIDACION_MS).toBe(5_000);
  });

  it("`cancelar` (al desmontar) descarta lo pendiente, también el tope", () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const diferida = crearInvalidacionDiferida(accion);
    diferida.programar();
    diferida.cancelar();
    vi.advanceTimersByTime(ESPERA_MAXIMA_INVALIDACION_MS * 2);
    expect(accion).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("programarSondeo y REFRESCO_PERIODICO", () => {
  let visibilidad: DocumentVisibilityState;

  beforeEach(() => {
    visibilidad = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it("toca cada minuto solo con la pestaña a la vista y para al pedírselo", () => {
    vi.useFakeTimers();
    const alTocar = vi.fn();
    const parar = programarSondeo(alTocar);

    visibilidad = "hidden";
    vi.advanceTimersByTime(INTERVALO_SONDEO_MS * 3);
    expect(alTocar).not.toHaveBeenCalled();

    visibilidad = "visible";
    vi.advanceTimersByTime(INTERVALO_SONDEO_MS);
    expect(alTocar).toHaveBeenCalledTimes(1);

    parar();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVALO_SONDEO_MS * 3);
    expect(alTocar).toHaveBeenCalledTimes(1);
  });

  it("el respaldo de TanStack Query: cada minuto y nunca en segundo plano", () => {
    expect(REFRESCO_PERIODICO).toEqual({ refetchInterval: 60_000, refetchIntervalInBackground: false });
  });
});
