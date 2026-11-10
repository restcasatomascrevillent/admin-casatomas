import { describe, expect, it } from "vitest";
import { PESTANAS_GESTOR_WEB, SECCIONES_GESTOR_WEB, puedeVerSeccion } from "../pestanasGestorWeb";
import type { UserPermissions } from "@/hooks/useUserRole";

const permiso = (section_key: string, can_view = true): UserPermissions =>
  ({ section_key, can_view, can_edit: false }) as UserPermissions;

const visibles = (permisos: UserPermissions[], superAdmin = false) =>
  PESTANAS_GESTOR_WEB.filter((p) => puedeVerSeccion(p.seccion, superAdmin, permisos)).map((p) => p.id);

describe("Pestañas del Gestor Web", () => {
  it("«Tienda» va la última y usa el permiso de Tienda (el mismo que pide la base de datos)", () => {
    expect(PESTANAS_GESTOR_WEB.map((p) => p.id)).toEqual(["carta", "novedades", "menus", "tapas", "tienda"]);
    expect(PESTANAS_GESTOR_WEB.find((p) => p.id === "tienda")?.seccion).toBe("tienda");
  });

  it("el permiso de Tienda por sí solo no abre el Gestor Web (ni su entrada del menú lateral)", () => {
    expect(SECCIONES_GESTOR_WEB).toEqual(["gestor_carta", "gestion_web"]);
  });

  it("la pestaña sale a quien entra por Gestión web y además ve la Tienda; sin ese permiso, no", () => {
    expect(visibles([permiso("gestion_web")])).toEqual(["novedades", "menus", "tapas"]);
    expect(visibles([permiso("gestion_web"), permiso("tienda")])).toEqual(["novedades", "menus", "tapas", "tienda"]);
    expect(visibles([permiso("gestion_web"), permiso("tienda", false)])).toEqual(["novedades", "menus", "tapas"]);
    expect(visibles([], true)).toEqual(["carta", "novedades", "menus", "tapas", "tienda"]);
  });
});
