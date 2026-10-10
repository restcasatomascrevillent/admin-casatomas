import { Megaphone, UtensilsCrossed, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";

export type TipoNewsletter = 'anuncio' | 'nuevo_menu' | 'oferta';

interface TipoOption {
  tipo: TipoNewsletter;
  icono: React.ReactNode;
  nombre: string;
  descripcion: string;
  tituloDefault: string;
  mensajeDefault: string;
}

const tiposNewsletter: TipoOption[] = [
  {
    tipo: 'anuncio',
    icono: <Megaphone className="h-4 w-4" />,
    nombre: 'Anuncio General',
    descripcion: 'Comunica novedades a tus clientes',
    tituloDefault: 'Novedades de Casa Tomás',
    mensajeDefault: 'Queridos clientes,\n\nNos complace compartir con vosotros las últimas novedades de Casa Tomás.\n\n¡Os esperamos!',
  },
  {
    tipo: 'nuevo_menu',
    icono: <UtensilsCrossed className="h-4 w-4" />,
    nombre: 'Nuevo Menú',
    descripcion: 'Presenta nuevos platos de la carta',
    tituloDefault: 'Nuevos platos en nuestra carta',
    mensajeDefault: 'Queridos clientes,\n\nHemos incorporado nuevos platos a nuestra carta que estamos seguros os van a encantar.\n\n¡Venid a probarlos!',
  },
  {
    tipo: 'oferta',
    icono: <PartyPopper className="h-4 w-4" />,
    nombre: 'Oferta Especial',
    descripcion: 'Promociones y descuentos exclusivos',
    tituloDefault: '¡Oferta exclusiva para ti!',
    mensajeDefault: 'Queridos clientes,\n\nTenemos una oferta especial preparada exclusivamente para vosotros.\n\n¡No os la perdáis!',
  },
];

interface SelectorTipoNewsletterProps {
  tipoSeleccionado: TipoNewsletter | null;
  onSeleccionar: (tipo: TipoNewsletter, titulo: string, mensaje: string) => void;
}

export function SelectorTipoNewsletter({ tipoSeleccionado, onSeleccionar }: SelectorTipoNewsletterProps) {
  // Una fila de tres botones (icono + nombre, 44 px): la descripción de cada tipo va en el tooltip y en el nombre
  // accesible, no ocupa alto. Es un grupo de opciones: se mueve con Tab y se elige con Intro o Espacio.
  return (
    <div role="radiogroup" aria-label="Tipo de comunicación" className="grid grid-cols-3 gap-2">
      {tiposNewsletter.map((opcion) => {
        const activo = tipoSeleccionado === opcion.tipo;
        return (
          <button
            key={opcion.tipo}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={`${opcion.nombre}: ${opcion.descripcion}`}
            title={opcion.descripcion}
            onClick={() => onSeleccionar(opcion.tipo, opcion.tituloDefault, opcion.mensajeDefault)}
            className={cn(
              "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activo ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted/60",
            )}
          >
            <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{opcion.icono}</span>
            <span className="text-center leading-tight">{opcion.nombre}</span>
          </button>
        );
      })}
    </div>
  );
}

export { tiposNewsletter };
