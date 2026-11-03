import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { Blocks, ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ItemMenu {
  title: string;
  url: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Recuerda si el grupo se dejó abierto (por navegador; sin almacenamiento, cerrado). */
export const CLAVE_MAS_MODULOS = "superadmin:menu:mas-modulos";

function leerAbierto(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_MAS_MODULOS) === "abierto";
  } catch {
    return false;
  }
}

function guardarAbierto(abierto: boolean) {
  try {
    window.localStorage.setItem(CLAVE_MAS_MODULOS, abierto ? "abierto" : "cerrado");
  } catch {
    /* modo privado o almacenamiento bloqueado: solo no se recuerda */
  }
}

const enRuta = (ruta: string, url: string) => ruta === url || ruta.startsWith(`${url}/`);

const TITULO = "Más módulos";

/**
 * Grupo plegable al final del menú del Super Admin con los módulos que se usan
 * menos (petición del dueño, 2026-11-03). Expandido (escritorio y panel deslizante)
 * es un desplegable con sus enlaces debajo; con el menú plegado a iconos es un
 * botón que abre un menú con los mismos enlaces. Se abre solo si la página actual
 * es uno de ellos y recuerda si se dejó abierto.
 */
export function MenuMasModulos({ items, rutaActual }: { items: ItemMenu[]; rutaActual: string }) {
  const { state, isMobile } = useSidebar();
  const colapsado = state === "collapsed" && !isMobile;
  const dentro = items.some((i) => enRuta(rutaActual, i.url));
  const [abierto, setAbierto] = useState(() => dentro || leerAbierto());

  // Al llegar a uno de sus módulos (enlace, atrás del navegador), el grupo se abre.
  useEffect(() => {
    if (dentro) setAbierto(true);
  }, [dentro, rutaActual]);

  // Al abrirlo a mano, sus enlaces se desplazan a la vista: con el menú largo
  // (portátil, panel deslizante) quedaban debajo del borde.
  const listaRef = useRef<HTMLUListElement>(null);
  const desplazar = useRef(false);
  useEffect(() => {
    if (!abierto || !desplazar.current) return;
    desplazar.current = false;
    const id = window.requestAnimationFrame(() => {
      const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      listaRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest", behavior: reducido ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [abierto]);

  const cambiar = (valor: boolean) => {
    desplazar.current = valor;
    setAbierto(valor);
    guardarAbierto(valor);
  };

  if (colapsado) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  isActive={dentro}
                  aria-label={TITULO}
                  className="rounded-lg"
                  data-testid="mas-modulos"
                >
                  <Blocks aria-hidden="true" />
                  <span>{TITULO}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              {TITULO}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" sideOffset={14} className="min-w-56">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{TITULO}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {items.map((item) => {
              const activo = enRuta(rutaActual, item.url);
              return (
                <DropdownMenuItem key={item.url} asChild className={cn("gap-3", activo && "bg-muted font-medium")}>
                  <NavLink to={item.url} aria-current={activo ? "page" : undefined}>
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.title}</span>
                  </NavLink>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={abierto} onOpenChange={cambiar} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            // Cerrado y estando en uno de sus módulos: el grupo se marca como activo.
            isActive={dentro && !abierto}
            className="group/mas rounded-lg gap-3"
            data-testid="mas-modulos"
          >
            <Blocks aria-hidden="true" />
            <span>{TITULO}</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto !size-4 transition-transform duration-200 group-data-[state=open]/mas:rotate-90 motion-reduce:transition-none"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub ref={listaRef} aria-label={TITULO}>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.url}>
                <SidebarMenuSubButton asChild isActive={enRuta(rutaActual, item.url)} className="h-9 gap-3 rounded-lg">
                  <NavLink to={item.url} aria-label={item.title}>
                    <item.icon className="shrink-0" aria-hidden="true" />
                    <span>{item.title}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
