import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Facebook, Instagram, Calendar, Image, Send } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CarruselPublicaciones } from "./CarruselPublicaciones";

export function GestionRedesSociales() {
  const { toast } = useToast();
  const [mensaje, setMensaje] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [redSeleccionada, setRedSeleccionada] = useState<string[]>(["instagram", "facebook"]);

  const toggleRed = (red: string) => {
    setRedSeleccionada((prev) =>
      prev.includes(red) ? prev.filter((r) => r !== red) : [...prev, red]
    );
  };

  const handlePublicar = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!mensaje) {
      toast({
        title: "Error",
        description: "Por favor escribe un mensaje",
        variant: "destructive",
      });
      return;
    }

    if (redSeleccionada.length === 0) {
      toast({
        title: "Error",
        description: "Selecciona al menos una red social",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    // Simular publicación
    setTimeout(() => {
      const redes = redSeleccionada.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(" y ");
      toast({
        title: "Publicado",
        description: `Tu contenido se ha publicado en ${redes}`,
      });
      setMensaje("");
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Sección de últimas publicaciones */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Últimas Publicaciones</h3>
        <CarruselPublicaciones />
      </div>

      {/* Formulario de crear publicación */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Crear Publicación
            </CardTitle>
            <CardDescription>
              Publica contenido simultáneamente en tus redes sociales
            </CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handlePublicar} className="space-y-4">
            <div className="space-y-2">
              <Label>Selecciona las redes sociales</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={redSeleccionada.includes("instagram") ? "default" : "outline"}
                  onClick={() => toggleRed("instagram")}
                  className="flex-1"
                >
                  <Instagram className="mr-2 h-4 w-4" />
                  Instagram
                </Button>
                <Button
                  type="button"
                  variant={redSeleccionada.includes("facebook") ? "default" : "outline"}
                  onClick={() => toggleRed("facebook")}
                  className="flex-1"
                >
                  <Facebook className="mr-2 h-4 w-4" />
                  Facebook
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mensaje">Mensaje</Label>
              <Textarea
                id="mensaje"
                placeholder="Escribe tu publicación aquí..."
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={8}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {mensaje.length} caracteres
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="imagen">Añadir imagen (opcional)</Label>
              <Input
                id="imagen"
                type="file"
                accept="image/*"
                className="cursor-pointer"
              />
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={isLoading} className="flex-1">
                <Send className="mr-2 h-4 w-4" />
                {isLoading ? "Publicando..." : "Publicar Ahora"}
              </Button>
              <Button type="button" variant="outline" disabled>
                <Calendar className="mr-2 h-4 w-4" />
                Programar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Instagram className="h-5 w-5 text-primary" />
              Instagram
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seguidores</span>
                <span className="font-semibold">3,542</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Engagement</span>
                <span className="font-semibold text-green-600">8.4%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Posts este mes</span>
                <span className="font-semibold">12</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Facebook className="h-5 w-5 text-primary" />
              Facebook
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seguidores</span>
                <span className="font-semibold">2,891</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Alcance</span>
                <span className="font-semibold text-blue-600">5.2K</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Posts este mes</span>
                <span className="font-semibold">8</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
