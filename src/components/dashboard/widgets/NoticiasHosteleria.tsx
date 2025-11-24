import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNoticiasHosteleria } from "@/hooks/useNoticiasHosteleria";
import { Skeleton } from "@/components/ui/skeleton";

export function NoticiasHosteleria() {
  const [filtroCategoria, setFiltroCategoria] = useState<string>("todas");
  const { data: noticias, isLoading, refetch, isFetching } = useNoticiasHosteleria(filtroCategoria);

  const categorias = ["todas", "Tendencias", "Legislación", "Tecnología", "RRHH", "Gestión"];

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
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
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : noticias && noticias.length > 0 ? (
          noticias.map((noticia, index) => (
            <div
              key={index}
              className="p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-sm leading-tight flex-1">{noticia.titulo}</h4>
                  <Badge className={`${getCategoriaColor(noticia.categoria)} text-xs`}>
                    {noticia.categoria}
                  </Badge>
                </div>
                {noticia.descripcion && (
                  <p className="text-xs text-muted-foreground">{noticia.descripcion}</p>
                )}
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

