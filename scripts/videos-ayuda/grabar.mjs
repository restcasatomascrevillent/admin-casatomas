// ---------------------------------------------------------------------------
// Graba los vídeos del Centro de Ayuda, en 1280x800, en dos partes:
//   1) el tour guiado de la sección, avanzado paso a paso (~4 s por paso);
//   2) una DEMO «verlo funcionando»: acciones reales de SOLO LECTURA con un
//      rótulo en pantalla que dice qué pasa («Zoom sobre el original»…) y un
//      puntero visible.
// Nunca sube documentos, guarda, marca como verificado, borra, toca
// interruptores (publican en la web), pulsa «Redactar con IA» ni envía
// preguntas al chatbot (cuestan dinero). Los botones «Al instante» sí se
// pulsan: son consultas SQL (RPC STABLE), no llaman a la IA.
// Salida: public/ayuda/videos/<seccion>.webm y .mp4 (H.264, para iPhone y
// WhatsApp; los usa centroAyuda.ts → videoUrl).
//
// Uso (con el panel en marcha: `npm run dev`, puerto 8080):
//   1) Una vez:   npx playwright install chromium
//   2) Sesión:    node scripts/videos-ayuda/grabar.mjs --login
//                 (se abre un navegador: inicia sesión a mano y se guarda
//                  scripts/videos-ayuda/.sesion.json; NO se sube a git)
//   3) Grabar:    npm run videos:ayuda   (o node scripts/videos-ayuda/grabar.mjs)
//
// Variables opcionales: PANEL_URL (por defecto http://localhost:8080),
// SEGUNDOS_PASO (por defecto 4), SOLO=facturas|gestor-web, DOC_FACTURAS (id
// del documento que se enseña; por defecto, uno con avisos y foto).
// Tras cada grabación se vuelve a guardar la sesión (Supabase renueva el token).
// ---------------------------------------------------------------------------
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SESION = join(AQUI, ".sesion.json");
const SALIDA = join(RAIZ, "public", "ayuda", "videos");
const BASE = process.env.PANEL_URL ?? "http://localhost:8080";
const MS_PASO = Number(process.env.SEGUNDOS_PASO ?? 4) * 1000;
const TAMANO = { width: 1280, height: 800 };
const FFMPEG = createRequire(import.meta.url)("ffmpeg-static");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Rótulo y puntero visibles en el vídeo ────────────────────────────────────
// El puntero del sistema no sale en la grabación: se pinta un círculo que sigue
// al ratón (y se encoge al pulsar). Se inyecta en cada carga de página.
const PUNTERO = () => {
  const poner = () => {
    if (document.getElementById("video-puntero")) return;
    const p = document.createElement("div");
    p.id = "video-puntero";
    Object.assign(p.style, {
      position: "fixed", left: "-50px", top: "-50px", width: "22px", height: "22px", marginLeft: "-11px", marginTop: "-11px",
      borderRadius: "50%", background: "rgba(234,88,12,.35)", border: "2px solid rgba(234,88,12,.9)",
      zIndex: "2147483647", pointerEvents: "none", transition: "transform .12s",
    });
    document.body.appendChild(p);
    addEventListener("mousemove", (e) => { p.style.left = `${e.clientX}px`; p.style.top = `${e.clientY}px`; }, true);
    addEventListener("mousedown", () => { p.style.transform = "scale(.65)"; }, true);
    addEventListener("mouseup", () => { p.style.transform = "scale(1)"; }, true);
  };
  if (document.body) poner();
  else addEventListener("DOMContentLoaded", poner);
};

async function rotulo(pagina, texto) {
  await pagina.evaluate((t) => {
    let r = document.getElementById("video-rotulo");
    if (!r) {
      r = document.createElement("div");
      r.id = "video-rotulo";
      Object.assign(r.style, {
        position: "fixed", left: "50%", bottom: "22px", transform: "translateX(-50%)", maxWidth: "88vw",
        padding: "12px 24px", borderRadius: "14px", background: "rgba(17,24,39,.88)", color: "#fff",
        font: "600 22px/1.3 system-ui, sans-serif", textAlign: "center", boxShadow: "0 8px 24px rgba(0,0,0,.3)",
        zIndex: "2147483646", pointerEvents: "none", transition: "opacity .25s",
      });
      document.body.appendChild(r);
    }
    r.textContent = t;
    r.style.opacity = t ? "1" : "0";
  }, texto);
}

/** Lleva el puntero al centro del elemento, despacio, y lo pulsa (o solo se posa). */
async function apuntar(pagina, locator, { pulsar = true, pasos = 18 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const caja = await locator.boundingBox();
  if (!caja) throw new Error(`No se ve el elemento: ${locator}`);
  await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: pasos });
  await esperar(250);
  if (pulsar) await pagina.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
}

/** Ejecuta un paso de la demo; si falla (no hay datos, otra pantalla), lo apunta y sigue. */
async function intentar(nombre, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`  · demo «${nombre}» omitida: ${e.message.split("\n")[0]}`);
  }
}

/** Desplaza con la rueda sobre un elemento, en varios golpes suaves. */
async function rueda(pagina, locator, dy, golpes = 6) {
  const caja = await locator.boundingBox();
  if (!caja) return;
  await pagina.mouse.move(caja.x + caja.width / 2, caja.y + Math.min(caja.height / 2, 300), { steps: 10 });
  for (let i = 0; i < golpes; i++) {
    await pagina.mouse.wheel(0, dy / golpes);
    await esperar(160);
  }
}

// ── Tour ─────────────────────────────────────────────────────────────────────
async function recorrerTour(pagina, id) {
  await esperar(1500);
  if (!(await pagina.locator(".driver-popover").isVisible())) {
    await pagina.locator('[data-tour="boton-ayuda"]:visible').first().click();
  }
  await pagina.locator(".driver-popover").waitFor({ state: "visible", timeout: 10_000 });
  let pasos = 0;
  for (;;) {
    await esperar(MS_PASO);
    pasos += 1;
    const popover = pagina.locator(".driver-popover");
    if (!(await popover.isVisible())) break;
    const siguiente = popover.locator(".driver-popover-next-btn");
    const texto = (await siguiente.textContent())?.trim();
    await siguiente.click();
    if (texto === "Entendido") break;
    if (pasos > 50) throw new Error(`El tour de ${id} no termina`);
  }
  await esperar(1200);
  return pasos;
}

// ── Documento que se enseña en Facturas ──────────────────────────────────────
function leerEnv() {
  const env = {};
  for (const linea of readFileSync(join(RAIZ, ".env"), "utf8").split(/\r?\n/)) {
    const i = linea.indexOf("=");
    if (i > 0) env[linea.slice(0, i).trim()] = linea.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return env;
}

/** Un documento con foto (no PDF) y avisos, el más reciente; si no hay, uno con foto. Solo lectura (REST). */
async function elegirDocumento(pagina) {
  if (process.env.DOC_FACTURAS) return Number(process.env.DOC_FACTURAS);
  const env = leerEnv();
  const docs = await pagina.evaluate(
    async ({ url, clave }) => {
      const k = Object.keys(localStorage).find((x) => x.endsWith("-auth-token"));
      const token = k ? JSON.parse(localStorage.getItem(k)).access_token : null;
      const r = await fetch(
        `${url}/rest/v1/facturas?select=id,fecha,archivo_path,alertas_validacion&archivo_path=not.is.null&order=fecha.desc&limit=300`,
        { headers: { apikey: clave, Authorization: `Bearer ${token}` } },
      );
      return r.ok ? r.json() : [];
    },
    { url: env.VITE_SUPABASE_URL, clave: env.VITE_SUPABASE_PUBLISHABLE_KEY },
  );
  const conFoto = docs.filter((d) => /\.(jpe?g|png|webp)$/i.test(d.archivo_path ?? ""));
  // Mejor un aviso de precio (se entiende en el vídeo) que un «total deducido».
  const deAviso = (d, codigos) => (d.alertas_validacion ?? []).some((a) => codigos.includes(a.codigo));
  const elegido =
    conFoto.find((d) => deAviso(d, ["precio_atipico_historico", "precio_unitario_extremo", "iva_incoherente", "descuadre_cabecera"])) ??
    conFoto.find((d) => (d.alertas_validacion ?? []).length > 0) ??
    conFoto[0];
  return elegido?.id ?? null;
}

// ── Demo de Facturas (solo lectura) ──────────────────────────────────────────
async function demoFacturas(pagina) {
  const ficha = pagina.locator('[data-testid="ficha-compras"]');
  await pagina.locator('[data-tour="facturas-pestana-compras"]').click();
  await esperar(800);

  await rotulo(pagina, "Ahora, funcionando: la lista de Compras, por meses y proveedores");
  await intentar("lista", async () => {
    const lista = pagina.locator('[data-testid="lista-documentos"]');
    await rueda(pagina, lista, 900);
    await esperar(1200);
    await rueda(pagina, lista, -900);
    const mes = lista.locator("h3 button").first();
    await apuntar(pagina, mes); // pliega el mes
    await esperar(1500);
    await apuntar(pagina, mes); // y lo vuelve a desplegar
    await esperar(1500);
  });

  await rotulo(pagina, "Filtro «Con avisos»: solo lo que hay que mirar");
  await intentar("filtro con avisos", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="facturas-filtros"] button', { hasText: "Con avisos" }));
    await esperar(2500);
  });

  await rotulo(pagina, "Abrimos un documento con avisos");
  await intentar("abrir documento", async () => {
    const abierto = pagina.locator('[data-testid="lista-documentos"] button[aria-current="true"]');
    const fila = (await abierto.count()) ? abierto.first() : pagina.locator('[data-testid="lista-documentos"] li button').first();
    await apuntar(pagina, fila);
    await esperar(2500);
  });

  await rotulo(pagina, "El aviso dice qué pasa; al tocarlo, te lo explica");
  await intentar("aviso", async () => {
    const aviso = ficha.locator("header button").filter({ hasNotText: "Sin revisar" }).first();
    await apuntar(pagina, aviso);
    await esperar(3000);
    await pagina.keyboard.press("Escape");
    await esperar(600);
  });

  await rotulo(pagina, "Albarán y factura: aquí ves en qué factura está (o «Asociar a factura»)");
  await intentar("vínculo", async () => {
    await apuntar(pagina, ficha.locator('[data-tour="facturas-ficha-vinculo"]'), { pulsar: false });
    await esperar(3000);
  });

  await rotulo(pagina, "Al final de la ficha, la foto del papel original");
  await intentar("zoom en la ficha", async () => {
    const original = ficha.locator('[data-tour="facturas-original"]');
    await original.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await pagina.locator('[data-testid="zoom-lienzo"]').first().waitFor({ state: "visible", timeout: 10_000 });
    await esperar(2500);
    await rotulo(pagina, "Zoom sobre el original: botón «+»");
    const ampliar = original.getByRole("button", { name: "Ampliar", exact: true });
    await apuntar(pagina, ampliar);
    await esperar(1200);
    await apuntar(pagina, ampliar, { pasos: 4 });
    await esperar(900);
    await apuntar(pagina, ampliar, { pasos: 4 });
    await esperar(2000);
    await rotulo(pagina, "Arrastra para moverte por el papel");
    const marco = original.locator('[data-testid="zoom-marco"]');
    const c = await marco.boundingBox();
    if (c) {
      const x = c.x + c.width / 2;
      const y = c.y + c.height / 2;
      await pagina.mouse.move(x, y, { steps: 10 });
      await pagina.mouse.down();
      await pagina.mouse.move(x + 220, y + 160, { steps: 30 });
      await pagina.mouse.move(x - 180, y + 60, { steps: 30 });
      await pagina.mouse.up();
    }
    await esperar(2000);
    await rotulo(pagina, "«Girar» si la foto salió torcida, y «Ajustar» para verla entera");
    await apuntar(pagina, original.getByRole("button", { name: "Girar 90 grados" }));
    await esperar(1800);
    await apuntar(pagina, original.getByRole("button", { name: "Girar 90 grados" }), { pasos: 4 });
    await apuntar(pagina, original.getByRole("button", { name: "Girar 90 grados" }), { pasos: 2 });
    await apuntar(pagina, original.getByRole("button", { name: "Girar 90 grados" }), { pasos: 2 });
    await apuntar(pagina, original.getByRole("button", { name: "Ajustar a la vista" }));
    await esperar(1800);
  });

  await rotulo(pagina, "Pantalla completa: rueda o dos dedos para ampliar");
  await intentar("visor a pantalla completa", async () => {
    await apuntar(pagina, ficha.getByRole("button", { name: "Ver el original a pantalla completa" }));
    const visor = pagina.locator('[data-testid="visor-original"] [data-testid="zoom-marco"]');
    await visor.waitFor({ state: "visible", timeout: 8000 });
    await esperar(1800);
    const c = await visor.boundingBox();
    if (c) {
      await pagina.mouse.move(c.x + c.width * 0.45, c.y + c.height * 0.35, { steps: 15 });
      for (let i = 0; i < 8; i++) {
        await pagina.mouse.wheel(0, -100);
        await esperar(180);
      }
      await esperar(1500);
      await pagina.mouse.down();
      await pagina.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.2, { steps: 30 });
      await pagina.mouse.up();
      await esperar(1500);
      for (let i = 0; i < 8; i++) {
        await pagina.mouse.wheel(0, 100);
        await esperar(150);
      }
    }
    await esperar(1200);
    await pagina.keyboard.press("Escape");
    await esperar(800);
  });

  await rotulo(pagina, "«Original» lo abre en otra pestaña; «Editar» corrige lo mal leído");
  await intentar("editar sin guardar", async () => {
    await ficha.evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
    await esperar(1000);
    const acciones = ficha.locator('[data-tour="facturas-ficha-acciones"]');
    await apuntar(pagina, acciones.locator("a, button").first(), { pulsar: false });
    await esperar(1800);
    await apuntar(pagina, acciones.getByRole("button", { name: "Editar", exact: true }));
    const dialogo = pagina.getByRole("dialog");
    await dialogo.waitFor({ state: "visible", timeout: 5000 });
    await rotulo(pagina, "Editar: se corrige y se marca como verificada (aquí cerramos sin guardar)");
    await esperar(2500);
    await rueda(pagina, dialogo, 600);
    await esperar(2500);
    await apuntar(pagina, dialogo.getByRole("button", { name: "Cancelar" }));
    await dialogo.waitFor({ state: "hidden", timeout: 5000 });
    await esperar(800);
  });

  await rotulo(pagina, "Vista «Productos»: gasto por categoría y precios");
  await intentar("productos", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="facturas-modos"] button', { hasText: "Productos" }));
    await esperar(2500);
    const subieron = pagina.locator('[data-tour="facturas-lista"] button', { hasText: "Subieron de precio" });
    if (await subieron.count()) {
      await rotulo(pagina, "«Subieron de precio»: lo que ahora pagas más caro");
      await apuntar(pagina, subieron.first());
      await esperar(2500);
    }
    await rotulo(pagina, "Cada producto: cómo ha cambiado su precio y en qué documentos sale");
    await apuntar(pagina, pagina.locator('[data-testid="lista-productos"] button').filter({ hasText: "€" }).first());
    await esperar(4000);
    if (await subieron.count()) await apuntar(pagina, subieron.first(), { pasos: 8 });
  });

  await rotulo(pagina, "Vista «Proveedores»: cuánto le compras a cada uno y qué");
  await intentar("proveedores", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="facturas-modos"] button', { hasText: "Proveedores" }));
    await esperar(2000);
    await apuntar(pagina, pagina.locator('[data-testid="lista-proveedores-compras"] button').first());
    await esperar(3500);
    await rotulo(pagina, "Filtro «Con albaranes sin factura»: a quién reclamar facturas");
    await apuntar(pagina, pagina.locator('[data-tour="facturas-lista"] button', { hasText: "Con albaranes sin factura" }));
    await esperar(2500);
    await apuntar(pagina, pagina.locator('[data-tour="facturas-lista"] button', { hasText: "Todos" }).first(), { pasos: 8 });
  });

  await rotulo(pagina, "Un buscador para todo: el número de cada vista se actualiza");
  await intentar("buscador", async () => {
    const buscar = pagina.getByLabel("Buscar en compras");
    await apuntar(pagina, buscar);
    await pagina.keyboard.type("aceite", { delay: 140 });
    await esperar(2500);
    await apuntar(pagina, pagina.locator('[data-tour="facturas-modos"] button', { hasText: "Documentos" }));
    await esperar(2500);
    await apuntar(pagina, pagina.getByLabel("Borrar la búsqueda"));
    await esperar(800);
  });

  await rotulo(pagina, "En «IA», «Al instante»: respuestas al momento, sin gastar IA");
  await intentar("al instante", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="facturas-pestana-ia"]'));
    await esperar(1500);
    const abrir = pagina.locator('[data-tour="facturas-ia-al-instante-abrir"]');
    await apuntar(pagina, abrir);
    await esperar(1500);
    await apuntar(pagina, pagina.getByRole("button", { name: "Gasto este mes" }));
    await esperar(4500);
    await apuntar(pagina, abrir);
    await esperar(1200);
    await apuntar(pagina, pagina.getByRole("button", { name: "Top proveedores" }));
    await esperar(4500);
  });

  await rotulo(pagina, "Arriba a la derecha, lo que ha costado la IA este mes");
  await intentar("gasto ia", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="facturas-gasto-ia"]'));
    await esperar(3500);
    await pagina.keyboard.press("Escape");
    await esperar(600);
  });
  await rotulo(pagina, "");
}

// ── Demo del Gestor Web (solo lectura: nada de guardar ni tocar interruptores) ─
async function demoGestorWeb(pagina) {
  const panel = () => pagina.locator('section[role="tabpanel"]:not([hidden])');
  const subpestana = (nombre) => panel().getByRole("tab", { name: new RegExp(`^${nombre}`) });

  await rotulo(pagina, "Ahora, funcionando: la carta");
  await intentar("carta", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="gw-pestana-carta"]'));
    await esperar(1000);
    await apuntar(pagina, subpestana("Platos"));
    await esperar(1500);
    await rueda(pagina, panel(), 1400, 10);
    await esperar(1500);
    await rueda(pagina, panel(), -1400, 8);
    await esperar(800);
  });

  await rotulo(pagina, "Buscar un plato por su nombre o su descripción");
  await intentar("buscar", async () => {
    const buscar = panel().getByPlaceholder("Buscar por nombre o descripción...");
    await apuntar(pagina, buscar);
    await pagina.keyboard.type("croqueta", { delay: 140 });
    await esperar(2500);
    await apuntar(pagina, panel().getByLabel("Limpiar búsqueda"));
    await esperar(1000);
  });

  await rotulo(pagina, "Cada plato: precio, alérgenos, «sin gluten» y en qué web se ve");
  await intentar("tarjeta", async () => {
    const plato = panel().locator('[data-tour="gw-carta-plato"]');
    await apuntar(pagina, plato, { pulsar: false });
    await esperar(2500);
    const foto = plato.getByRole("button", { name: "Mostrar foto" });
    if (await foto.count()) {
      await rotulo(pagina, "El ojo enseña la foto aquí, en el panel");
      await apuntar(pagina, foto);
      await esperar(2500);
    }
  });

  await rotulo(pagina, "«Editar» abre la ficha del plato (cerramos sin guardar)");
  await intentar("editar plato", async () => {
    await apuntar(pagina, panel().locator('[data-tour="gw-carta-plato"]').getByRole("button", { name: /Editar/ }));
    const dialogo = pagina.getByRole("dialog");
    await dialogo.waitFor({ state: "visible", timeout: 5000 });
    await esperar(2500);
    await rotulo(pagina, "Nombre, precio, descripción, alérgenos, «sin gluten» y foto");
    await rueda(pagina, dialogo, 900, 8);
    await esperar(2500);
    await rueda(pagina, dialogo, 900, 8);
    await esperar(2000);
    await apuntar(pagina, dialogo.getByRole("button", { name: "Cancelar" }));
    await dialogo.waitFor({ state: "hidden", timeout: 5000 });
    await esperar(800);
  });

  await rotulo(pagina, "«Ajustar precios»: una categoría entera, en % (cerramos sin aplicar)");
  await intentar("ajustar precios", async () => {
    await apuntar(pagina, panel().getByRole("button", { name: "Ajustar precios" }));
    const dialogo = pagina.getByRole("dialog");
    await dialogo.waitFor({ state: "visible", timeout: 5000 });
    await esperar(3500);
    await rotulo(pagina, "«Ver historial»: ajustes anteriores, gráfica y volver atrás");
    await apuntar(pagina, dialogo.getByRole("button", { name: "Ver Historial" }));
    await esperar(4000);
    await pagina.keyboard.press("Escape");
    await esperar(1000);
    if (await pagina.getByRole("dialog").count()) {
      await apuntar(pagina, pagina.getByRole("dialog").getByRole("button", { name: "Cancelar" }));
    }
    await esperar(800);
  });

  await rotulo(pagina, "Vinos: «Añadir botella con foto» y «Varias botellas»");
  await intentar("vinos", async () => {
    await apuntar(pagina, panel().locator('[data-tour="gw-carta-vinos"]'));
    await esperar(1800);
    const foto = panel().locator('[data-tour="gw-carta-vinos-foto"]');
    await apuntar(pagina, foto.getByRole("button").first(), { pulsar: false });
    await esperar(2500);
    await apuntar(pagina, foto.getByRole("button").last(), { pulsar: false });
    await esperar(2500);
    await rueda(pagina, panel(), 900, 8);
    await esperar(1500);
  });

  await rotulo(pagina, "Bebidas y cócteles funcionan igual");
  await intentar("bebidas y cócteles", async () => {
    await apuntar(pagina, subpestana("Bebidas"));
    await esperar(2200);
    await apuntar(pagina, subpestana("Cócteles"));
    await esperar(2200);
  });

  await rotulo(pagina, "Novedades: la lista, el formulario y cómo se ve en el móvil");
  await intentar("novedades", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="gw-pestana-novedades"]'));
    await esperar(2500);
    const editar = panel().locator('[data-tour="gw-novedades-lista"]').getByRole("button", { name: "Editar", exact: true });
    await apuntar(pagina, editar.first());
    await esperar(2500);
    await rotulo(pagina, "A la derecha, así se ve en el móvil (no se guarda nada)");
    await apuntar(pagina, panel().locator('[data-tour="gw-novedades-vista"]'), { pulsar: false });
    await esperar(3000);
    await rotulo(pagina, "«Publicación»: visible, destacada y entre qué fechas");
    const publicacion = panel().locator('[data-tour="gw-novedades-publicacion"]');
    await publicacion.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await esperar(1000);
    await apuntar(pagina, publicacion, { pulsar: false });
    await esperar(3500);
  });

  await rotulo(pagina, "Menú del día: los días guardados, el formulario y la vista previa");
  await intentar("menús", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="gw-pestana-menus"]'));
    await esperar(2500);
    const editar = panel().locator('[data-tour="gw-menu-lista"]').getByRole("button", { name: "Editar", exact: true });
    if (await editar.count()) {
      await apuntar(pagina, editar.first());
      await esperar(1500);
    }
    await rotulo(pagina, "Platos «De la carta» (con sus alérgenos y su foto) o «A mano»");
    const formulario = panel().locator('[data-tour="gw-menu-formulario"]');
    await formulario.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await esperar(1000);
    await apuntar(pagina, formulario, { pulsar: false });
    await esperar(3000);
    await rotulo(pagina, "A la derecha, así se leerá en la web");
    await apuntar(pagina, panel().locator('[data-tour="gw-menu-vista"]'), { pulsar: false });
    await esperar(3000);
  });

  await rotulo(pagina, "Tapas: la fecha y una tapa por línea");
  await intentar("tapas", async () => {
    await apuntar(pagina, pagina.locator('[data-tour="gw-pestana-tapas"]'));
    await esperar(2000);
    const editar = panel().locator('[data-tour="gw-menu-lista"]').getByRole("button", { name: "Editar", exact: true });
    if (await editar.count()) {
      await apuntar(pagina, editar.first());
      await esperar(1500);
    }
    await apuntar(pagina, panel().locator('[data-tour="gw-menu-formulario"]'), { pulsar: false });
    await esperar(3500);
  });
  await rotulo(pagina, "");
}

const SECCIONES = [
  { id: "facturas", ruta: "/facturas?tab=compras", preparar: prepararFacturas, demo: demoFacturas },
  { id: "gestor-web", ruta: "/gestion-web?tab=carta", demo: demoGestorWeb },
];

/** Deja abierta la ficha de un documento con avisos y foto antes del tour (así el tour la enseña llena). */
async function prepararFacturas(pagina) {
  const id = await elegirDocumento(pagina);
  if (!id) return;
  console.log(`  · documento de ejemplo: ${id}`);
  await pagina.goto(`${BASE}/facturas?tab=compras&modo=documentos&doc=${id}`, { waitUntil: "networkidle" });
  await pagina.locator('[data-testid="ficha-compras"]').waitFor({ state: "visible", timeout: 15_000 });
}

// ── Grabación ────────────────────────────────────────────────────────────────
async function guardarSesion() {
  const navegador = await chromium.launch({ headless: false });
  const contexto = await navegador.newContext({ viewport: TAMANO });
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}/auth`);
  console.log("Inicia sesión en la ventana que se ha abierto (tienes 5 minutos)…");
  await pagina.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 5 * 60_000 });
  await esperar(2000); // que Supabase termine de guardar la sesión en localStorage
  await contexto.storageState({ path: SESION });
  await navegador.close();
  console.log(`Sesión guardada en ${SESION}`);
}

function aMp4(webm) {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  rmSync(mp4, { force: true });
  execFileSync(
    FFMPEG,
    ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "23", "-r", "25", "-movflags", "+faststart", "-an", mp4],
    { stdio: "inherit" },
  );
  return mp4;
}

const mb = (ruta) => (statSync(ruta).size / 1024 / 1024).toFixed(1);

async function grabarSeccion(navegador, { id, ruta, preparar, demo }) {
  const carpetaVideo = mkdtempSync(join(tmpdir(), `video-ayuda-${id}-`));
  const contexto = await navegador.newContext({
    storageState: SESION,
    viewport: TAMANO,
    recordVideo: { dir: carpetaVideo, size: TAMANO },
  });
  await contexto.addInitScript(PUNTERO);
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
  if (new URL(pagina.url()).pathname.startsWith("/auth")) {
    await contexto.close();
    throw new Error("La sesión ha caducado: vuelve a ejecutar con --login.");
  }
  // Supabase puede haber renovado el token al cargar: se guarda ya, por si algo falla luego.
  await contexto.storageState({ path: SESION });

  if (preparar) await preparar(pagina);
  const pasos = await recorrerTour(pagina, id);
  if (demo) await demo(pagina);
  await esperar(1500);

  await contexto.storageState({ path: SESION });
  const video = pagina.video();
  await contexto.close(); // el vídeo se escribe al cerrar el contexto
  const destino = join(SALIDA, `${id}.webm`);
  rmSync(destino, { force: true });
  renameSync(await video.path(), destino);
  rmSync(carpetaVideo, { recursive: true, force: true });
  const mp4 = aMp4(destino);
  console.log(`${id}: ${pasos} pasos de tour + demo → ${destino} (${mb(destino)} MB), ${mp4} (${mb(mp4)} MB)`);
}

async function grabar() {
  if (!existsSync(SESION)) {
    console.error("No hay sesión guardada. Ejecuta antes: node scripts/videos-ayuda/grabar.mjs --login");
    process.exit(1);
  }
  mkdirSync(SALIDA, { recursive: true });
  const navegador = await chromium.launch();
  try {
    const solo = process.env.SOLO;
    for (const seccion of SECCIONES.filter((s) => !solo || s.id === solo)) {
      await grabarSeccion(navegador, seccion);
    }
  } finally {
    await navegador.close();
  }
  console.log("Vídeos en public/ayuda/videos:", readdirSync(SALIDA).join(", "));
}

if (process.argv.includes("--login")) await guardarSesion();
else await grabar();
