import { useState } from "react";
import { Search, Loader2, ExternalLink, X, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useBuscarPrecios } from "@/hooks/useBuscarPrecios";

const SUGERENCIAS = [
  "lubina fresca",
  "merluza del cantábrico",
  "gambas rojas",
  "pulpo gallego",
  "solomillo de ternera",
  "aceite de oliva virgen extra",
  "jamón ibérico",
  "tomate raf",
];

export function BuscadorPreciosMercado() {
  const [query, setQuery] = useState("");
  const { buscarPrecios, limpiarResultado, isLoading, resultado } = useBuscarPrecios();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    buscarPrecios(query);
  };

  const handleSugerencia = (sugerencia: string) => {
    setQuery(sugerencia);
    buscarPrecios(sugerencia);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Precios de Mercado</CardTitle>
        </div>
        <CardDescription>
          Busca precios actuales en lonjas, Mercamadrid, Mercabarna y proveedores
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Ej: merluza fresca, gambas, solomillo..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              disabled={isLoading}
            />
          </div>
          <Button type="submit" disabled={isLoading || !query.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Buscar"
            )}
          </Button>
        </form>

        {!resultado && !isLoading && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Sugerencias:</p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((sug) => (
                <Badge
                  key={sug}
                  variant="secondary"
                  className="cursor-pointer hover:bg-secondary/80 transition-colors"
                  onClick={() => handleSugerencia(sug)}
                >
                  {sug}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Buscando precios actuales...</p>
            </div>
          </div>
        )}

        {resultado && (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                Búsqueda: {resultado.query}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={limpiarResultado}
                className="h-7 px-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <ScrollArea className="flex-1 border rounded-md p-4 bg-muted/30">
              <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                {resultado.content}
              </div>
            </ScrollArea>

            {resultado.citations && resultado.citations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Fuentes:</p>
                <div className="flex flex-wrap gap-1">
                  {resultado.citations.slice(0, 5).map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Fuente {idx + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Actualizado: {new Date(resultado.timestamp).toLocaleString("es-ES")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
