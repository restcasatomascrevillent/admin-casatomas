import { EditorMenuTapasWeb } from "@/components/gestion-web/EditorMenuTapasWeb";

export function TabMenus() {
  return <EditorMenuTapasWeb seccionActiva="menus_diarios" />;
}

export function TabTapas() {
  return <EditorMenuTapasWeb seccionActiva="tapas" />;
}
