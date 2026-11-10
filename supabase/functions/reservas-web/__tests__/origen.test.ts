/**
 * «Cómo se hizo la reserva»: validación de `origen` en reservas-web/crear.
 */
import { describe, it, expect } from "vitest";
import { construirOrigenReserva, normalizarOrigenCliente, ORIGEN_MAX_BYTES } from "../origen";

const AHORA = new Date("2026-11-10T18:00:00.000Z");
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const valido = {
  formulario_abierto_at: "2026-11-10T17:55:00.000Z",
  primer_contacto_at: "2026-11-10T17:56:00.000Z",
  enviado_at: "2026-11-10T17:58:35.000Z",
  duracion_segundos: 155,
  campos_cambiados: ["fecha", "numero_comensales", "hora", "nombre", "inventado"],
  consultas_disponibilidad: 2,
  consultas_sin_hueco: 1,
  intentos_fallidos: 1,
  idioma: "es",
  idioma_navegador: "es-ES",
  pagina_entrada: "/carta?utm_source=ig&email=x@y.z",
  pagina_formulario: "/reservas",
  referente: "https://www.instagram.com/p/abc?u=1",
  utm_source: "instagram",
  utm_medium: "social",
  utm_campaign: "navidad",
  pantalla: { ancho: 390, alto: 844 },
  tactil: true,
  nombre: "No debería guardarse",
};

describe("normalizarOrigenCliente", () => {
  it("acepta un origen normal y tira lo que no está en la lista blanca", () => {
    const o = normalizarOrigenCliente(valido, AHORA)!;
    expect(o.duracion_segundos).toBe(155);
    expect(o.campos_cambiados).toEqual(["fecha", "numero_comensales", "hora", "nombre"]);
    expect(o.pagina_entrada).toBe("/carta"); // sin query
    expect(o.referente).toBe("instagram.com"); // solo host
    expect(o.pantalla_ancho).toBe(390);
    expect(o).not.toHaveProperty("nombre");
  });

  it("devuelve null si no viene, no es objeto o es demasiado grande", () => {
    expect(normalizarOrigenCliente(undefined, AHORA)).toBeNull();
    expect(normalizarOrigenCliente("hola", AHORA)).toBeNull();
    expect(normalizarOrigenCliente([1, 2], AHORA)).toBeNull();
    expect(normalizarOrigenCliente({ relleno: "x".repeat(ORIGEN_MAX_BYTES) }, AHORA)).toBeNull();
  });

  it("anula tipos y valores fuera de rango sin fallar", () => {
    const o = normalizarOrigenCliente(
      {
        duracion_segundos: -5,
        enviado_at: "ayer",
        formulario_abierto_at: "2031-01-01T00:00:00Z",
        idioma: "de",
        intentos_fallidos: "3",
        utm_source: "<script>",
        pantalla: { ancho: 1e9 },
        tactil: "si",
      },
      AHORA,
    )!;
    expect(o.duracion_segundos).toBeNull();
    expect(o.enviado_at).toBeNull();
    expect(o.formulario_abierto_at).toBeNull();
    expect(o.idioma).toBeNull();
    expect(o.intentos_fallidos).toBeNull();
    expect(o.utm_source).toBeNull();
    expect(o.pantalla_ancho).toBeNull();
    expect(o.tactil).toBeNull();
  });

  it("calcula la duración con las horas del navegador si no la manda", () => {
    const o = normalizarOrigenCliente(
      { primer_contacto_at: "2026-11-10T17:56:00Z", enviado_at: "2026-11-10T17:58:35Z" },
      AHORA,
    )!;
    expect(o.duracion_segundos).toBe(155);
  });
});

describe("construirOrigenReserva", () => {
  it("añade lo del servidor: UA, dispositivo, navegador, procedencia y hash corto", () => {
    const o = construirOrigenReserva(valido, { recibidoAt: AHORA, userAgent: UA_IPHONE, ipHash: "a".repeat(64) });
    expect(o.v).toBe(1);
    expect(o.servidor.recibido_at).toBe(AHORA.toISOString());
    expect(o.servidor.dispositivo).toBe("movil");
    expect(o.servidor.navegador).toBe("Safari");
    expect(o.servidor.sistema).toBe("iOS");
    expect(o.servidor.ip_hash).toHaveLength(16);
    expect(o.servidor.procedencia?.origen_tipo).toBe("campana");
    expect(JSON.stringify(o)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("sin `origen` (web antigua) guarda igualmente la parte del servidor", () => {
    const o = construirOrigenReserva(undefined, { recibidoAt: AHORA, userAgent: null, ipHash: null });
    expect(o.cliente).toBeNull();
    expect(o.servidor).toMatchObject({ dispositivo: "desconocido", navegador: null, ip_hash: null, procedencia: null });
  });
});
