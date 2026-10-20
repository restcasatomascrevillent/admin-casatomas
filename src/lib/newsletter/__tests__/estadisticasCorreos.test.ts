import { describe, it, expect } from "vitest";
import { resumirEventosCorreo, porcentaje, type EventoCorreo } from "../estadisticasCorreos";

const AHORA = Date.parse("2026-10-05T10:00:00Z");

function ev(email_id: string, tipo_evento: string, timestamp_evento = "2026-10-05T08:00:00Z"): EventoCorreo {
  return { email_id, tipo_evento, timestamp_evento };
}

/**
 * El caso que vio el dueño: 30 correos enviados y entregados, 5 abiertos y 4 con clic (los 4 también
 * abiertos). Con la cuenta antigua salían «39 entregados» (30+5+4) y «9 abiertos» (5+4) en las
 * tarjetas, frente a 30 y 5 en el desglose.
 */
function casoDelDueno(): EventoCorreo[] {
  const eventos: EventoCorreo[] = [];
  for (let i = 0; i < 30; i++) {
    eventos.push(ev(`m${i}`, "sent"), ev(`m${i}`, "delivered"));
    if (i < 5) eventos.push(ev(`m${i}`, "opened"));
    if (i < 4) eventos.push(ev(`m${i}`, "clicked"));
  }
  return eventos;
}

describe("resumirEventosCorreo", () => {
  it("el caso del dueño: cada correo cuenta una vez y las tasas son sobre los enviados", () => {
    const { cifras, tasas } = resumirEventosCorreo(casoDelDueno(), { ahora: AHORA });
    expect(cifras).toEqual({ enviados: 30, entregados: 30, abiertos: 5, clics: 4, noEntregados: 0, spam: 0 });
    expect(tasas).toEqual({ entrega: 100, apertura: 17, clics: 13 });
  });

  it("reproduce la cuenta antigua (sumar conjuntos que se solapan) para dejar claro lo que fallaba", () => {
    const eventos = casoDelDueno();
    const unicos = (tipo: string) => new Set(eventos.filter((e) => e.tipo_evento === tipo).map((e) => e.email_id)).size;
    const entregadosAntiguos = unicos("delivered") + unicos("opened") + unicos("clicked");
    const abiertosAntiguos = unicos("opened") + unicos("clicked");
    expect(entregadosAntiguos).toBe(39); // más entregados que enviados: imposible
    expect(abiertosAntiguos).toBe(9); // y el desglose decía 5
    const { cifras } = resumirEventosCorreo(eventos, { ahora: AHORA });
    expect(cifras.entregados).toBeLessThanOrEqual(cifras.enviados);
    expect(cifras.abiertos).toBe(5);
  });

  it("eventos repetidos (reintentos del webhook, varias aperturas) no inflan nada", () => {
    const eventos = [
      ev("a", "sent"),
      ev("a", "delivered"),
      ev("a", "delivered"),
      ev("a", "opened"),
      ev("a", "opened"),
      ev("a", "opened"),
      ev("a", "clicked"),
      ev("a", "clicked"),
    ];
    const { cifras, tasas, porDia } = resumirEventosCorreo(eventos, { ahora: AHORA });
    expect(cifras).toMatchObject({ enviados: 1, entregados: 1, abiertos: 1, clics: 1 });
    expect(tasas).toEqual({ entrega: 100, apertura: 100, clics: 100 });
    expect(porDia.at(-1)).toMatchObject({ fecha: "2026-10-05", enviados: 1, entregados: 1, abiertos: 1, clics: 1 });
  });

  it("un clic prueba la apertura y la entrega aunque falten esos eventos", () => {
    const { cifras } = resumirEventosCorreo([ev("a", "sent"), ev("a", "clicked")], { ahora: AHORA });
    expect(cifras).toMatchObject({ enviados: 1, entregados: 1, abiertos: 1, clics: 1 });
  });

  it("un correo sin evento sent también cuenta como enviado (nunca más del 100 %)", () => {
    const { cifras, tasas } = resumirEventosCorreo([ev("a", "delivered"), ev("b", "sent")], { ahora: AHORA });
    expect(cifras.enviados).toBe(2);
    expect(tasas.entrega).toBe(50);
  });

  it("rebotes, supresiones y fallos son no entregados; la queja de spam cuenta como entregado", () => {
    const { cifras } = resumirEventosCorreo(
      [
        ev("r", "sent"),
        ev("r", "bounced"),
        ev("s", "suppressed"),
        ev("f", "failed"),
        ev("q", "sent"),
        ev("q", "delivered"),
        ev("q", "complained"),
      ],
      { ahora: AHORA },
    );
    expect(cifras).toEqual({ enviados: 4, entregados: 1, abiertos: 0, clics: 0, noEntregados: 3, spam: 1 });
  });

  it("un correo entregado no cuenta además como no entregado", () => {
    const { cifras } = resumirEventosCorreo([ev("a", "delivered"), ev("a", "bounced")], { ahora: AHORA });
    expect(cifras.entregados + cifras.noEntregados).toBeLessThanOrEqual(cifras.enviados);
  });

  it("ignora los eventos de contacto y los tipos que no son de un correo enviado", () => {
    const { cifras } = resumirEventosCorreo(
      [ev("contact.updated:c1", "contact.updated"), ev("x", "received"), ev("y", "scheduled"), ev("a", "sent")],
      { ahora: AHORA },
    );
    expect(cifras.enviados).toBe(1);
  });

  it("tendencia: 7 días de Madrid con ceros, cada correo el día en que alcanzó cada estado", () => {
    const eventos = [
      // Enviado el 4 a las 00:30 de Madrid (aún día 3 en UTC): cuenta el día de Madrid, no el de UTC.
      ev("a", "sent", "2026-10-03T22:30:00Z"),
      ev("a", "delivered", "2026-10-03T22:30:05Z"),
      ev("a", "opened", "2026-10-04T09:00:00Z"),
      ev("a", "opened", "2026-10-05T09:00:00Z"), // segunda apertura: no vuelve a contar
      ev("viejo", "sent", "2026-09-01T10:00:00Z"), // fuera de la ventana
    ];
    const { porDia, cifras } = resumirEventosCorreo(eventos, { ahora: AHORA, dias: 7 });
    expect(porDia.map((d) => d.fecha)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(porDia.find((d) => d.fecha === "2026-10-03")).toMatchObject({ enviados: 0, entregados: 0 });
    expect(porDia.find((d) => d.fecha === "2026-10-04")).toMatchObject({ enviados: 1, entregados: 1, abiertos: 1 });
    expect(porDia.find((d) => d.fecha === "2026-10-05")).toMatchObject({ enviados: 0, abiertos: 0 });
    expect(cifras.enviados).toBe(2);
  });

  it("sin datos: todo a cero, sin dividir entre cero", () => {
    const { cifras, tasas, porDia } = resumirEventosCorreo([], { ahora: AHORA });
    expect(cifras.enviados).toBe(0);
    expect(tasas).toEqual({ entrega: 0, apertura: 0, clics: 0 });
    expect(porDia).toHaveLength(7);
    expect(porcentaje(3, 0)).toBe(0);
  });
});
