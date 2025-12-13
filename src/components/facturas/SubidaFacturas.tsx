import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, X, Send, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ArchivoFactura {
  file: File;
  preview: string;
  nombre: string;
}

interface DatosExtraidos {
  success: boolean;
  archivos: string[];
  datos: Record<string, unknown> | Record<string, unknown>[];
  timestamp: string;
  rawResponse?: unknown;
}

export function SubidaFacturas() {
  const [archivos, setArchivos] = useState<ArchivoFactura[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [instruccionesExtraccion, setInstruccionesExtraccion] = useState("");
  const [datosExtraidos, setDatosExtraidos] = useState<DatosExtraidos | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);
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
    setDatosExtraidos(null);

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
        instrucciones: instruccionesExtraccion.trim() || "Extraer todos los datos relevantes de la factura",
      };

      const nombresArchivos = archivos.map(a => a.nombre);

      const { data, error } = await supabase.functions.invoke('procesar-factura', {
        body: payload,
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('Facturas enviadas:', data);

      // Verificar si el webhook respondió correctamente
      if (data?.success) {
        // Guardar los datos extraídos para mostrarlos
        setDatosExtraidos({
          success: true,
          archivos: nombresArchivos,
          datos: data.webhookResponse || {},
          timestamp: new Date().toISOString(),
          rawResponse: data,
        });

        toast({
          title: "Facturas procesadas",
          description: data.webhookResponse?.message || `Se han procesado ${archivos.length} factura(s) correctamente`,
        });

        // Limpiar archivos e instrucciones solo si fue exitoso
        archivos.forEach(a => {
          if (a.preview) URL.revokeObjectURL(a.preview);
        });
        setArchivos([]);
        setInstruccionesExtraccion("");
      } else {
        throw new Error(data?.error || "Error al procesar las facturas");
      }

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

  const renderDatosExtraidos = (datos: unknown, nivel = 0): React.ReactNode => {
    if (datos === null || datos === undefined) {
      return <span className="text-muted-foreground italic">Sin datos</span>;
    }

    if (typeof datos === 'string' || typeof datos === 'number' || typeof datos === 'boolean') {
      return <span className="text-foreground">{String(datos)}</span>;
    }

    if (Array.isArray(datos)) {
      if (datos.length === 0) {
        return <span className="text-muted-foreground italic">Lista vacía</span>;
      }
      return (
        <div className="space-y-2">
          {datos.map((item, index) => (
            <div key={index} className="pl-3 border-l-2 border-muted">
              <span className="text-xs text-muted-foreground">#{index + 1}</span>
              <div>{renderDatosExtraidos(item, nivel + 1)}</div>
            </div>
          ))}
        </div>
      );
    }

    if (typeof datos === 'object') {
      const entries = Object.entries(datos as Record<string, unknown>);
      if (entries.length === 0) {
        return <span className="text-muted-foreground italic">Objeto vacío</span>;
      }
      return (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className={nivel > 0 ? "pl-3" : ""}>
              <span className="font-medium text-primary capitalize">{key.replace(/_/g, ' ')}: </span>
              {typeof value === 'object' ? (
                <div className="mt-1">{renderDatosExtraidos(value, nivel + 1)}</div>
              ) : (
                renderDatosExtraidos(value, nivel + 1)
              )}
            </div>
          ))}
        </div>
      );
    }

    return <span>{String(datos)}</span>;
  };

  return (
    <div className="space-y-6">
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

          {/* Campo de instrucciones de extracción */}
          <div className="space-y-2">
            <Label htmlFor="instrucciones">¿Qué datos quieres extraer?</Label>
            <Textarea
              id="instrucciones"
              placeholder="Ej: Extraer nombre del proveedor, CIF, fecha, importe total, IVA, productos con sus precios..."
              value={instruccionesExtraccion}
              onChange={(e) => setInstruccionesExtraccion(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[80px]"
            />
            <p className="text-xs text-muted-foreground">
              Describe qué información necesitas extraer de las facturas
            </p>
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
                Procesando...
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

      {/* Resultados de extracción */}
      {datosExtraidos && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {datosExtraidos.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              Datos Extraídos
            </CardTitle>
            <CardDescription className="flex items-center gap-2 flex-wrap">
              <span>Procesado: {new Date(datosExtraidos.timestamp).toLocaleString('es-ES')}</span>
              <span className="text-muted-foreground">•</span>
              <div className="flex gap-1 flex-wrap">
                {datosExtraidos.archivos.map((nombre, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {nombre}
                  </Badge>
                ))}
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScrollArea className="h-[400px] rounded-md border p-4">
              {renderDatosExtraidos(datosExtraidos.datos)}
            </ScrollArea>

            {/* Mostrar respuesta raw (colapsable) */}
            <Collapsible open={showRawResponse} onOpenChange={setShowRawResponse}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="text-xs text-muted-foreground">Ver respuesta completa (JSON)</span>
                  {showRawResponse ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-[200px] mt-2">
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                    {JSON.stringify(datosExtraidos.rawResponse, null, 2)}
                  </pre>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>

            <Button 
              variant="outline" 
              onClick={() => setDatosExtraidos(null)}
              className="w-full"
            >
              Limpiar resultados
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}