
## Plan: Enviar Documentos Individualmente con Control de Errores

### Objetivo
Modificar el flujo de procesamiento para que cada documento se envíe por separado al webhook, permitiendo:
1. Procesar cada archivo de forma independiente
2. Esperar a que todos completen (éxito o fallo)
3. Identificar exactamente qué archivo(s) fallaron
4. Mostrar un resumen detallado del resultado

---

### Cambios en Edge Function

**Archivo: `supabase/functions/procesar-factura/index.ts`**

Modificar para procesar un solo archivo por petición:

```typescript
// Recibe UN solo archivo en lugar de un array
const payload = await req.json();

// Validar que viene un archivo
if (!payload.archivo?.contenido_base64) {
  throw new Error('No se recibió ningún archivo');
}

// Procesar solo ese archivo
const formData = new FormData();
formData.append('tipo', payload.tipo || 'AUTO');
formData.append('fecha', payload.fecha);

// Convertir base64 a blob
const binaryString = atob(payload.archivo.contenido_base64);
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < binaryString.length; i++) {
  bytes[i] = binaryString.charCodeAt(i);
}
const blob = new Blob([bytes.buffer], { type: payload.archivo.tipo });
formData.append('file', blob, payload.archivo.nombre);

// Enviar al webhook
const response = await fetch(WEBHOOK_URL, {
  method: 'POST',
  body: formData,
});

return new Response(JSON.stringify({
  success: true,
  nombre: payload.archivo.nombre,
  webhookResponse: await response.json(),
}));
```

---

### Cambios en Componente Frontend

**Archivo: `src/components/facturas/SubidaFacturas.tsx`**

Modificar `enviarFacturas` para enviar documentos uno a uno:

```typescript
interface ResultadoProcesamiento {
  nombre: string;
  success: boolean;
  error?: string;
  respuesta?: any;
}

const enviarFacturas = async () => {
  setIsSubmitting(true);
  setDatosExtraidos(null);
  
  const resultados: ResultadoProcesamiento[] = [];
  
  // Procesar cada archivo individualmente
  for (const archivo of archivos) {
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
        resultados.push({
          nombre: archivo.nombre,
          success: false,
          error: error?.message || data?.error || 'Error desconocido',
        });
      } else {
        resultados.push({
          nombre: archivo.nombre,
          success: true,
          respuesta: data.webhookResponse,
        });
      }
    } catch (err) {
      resultados.push({
        nombre: archivo.nombre,
        success: false,
        error: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  }
  
  // Analizar resultados
  const exitosos = resultados.filter(r => r.success);
  const fallidos = resultados.filter(r => !r.success);
  
  if (fallidos.length > 0) {
    toast({
      title: `${fallidos.length} documento(s) fallaron`,
      description: fallidos.map(f => f.nombre).join(', '),
      variant: "destructive",
    });
  }
  
  if (exitosos.length > 0) {
    toast({
      title: `${exitosos.length} documento(s) procesados`,
      description: exitosos.map(e => e.nombre).join(', '),
    });
    
    // Limpiar solo archivos exitosos
    setArchivos(prev => prev.filter(a => 
      fallidos.some(f => f.nombre === a.nombre)
    ));
  }
  
  setIsSubmitting(false);
};
```

---

### Mejoras en la UI

**Mostrar progreso por archivo:**

```tsx
// Nuevo estado para tracking de progreso
const [progreso, setProgreso] = useState<{
  total: number;
  actual: number;
  nombreActual: string;
}>({ total: 0, actual: 0, nombreActual: '' });

// Durante el procesamiento
{isSubmitting && progreso.total > 0 && (
  <div className="space-y-2">
    <p className="text-sm text-muted-foreground">
      Procesando {progreso.actual} de {progreso.total}: {progreso.nombreActual}
    </p>
    <Progress value={(progreso.actual / progreso.total) * 100} />
  </div>
)}
```

**Mostrar resultados individuales con badges de estado:**

```tsx
// En la sección de resultados
{resultados.map((r, i) => (
  <div key={i} className="flex items-center gap-2">
    {r.success ? (
      <CheckCircle2 className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    )}
    <span className={r.success ? "" : "text-destructive"}>
      {r.nombre}
    </span>
    {!r.success && (
      <span className="text-xs text-muted-foreground">
        - {r.error}
      </span>
    )}
  </div>
))}
```

---

### Flujo Visual

```text
┌─────────────────────────────────────────────────────────────┐
│  📄 factura-1.pdf    ✅ Procesado                           │
│  📄 albaran-23.png   ✅ Procesado                           │
│  📄 factura-2.pdf    ❌ Error: Timeout                      │
│  📄 ticket-45.jpg    ✅ Procesado                           │
├─────────────────────────────────────────────────────────────┤
│  Resumen: 3 exitosos, 1 fallido                             │
│                                                             │
│  [Reintentar fallidos]  [Limpiar todo]                      │
└─────────────────────────────────────────────────────────────┘
```

---

### Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/procesar-factura/index.ts` | Simplificar para recibir 1 archivo |
| `src/components/facturas/SubidaFacturas.tsx` | Loop individual + progreso + resultados detallados |

---

### Detalles Adicionales

**Timeout individual**: Cada petición tiene su propio timeout de 30s

**Orden de procesamiento**: Secuencial (uno tras otro) para no saturar el webhook

**Archivos que fallan**: Se mantienen en la lista para poder reintentarlos

**Archivos exitosos**: Se eliminan automáticamente de la lista
