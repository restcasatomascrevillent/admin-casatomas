# ✅ Configuración Final: Google Drive Link en Facturas

## 📊 **ESTRUCTURA DE BASE DE DATOS**

### **Tabla: `facturas`**

Solo se agregó **1 campo nuevo**:

```sql
drive_url TEXT NULL  -- URL del documento en Google Drive
```

**Campos existentes** (sin cambios):
- `id`, `tipo`, `numero_documento`, `proveedor`, `cif`
- `fecha`, `subtotal`, `iva`, `total`
- `observaciones`, `procesado_en`, `created_at`, `updated_at`

---

## 🔧 **CONFIGURACIÓN N8N**

### **Flujo Recomendado:**

```
1. Webhook (recibe archivo)
   ↓
2. OCR/Procesamiento
   ↓
3. Insertar Factura en Supabase (sin drive_url)
   ↓
4. Upload file a Google Drive (conectado directo desde Webhook)
   ↓
5. UPDATE Factura con drive_url
   ↓
6. Insertar Productos
   ↓
7. Respond to Webhook
```

---

### **Nodo 4: Upload file**

```
Resource: File
Operation: Upload

Input Data Field Name: file
File Name: factura_{{ $now.format('YYYY-MM-DD_HHmmss') }}.pdf
Parent Folder: By ID → [ID de tu carpeta]

Options:
  ✅ Resolve Data: true  ← IMPORTANTE
```

---

### **Nodo 5: UPDATE Factura**

```
Resource: Row
Operation: Update
Table: facturas

Filter:
  Column: id
  Operator: equals
  Value: {{ $('Insertar Factura').item.json[0].id }}

Fields to Update:
  drive_url: {{ $('Upload file').item.json.webViewLink }}
```

---

## 💻 **CÓDIGO TYPESCRIPT**

### **Interfaz actualizada:**

```typescript
export interface Factura {
  id: number;
  tipo: string;
  numero_documento: string;
  proveedor: string | null;
  cif: string | null;
  fecha: string;
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  observaciones: string | null;
  productos: ProductoFactura[];
  drive_url: string | null;  // ← NUEVO
}
```

---

## 🎨 **USO EN EL ADMIN PANEL**

### **Mostrar enlace en la tabla:**

```tsx
{factura.drive_url && (
  <a 
    href={factura.drive_url} 
    target="_blank" 
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
  >
    <FileText className="h-4 w-4" />
    Ver Documento
  </a>
)}
```

---

## ✅ **VERIFICACIÓN**

Después de procesar una factura:

```sql
SELECT 
  numero_documento,
  proveedor,
  total,
  drive_url
FROM facturas
WHERE drive_url IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
```

**Resultado esperado:**
```
numero_documento | proveedor  | total  | drive_url
-----------------|------------|--------|----------------------------------
4305_FLOPE...    | FRIO S.A.  | 982.50 | https://drive.google.com/file/...
```

---

## 🚀 **PRÓXIMOS PASOS**

1. ✅ Configurar el nodo "Upload file" en n8n
2. ✅ Agregar el nodo UPDATE después de la inserción
3. ✅ Probar con un documento de prueba
4. ⏳ Actualizar `TablaFacturas.tsx` para mostrar el botón "Ver Documento"

---

**Estado:** ✅ Base de datos lista, tipos TypeScript actualizados
