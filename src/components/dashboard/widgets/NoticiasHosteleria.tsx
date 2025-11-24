import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Noticia {
  id: string;
  titulo: string;
  fuente: string;
  fecha: string;
  categoria: string;
  enlace: string;
}

// Noticias de ejemplo - En producción estas vendrían de una API o RSS feed
const NOTICIAS_EJEMPLO: Noticia[] = [
  {
    id: "1",
    titulo: "Nuevas regulaciones laborales para el sector hostelero en 2025",
    fuente: "Hostelería Digital",
    fecha: "2024-11-20",
    categoria: "Legislación",
    enlace: "#",
  },
  {
    id: "2",
    titulo: "Tendencias gastronómicas: El auge de la cocina sostenible",
    fuente: "Restauración News",
    fecha: "2024-11-19",
    categoria: "Tendencias",
    enlace: "#",
  },
  {
    id: "3",
    titulo: "Tecnología en restaurantes: Sistemas de reservas con IA",
    fuente: "HORECA Magazine",
    fecha: "2024-11-18",
    categoria: "Tecnología",
    enlace: "#",
  },
  {
    id: "4",
    titulo: "Gestión de personal: Cómo reducir la rotación en hostelería",
    fuente: "Gestión Restaurantes",
    fecha: "2024-11-17",
    categoria: "RRHH",
    enlace: "#",
  },
  {
    id: "5",
    titulo: "Subvenciones para digitalización de restaurantes",
    fuente: "Hostelería España",
    fecha: "2024-11-16",
    categoria: "Gestión",
    enlace: "#",
  },
];

export function NoticiasHosteleria() {
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas");

  const categorias = ["todas", "Tendencias", "Legislación", "Tecnología", "RRHH", "Gestión"];

  const noticiasFiltradas =
    filtroCategoria === "todas"
      ? NOTICIAS_EJEMPLO
      : NOTICIAS_EJEMPLO.filter((n) => n.categoria === filtroCategoria);

  const getCategoriaColor = (categoria: string) => {
    const colors: Record<string, string> = {
      Tendencias: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      Legislación: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      Tecnología: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      RRHH: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      Gestión: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    };
    return colors[categoria] || "bg-gray-100 text-gray-800";
  };

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-medium">Noticias del Sector</CardTitle>
          </div>
        </div>
        <Tabs value={filtroCategoria} onValueChange={setFiltroCategoria} className="mt-3">
          <TabsList className="grid grid-cols-6 w-full">
            {categorias.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="text-xs capitalize">
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-3">
        {noticiasFiltradas.length > 0 ? (
          noticiasFiltradas.map((noticia) => (
            <div
              key={noticia.id}
              className="p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-sm leading-tight flex-1">{noticia.titulo}</h4>
                  <Badge className={`${getCategoriaColor(noticia.categoria)} text-xs`}>
                    {noticia.categoria}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span>{noticia.fuente}</span>
                    <span>•</span>
                    <span>
                      {new Date(noticia.fecha).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
                    <a href={noticia.enlace} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-muted-foreground py-4">
            No hay noticias en esta categoría
          </div>
        )}
      </CardContent>
    </Card>
  );
}
