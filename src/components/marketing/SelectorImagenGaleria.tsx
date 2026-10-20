import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageIcon, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface SelectorImagenGaleriaProps {
  imagenSeleccionada?: string;
  onSeleccionar: (url: string | undefined) => void;
}

export function SelectorImagenGaleria({ imagenSeleccionada, onSeleccionar }: SelectorImagenGaleriaProps) {
  const [open, setOpen] = useState(false);

  const { data: imagenes, isLoading } = useQuery({
    queryKey: ['galeria-imagenes'],
    queryFn: async () => {
      const buckets = ['platos', 'bebidas', 'vinos'];
      const allImages: string[] = [];

      for (const bucket of buckets) {
        const { data: files } = await supabase.storage.from(bucket).list('', {
          limit: 20,
          sortBy: { column: 'created_at', order: 'desc' },
        });

        if (files) {
          for (const file of files) {
            if (file.name && !file.name.startsWith('.')) {
              const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(file.name);
              if (urlData?.publicUrl) {
                allImages.push(urlData.publicUrl);
              }
            }
          }
        }
      }

      return allImages;
    },
  });

  const handleSelect = (url: string | undefined) => {
    onSeleccionar(url);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Imagen (opcional)</label>
      
      {imagenSeleccionada ? (
        <div className="relative rounded-lg overflow-hidden border">
          <img
            src={imagenSeleccionada}
            alt="Seleccionada"
            className="w-full h-32 object-cover"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-11 w-11"
            onClick={() => onSeleccionar(undefined)}
            aria-label="Quitar la imagen"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full h-24 flex-col gap-2">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Seleccionar imagen</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Seleccionar imagen</DialogTitle>
            </DialogHeader>
            
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="sm" className="h-11 px-4" onClick={() => handleSelect(undefined)}>
                Sin imagen
              </Button>
            </div>

            <ScrollArea className="h-[min(400px,55dvh)]">
              {isLoading ? (
                <div className="grid grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-lg" />
                  ))}
                </div>
              ) : imagenes && imagenes.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {imagenes.map((url, index) => (
                    <div
                      key={index}
                      className={cn(
                        "relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all active:opacity-80",
                        imagenSeleccionada === url ? "border-primary" : "border-transparent"
                      )}
                      onClick={() => handleSelect(url)}
                    >
                      <img
                        src={url}
                        alt={`Imagen ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {imagenSeleccionada === url && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <Check className="h-8 w-8 text-primary" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  No hay imágenes disponibles en la galería
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
