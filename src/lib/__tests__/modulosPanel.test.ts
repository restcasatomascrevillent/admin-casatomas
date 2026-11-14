/**
 * Catálogo de módulos del Admin Panel (14/11/2026, «hay muchos módulos que no aparecen en el control del
 * panel»). Si alguien añade una página al panel sin ponerla en `lib/modulosPanel.ts`, falla aquí: así no
 * vuelve a quedar un módulo sin interruptor en Control del Panel.
 */
import { describe, expect, it } from "vitest";
// Texto de App.tsx tal cual (`?raw` de Vite): sin `fs` ni rutas.
import fuenteApp from "../../App.tsx?raw";
// Import de verdad (sin pintar nada): así `npm run test:cambios` (`vitest related`) pasa esta prueba
// cuando cambia App.tsx, que es justo cuando alguien añade una página. Con solo `?raw` no la relaciona.
import App from "@/App";
import {
  GRUPOS_MODULOS,
  MODULOS_MENU,
  MODULOS_PANEL,
  RUTAS_FUERA_DEL_CATALOGO,
  destinoPermitido,
  moduloActivo,
  moduloDeRuta,
  moduloPorClave,
  rutaFueraDelCatalogo,
  tienePermisoModulo,
  valorInterruptor,
} from "@/lib/modulosPanel";
import { OPCIONES_INICIO } from "@/lib/seccionInicio";
import { CARGADORES_SECCION } from "@/lib/precargaSecciones";
import { SECTIONS } from "@/hooks/useUserRole";

/** Todas las `<Route path="…">` de App.tsx. */
const rutasApp = [...fuenteApp.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
/** Las que pintan una página del panel para el equipo (`pagina(…)` o `paginaSinMarco(…)`). */
const paginasEquipo = [...fuenteApp.matchAll(/<Route\s+path="([^"]+)"\s+element=\{pagina(?:SinMarco)?\(/g)].map((m) => m[1]);
const rutasCatalogo = MODULOS_PANEL.flatMap((m) => m.rutas);

describe("catálogo completo: cada ruta de App.tsx está en un módulo o fuera con su motivo", () => {
  it("lee las rutas de App.tsx (si cambia la forma de escribirlas, hay que cambiar esta prueba)", () => {
    expect(App).toBeTypeOf("function");
    expect(rutasApp.length).toBeGreaterThan(20);
    expect(paginasEquipo).toEqual(expect.arrayContaining(["/reservas", "/rrss", "/albaranes", "/peticiones", "/instagram/rapido"]));
  });

  it.each(rutasApp)("%s", (ruta) => {
    const enCatalogo = rutasCatalogo.includes(ruta);
    const motivo = rutaFueraDelCatalogo(ruta);
    // Mensaje claro para quien añade una página: qué hacer.
    expect(
      enCatalogo || !!motivo,
      `La ruta «${ruta}» de App.tsx no está en el catálogo de módulos (src/lib/modulosPanel.ts). Añádela a las rutas ` +
        "de su módulo (o crea el módulo, con su interruptor en Control del Panel) o, si no es del equipo, a " +
        "RUTAS_FUERA_DEL_CATALOGO con el motivo.",
    ).toBe(true);
    expect(enCatalogo && !!motivo, `«${ruta}» está a la vez en el catálogo y fuera de él`).toBe(false);
  });

  it("toda página del equipo (pagina/paginaSinMarco) es de un módulo, no una excepción", () => {
    for (const ruta of paginasEquipo) expect(rutasCatalogo, ruta).toContain(ruta);
  });

  it("y al revés: ninguna ruta del catálogo ni excepción sobra (todas existen en App.tsx)", () => {
    for (const ruta of rutasCatalogo) expect(rutasApp, `«${ruta}» ya no está en App.tsx`).toContain(ruta);
    for (const ruta of Object.keys(RUTAS_FUERA_DEL_CATALOGO)) expect(rutasApp, ruta).toContain(ruta);
  });

  it("las páginas del Super Admin quedan fuera (solo entra un super admin)", () => {
    const superAdmin = rutasApp.filter((r) => r.startsWith("/super-admin"));
    expect(superAdmin.length).toBeGreaterThan(10);
    for (const ruta of superAdmin) {
      expect(moduloDeRuta(ruta)).toBeUndefined();
      expect(rutaFueraDelCatalogo(ruta)).toMatch(/Solo Super Admin/);
    }
  });

  it("cada sección precargable del menú (CARGADORES_SECCION) es de un módulo", () => {
    for (const ruta of Object.keys(CARGADORES_SECCION)) expect(moduloDeRuta(ruta), ruta).toBeDefined();
  });
});

describe("forma del catálogo", () => {
  it("claves únicas, con nombre, descripción, icono y un grupo que existe", () => {
    const claves = MODULOS_PANEL.map((m) => m.clave);
    expect(new Set(claves).size).toBe(claves.length);
    const grupos = GRUPOS_MODULOS.map((g) => g.id) as string[];
    for (const m of MODULOS_PANEL) {
      expect(m.nombre.trim(), m.clave).not.toBe("");
      expect(m.descripcion.length, m.clave).toBeGreaterThan(15);
      expect(m.icono, m.clave).toBeTruthy();
      expect(grupos, m.clave).toContain(m.grupo);
      if (!m.desactivable) expect(m.motivoSiempreActivo, m.clave).toBeTruthy();
      if (m.enMenu) expect(m.rutas.length, m.clave).toBeGreaterThan(0);
    }
  });

  it("conserva las claves que ya había en admin_feature_toggles (no se renombran) y se pueden apagar", () => {
    for (const clave of ["cheques", "facturas", "gestion_web", "marketing", "reservas", "tienda", "usuarios"]) {
      expect(moduloPorClave(clave)?.desactivable, clave).toBe(true);
    }
    expect(moduloPorClave("marketing")?.nombre).toBe("Newsletter");
  });

  it("RRSS y Subir albaranes tienen interruptor propio, heredado de Newsletter y Facturas", () => {
    expect(moduloPorClave("rrss")).toMatchObject({ desactivable: true, heredaDe: "marketing", rutas: ["/rrss", "/instagram/rapido"] });
    expect(moduloPorClave("albaranes")).toMatchObject({ desactivable: true, heredaDe: "facturas", rutas: ["/albaranes"] });
  });

  it("Dashboard, Ayuda, Avisos y Mi cuenta no se pueden apagar", () => {
    expect(MODULOS_PANEL.filter((m) => !m.desactivable).map((m) => m.clave)).toEqual(["dashboard", "ayuda", "avisos", "mi_cuenta"]);
  });

  it("el menú lateral, en el orden de siempre", () => {
    expect(MODULOS_MENU.map((m) => m.nombre)).toEqual([
      "Dashboard", "Reservas", "Gestor Web", "Newsletter", "RRSS", "Cheques", "Tienda", "Facturas",
      "Subir albaranes", "Usuarios", "Nueva petición", "Ayuda",
    ]);
  });

  it("los permisos de cada módulo existen", () => {
    const secciones = SECTIONS.map((s) => s.key) as string[];
    for (const m of MODULOS_PANEL) for (const s of m.secciones ?? []) expect(secciones, `${m.clave}: ${s}`).toContain(s);
  });

  it("las opciones de «Al iniciar sesión, abrir» son entradas del menú con los mismos permisos", () => {
    for (const o of OPCIONES_INICIO) {
      const m = moduloDeRuta(o.ruta);
      expect(m?.enMenu, o.ruta).toBe(true);
      expect([...(o.secciones ?? [])].sort(), o.ruta).toEqual([...(m?.secciones ?? [])].sort());
      expect(!!o.soloConPermiso, o.ruta).toBe(!!m?.soloConPermiso);
    }
  });
});

describe("moduloDeRuta", () => {
  it.each([
    ["/", "dashboard"],
    ["/dashboard", "dashboard"],
    ["/reservas", "reservas"],
    ["/reservas/", "reservas"],
    ["/aplicar-precio/7f1c", "gestion_web"],
    ["/rrss", "rrss"],
    ["/instagram/rapido", "rrss"],
    ["/facturas/ia", "facturas"],
    ["/albaranes", "albaranes"],
    ["/peticiones", "peticiones"],
    ["/avisos", "avisos"],
  ])("%s → %s", (ruta, clave) => {
    expect(moduloDeRuta(ruta)?.clave).toBe(clave);
  });

  it("lo que no es del equipo, ninguno", () => {
    for (const ruta of ["/super-admin", "/super-admin/espacios", "/auth", "/no-existe", "/facturas/otra"]) {
      expect(moduloDeRuta(ruta), ruta).toBeUndefined();
    }
  });
});

describe("valorInterruptor (sin fila = activado; RRSS y Subir albaranes heredan)", () => {
  it("con fila manda la fila; sin fila, activado", () => {
    expect(valorInterruptor("reservas", [{ section_key: "reservas", enabled: false }])).toBe(false);
    expect(valorInterruptor("reservas", [])).toBe(true);
    expect(valorInterruptor("peticiones", [{ section_key: "reservas", enabled: false }])).toBe(true);
    expect(valorInterruptor("clave_desconocida", [])).toBe(true);
  });

  it("RRSS sin fila vale lo que Newsletter (si estaba apagado, sigue oculto); con fila propia, va por libre", () => {
    expect(valorInterruptor("rrss", [{ section_key: "marketing", enabled: false }])).toBe(false);
    expect(valorInterruptor("rrss", [{ section_key: "marketing", enabled: true }])).toBe(true);
    expect(valorInterruptor("rrss", [{ section_key: "marketing", enabled: false }, { section_key: "rrss", enabled: true }])).toBe(true);
    expect(valorInterruptor("albaranes", [{ section_key: "facturas", enabled: false }])).toBe(false);
    expect(valorInterruptor("albaranes", [{ section_key: "facturas", enabled: false }, { section_key: "albaranes", enabled: true }])).toBe(true);
  });

  it("moduloActivo: los que no se pueden apagar, siempre activos aunque haya una fila", () => {
    const apagado = () => false;
    expect(moduloActivo(moduloPorClave("dashboard")!, apagado)).toBe(true);
    expect(moduloActivo(moduloPorClave("ayuda")!, apagado)).toBe(true);
    expect(moduloActivo(moduloPorClave("reservas")!, apagado)).toBe(false);
  });
});

describe("permisos y destino al rechazar", () => {
  const ver = (...s: string[]) => s.map((section_key) => ({ section_key, can_view: true }));
  const todoActivo = () => true;
  const apagados = (...claves: string[]) => (c: string) => !claves.includes(c);

  it("tienePermisoModulo: sin secciones lo ve todo el mundo; el super admin todo salvo «solo con permiso»", () => {
    expect(tienePermisoModulo(moduloPorClave("peticiones")!, [], false)).toBe(true);
    expect(tienePermisoModulo(moduloPorClave("rrss")!, ver("instagram_agencia"), false)).toBe(true);
    expect(tienePermisoModulo(moduloPorClave("rrss")!, [], true)).toBe(true);
    expect(tienePermisoModulo(moduloPorClave("albaranes")!, [], true)).toBe(false);
    expect(tienePermisoModulo(moduloPorClave("albaranes")!, ver("facturas_albaranes"), true)).toBe(true);
  });

  it("primero el Dashboard si lo puede ver; si no, la primera sección del menú que pueda ver y esté activada", () => {
    expect(destinoPermitido(ver("dashboard", "reservas"), todoActivo, "/rrss")).toBe("/dashboard");
    expect(destinoPermitido(ver("reservas", "facturas"), todoActivo, "/rrss")).toBe("/reservas");
    expect(destinoPermitido(ver("reservas", "facturas"), apagados("reservas"), "/rrss")).toBe("/facturas");
    // La agencia, con Newsletter apagado no cuenta: va a RRSS.
    expect(destinoPermitido(ver("marketing"), apagados("marketing"), "/dashboard")).toBe("/rrss");
  });

  it("no manda al módulo de la ruta actual ni a uno apagado (sin bucles): si no queda nada, Ayuda", () => {
    expect(destinoPermitido(ver("facturas_albaranes"), apagados("albaranes"), "/dashboard")).toBe("/ayuda");
    expect(destinoPermitido(ver("facturas_albaranes"), todoActivo, "/albaranes")).toBe("/ayuda");
    expect(destinoPermitido(ver("facturas", "facturas_subida"), todoActivo, "/facturas/ia")).toBe("/ayuda");
    expect(destinoPermitido([], todoActivo, "/reservas")).toBe("/ayuda");
  });
});
