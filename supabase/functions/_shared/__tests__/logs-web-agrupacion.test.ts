/**
 * Super Admin › Logs: agrupación de errores repetidos y causas conocidas.
 * Casos sacados de los logs reales de producción y demo (informe del 10/11/2026).
 */
import { describe, expect, it } from "vitest";
import { calcularHuella, marcoPrincipal, normalizarMensaje, quitarHashVite, textoHuella } from "../logs-web/huella";
import { causaConocida, IDS_CAUSAS } from "../logs-web/causas";

describe("hash de Vite: el mismo fichero en dos despliegues es el mismo fichero", () => {
  it("quita hashes con guion y guion bajo (base64url de 8)", () => {
    expect(quitarHashVite("app-C0ct-iG8.js")).toBe("app.js");
    expect(quitarHashVite("/assets/NovedadesSection-D-0lW2q6.js")).toBe("/assets/NovedadesSection.js");
    expect(quitarHashVite("client-CHi__bHm.js")).toBe("client.js");
    expect(quitarHashVite("EspaciosGallery-CmTTVDlw.css")).toBe("EspaciosGallery.css");
    expect(quitarHashVite("salon-2-840w-E35b0I3N.avif")).toBe("salon-2-840w.avif");
  });
  it("no toca nombres sin hash", () => {
    expect(quitarHashVite("salon-2-840w.avif")).toBe("salon-2-840w.avif");
    expect(quitarHashVite("reservas-web/disponibilidad")).toBe("reservas-web/disponibilidad");
  });
  it("el marco principal ya no depende del hash (antes: una incidencia por despliegue)", () => {
    expect(marcoPrincipal("Error: x\nat Yg (http://127.0.0.1:4173/assets/app-C0ct-iG8.js:41:45194)")).toBe("Yg@/assets/app.js");
    expect(marcoPrincipal("Error: x\nat Yg (https://web.es/assets/app-Ab_c-123.js:41:1)")).toBe("Yg@/assets/app.js");
  });
  it("React #423 de dos despliegues distintos: misma huella (en la demo eran #1 y #9)", async () => {
    const msg = "Uncaught Error: Minified React error #423; visit https://reactjs.org/docs/error-decoder.html for the full message";
    const a = await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: msg, pila: "Error\nat Yg (https://w.es/assets/app-C0ct-iG8.js:41:45194)" });
    const b = await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: msg, pila: "Error\nat Yg (https://w.es/assets/app-Zz9_x-1Q.js:40:100)" });
    expect(a).toBe(b);
  });
  it("recursos: misma imagen o script en dos despliegues → misma huella", async () => {
    const r = (u: string) => calcularHuella({ tipo: "error_recurso", fuente: "navegador", objetivo: u });
    expect(await r("https://w.es/assets/clock-8WO4Qfr6.js")).toBe(await r("https://w.es/assets/clock-Ab-cd_12.js"));
    expect(await r("https://w.es/assets/salon-1-840w-B7ABlOd7.avif")).not.toBe(await r("https://w.es/assets/salon-2-840w-E35b0I3N.avif"));
  });
  it("normalizarMensaje también quita el hash dentro de las URLs", () => {
    expect(normalizarMensaje("Failed for https://w.es/assets/a-C0ct-iG8.js")).toBe(normalizarMensaje("Failed for https://w.es/assets/a-XXXXXXXX.js"));
  });
});

describe("fichero caducado tras publicar: una sola incidencia", () => {
  it("import dinámico, CSS y tipos distintos van juntos", async () => {
    const h = (tipo: string, mensaje: string) => calcularHuella({ tipo, fuente: "navegador", mensaje, pila: `${mensaje}\nat Lazy` });
    const a = await h("error_react", "TypeError: Failed to fetch dynamically imported module: https://w.es/assets/NovedadesSection-D-0lW2q6.js");
    const b = await h("error_react", "Error: Unable to preload CSS for /assets/EspaciosGallery-CmTTVDlw.css");
    const c = await h("error_promesa", "TypeError: Importing a module script failed.");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(textoHuella({ tipo: "error_js", fuente: "navegador", mensaje: "ChunkLoadError: Loading chunk 12 failed" })).toBe("navegador|chunk_caducado");
  });
  it("otros errores siguen separados", async () => {
    expect(await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: "TypeError: x is null" }))
      .not.toBe(await calcularHuella({ tipo: "error_js", fuente: "navegador", mensaje: "Error: Unable to preload CSS for /a.css" }));
  });
});

describe("pg_cron sin poder arrancar: una incidencia para todas las tareas", () => {
  it("«job startup timeout» de tareas distintas comparte huella (el 08/11 fueron 6 tickets)", async () => {
    const h = (tarea: string, mensaje = "job startup timeout") =>
      calcularHuella({ tipo: "error_integracion", fuente: "integracion", objetivo: `cron:${tarea}`, mensaje });
    expect(await h("reanudar-trabajos-ocr")).toBe(await h("instagram-programador"));
    expect(await h("clasificar-productos")).toBe(await h("emails-reserva-reintentar-fallidos"));
  });
  it("un fallo propio de una tarea sigue siendo de esa tarea", async () => {
    const h = (tarea: string) => calcularHuella({ tipo: "error_integracion", fuente: "integracion", objetivo: `cron:${tarea}`, mensaje: "ERROR: relation \"x\" does not exist" });
    expect(await h("a")).not.toBe(await h("b"));
  });
});

describe("causas conocidas", () => {
  it("reconoce los fallos vistos en producción y demo", () => {
    expect(causaConocida({ tipo: "error_react", mensaje: "TypeError: Failed to fetch dynamically imported module: https://w/assets/N-D-0lW2q6.js" })?.id).toBe("chunk_caducado");
    expect(causaConocida({ tipo: "error_recurso", objetivo: "https://w.es/assets/client-CHi__bHm.js" })?.id).toBe("chunk_caducado");
    expect(causaConocida({ tipo: "error_integracion", mensaje: "job startup timeout", objetivo: "cron:x" })?.id).toBe("cron_plataforma");
    expect(causaConocida({ tipo: "error_js", mensaje: "Uncaught Error: Minified React error #418; visit https://reactjs.org" })?.id).toBe("react_hidratacion");
    expect(causaConocida({ tipo: "error_peticion", mensaje: "Sin respuesta de rest:menus_diarios", propiedades: { status: 0 } })?.id).toBe("peticion_sin_respuesta");
    expect(causaConocida({ tipo: "error_servidor", mensaje: "error sending request: dns error: failed to lookup address information" })?.id).toBe("dns_host_inexistente");
    expect(causaConocida({ tipo: "error_servidor", mensaje: "procesar-logs-web: falta_secreto" })?.id).toBe("falta_secreto");
  });
  it("no inventa: un error cualquiera no tiene causa conocida", () => {
    expect(causaConocida({ tipo: "error_js", mensaje: "TypeError: Cannot read properties of null (reading 'precio')" })).toBeNull();
    expect(causaConocida({ tipo: "error_peticion", mensaje: "HTTP 500 en reservas-web/disponibilidad", propiedades: { status: 500 } })).toBeNull();
    expect(causaConocida({ tipo: "error_recurso", objetivo: "https://w.es/foto-sin-hash.jpg" })).toBeNull();
  });
  it("cada causa tiene explicación y acciones", () => {
    expect(IDS_CAUSAS.length).toBeGreaterThanOrEqual(6);
    const c = causaConocida({ tipo: "error_integracion", mensaje: "job startup timeout" })!;
    expect(c.explicacion.length).toBeGreaterThan(40);
    expect(c.acciones.length).toBeGreaterThan(0);
  });
});
