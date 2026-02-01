
## Plan: Chatbot de Facturas con Auto-Detección de Tipo

### Resumen
Transformar la sección de Facturas en una interfaz conversacional donde el usuario puede:
1. Subir documentos (se auto-detecta el tipo factura/albarán)
2. Chatear con un asistente IA sobre las facturas procesadas
3. Hacer preguntas como "¿Cuánto debo a tal proveedor?" o "Muéstrame las facturas de enero"

---

### Fase 1: Eliminar Selector de Tipo de Documento

**1.1 Modificar `SubidaFacturas.tsx`**
- Eliminar el estado `tipoDocumento` y todo el bloque del `Select`
- El payload enviará `tipo: "AUTO"` para que el backend/webhook detecte automáticamente

```tsx
// Antes
const payload = {
  tipo: tipoDocumento,
  archivos: archivosPayload,
  fecha: new Date().toISOString(),
};

// Después
const payload = {
  tipo: "AUTO", // El webhook detecta automáticamente
  archivos: archivosPayload,
  fecha: new Date().toISOString(),
};
```

---

### Fase 2: Crear Componente de Chat

**2.1 Crear `src/components/facturas/ChatFacturas.tsx`**

Interfaz de chat con:
- Lista de mensajes con scroll automático
- Campo de entrada de texto
- Indicador de "escribiendo..."
- Renderizado de respuestas con Markdown

```tsx
interface Mensaje {
  id: string;
  rol: "user" | "assistant";
  contenido: string;
  timestamp: Date;
}

export function ChatFacturas() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  // Enviar mensaje al webhook de chat
  const enviarMensaje = async () => {
    // Añadir mensaje del usuario
    // Llamar a edge function
    // Mostrar respuesta del asistente
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>💬 Asistente de Facturas</CardTitle>
        <CardDescription>
          Pregunta sobre tus facturas, proveedores o importes
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Área de mensajes */}
        <ScrollArea className="h-[400px]">
          {mensajes.map(msg => (
            <div key={msg.id} className={cn(
              "mb-4 p-3 rounded-lg",
              msg.rol === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-8"
            )}>
              <ReactMarkdown>{msg.contenido}</ReactMarkdown>
            </div>
          ))}
        </ScrollArea>
        
        {/* Input de mensaje */}
        <div className="flex gap-2 mt-4">
          <Textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta..."
            onKeyDown={handleEnter}
          />
          <Button onClick={enviarMensaje} disabled={isLoading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

### Fase 3: Edge Function para Chat

**3.1 Crear `supabase/functions/chat-facturas/index.ts`**

Nueva edge function que:
- Recibe el mensaje del usuario y el historial de conversación
- Envía la consulta al webhook de n8n
- Devuelve la respuesta del asistente

```typescript
const WEBHOOK_CHAT_URL = 'https://n8npersonal.miguelbenito.space/webhook/XXXXX'; // URL del webhook de chat

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { mensaje, historial } = await req.json();

  const response = await fetch(WEBHOOK_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mensaje,
      historial,
      timestamp: new Date().toISOString(),
    }),
  });

  const data = await response.json();
  
  return new Response(JSON.stringify({
    success: true,
    respuesta: data.text || data.message || data.response,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

---

### Fase 4: Actualizar Edge Function de Procesamiento

**4.1 Modificar `supabase/functions/procesar-factura/index.ts`**
- Eliminar la dependencia del campo `tipo`
- Enviar `tipo: "AUTO"` al webhook para que detecte automáticamente

---

### Fase 5: Integrar en Página de Facturas

**5.1 Modificar `src/pages/Facturas.tsx`**

Layout con dos columnas:
- Izquierda: Subida de documentos (simplificada sin selector)
- Derecha: Chat para consultar sobre facturas

```tsx
import { ChatFacturas } from "@/components/facturas/ChatFacturas";

const Facturas = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas</h1>
          <p className="text-muted-foreground">
            Sube facturas y albaranes, y consulta información con el asistente
          </p>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SubidaFacturas />
          <ChatFacturas />
        </div>
      </div>
    </DashboardLayout>
  );
};
```

---

### Fase 6: Instalar Dependencia para Markdown

**6.1 Añadir `react-markdown`**
- Para renderizar las respuestas del asistente con formato

```bash
npm install react-markdown
```

---

### Diagrama del Flujo

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  📁 FACTURAS                                                                 │
├──────────────────────────────────┬──────────────────────────────────────────┤
│  SUBIR DOCUMENTOS                │  💬 ASISTENTE DE FACTURAS                │
│                                  │                                          │
│  ┌────────────────────────────┐  │  ┌──────────────────────────────────────┐│
│  │ Arrastra tus facturas aquí │  │  │ 🤖 Hola, ¿en qué puedo ayudarte?     ││
│  │     📄  📄  📄              │  │  │                                      ││
│  └────────────────────────────┘  │  │ 👤 ¿Cuánto debo a Proveedor X?       ││
│                                  │  │                                      ││
│  📎 factura-enero.pdf    [x]    │  │ 🤖 Según tus facturas, debes          ││
│  📎 albaran-023.png      [x]    │  │    1,234.56€ a Proveedor X            ││
│                                  │  │                                      ││
│  [      Enviar documentos     ] │  └──────────────────────────────────────┘│
│                                  │                                          │
│                                  │  ┌──────────────────────────────┐  [↑]  │
│                                  │  │ Escribe tu pregunta...       │       │
│                                  │  └──────────────────────────────┘       │
└──────────────────────────────────┴──────────────────────────────────────────┘
```

---

### Archivos a Crear/Modificar

| Archivo | Acción |
|---------|--------|
| `src/components/facturas/SubidaFacturas.tsx` | Eliminar selector de tipo |
| `src/components/facturas/ChatFacturas.tsx` | **Crear** componente de chat |
| `supabase/functions/chat-facturas/index.ts` | **Crear** edge function |
| `supabase/functions/procesar-factura/index.ts` | Simplificar (quitar tipo) |
| `src/pages/Facturas.tsx` | Integrar chat + layout 2 columnas |
| `supabase/config.toml` | Añadir nueva función `chat-facturas` |
| `package.json` | Añadir `react-markdown` |

---

### Detalles Técnicos

**Webhook de Chat (n8n)**
Necesitaré que me proporciones la URL del webhook de n8n para el chat, o puedo usar una URL placeholder que luego puedas actualizar.

**Historial de Conversación**
El chat enviará el historial completo de mensajes al webhook para mantener contexto. Formato:
```json
{
  "mensaje": "¿Cuánto debo a Proveedor X?",
  "historial": [
    { "rol": "assistant", "contenido": "Hola, ¿en qué puedo ayudarte?" },
    { "rol": "user", "contenido": "¿Cuánto debo a Proveedor X?" }
  ]
}
```

**Auto-Scroll**
El chat hará scroll automático al último mensaje usando `useRef` y `scrollIntoView`.

**Estado Persistente**
Los mensajes se mantienen en estado local durante la sesión. Si se necesita persistencia entre sesiones, se puede añadir almacenamiento en base de datos posteriormente.
