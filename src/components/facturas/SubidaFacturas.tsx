import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, FileText, X, Send, Loader2, CheckCircle2, XCircle, Receipt, Package, AlertTriangle, FileWarning, Copy, Camera, FolderOpen, Layers, Replace } from "lucide-react";
import type { AlertaValidacion } from "@/hooks/useFacturas";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import {
  describirProgreso,
  esperarTrabajo,
  iniciarDocumentoLargo,
  planificarDocumento,
  SinDocumentosLargos,
  type Sustituible,
  sustituirExistente,
} from "@/lib/facturas/documentoLargo";
import { useTrabajosOcrEnCurso } from "@/hooks/useTrabajoOcr";
import { SustituirFacturaDialog } from "./SustituirFacturaDialog";

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
  /** Duplicado que se puede SUSTITUIR por el documento nuevo (ya leído). */
  sustituible?: Sustituible | null;
  /** Ya se ha sustituido la factura existente por este documento. */
  sustituida?: boolean;
  /** Documento largo leído por trozos (páginas o franjas). */
  piezas?: number;
}

/** Respuesta de procesar-factura (síncrona) o resultado de un trabajo → fila. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cuerpo JSON de la función, se valida campo a campo
function aResultado(nombre: string, data: any, piezas?: number): ResultadoProcesamiento {
  if (!data?.success) {
    return { nombre, success: false, error: data?.error || 'Error desconocido', piezas };
  }
  return {
    nombre,
    success: true,
    respuesta: data.webhookResponse,
    tipo: data.webhookResponse?.tipo || data.tipo,
    alertas: Array.isArray(data.alertas) ? data.alertas : [],
    archivoGuardado: data.duplicado === true ? undefined : data.archivo_guardado !== false,
    duplicado: data.duplicado === true,
    sustituible: data.sustituible ?? null,
    piezas,
  };
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
  // Segundo input solo para la cámara de la tablet/móvil (`capture`): abre la
  // cámara directamente en vez del selector de archivos.
  const camaraInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [aSustituir, setASustituir] = useState<{ indice: number; s: Sustituible } | null>(null);
  // Documentos largos que siguen en segundo plano (p. ej. si se cerró la pestaña).
  const { data: enCurso = [] } = useTrabajosOcrEnCurso();

  const confirmarSustitucion = async (s: Sustituible) => {
    const indice = aSustituir?.indice;
    try {
      const r = await sustituirExistente(s);
      toast.success("Factura sustituida", { description: r.message });
      if (indice !== undefined) {
        setResultados((prev) => prev.map((x, i) => (i === indice
          ? { ...x, duplicado: false, sustituida: true, sustituible: null, alertas: r.alertas as AlertaValidacion[] }
          : x)));
      }
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['albaranes'] });
      setASustituir(null);
    } catch (err) {
      toast.error("No se ha sustituido", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    // Se copia la lista ANTES de vaciar el input: `files` es una referencia viva
    // y al limpiar el input se vacía.

    const nuevosArchivos: ArchivoFactura[] = [];
    const nombresUsados = new Set(archivos.map((a) => a.nombre));

    // La cámara del iPad/móvil llama "image.jpg" a TODAS las fotos, y el resto
    // del flujo (resultados, reintentos, limpieza) identifica cada archivo por su
    // nombre: dos fotos seguidas se pisaban. Se les da un nombre único.
    const conNombreUnico = (file: File): File => {
      const punto = file.name.lastIndexOf('.');
      const ext = punto > 0 ? file.name.slice(punto) : '';
      const generico = /^image\.[a-z0-9]+$/i.test(file.name) || file.name === '';
      const base = generico
        ? `foto-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')}`
        : punto > 0 ? file.name.slice(0, punto) : file.name;
      let candidato = `${base}${ext}`;
      for (let n = 2; nombresUsados.has(candidato); n += 1) candidato = `${base}-${n}${ext}`;
      nombresUsados.add(candidato);
      return candidato === file.name ? file : new File([file], candidato, { type: file.type, lastModified: file.lastModified });
    };

    Array.from(files).forEach((original) => {
      const file = original;
      // Validar tipo de archivo
      const tiposPermitidos = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!tiposPermitidos.includes(file.type)) {
        toast.error("Tipo de archivo no permitido", {
          description: `El archivo ${file.name} no es un PDF o imagen válida`,
        });
        return;
      }

      // Validar tamaño (máximo 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Archivo demasiado grande", {
          description: `El archivo ${file.name} supera los 10MB`,
        });
        return;
      }

      const unico = conNombreUnico(file);
      nuevosArchivos.push({
        file: unico,
        preview: unico.type.startsWith('image/') ? URL.createObjectURL(unico) : '',
        nombre: unico.name,
      });
    });

    setArchivos(prev => [...prev, ...nuevosArchivos]);

    // Limpiar los inputs (permite volver a elegir el mismo archivo)
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (camaraInputRef.current) {
      camaraInputRef.current.value = '';
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
      toast.error("Sin archivos", {
        description: "Selecciona al menos un documento para enviar.",
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
      toast.error("Error de lectura", {
        description: "No se pudieron leer algunos archivos. Inténtelo de nuevo.",
      });
      setIsSubmitting(false);
      setProgreso({ total: 0, actual: 0, nombreActual: '' });
      return;
    }

    let completados = 0;

    // Procesar todos los archivos en paralelo con Promise.allSettled
    const resultadosSettled = await Promise.allSettled(
      archivosConBase64.map(async ({ archivo, base64 }) => {
        // Documento LARGO (imagen muy alta o PDF de varias páginas): se trocea
        // aquí y se lee en segundo plano por trozos. Automático, sin botón.
        // Si el servidor aún no lo admite, sigue por el camino de siempre.
        let plan: Awaited<ReturnType<typeof planificarDocumento>> = { camino: "unico" };
        try {
          plan = await planificarDocumento(archivo.file);
        } catch (err) {
          console.warn("[subida] no se pudo trocear, se envía entero:", err);
        }
        if (plan.camino === "largo") {
          try {
            const inicio = await iniciarDocumentoLargo(archivo.file, plan, (n, t) =>
              setProgreso((p) => ({ ...p, nombreActual: `${archivo.nombre}: subiendo trozo ${n} de ${t}…` })));
            const fin = await esperarTrabajo(inicio.trabajoId, (t) =>
              setProgreso((p) => ({ ...p, nombreActual: `${archivo.nombre}: ${describirProgreso(t)}` })));
            completados += 1;
            setProgreso({ total: archivos.length, actual: completados, nombreActual: `${completados} de ${archivos.length}` });
            if (fin.estado === 'fallido' || fin.estado === 'cancelado') {
              return { nombre: archivo.nombre, success: false, error: fin.error || 'No se pudo leer el documento', piezas: inicio.numPiezas } as ResultadoProcesamiento;
            }
            return aResultado(archivo.nombre, fin.resultado, inicio.numPiezas);
          } catch (err) {
            if (!(err instanceof SinDocumentosLargos)) throw err;
            console.warn("[subida] el servidor aún no admite documentos largos; camino de una página:", err.message);
          }
        }

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

        return aResultado(archivo.nombre, data);
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
      toast.error(`${exitosos.length} procesados, ${fallidos.length} fallidos`, {
        description: `Fallidos: ${fallidos.map(f => f.nombre).join(', ')}`,
      });
    } else if (fallidos.length > 0) {
      toast.error(`${fallidos.length} documento(s) fallaron`, {
        description: fallidos.map(f => f.nombre).join(', '),
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
      // Si todo lo subido ya existia no se ha creado nada: eso no es un
      // exito que celebrar, es un aviso neutro.
      if (duplicados > 0 && nuevos === 0) {
        toast("Documento(s) ya existente(s)", { description: partes.join('. ') + '.' });
      } else {
        toast.success("Todos los documentos procesados", { description: partes.join('. ') + '.' });
      }
    }

    // El original perdido es un fallo serio aunque los datos se hayan guardado.
    const sinArchivo = exitosos.filter(r => r.archivoGuardado === false);
    if (sinArchivo.length > 0) {
      toast.error(`No se ha podido archivar ${sinArchivo.length} original(es)`, {
        description: "Los datos estan guardados, pero el fichero original no. Guarda una copia a mano y avisa al administrador.",
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
            "border-2 border-dashed rounded-lg p-4 sm:p-8 text-center transition-all duration-200",
            isDragging
              ? "border-primary bg-primary/5 scale-[1.01] shadow-md"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
          ].join(" ")}
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
          <p className="text-sm text-muted-foreground mb-4">
            {isDragging ? "Suelta aquí para añadir" : "Haz una foto del documento o elige archivos de la galería o de Archivos"}
          </p>
          {/* Dos botones grandes en vez de una zona entera "clicable": en la tablet
              se toca, no se arrastra. El de la cámara usa `capture` para abrir la
              cámara trasera directamente; el otro admite PDF y varias imágenes. */}
          <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button
              type="button"
              className="h-12 gap-2 px-6 text-base"
              onClick={() => camaraInputRef.current?.click()}
              disabled={isSubmitting}
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              Hacer foto
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 gap-2 px-6 text-base"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
            >
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
              Elegir archivos
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            PDF, JPG, PNG o WEBP (máximo 10MB por archivo). En un ordenador también puedes arrastrarlos aquí.
          </p>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            aria-label="Elegir facturas o albaranes (PDF o imágenes)"
            onChange={handleFileChange}
          />
          <Input
            ref={camaraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Hacer una foto de la factura o albarán"
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

        {/* Documentos largos que siguen leyéndose en segundo plano */}
        {!isSubmitting && enCurso.length > 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm" role="status">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Leyendo en segundo plano
            </p>
            <ul className="mt-1 space-y-0.5 pl-6 text-xs text-muted-foreground">
              {enCurso.map((t) => (
                <li key={t.id}>{t.nombre_original}: {describirProgreso(t)}</li>
              ))}
            </ul>
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
                      className="h-14 w-14 shrink-0 object-cover rounded"
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 bg-primary/10 rounded flex items-center justify-center">
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
                    className="h-11 w-11 shrink-0"
                    onClick={() => eliminarArchivo(index)}
                    disabled={isSubmitting}
                    aria-label={`Quitar ${archivo.nombre}`}
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
            <div className="max-h-[50dvh] overflow-y-auto rounded-md border p-4">
              <div className="space-y-3">
                {resultados.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                      <span className="basis-full pl-6 text-xs text-muted-foreground break-words">
                        {r.error}
                      </span>
                    )}
                    {/* Los motivos van escritos en la propia fila: antes estaban solo en
                        un `title` (hover) y con el dedo no se podían leer. */}
                    {r.success && r.duplicado && (
                      <span className="basis-full pl-6 flex items-start gap-1 text-xs font-medium text-blue-600">
                        <Copy className="mt-0.5 h-3 w-3 shrink-0" />
                        {r.sustituible
                          ? `Ya existe la factura ${r.sustituible.existente.numero_documento} (${r.sustituible.existente.lineas} líneas): no se ha creado otra. Si la que hay está mal leída, puedes sustituirla por este documento.`
                          : 'Ya existía un documento con el mismo número, proveedor, fecha y total: no se ha creado uno nuevo.'}
                      </span>
                    )}
                    {r.success && r.duplicado && r.sustituible && (
                      <div className="basis-full pl-6">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 gap-2"
                          onClick={() => setASustituir({ indice: i, s: r.sustituible! })}
                        >
                          <Replace className="h-4 w-4" aria-hidden="true" />
                          Sustituir la existente
                        </Button>
                      </div>
                    )}
                    {r.success && r.sustituida && (
                      <span className="basis-full pl-6 flex items-start gap-1 text-xs font-medium text-green-700">
                        <Replace className="mt-0.5 h-3 w-3 shrink-0" /> Factura existente sustituida por este documento.
                      </span>
                    )}
                    {r.piezas && r.piezas > 1 && (
                      <span className="basis-full pl-6 flex items-start gap-1 text-xs text-muted-foreground">
                        <Layers className="mt-0.5 h-3 w-3 shrink-0" /> Documento largo: leído en {r.piezas} trozos y unido.
                      </span>
                    )}
                    {r.success && r.archivoGuardado === false && (
                      <span className="basis-full pl-6 flex items-start gap-1 text-xs font-medium text-destructive">
                        <FileWarning className="mt-0.5 h-3 w-3 shrink-0" /> Los datos se han guardado, pero el fichero original no se ha podido archivar.
                      </span>
                    )}
                    {r.success && (r.alertas?.length ?? 0) > 0 && (
                      <div className="basis-full pl-6 text-xs font-medium text-amber-600">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {r.alertas!.length} aviso{r.alertas!.length > 1 ? 's' : ''}
                        </span>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-8 font-normal">
                          {r.alertas!.map((a, j) => (
                            <li key={j}>{a.mensaje}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Botones de acción para resultados */}
            <div className="flex gap-2">
              {resultados.some(r => !r.success) && archivos.length > 0 && (
                <Button
                  variant="outline"
                  onClick={reintentarFallidos}
                  disabled={isSubmitting}
                  className="h-11 flex-1"
                >
                  Reintentar fallidos
                </Button>
              )}
              <Button
                variant="outline"
                onClick={limpiarTodo}
                disabled={isSubmitting}
                className="h-11 flex-1"
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
            className="h-12 w-full text-base"
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
      <SustituirFacturaDialog
        sustituible={aSustituir?.s ?? null}
        onCancelar={() => setASustituir(null)}
        onConfirmar={confirmarSustitucion}
      />
    </Card>
  );
}
