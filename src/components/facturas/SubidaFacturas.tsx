import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, X, Send, Loader2, CheckCircle2, XCircle, Receipt, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

interface ArchivoFactura {
  file: File;
  preview: string;
  nombre: string;
}

interface ResultadoProcesamiento {
  nombre: string;
  success: boolean;
  error?: string;
  respuesta?: any;
  tipo?: 'factura' | 'albaran' | string;
}

export function SubidaFacturas() {
  const [archivos, setArchivos] = useState<ArchivoFactura[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultados, setResultados] = useState<ResultadoProcesamiento[]>([]);
  const [progreso, setProgreso] = useState<{
    total: number;
    actual: number;
    nombreActual: string;
  }>({ total: 0, actual: 0, nombreActual: '' });
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
        description: "Por favor, selecciona al menos un documento para enviar",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    setResultados([]);
    setProgreso({ total: archivos.length, actual: 0, nombreActual: '' });

    const nuevosResultados: ResultadoProcesamiento[] = [];

    // Procesar cada archivo individualmente
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i];

      setProgreso({
        total: archivos.length,
        actual: i + 1,
        nombreActual: archivo.nombre,
      });

      try {
        const base64 = await convertirABase64(archivo.file);

        const payload = {
          tipo: "AUTO",
          archivo: {
            nombre: archivo.nombre,
            tipo: archivo.file.type,
            size: archivo.file.size,
            contenido_base64: base64,
          },
          fecha: new Date().toISOString(),
        };

        const { data, error } = await supabase.functions.invoke('procesar-factura', {
          body: payload,
        });

        if (error || !data?.success) {
          nuevosResultados.push({
            nombre: archivo.nombre,
            success: false,
            error: error?.message || data?.error || 'Error desconocido',
          });
        } else {
          nuevosResultados.push({
            nombre: archivo.nombre,
            success: true,
            respuesta: data.webhookResponse,
            tipo: data.webhookResponse?.tipo || data.tipo,
          });
        }
      } catch (err) {
        nuevosResultados.push({
          nombre: archivo.nombre,
          success: false,
          error: err instanceof Error ? err.message : 'Error desconocido',
        });
      }
    }

    setResultados(nuevosResultados);

    // Analizar resultados
    const exitosos = nuevosResultados.filter(r => r.success);
    const fallidos = nuevosResultados.filter(r => !r.success);

    if (fallidos.length > 0 && exitosos.length > 0) {
      toast({
        title: `${exitosos.length} procesados, ${fallidos.length} fallidos`,
        description: `Fallidos: ${fallidos.map(f => f.nombre).join(', ')}`,
        variant: "destructive",
      });
    } else if (fallidos.length > 0) {
      toast({
        title: `${fallidos.length} documento(s) fallaron`,
        description: fallidos.map(f => f.nombre).join(', '),
        variant: "destructive",
      });
    } else {
      toast({
        title: "Todos los documentos procesados",
        description: `${exitosos.length} documento(s) procesados correctamente`,
      });
    }

    // Limpiar solo archivos exitosos
    if (exitosos.length > 0) {
      setArchivos(prev => {
        const archivosRestantes = prev.filter(a =>
          fallidos.some(f => f.nombre === a.nombre)
        );
        // Liberar URLs de preview de archivos exitosos
        prev.forEach(a => {
          if (!fallidos.some(f => f.nombre === a.nombre) && a.preview) {
            URL.revokeObjectURL(a.preview);
          }
        });
        return archivosRestantes;
      });
    }

    setIsSubmitting(false);
    setProgreso({ total: 0, actual: 0, nombreActual: '' });
  };

  const reintentarFallidos = () => {
    // Los fallidos ya están en la lista de archivos
    setResultados([]);
    enviarFacturas();
  };

  const limpiarTodo = () => {
    archivos.forEach(a => {
      if (a.preview) URL.revokeObjectURL(a.preview);
    });
    setArchivos([]);
    setResultados([]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Subida de Facturas y Albaranes
        </CardTitle>
        <CardDescription>
          Arrastra o selecciona tus facturas o albaranes (PDF o imágenes) para enviarlas al sistema de procesamiento
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
            Arrastra tus facturas o albaranes aquí o haz clic para seleccionar
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

        {/* Barra de progreso */}
        {isSubmitting && progreso.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Procesando {progreso.actual} de {progreso.total}</span>
              <span>{progreso.nombreActual}</span>
            </div>
            <Progress value={(progreso.actual / progreso.total) * 100} />
          </div>
        )}

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

        {/* Resultados de procesamiento */}
        {resultados.length > 0 && (
          <div className="space-y-3">
            <Label>Resultados del procesamiento</Label>
            <ScrollArea className="h-[200px] rounded-md border p-4">
              <div className="space-y-2">
                {resultados.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className={`text-sm truncate flex-1 ${!r.success ? 'text-destructive' : 'text-foreground'}`}>
                      {r.nombre}
                    </span>
                    {r.success && r.tipo && (
                      <div className="flex items-center gap-1 shrink-0">
                        {r.tipo === 'factura' ? (
                          <>
                            <Receipt className="h-3 w-3 text-blue-600" />
                            <span className="text-xs font-medium text-blue-600">Factura</span>
                          </>
                        ) : r.tipo === 'albaran' ? (
                          <>
                            <Package className="h-3 w-3 text-green-600" />
                            <span className="text-xs font-medium text-green-600">Albarán</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">{r.tipo}</span>
                        )}
                      </div>
                    )}
                    {!r.success && r.error && (
                      <span className="text-xs text-muted-foreground truncate">
                        - {r.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Botones de acción para resultados */}
            <div className="flex gap-2">
              {resultados.some(r => !r.success) && archivos.length > 0 && (
                <Button
                  variant="outline"
                  onClick={reintentarFallidos}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  Reintentar fallidos
                </Button>
              )}
              <Button
                variant="outline"
                onClick={limpiarTodo}
                disabled={isSubmitting}
                className="flex-1"
              >
                Limpiar todo
              </Button>
            </div>
          </div>
        )}

        {/* Botón enviar */}
        {archivos.length > 0 && resultados.length === 0 && (
          <Button
            onClick={enviarFacturas}
            disabled={archivos.length === 0 || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Enviar {archivos.length} documento{archivos.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
