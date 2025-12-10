import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ArchivoFactura {
  file: File;
  preview: string;
  nombre: string;
}

export function SubidaFacturas() {
  const [archivos, setArchivos] = useState<ArchivoFactura[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const nuevosArchivos: ArchivoFactura[] = [];
    
    Array.from(files).forEach((file) => {
      // Validar tipo de archivo
      const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!tiposPermitidos.includes(file.type)) {
        toast({
          title: "Tipo de archivo no permitido",
          description: `El archivo ${file.name} no es un PDF o imagen válida`,
          variant: "destructive",
        });
        return;
      }

      // Validar tamaño (máximo 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "Archivo demasiado grande",
          description: `El archivo ${file.name} supera los 10MB`,
          variant: "destructive",
        });
        return;
      }

      nuevosArchivos.push({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        nombre: file.name,
      });
    });

    setArchivos(prev => [...prev, ...nuevosArchivos]);
    
    // Limpiar input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const eliminarArchivo = (index: number) => {
    setArchivos(prev => {
      const nuevos = [...prev];
      if (nuevos[index].preview) {
        URL.revokeObjectURL(nuevos[index].preview);
      }
      nuevos.splice(index, 1);
      return nuevos;
    });
  };

  const convertirABase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Extraer solo el contenido base64 sin el prefijo data:...
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const enviarFacturas = async () => {
    if (archivos.length === 0) {
      toast({
        title: "Sin archivos",
        description: "Por favor, selecciona al menos una factura para enviar",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Convertir todos los archivos a base64
      const archivosPayload = await Promise.all(
        archivos.map(async (archivo) => {
          const base64 = await convertirABase64(archivo.file);
          return {
            nombre: archivo.nombre,
            tipo: archivo.file.type,
            size: archivo.file.size,
            contenido_base64: base64,
          };
        })
      );

      const payload = {
        tipo: "facturas",
        archivos: archivosPayload,
        fecha: new Date().toISOString(),
      };

      const { data, error } = await supabase.functions.invoke('procesar-factura', {
        body: payload,
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('Facturas enviadas:', data);

      toast({
        title: "Facturas enviadas",
        description: `Se han enviado ${archivos.length} factura(s) correctamente`,
      });

      // Limpiar archivos
      archivos.forEach(a => {
        if (a.preview) URL.revokeObjectURL(a.preview);
      });
      setArchivos([]);

    } catch (error) {
      console.error('Error al enviar facturas:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudieron enviar las facturas",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Subida de Facturas
        </CardTitle>
        <CardDescription>
          Arrastra o selecciona tus facturas (PDF o imágenes) para enviarlas al sistema de procesamiento
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Zona de carga */}
        <div 
          className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = e.dataTransfer.files;
            if (files.length > 0 && fileInputRef.current) {
              const dt = new DataTransfer();
              Array.from(files).forEach(f => dt.items.add(f));
              fileInputRef.current.files = dt.files;
              handleFileChange({ target: { files: dt.files } } as React.ChangeEvent<HTMLInputElement>);
            }
          }}
        >
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground mb-2">
            Arrastra tus facturas aquí o haz clic para seleccionar
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, JPG, PNG o WEBP (máximo 10MB por archivo)
          </p>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Lista de archivos */}
        {archivos.length > 0 && (
          <div className="space-y-3">
            <Label>Archivos seleccionados ({archivos.length})</Label>
            <div className="grid gap-3">
              {archivos.map((archivo, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                >
                  {archivo.preview ? (
                    <img 
                      src={archivo.preview} 
                      alt={archivo.nombre}
                      className="h-12 w-12 object-cover rounded"
                    />
                  ) : (
                    <div className="h-12 w-12 bg-primary/10 rounded flex items-center justify-center">
                      <FileText className="h-6 w-6 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{archivo.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {(archivo.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => eliminarArchivo(index)}
                    disabled={isSubmitting}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botón enviar */}
        <Button 
          onClick={enviarFacturas}
          disabled={archivos.length === 0 || isSubmitting}
          className="w-full"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Enviar {archivos.length > 0 ? `${archivos.length} factura(s)` : 'facturas'}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
