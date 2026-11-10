# Tipos de usuario «Reservas» y «Albaranes»

Petición del dueño (10/11/2026): «Crear usuarios de Reservas (solo crear y ver reservas) usuario albaranes solo subida fotos».

## Cómo se crean

**Usuarios → Crear usuario → Configuración de acceso → Tipos de usuario**, y elegir **Reservas** o **Albaranes**. En el diálogo **Permisos** de un usuario existente está el mismo desplegable. Los dos tipos van en el código (no se pueden borrar como los roles preconfigurados) y rellenan estos permisos:

| Tipo | Permisos | Al entrar va a |
|---|---|---|
| **Reservas** | «Ver» en Reservas + «Reservas · Crear» (*Puede crear*) | Reservas |
| **Albaranes** | solo «Facturas · Solo fotos (albaranes)» (*Puede subir fotos*) | Subir albaranes (`/albaranes`) |

En la lista de usuarios salen con la etiqueta «Tipo: Reservas» o «Tipo: Albaranes». Los dos son rol Staff. Los dos permisos nuevos también se pueden dar sueltos a cualquier usuario (p. ej. «Reservas · Crear» a un camarero que ya ve Reservas).

## Qué puede hacer cada uno

**Reservas**
- Ve toda la sección Reservas (Hoy, Lista, Calendario, Próximas, Blacklist), como con «Ver».
- **Nueva reserva**: la crea como el formulario del panel (nace *verificada*, o *pendiente* si el cliente está en la lista negra; con email, el cliente recibe «Confirma tu reserva»).
- **No** puede: modificar ni cancelar reservas, **cambiar su estado (tampoco «Ha llegado»)**, dar mesa, cerrar la sala para un evento, cerrar días, tocar la lista negra, convertir solicitudes del asistente ni entrar en Configuración. Arriba sale la etiqueta «Solo ver y crear».

**Albaranes**
- Una sola pantalla, pensada para el móvil: **Hacer foto** (abre la cámara trasera) y **Elegir fotos o PDF** (varias a la vez). Cada foto se lee sola, como en Facturas › Cargar.
- Ve *Mis últimas subidas* (14 días) con su estado: Leyendo, Recibido, Ya estaba subido, No se pudo leer.
- **No** ve lo leído, ni importes, ni Análisis, Compras o Cargar, ni ninguna otra sección. Los documentos los revisa la oficina en Facturas, como siempre.
- Si sube un documento que ya existía («Ya estaba subido»), no decide nada: no se guarda otra vez.

## Quién lo hace cumplir

La base de datos, no solo el menú (migración `supabase/migrations/20261122143000_usuarios_reservas_albaranes.sql`, con su vuelta atrás en `supabase/rollbacks/`):

- `reservas`: política nueva `reservas_insert_crear` con `reservas_puede_crear()` («Editar», o «Ver» + «Reservas · Crear») y un trigger que, sin «Editar», solo deja dar de alta como el formulario (estado pendiente/verificada; canal manual, teléfono o presencial; sin solicitud, llegada, salida, «importante», mesa fijada ni email verificado). Modificar y borrar siguen exigiendo «Editar».
- Storage `facturas-originales`: subir a `pendientes/{su uid}/` con `facturas_puede_subir_fotos()`; el de albaranes solo relee sus propias fotos pendientes.
- `albaranes_mis_subidas()`: lo único que ve el de albaranes de sus subidas (nombre, estado, páginas, fechas).
- Facturas, líneas, trabajos de lectura (con el resultado), historial de precios y chat **no cambian**: el de albaranes no tiene ninguna de sus políticas.
- Función `procesar-factura`: con solo «Solo fotos» acepta únicamente crear el trabajo (`modo: "iniciar"`, que no devuelve datos); sustituir, añadir página y el camino síncrono (que devuelve lo leído) dan 403.

Pruebas: `npm run test:usuarios-reservas-albaranes:db` (PGlite) y los tests de vitest de `tiposUsuario`, `albaranes`, `Albaranes`, `TiposUsuarioAcceso`, `Reservas.configuracion`, `FormularioReserva`, `InvitarUsuario` y `facturas-permisos-subida`.

## Aplicar

1. Demo: la migración (`supabase db query --linked -f …`, debe terminar en «usuarios_reservas_albaranes: aplicada») y desplegar `procesar-factura`.
2. Producción, solo tras aceptar el PR de la release y con el «sí» del dueño: lo mismo, a la vez que se publica el panel. Necesita antes `20261106510000_permisos_facturas_subida` (la migración lo comprueba y, si falta, se para sin cambiar nada).
