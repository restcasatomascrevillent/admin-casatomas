// avisos-telegram · acción «informes» (25/11/2026): el mensaje de la tarea programada del último jueves.
import { describe, expect, it } from "vitest";
import { aTextoPlano, esAccion, esUrlDrive, leerDatosInformes, mensajeInformes, tipoRegistro } from "../logica";

const URL1 = "https://drive.google.com/file/d/abc123_DEF-456/view";
const CARPETA = "https://drive.google.com/drive/folders/carpeta_789";

describe("avisos-telegram · informes mensuales", () => {
  it("es una acción y se apunta como 'resumen' (el CHECK de avisos_telegram_envios no tiene otro tipo)", () => {
    expect(esAccion("informes")).toBe(true);
    expect(tipoRegistro("informes")).toBe("resumen");
  });

  it("solo acepta enlaces de Google Drive", () => {
    expect(esUrlDrive(URL1)).toBe(true);
    expect(esUrlDrive(CARPETA)).toBe(true);
    expect(esUrlDrive("https://drive.google.com.malo.com/x")).toBe(false);
    expect(esUrlDrive("https://ejemplo.com/file/d/x")).toBe(false);
    expect(esUrlDrive('https://drive.google.com/x"><b>')).toBe(false);
  });

  it("valida el cuerpo: mes AAAA-MM e informes con título y enlace de Drive (los demás se descartan)", () => {
    expect(leerDatosInformes({ mes: "noviembre", informes: [] })).toBeNull();
    expect(leerDatosInformes({ mes: "2026-11" })).toBeNull();
    const d = leerDatosInformes({
      mes: "2026-11",
      carpeta_url: "https://otro.com/x",
      informes: [{ titulo: "Tráfico web", url: URL1 }, { titulo: "Malo", url: "https://otro.com" }, { titulo: "", url: URL1 }],
      sin_datos: ["Votación del vino favorito"],
      fallidos: "no es lista",
    });
    expect(d).toEqual({ mes: "2026-11", carpetaUrl: null, informes: [{ titulo: "Tráfico web", url: URL1 }], sinDatos: ["Votación del vino favorito"], fallidos: [] });
  });

  it("mensaje breve: título del mes, carpeta y un enlace por PDF; sin datos y fallos al final, escapados", () => {
    const texto = mensajeInformes({
      mes: "2026-11",
      carpetaUrl: CARPETA,
      informes: [{ titulo: "Informe <mensual> de tráfico web", url: URL1 }],
      sinDatos: ["Votación & vino"],
      fallidos: ["Recibo mensual (Gestor Gasto)"],
    });
    expect(texto.split("\n")).toEqual([
      `📊 <b>Informes de noviembre de 2026</b> · <a href="${CARPETA}">Carpeta en Drive</a>`,
      `• <a href="${URL1}">Informe &lt;mensual&gt; de tráfico web</a>`,
      "⚪ Sin datos este mes: Votación &amp; vino",
      "⚠️ No se han podido sacar: Recibo mensual (Gestor Gasto)",
    ]);
    expect(aTextoPlano(texto)).toContain(`Informe <mensual> de tráfico web: ${URL1}`);
  });

  it("sin ningún PDF lo dice", () => {
    expect(mensajeInformes({ mes: "2026-01", carpetaUrl: null, informes: [], sinDatos: [], fallidos: ["Todo"] })).toContain("No se ha podido subir ningún PDF.");
  });
});
