# Segunda Base de Datos Supabase - Métricas, Incidencias e Instalaciones

## 📋 Resumen

Este proyecto ahora utiliza **dos bases de datos Supabase separadas**:

1. **Base de datos principal** (`jeamoczmbfsnwkfjxcyo`): Para reservas, espacios, usuarios, etc.
2. **Base de datos de métricas** (`yfnrkmxnmtrqmdtfvqix`): Para métricas, incidencias e instalaciones

## 🔧 Configuración

### Variables de Entorno

Asegúrate de tener las siguientes variables en tu archivo `.env`:

```env
# Base de datos principal
VITE_SUPABASE_PROJECT_ID="jeamoczmbfsnwkfjxcyo"
VITE_SUPABASE_PUBLISHABLE_KEY="..."
VITE_SUPABASE_URL="https://jeamoczmbfsnwkfjxcyo.supabase.co"

# Base de datos de métricas
VITE_SUPABASE_METRICS_PROJECT_ID="yfnrkmxnmtrqmdtfvqix"
VITE_SUPABASE_METRICS_URL="https://yfnrkmxnmtrqmdtfvqix.supabase.co"
VITE_SUPABASE_METRICS_PUBLISHABLE_KEY="TU_ANON_KEY_AQUI"
```

> [!IMPORTANT]
> Debes reemplazar `TU_ANON_KEY_AQUI` con la clave pública (anon key) real del proyecto `yfnrkmxnmtrqmdtfvqix`.
> 
> Puedes encontrar esta clave en:
> 1. Ve a [https://supabase.com/dashboard/project/yfnrkmxnmtrqmdtfvqix/settings/api](https://supabase.com/dashboard/project/yfnrkmxnmtrqmdtfvqix/settings/api)
> 2. Copia el valor de "anon public"

### Crear las Tablas en Supabase

Para crear las tablas en el proyecto `yfnrkmxnmtrqmdtfvqix`, ejecuta los siguientes scripts SQL en el editor SQL de Supabase:

1. Ve a [https://supabase.com/dashboard/project/yfnrkmxnmtrqmdtfvqix/editor](https://supabase.com/dashboard/project/yfnrkmxnmtrqmdtfvqix/editor)
2. Ejecuta los scripts en orden:
   - [001_create_metricas.sql](file:///Users/pablocandela/AdminPanelCT/adminpanelct/supabase/migrations/metrics/001_create_metricas.sql)
   - [002_create_incidencias.sql](file:///Users/pablocandela/AdminPanelCT/adminpanelct/supabase/migrations/metrics/002_create_incidencias.sql)
   - [003_create_instalaciones.sql](file:///Users/pablocandela/AdminPanelCT/adminpanelct/supabase/migrations/metrics/003_create_instalaciones.sql)

## 💻 Uso del Cliente

### Importar el Cliente

```typescript
// Para la base de datos principal
import { supabase } from "@/integrations/supabase/client";

// Para la base de datos de métricas
import { metricsClient } from "@/integrations/supabase/metricsClient";
```

### Ejemplos de Uso

#### Métricas

```typescript
import { metricsClient } from "@/integrations/supabase/metricsClient";

// Insertar una métrica
const { data, error } = await metricsClient
  .from('metricas')
  .insert({
    tipo: 'visitas',
    valor: 150,
    unidad: 'usuarios',
    fecha: new Date().toISOString(),
    entidad_tipo: 'espacio',
    entidad_id: 'abc-123',
    metadata: { origen: 'web', dispositivo: 'mobile' }
  });

// Consultar métricas
const { data: metricas } = await metricsClient
  .from('metricas')
  .select('*')
  .eq('tipo', 'visitas')
  .gte('fecha', '2026-01-01')
  .order('fecha', { ascending: false });
```

#### Incidencias

```typescript
import { metricsClient } from "@/integrations/supabase/metricsClient";

// Crear una incidencia
const { data, error } = await metricsClient
  .from('incidencias')
  .insert({
    titulo: 'Error en el sistema de reservas',
    descripcion: 'Los usuarios no pueden completar reservas',
    estado: 'abierta',
    prioridad: 'alta',
    tipo: 'tecnica',
    reportado_por: 'user-id-123',
    fecha_reporte: new Date().toISOString(),
    entidad_tipo: 'reserva',
    entidad_id: 'reserva-456'
  });

// Actualizar estado de incidencia
const { error: updateError } = await metricsClient
  .from('incidencias')
  .update({ 
    estado: 'resuelta',
    asignado_a: 'tecnico-id-789'
  })
  .eq('id', 'incidencia-id');

// Consultar incidencias abiertas
const { data: incidenciasAbiertas } = await metricsClient
  .from('incidencias')
  .select('*')
  .in('estado', ['abierta', 'en_progreso'])
  .order('prioridad', { ascending: false });
```

#### Instalaciones

```typescript
import { metricsClient } from "@/integrations/supabase/metricsClient";

// Crear una instalación
const { data, error } = await metricsClient
  .from('instalaciones')
  .insert({
    nombre: 'Instalación de sistema POS',
    tipo: 'hardware',
    ubicacion: 'Restaurante Centro',
    estado: 'planificada',
    fecha_planificada: '2026-02-15T10:00:00Z',
    tecnico_id: 'tecnico-123',
    cliente_id: 'cliente-456',
    equipos: [
      { tipo: 'terminal', modelo: 'POS-2000', cantidad: 2 },
      { tipo: 'impresora', modelo: 'TH-80', cantidad: 1 }
    ],
    notas: 'Requiere configuración de red'
  });

// Marcar instalación como completada
const { error: updateError } = await metricsClient
  .from('instalaciones')
  .update({ estado: 'completada' })
  .eq('id', 'instalacion-id');
// Nota: fecha_instalacion se establece automáticamente

// Consultar instalaciones pendientes
const { data: pendientes } = await metricsClient
  .from('instalaciones')
  .select('*')
  .in('estado', ['planificada', 'en_progreso'])
  .order('fecha_planificada', { ascending: true });
```

## 📊 Estructura de las Tablas

### Tabla: metricas

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único (generado automáticamente) |
| `tipo` | TEXT | Tipo de métrica (ej: 'visitas', 'ventas', 'rendimiento') |
| `valor` | NUMERIC | Valor numérico de la métrica |
| `unidad` | TEXT | Unidad de medida (ej: 'euros', 'unidades', 'ms') |
| `fecha` | TIMESTAMPTZ | Fecha de la métrica |
| `usuario_id` | UUID | ID del usuario relacionado (opcional) |
| `entidad_tipo` | TEXT | Tipo de entidad relacionada (opcional) |
| `entidad_id` | TEXT | ID de la entidad relacionada (opcional) |
| `metadata` | JSONB | Datos adicionales en formato JSON |
| `created_at` | TIMESTAMPTZ | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | Fecha de última actualización |

### Tabla: incidencias

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único (generado automáticamente) |
| `titulo` | TEXT | Título breve de la incidencia |
| `descripcion` | TEXT | Descripción detallada |
| `estado` | TEXT | Estado: 'abierta', 'en_progreso', 'resuelta', 'cerrada' |
| `prioridad` | TEXT | Prioridad: 'baja', 'media', 'alta', 'critica' |
| `tipo` | TEXT | Tipo de incidencia (opcional) |
| `reportado_por` | UUID | ID del usuario que reportó (opcional) |
| `asignado_a` | UUID | ID del usuario asignado (opcional) |
| `entidad_tipo` | TEXT | Tipo de entidad relacionada (opcional) |
| `entidad_id` | TEXT | ID de la entidad relacionada (opcional) |
| `fecha_reporte` | TIMESTAMPTZ | Fecha del reporte |
| `fecha_resolucion` | TIMESTAMPTZ | Fecha de resolución (se establece automáticamente) |
| `metadata` | JSONB | Datos adicionales en formato JSON |
| `created_at` | TIMESTAMPTZ | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | Fecha de última actualización |

### Tabla: instalaciones

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único (generado automáticamente) |
| `nombre` | TEXT | Nombre descriptivo de la instalación |
| `tipo` | TEXT | Tipo: 'hardware', 'software', 'infraestructura', etc. |
| `ubicacion` | TEXT | Ubicación física o lógica (opcional) |
| `estado` | TEXT | Estado: 'planificada', 'en_progreso', 'completada', 'cancelada' |
| `fecha_planificada` | TIMESTAMPTZ | Fecha planificada |
| `fecha_instalacion` | TIMESTAMPTZ | Fecha real (se establece automáticamente al completar) |
| `tecnico_id` | UUID | ID del técnico responsable (opcional) |
| `cliente_id` | UUID | ID del cliente (opcional) |
| `equipos` | JSONB | Lista de equipos instalados en formato JSON |
| `notas` | TEXT | Notas adicionales (opcional) |
| `metadata` | JSONB | Datos adicionales en formato JSON |
| `created_at` | TIMESTAMPTZ | Fecha de creación |
| `updated_at` | TIMESTAMPTZ | Fecha de última actualización |

## 🔒 Seguridad

Todas las tablas tienen **Row Level Security (RLS)** habilitado con políticas que permiten:
- ✅ Lectura para usuarios autenticados
- ✅ Inserción para usuarios autenticados
- ✅ Actualización para usuarios autenticados

> [!WARNING]
> Puedes necesitar ajustar las políticas de RLS según tus requisitos de seguridad específicos.

## 🚀 Características Automáticas

### Triggers Implementados

1. **Auto-actualización de `updated_at`**: Se actualiza automáticamente en todas las tablas
2. **Auto-establecimiento de `fecha_resolucion`**: En incidencias cuando cambia a 'resuelta' o 'cerrada'
3. **Auto-establecimiento de `fecha_instalacion`**: En instalaciones cuando cambia a 'completada'

### Índices Optimizados

Todas las tablas tienen índices en los campos más consultados para mejorar el rendimiento.

## 📁 Archivos Relacionados

- [metricsClient.ts](file:///Users/pablocandela/AdminPanelCT/adminpanelct/src/integrations/supabase/metricsClient.ts) - Cliente Supabase para métricas
- [metricsTypes.ts](file:///Users/pablocandela/AdminPanelCT/adminpanelct/src/integrations/supabase/metricsTypes.ts) - Tipos TypeScript
- [Migraciones SQL](file:///Users/pablocandela/AdminPanelCT/adminpanelct/supabase/migrations/metrics/) - Scripts de creación de tablas
