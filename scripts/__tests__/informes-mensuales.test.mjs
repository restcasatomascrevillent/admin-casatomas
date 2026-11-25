// Informes mensuales: cuándo toca (último jueves a las 08:xx de Madrid) y nombres de fichero para Drive.
import { describe, expect, it } from "vitest";
import { decidir, enMadrid, esUltimoJueves, horaDelCron } from "../informes-mensuales/calendario.mjs";
import { leerSesion, nombrePdfSeguro, textoResumen } from "../informes-mensuales/utiles.mjs";

const VERANO = "7 6 * * 4";
const INVIERNO = "7 7 * * 4";

describe("informes mensuales · calendario", () => {
  it("último jueves de cada mes", () => {
    const jueves = (fecha) => enMadrid(new Date(`${fecha}T10:00:00Z`));
    expect(esUltimoJueves(jueves("2026-11-26"))).toBe(true);
    expect(esUltimoJueves(jueves("2026-11-19"))).toBe(false);
    expect(esUltimoJueves(jueves("2026-12-31"))).toBe(true);
    expect(esUltimoJueves(jueves("2026-12-24"))).toBe(false);
    expect(esUltimoJueves(jueves("2027-02-25"))).toBe(true); // febrero de 28 días
    expect(esUltimoJueves(jueves("2026-11-27"))).toBe(false); // viernes
  });

  it("hora del cron", () => {
    expect(horaDelCron(VERANO)).toBe(6);
    expect(horaDelCron("*/5 * * * *")).toBeNull();
    expect(horaDelCron("")).toBeNull();
  });

  it("en invierno (UTC+1) sigue solo el disparo de las 07:07 UTC = 08:07 en Madrid", () => {
    const ahora = new Date("2026-11-26T07:07:00Z");
    expect(decidir({ ahora, cron: INVIERNO })).toMatchObject({ ejecutar: true, mes: "2026-11" });
    expect(decidir({ ahora: new Date("2026-11-26T06:07:00Z"), cron: VERANO }).ejecutar).toBe(false);
  });

  it("en verano (UTC+2) sigue solo el de las 06:07 UTC, aunque GitHub lo retrase", () => {
    expect(decidir({ ahora: new Date("2026-07-30T06:07:00Z"), cron: VERANO }).ejecutar).toBe(true);
    expect(decidir({ ahora: new Date("2026-07-30T07:50:00Z"), cron: VERANO }).ejecutar).toBe(true); // retrasado
    expect(decidir({ ahora: new Date("2026-07-30T07:07:00Z"), cron: INVIERNO }).ejecutar).toBe(false);
  });

  it("un jueves que no es el último no hace nada; a mano siempre, con el mes en curso de Madrid", () => {
    expect(decidir({ ahora: new Date("2026-11-19T07:07:00Z"), cron: INVIERNO })).toMatchObject({ ejecutar: false });
    // 31/12 a las 23:30 UTC ya es 1 de enero en Madrid.
    expect(decidir({ ahora: new Date("2026-12-31T23:30:00Z") })).toMatchObject({ ejecutar: true, mes: "2027-01" });
  });
});

describe("informes mensuales · utilidades", () => {
  it("nombres de PDF válidos para Drive y sin repetir", () => {
    const usados = new Set();
    expect(nombrePdfSeguro("Tráfico de Casa Tomás · noviembre 2026.pdf", usados)).toBe("Tráfico de Casa Tomás - noviembre 2026.pdf");
    expect(nombrePdfSeguro("informe/../raro?.pdf", usados)).toBe("informe-..-raro.pdf");
    expect(nombrePdfSeguro("Tráfico de Casa Tomás · noviembre 2026.pdf", usados)).toBe("Tráfico de Casa Tomás - noviembre 2026 (2).pdf");
    expect(nombrePdfSeguro("", usados)).toBe("informe.pdf");
    for (const n of usados) expect(n).toMatch(/^[\p{L}\p{N} ._()-]+\.pdf$/u);
  });

  it("lee el token y la URL de Supabase de la sesión guardada", () => {
    expect(leerSesion([["otra", "x"], ["sb-abc123-auth-token", JSON.stringify({ access_token: "tk" })]])).toEqual({ token: "tk", supabaseUrl: "https://abc123.supabase.co" });
    expect(leerSesion([["sb-abc-auth-token", "no es json"]])).toBeNull();
  });

  it("resumen sin enlaces", () => {
    expect(textoResumen({ mes: "2026-11", generados: 3, subidos: 2, sinDatos: ["A"], fallidos: ["B (Drive)"] })).toBe(
      "Informes de 2026-11: 3 PDF generados, 2 subidos a Drive.\nSin datos: A.\nFallidos: B (Drive).",
    );
  });
});
