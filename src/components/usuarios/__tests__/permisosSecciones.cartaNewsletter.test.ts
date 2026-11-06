// Textos de «Editar» en Usuarios para la carta, el Gestor Web y el newsletter
// (decisiones del dueño del 06/11/2026). Se prueban aparte para no pisar las
// pruebas de las demás secciones.
import { describe, expect, it } from "vitest";
import { AYUDA_EDICION, seccionesConPermisos } from "../permisosSecciones";

describe("AYUDA_EDICION · carta, Gestor Web y newsletter", () => {
  it("Carta: «Editar» ya se usa; con solo «Ver» se consulta y se descarga el «PDF Carta»", () => {
    expect(AYUDA_EDICION.gestor_carta).not.toMatch(/aún no se usa/);
    expect(AYUDA_EDICION.gestor_carta).toMatch(/precios/);
    expect(AYUDA_EDICION.gestor_carta).toMatch(/fotos/);
    expect(AYUDA_EDICION.gestor_carta).toMatch(/Con solo «Ver» se consulta la carta y se descarga el «PDF Carta»/);
  });

  it("Gestor Web: no cambia, con «Ver» se cambia todo", () => {
    expect(AYUDA_EDICION.gestion_web).toMatch(/sin efecto/);
    expect(AYUDA_EDICION.gestion_web).toMatch(/basta con «Ver»/);
    expect(AYUDA_EDICION.gestion_web).toMatch(/Novedades, Menús diarios y Tapas/);
  });

  it("Newsletter: «Editar» para crear y enviar; con solo «Ver» se consulta (Instagram sigue igual)", () => {
    expect(AYUDA_EDICION.marketing).not.toMatch(/aún no se usa/);
    expect(AYUDA_EDICION.marketing).toMatch(/en Instagram: crear y cambiar piezas/);
    expect(AYUDA_EDICION.marketing).toMatch(/En el newsletter: crear y enviar/);
    expect(AYUDA_EDICION.marketing).toMatch(/Con solo «Ver» se consultan los suscriptores, el historial de envíos y las estadísticas/);
  });

  it("se enseñan detrás de «Editar: » en el diálogo de permisos", () => {
    const filas = seccionesConPermisos({ is_super_admin: false, role: "staff", permissions: [] });
    expect(filas.find((f) => f.key === "gestor_carta")?.ayuda).toBe(`Editar: ${AYUDA_EDICION.gestor_carta}`);
    expect(filas.find((f) => f.key === "marketing")?.ayuda).toBe(`Editar: ${AYUDA_EDICION.marketing}`);
  });
});
