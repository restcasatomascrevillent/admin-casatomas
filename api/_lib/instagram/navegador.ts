/**
 * Arranque de Chromium para renderizar piezas de Instagram.
 *
 *  - En Vercel (Linux, Amazon Linux 2023): playwright-core + @sparticuz/chromium.
 *    El binario va comprimido en node_modules/@sparticuz/chromium/bin (vercel.json
 *    → functions → includeFiles) y se descomprime en /tmp la primera vez de cada
 *    instancia (~1-2 s). Las versiones van emparejadas: playwright-core 1.63 usa
 *    Chromium 153 y @sparticuz/chromium 153.0.0 trae Chromium 153.
 *  - Fuera de Vercel (Windows/macOS, o Linux sin VERCEL): el Chromium que instala
 *    Playwright (`npx playwright install chromium`), para probar en local.
 *    INSTAGRAM_CHROMIUM_PATH permite apuntar a otro ejecutable.
 *
 * Un navegador por petición (se cierra al acabar): las piezas se generan de
 * una en una y con `--single-process` (obligatorio en Lambda) reutilizar el
 * navegador entre invocaciones es frágil.
 */
import type { Browser } from "playwright-core";

export type Lanzador = () => Promise<Browser>;

/** ¿Hay que usar el Chromium de @sparticuz (entorno serverless de Linux)? */
export function usarChromiumServerless(env: Record<string, string | undefined> = process.env, plataforma: string = process.platform): boolean {
  if (plataforma !== "linux") return false;
  if (env.INSTAGRAM_CHROMIUM_PATH) return false;
  return Boolean(env.VERCEL || env.AWS_EXECUTION_ENV || env.AWS_LAMBDA_FUNCTION_NAME || env.INSTAGRAM_CHROMIUM_SERVERLESS === "1");
}

export async function lanzarNavegador(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  if (usarChromiumServerless()) {
    // @sparticuz/chromium decide AL CARGARSE si descomprime las bibliotecas de
    // Amazon Linux 2023 (libnss3…) mirando AWS_EXECUTION_ENV / AWS_LAMBDA_JS_RUNTIME.
    // En Vercel puede no venir ninguna de las dos: se fija antes del import.
    if (process.env.VERCEL && !process.env.AWS_LAMBDA_JS_RUNTIME && !/\d+\.x/.test(process.env.AWS_EXECUTION_ENV ?? "")) {
      process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
    }
    const Chromium = (await import("@sparticuz/chromium")).default;
    // Sin WebGL: no se usa y así no se descomprime swiftshader en /tmp.
    Chromium.setGraphicsMode = false;
    return chromium.launch({ args: Chromium.args, executablePath: await Chromium.executablePath(), headless: true });
  }
  return chromium.launch({ headless: true, executablePath: process.env.INSTAGRAM_CHROMIUM_PATH || undefined });
}
