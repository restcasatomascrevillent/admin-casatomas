import { Card, CardContent } from "@/components/ui/card";
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
    icono: <Megaphone className="h-8 w-8" />,
    nombre: 'Anuncio General',
    descripcion: 'Comunica novedades a tus clientes',
    tituloDefault: 'Novedades de Casa Tomás',
    mensajeDefault: 'Queridos clientes,\n\nNos complace compartir con vosotros las últimas novedades de Casa Tomás.\n\n¡Os esperamos!',
  },
  {
    tipo: 'nuevo_menu',
    icono: <UtensilsCrossed className="h-8 w-8" />,
    nombre: 'Nuevo Menú',
    descripcion: 'Presenta nuevos platos de la carta',
    tituloDefault: 'Nuevos platos en nuestra carta',
    mensajeDefault: 'Queridos clientes,\n\nHemos incorporado nuevos platos a nuestra carta que estamos seguros os van a encantar.\n\n¡Venid a probarlos!',
  },
  {
    tipo: 'oferta',
    icono: <PartyPopper className="h-8 w-8" />,
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
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiposNewsletter.map((opcion) => (
        <Card
          key={opcion.tipo}
          className={cn(
            "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
            tipoSeleccionado === opcion.tipo && "border-primary ring-2 ring-primary/20"
          )}
          onClick={() => onSeleccionar(opcion.tipo, opcion.tituloDefault, opcion.mensajeDefault)}
        >
          <CardContent className="p-4 text-center">
            <div className={cn(
              "mx-auto mb-2 w-fit p-2 rounded-full",
              tipoSeleccionado === opcion.tipo ? "bg-primary text-primary-foreground" : "bg-muted"
            )}>
              {opcion.icono}
            </div>
            <h3 className="font-semibold text-sm">{opcion.nombre}</h3>
            <p className="text-xs text-muted-foreground mt-1">{opcion.descripcion}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export { tiposNewsletter };
