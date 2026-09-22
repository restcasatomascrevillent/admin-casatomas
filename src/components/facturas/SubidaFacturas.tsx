import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, X, Send, Loader2, CheckCircle2, XCircle, Receipt, Package, AlertTriangle, FileWarning, Copy } from "lucide-react";
import type { AlertaValidacion } from "@/hooks/useFacturas";
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
  /** Avisos de cordura de importes devueltos por procesar-factura (T5). */
  alertas?: AlertaValidacion[];
  /**
   * `false` = el documento se guardo en base de datos pero el PDF/imagen
   * original NO se pudo archivar ni en Drive ni en Storage. Es perdida de
   * datos y el usuario tiene que verlo, no solo los logs de la funcion.
   */
  archivoGuardado?: boolean;
  /**
   * `true` = `procesar-factura` reconocio el documento como ya existente
   * (mismo numero+proveedor+fecha+total) y NO lo volvio a insertar. Sin este
   * campo la fila se pintaba con el mismo check verde que un documento
   * nuevo: parecia "procesado" cuando en realidad no se habia creado nada.
   */
  duplicado?: boolean;
}

export function SubidaFacturas() {
  const [archivos, setArchivos] = useState<ArchivoFactura[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resultados, setResultados] = useState<ResultadoProcesamiento[]>([]);
  const [progreso, setProgreso] = useState<{
    total: number;
    actual: number;
    nombreActual: string;
  }>({ total: 0, actual: 0, nombreActual: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    setProgreso({ total: archivos.length, actual: 0, nombreActual: 'Preparando archivos…' });

    // Convertir todos los archivos a base64 en paralelo
    let archivosConBase64: { archivo: ArchivoFactura; base64: string }[];
    try {
      archivosConBase64 = await Promise.all(
        archivos.map(async (archivo) => ({
          archivo,
          base64: await convertirABase64(archivo.file),
        }))
      );
    } catch (err) {
      console.error("Error convirtiendo archivos a base64:", err);
      toast({
        title: "Error de lectura",
        description: "No se pudieron leer algunos archivos. Inténtelo de nuevo.",
        variant: "destructive",
      });
      setIsSubmitting(false);
      setProgreso({ total: 0, actual: 0, nombreActual: '' });
      return;
    }

    let completados = 0;

    // Procesar todos los archivos en paralelo con Promise.allSettled
    const resultadosSettled = await Promise.allSettled(
      archivosConBase64.map(async ({ archivo, base64 }) => {
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

        // Actualizar contador de progreso en tiempo real
        completados += 1;
        setProgreso({
          total: archivos.length,
          actual: completados,
          nombreActual: `${completados} de ${archivos.length}`,
        });

        if (error || !data?.success) {
          return {
            nombre: archivo.nombre,
            success: false,
            error: error?.message || data?.error || 'Error desconocido',
          } as ResultadoProcesamiento;
        }

        return {
          nombre: archivo.nombre,
          success: true,
          respuesta: data.webhookResponse,
          tipo: data.webhookResponse?.tipo || data.tipo,
          alertas: Array.isArray(data.alertas) ? data.alertas : [],
          archivoGuardado: data.archivo_guardado !== false,
          duplicado: data.duplicado === true,
        } as ResultadoProcesamiento;
      })
    );

    // Extraer resultados de Promise.allSettled
    const nuevosResultados: ResultadoProcesamiento[] = resultadosSettled.map((res, i) => {
      if (res.status === 'fulfilled') return res.value;
      return {
        nombre: archivos[i].nombre,
        success: false,
        error: res.reason instanceof Error ? res.reason.message : 'Error desconocido',
      };
    });

    setResultados(nuevosResultados);

    // Analizar resultados
    const exitosos = nuevosResultados.filter(r => r.success);
    const fallidos = nuevosResultados.filter(r => !r.success);

    // Refrescar tablas si hay documentos procesados correctamente
    if (exitosos.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['albaranes'] });
    }

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
      const conAlertas = exitosos.filter(r => (r.alertas?.length ?? 0) > 0).length;
      // Un duplicado no crea ningun documento nuevo: si se cuenta como
      // "procesado" sin distincion, la confirmacion dice que se guardo algo
      // que en realidad ya existia y se descarto.
      const duplicados = exitosos.filter(r => r.duplicado).length;
      const nuevos = exitosos.length - duplicados;
      const partes: string[] = [];
      if (nuevos > 0) partes.push(`${nuevos} documento(s) nuevo(s) procesado(s)`);
      if (duplicados > 0) partes.push(`${duplicados} ya existian (no se han duplicado)`);
      if (conAlertas > 0) partes.push(`${conAlertas} con importes que conviene revisar`);
      toast({
        title: duplicados > 0 && nuevos === 0
          ? "Documento(s) ya existente(s)"
          : "Todos los documentos procesados",
        description: partes.join('. ') + '.',
      });
    }

    // El original perdido es un fallo serio aunque los datos se hayan guardado.
    const sinArchivo = exitosos.filter(r => r.archivoGuardado === false);
    if (sinArchivo.length > 0) {
      toast({
        title: `No se ha podido archivar ${sinArchivo.length} original(es)`,
        description: "Los datos estan guardados, pero el fichero original no. Guarda una copia a mano y avisa al administrador.",
        variant: "destructive",
      });
    }

    // Limpiar solo archivos exitosos
    if (exitosos.length > 0) {
      setArchivos(prev => {
        const archivosRestantes = prev.filter(a =>
          fallidos.some(f => f.nombre === a.nombre)
        );
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
      <CardContent className="space-y-4 sm:space-y-6 px-3 sm:px-6">
        {/* Zona de carga */}
        <div
          className={[
            "border-2 border-dashed rounded-lg p-4 sm:p-8 text-center cursor-pointer transition-all duration-200",
            isDragging
              ? "border-primary bg-primary/5 scale-[1.01] shadow-md"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
          ].join(" ")}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            const files = e.dataTransfer.files;
            if (files.length > 0 && fileInputRef.current) {
              const dt = new DataTransfer();
              Array.from(files).forEach(f => dt.items.add(f));
              fileInputRef.current.files = dt.files;
              handleFileChange({ target: { files: dt.files } } as React.ChangeEvent<HTMLInputElement>);
            }
          }}
        >
          <Upload
            className={[
              "h-10 w-10 mx-auto mb-4 transition-all duration-200",
              isDragging ? "text-primary scale-110" : "text-muted-foreground",
            ].join(" ")}
          />
          <p className="text-sm text-muted-foreground mb-2">
            {isDragging ? "Suelta aquí para añadir" : "Arrastra tus facturas o albaranes aquí o haz clic para seleccionar"}
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
                    {!r.success ? (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    ) : r.duplicado ? (
                      // Icono distinto a proposito: un check verde aqui daria a entender
                      // que se creo un documento nuevo, y no es el caso.
                      <Copy className="h-4 w-4 text-blue-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
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
                    {r.success && r.duplicado && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600"
                        title="Ya existia un documento con el mismo numero, proveedor, fecha y total: no se ha creado uno nuevo"
                      >
                        <Copy className="h-3 w-3" /> ya existía
                      </span>
                    )}
                    {r.success && r.archivoGuardado === false && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive"
                        title="Los datos se han guardado, pero el fichero original no se ha podido archivar"
                      >
                        <FileWarning className="h-3 w-3" /> sin archivar
                      </span>
                    )}
                    {r.success && (r.alertas?.length ?? 0) > 0 && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600"
                        title={r.alertas!.map(a => `· ${a.mensaje}`).join("\n")}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {r.alertas!.length} aviso{r.alertas!.length > 1 ? 's' : ''}
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
