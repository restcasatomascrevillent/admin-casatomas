/**
 * `vigilarCanal` contra el realtime-js 2.81.1 DE VERDAD (node_modules), con un WebSocket falso que
 * hace de servidor. Comprueba lo que los dobles de los demás tests dan por hecho:
 *   · un `system` con status "error" (tabla fuera de la publicación) llega a `alMensajeSistema` y
 *     NO al callback de `.subscribe()`, que se queda en SUBSCRIBED;
 *   · tras una caída de red llega CHANNEL_ERROR y, al reconectar, SUBSCRIBED otra vez (vez 2);
 *   · `removeChannel` emite CLOSED de forma SÍNCRONA y saca el canal de la lista sin esperar al
 *     servidor: por eso `vigilancia.cerrar()` va ANTES, y el mismo nombre justo después ya da un
 *     canal nuevo.
 * (Nació como sonda de la revisión de 2026-10-02.)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealtimeClient } from "@supabase/realtime-js";
import { olvidarAvisosRealtime, vigilarCanal } from "@/lib/realtimeCanal";

type Msg = { topic: string; event: string; payload: Record<string, unknown>; ref: string | null; join_ref?: string | null };

class FakeWS {
  static instancias: FakeWS[] = [];
  readyState = 0;
  enviados: Msg[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instancias.push(this);
  }
  send(data: string) {
    this.enviados.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  abrir() {
    this.readyState = 1;
    this.onopen?.();
  }
  recibir(msg: Msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  ultimo(evento: string, topic: string) {
    return [...this.enviados].reverse().find((m) => m.event === evento && m.topic === topic);
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("vigilarCanal con realtime-js 2.81.1 real", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeWS.instancias = [];
  });

  it("system → alMensajeSistema; SUBSCRIBED se repite al reconectar; CLOSED síncrono en removeChannel; el nombre se puede reutilizar", async () => {
    vi.useFakeTimers();
    olvidarAvisosRealtime();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cliente = new RealtimeClient("ws://127.0.0.1:1/realtime/v1", {
      params: { apikey: "valor-de-prueba-sin-credencial" },
      transport: FakeWS as unknown as never,
      logger: () => {},
    });
    const nombre = "prueba-realtimejs-1";
    const topic = `realtime:${nombre}`;
    const vez: number[] = [];
    const v = vigilarCanal(nombre, { tabla: "reservas", alSuscribirse: (n) => vez.push(n) });
    const estados: string[] = [];
    const canal = cliente
      .channel(nombre)
      .on("system", {}, v.alMensajeSistema)
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, () => {})
      .subscribe((estado, err) => {
        estados.push(estado);
        v.alCambiarEstado(estado, err);
      });

    // 1) Conexión + join ok → SUBSCRIBED (vez 1)
    const ws1 = FakeWS.instancias[0];
    ws1.abrir();
    await flush();
    const join1 = ws1.ultimo("phx_join", topic)!;
    expect(join1).toBeTruthy();
    ws1.recibir({
      topic,
      event: "phx_reply",
      ref: join1.ref,
      payload: { status: "ok", response: { postgres_changes: [{ id: 7, event: "*", schema: "public", table: "reservas" }] } },
    });
    await flush();
    expect(vez).toEqual([1]);

    // 2) La tabla no está publicada: el servidor manda `system` con status error → UN aviso
    const sistema = {
      message: '{:error, "Unable to subscribe to changes with given parameters..."}',
      status: "error",
      extension: "postgres_changes",
      channel: nombre,
    };
    ws1.recibir({ topic, event: "system", ref: null, payload: sistema });
    ws1.recibir({ topic, event: "system", ref: null, payload: sistema }); // reintento del servidor 5-10 s después
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe(sistema.message);
    expect(estados).toEqual(["SUBSCRIBED"]); // el callback de subscribe NO se entera del system

    // 3) Caída de red → CHANNEL_ERROR; reconexión → SUBSCRIBED otra vez (vez 2)
    ws1.readyState = 3;
    ws1.onclose?.({ code: 1006 });
    expect(estados).toEqual(["SUBSCRIBED", "CHANNEL_ERROR"]);
    await vi.advanceTimersByTimeAsync(15_000);
    const ws2 = FakeWS.instancias[1];
    expect(ws2).toBeTruthy();
    ws2.abrir();
    await flush();
    // El servidor contesta al (re)join en cuanto llega, como en la realidad.
    let join2: Msg | undefined;
    for (let i = 0; i < 60 && !join2; i++) {
      await vi.advanceTimersByTimeAsync(250);
      join2 = ws2.ultimo("phx_join", topic);
    }
    expect(join2).toBeTruthy();
    ws2.recibir({
      topic,
      event: "phx_reply",
      ref: join2!.ref,
      payload: { status: "ok", response: { postgres_changes: [{ id: 7, event: "*", schema: "public", table: "reservas" }] } },
    });
    await flush();
    expect(estados).toEqual(["SUBSCRIBED", "CHANNEL_ERROR", "SUBSCRIBED"]);
    expect(vez).toEqual([1, 2]);
    expect(warn).toHaveBeenCalledTimes(1);

    // 4) Desmontaje: cerrar() + removeChannel. `unsubscribe()` pone `leaving` ANTES de mirar
    //    `_canPush()`, así que dispara su 'ok' al momento: el CLOSED llega SÍNCRONO dentro de
    //    removeChannel y el canal sale de la lista sin esperar al servidor.
    const estadosAntes = estados.length;
    v.cerrar();
    const salida = cliente.removeChannel(canal);
    expect(estados.slice(estadosAntes)).toEqual(["CLOSED"]); // síncrono
    expect(cliente.getChannels()).not.toContain(canal); // fuera ya, sin ack
    expect(ws2.ultimo("phx_leave", topic)).toBeTruthy(); // el leave sí se manda
    expect(warn).toHaveBeenCalledTimes(1); // cerrar() antes: el CLOSED propio no avisa
    // Reutilizar el nombre justo después da un canal NUEVO (no el que se cierra).
    const otraVez = cliente.channel(nombre);
    expect(otraVez).not.toBe(canal);
    await salida;
    warn.mockRestore();
    cliente.disconnect();
  });
});
