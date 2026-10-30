// CT-REM-FN-03 · IP del cliente = cf-connecting-ip o ÚLTIMO salto de X-Forwarded-For.
import { describe, expect, it } from "vitest";
import { ipCliente } from "../ip-cliente";

const req = (h: Record<string, string>) => new Request("https://e.test/", { headers: h });

describe("ipCliente", () => {
  it("prefiere cf-connecting-ip (lo pone la plataforma)", () => {
    expect(ipCliente(req({ "cf-connecting-ip": " 203.0.113.7 ", "x-forwarded-for": "9.9.9.9" }))).toBe("203.0.113.7");
  });
  it("sin cf-connecting-ip, el ÚLTIMO salto de XFF; el primero lo controla el cliente", () => {
    expect(ipCliente(req({ "x-forwarded-for": "6.6.6.6, 10.0.0.1 , 198.51.100.2" }))).toBe("198.51.100.2");
  });
  it("rotar el primer salto de XFF no cambia la IP resultante", () => {
    const ips = new Set(Array.from({ length: 31 }, (_, i) => ipCliente(req({ "x-forwarded-for": `10.0.0.${i}, 198.51.100.2` }))));
    expect([...ips]).toEqual(["198.51.100.2"]);
  });
  it("sin cabeceras → cadena vacía; saltos vacíos se ignoran; se recorta a 128", () => {
    expect(ipCliente(req({}))).toBe("");
    expect(ipCliente(req({ "x-forwarded-for": " , ," }))).toBe("");
    expect(ipCliente(req({ "x-forwarded-for": "1.1.1.1, " }))).toBe("1.1.1.1");
    expect(ipCliente(req({ "cf-connecting-ip": "a".repeat(300) })).length).toBe(128);
  });
  it("acepta Headers directamente", () => {
    expect(ipCliente(new Headers({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });
});
