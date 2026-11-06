import type { ComponentType, SVGProps } from "react";
import { Box, Code2, CreditCard, Database, FolderOpen, Globe, Mail, MapPinned, Phone, Server, Sparkles } from "lucide-react";

type Icono = ComponentType<SVGProps<SVGSVGElement>>;

/** Icono de cada categoría de servicio (fichas de Estado y tarjetas de Servicios). */
const ICONO_CATEGORIA: Record<string, Icono> = {
  alojamiento: Server,
  base_datos: Database,
  codigo: Code2,
  correo: Mail,
  pagos: CreditCard,
  ia: Sparkles,
  telefonia: Phone,
  mapas: MapPinned,
  archivos: FolderOpen,
  dominio: Globe,
};

export const iconoCategoria = (categoria: string): Icono => ICONO_CATEGORIA[categoria] ?? Box;
