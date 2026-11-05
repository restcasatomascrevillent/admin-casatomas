# Instagram: IA de textos (fase 1)

Al crear una pieza, el botón **«Proponer 3 textos»** pide a la IA tres propuestas con la voz de la marca. Cada una trae el texto (caption), los hashtags y el texto alternativo para personas ciegas. Si se quiere, también propone **rótulos** para la plantilla: antetítulo, titular, CTA y pie.

**Lo hace una persona.** La IA solo propone. Al elegir una propuesta se rellena el texto y nada más. No publica ni programa; eso sigue siendo el clic de siempre.

Diseño: `instagram-studio/propuesta/PROPUESTA.md`, apartados 3.1-3.6 y fila «1» del apartado 7. Las acciones `ideas_semana` y `proponer_campana` son de la fase 2: [instagram-campanas.md](instagram-campanas.md).

## Piezas

| Pieza | Dónde |
|---|---|
| Edge Function | `supabase/functions/instagram-ia/`: `index.ts` (envoltorio de auditoría), `ia.ts` (lógica y contrato), `prompts.ts` (prompts y esquemas JSON) y `plantillas.ts` (copia de los campos y límites de las plantillas) |
| Validadores | `supabase/functions/_shared/instagram/validar-ia.ts` (lógica pura) |
| Migración | `supabase/migrations/20261108000000_instagram_ia.sql`; rollback en `supabase/rollbacks/20261108000000_instagram_ia_ROLLBACK.sql` |
| Panel | `src/components/instagram/ia/`: `SugerirTextoIA.tsx` (componente) y `api.ts` (llamadas) |
| Pruebas | `supabase/functions/instagram-ia/__tests__/` (función, validadores y plantillas), `src/components/instagram/ia/__tests__/` (componente) y `scripts/test-instagram-ia.mjs` (PGlite) |

## Integrarlo en «Crear»

El componente no toca nada de `src/components/marketing/instagram/*`. Recibe el contexto de la pieza y devuelve lo elegido:

```tsx
import { SugerirTextoIA } from "@/components/instagram/ia";

<SugerirTextoIA
  contexto={{
    marca: borrador.marca,            // "casa-tomas" | "touza"
    formato: borrador.formato,        // "post" | "story"
    plantilla: borrador.plantilla,    // p. ej. "ct-foto-titular"
    foto: borrador.foto,              // si es "carta:<id>", usa ese plato
    platoId: null,                    // opcional; si no, se saca de la foto
    piezaId: piezaGuardada?.id,       // opcional; para el registro y el coste
    textos: { antetitulo, titular, cita, cta, pie }, // lo que ya lleve la pieza
  }}
  onElegir={(caption, hashtags, altText) => {
    // Rellenar el formulario: caption + hashtags (unidos con espacios al final
    // del texto, o en su propio campo) y el texto alternativo.
  }}
  onElegirRotulos={(rotulos) => {
    // Opcional. Solo trae los campos que usa la plantilla:
    // { antetitulo?, titular?, cita?, cta?, pie? }
  }}
/>
```

- Tono: **Cercano**, **Elegante** o **Con retranca**.
- Indicaciones libres: hasta 500 caracteres. El servidor quita correos, teléfonos, DNI/NIE e IBAN antes de enviarlas o guardarlas.
- «Añadir el precio de la carta» sale solo si la foto es de la carta. El precio lo pone el **servidor** desde `Platos.precio_eur`, con el formato `22,5 € / ración`.
- Los hashtags se pueden quitar uno a uno (la «x» de cada chip) antes de elegir.
- Se ven los avisos (lo que el servidor corrigió) y las propuestas descartadas con su motivo.
- Estados de carga y error. Con 422, 502 o 503 hay «Reintentar»; con el cupo agotado o sin permiso, no.
- Al elegir, se anota en `instagram_sugerencias_ia` (`aceptada`, `variante_elegida`). Si falla, la elección sigue adelante.

## Contrato de la función

`POST /functions/v1/instagram-ia` con `Authorization: Bearer <JWT del panel>`. Hace falta **Marketing en edición** (`can_write_section('marketing')`).

```jsonc
{
  "accion": "sugerir_texto",          // o "sugerir_rotulos"
  "marca": "casa-tomas",              // o "touza"
  "formato": "post",                  // o "story"
  "plantilla": "ct-foto-titular",     // de la marca
  "tono": "cercano",                  // "elegante" | "retranca"; por defecto cercano
  "indicaciones": "Que se note el otoño",
  "foto": "carta:pulpo-feira",        // o "platoId": "pulpo-feira"
  "piezaId": "<uuid>",                // opcional
  "textos": { "titular": "El pulpo de casa" },
  "incluirPrecio": false              // solo sugerir_texto
}
```

Respuesta 200 de `sugerir_texto`:

```jsonc
{ "ok": true, "accion": "sugerir_texto", "sugerenciaId": "<uuid|null>", "modelo": "gpt-5.6-luna",
  "versionGuia": 1, "plato": { "id": "…", "nombre": "…" },
  "variantes": [{ "gancho": "…", "caption": "…", "hashtags": ["#…"], "altText": "…",
                  "platosCitados": ["…"], "avisos": ["Se han quitado los emoji…"] }],
  "descartadas": [{ "motivos": ["Precio que no viene de la carta (15 €)…"] }],
  "avisos": [] }
```

En `sugerir_rotulos`, cada variante es `{ antetitulo?, titular?, cita?, cta?, pie?, avisos[] }`.

| Código | Cuándo |
|---|---|
| 400 | Entrada mal: acción, marca, plantilla de otra marca, tono, ids o indicaciones de más de 500 caracteres |
| 401 / 403 | Sin sesión / sin Marketing en edición |
| 422 | Ninguna propuesta pasó los validadores, ni al segundo intento. Trae `descartadas` |
| 429 | Cupo diario agotado (100 por usuario y día, UTC; se cambia con `INSTAGRAM_IA_CUPO_DIARIO`) |
| 502 | OpenAI falló (con el motivo legible de `motivoErrorOpenAI`, p. ej. «sin saldo») o la base de datos no respondió |
| 503 | Falta `OPENAI_API_KEY`, la migración o la guía de la marca |

### Qué recibe el modelo

Recibe solo esto, como **datos** en un bloque JSON delimitado (`<<<DATOS … DATOS>>>`):

- la guía de `instagram_guias_marca`;
- el plato de la foto, si es de la carta, está activo y es de la marca: nombre, categoría, descripción (400 caracteres como mucho), alérgenos oficiales y `sin_gluten_disponible`. **El precio no**;
- los nombres de la carta activa de la marca (300 como mucho);
- la plantilla y los textos de la pieza;
- el tono y las indicaciones, ya anonimizadas.

**No recibe nunca** reservas, clientes, teléfonos, correos, facturas ni conversaciones. Tampoco el precio, para que no lo escriba.

### Validadores en el servidor

Están en `_shared/instagram/validar-ia.ts`. Pasan después del modelo y antes de devolver nada.

| Regla | Qué pasa |
|---|---|
| Sin emoji | Se **corrigen**: se quitan y se avisa |
| Hashtags | Se **corrigen**: se normalizan, se quitan los repetidos y quedan 12 como mucho |
| Texto alternativo de más de 1000 caracteres | Se **recorta** y se avisa |
| CTA de los rótulos fuera de `instagram_guias_marca.ctas` | Se **quita** y se avisa. Si coincide sin mayúsculas, se deja la de la lista |
| «Touza» en una propuesta de TOUZA | Pasa a «TOUZA», salvo el pueblo «A Touza» |
| Límites de Instagram: 2200 caracteres, 30 hashtags y 20 menciones (caption + hashtags; usa `validarCaption`) | **Descarta** |
| Precio que no sea `precio_eur` del plato de la pieza, o hablar de euros sin cifra | **Descarta** |
| Plato citado que no está en la carta activa de la marca, o un plato concreto (percebes, bogavante…) que no aparece en ningún nombre de la carta | **Descarta** |
| «sin gluten», «apto para celíacos» o «gluten free» sin `sin_gluten_disponible` ni oficiales sin gluten | **Descarta** |
| «sin X» o «contiene X» que no cuadra con `alergenos_oficiales` (se normaliza con `chat-web/alergenos.ts`; nunca los inferidos) | **Descarta** |
| «sin alérgenos», «apto para alérgicos», «vegano», «vegetariano» (la carta no tiene ese dato) | **Descarta** |
| TOUZA con «reservar», «reserva», «reservado»… (también en hashtags; incluye «El Reservado») | **Descarta** |
| Correo, teléfono, DNI/NIE, IBAN o mención a una cuenta que no sea @casatomascrevillent o @touzabar | **Descarta** |
| Rótulos: titular de más de 6 palabras, campos por encima del límite de la plantilla, sin titular (salvo plantilla con cita) | **Descarta** |

Si las 3 propuestas se descartan, se pide **una vez más** al modelo con los motivos (sin datos del usuario). Si vuelven a fallar, responde 422.

## Base de datos

Migración `20261108000000_instagram_ia.sql`:

- **`instagram_guias_marca`**: una fila por marca, con `version`, `guia`, `hashtags_base` y `ctas` (lista cerrada).
  - Se siembra con `marca-base` (readme.md, CONTENT FUNDAMENTALS y brand-voice).
  - **No pisa** una guía ya editada.
  - Al cambiar la guía, los hashtags o las CTA, sube la versión y se anota `actualizado_por`.
  - Marketing la lee. Solo Marketing en edición cambia esas tres columnas. Nadie del panel inserta ni borra.
  - La guía oficial de voz es corta: conviene que el dueño la complete. De momento, con un `update` en el SQL Editor; la pantalla «Ajustes de marca» es de una fase posterior.
- **`instagram_sugerencias_ia`**: cada petición.
  - Guarda la entrada anonimizada, la salida validada, el modelo, la versión de la guía, cuántas variantes salieron y cuántas se descartaron, los tokens y la variante elegida.
  - Marketing la lee. Marketing en edición inserta. `creado_por` lo pone el servidor.
  - Solo quien la pidió marca la elegida, y solo las columnas `aceptada` y `variante_elegida`. Nadie del panel borra.
- Las dos tablas llevan la política restrictiva `acceso_panel_no_bloqueado` y triggers de auditoría.
- **`ia_funciones`**: alta de `instagram-ia` con `instrumentada = false`, para que salga en `/super-admin/costes`.

## Modelo, clave y coste

Se usan los mismos patrones que `chat-web` y `chat-facturas`:

- **Clave**: `claveOpenAI("otros")`, que es el secreto **`OPENAI_API_KEY`**, la clave general que ya usan `traducir-contenido` y `format-novedad`. No hace falta crear nada si ese secreto ya existe en el proyecto. En `ia_proceso_de_funcion()` cae en «otros», que cuadra con esa clave. Si algún día se quiere ver aparte en la factura de OpenAI, hay que añadir un proceso `marketing` en `_shared/clave-openai.ts` y en `ia_proceso_de_funcion()`.
- **Modelo**: `gpt-5.6-luna`, el de `chat-web`. Se cambia con el secreto opcional `INSTAGRAM_IA_MODEL`.
  - Va con Structured Outputs (`response_format: json_schema`, `strict`), `reasoning_effort: "none"`, `temperature: 0.8` y `max_completion_tokens: 2000`.
  - Si se cambia el modelo, hay que revisar estos parámetros y darlo de alta en `ia_precios`.
- **Coste**: `AcumuladorUso("instagram-ia", modelo, "chat")` y `registrarUso()` en el `finally`.
  - El disparador es `pieza:<uuid>` o `usuario:<uuid>`.
  - Unos 0,002 $ por petición, según la tarifa de `gpt-5.6-luna` en `ia_precios`. **Sin verificar hoy.**
- **Errores**: `motivoErrorOpenAI()`, que traduce «sin saldo», 401 y 429.

## Desplegar (demo primero)

Desde la raíz del repo (`admin-casatomas/`). **Nunca `db push`.** Producción (`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí» del dueño.

```bash
# 1. Migración (necesita 20261105090000_instagram.sql aplicada). Tiene que terminar en «instagram_ia: aplicada».
npx supabase db query --linked -f supabase/migrations/20261108000000_instagram_ia.sql

# 2. Secreto: OPENAI_API_KEY ya existe si funcionan traducir-contenido o format-novedad. Comprobarlo SIN ver el valor:
npx supabase secrets list --project-ref sfonaclosuafvlhutkon | grep OPENAI_API_KEY
#    Opcionales: INSTAGRAM_IA_MODEL (por defecto gpt-5.6-luna) e INSTAGRAM_IA_CUPO_DIARIO (por defecto 100).

# 3. Función (verify_jwt = true sale de supabase/config.toml)
npx supabase functions deploy instagram-ia --project-ref sfonaclosuafvlhutkon
```

```sql
-- 4. En el mismo momento del despliegue (ENGANCHE-REGISTRO-IA.md):
update public.ia_funciones set instrumentada = true where funcion = 'instagram-ia';
```

Comprobación en la demo:

1. En una pieza con la foto de un plato `featured`, pide texto. Tienen que salir 3 variantes sin emoji y sin precios.
2. Marca «Añadir el precio»: el precio sale al final, igual que en la carta.
3. En el SQL Editor, `select … from ia_uso where funcion = 'instagram-ia'` muestra la fila con `coste_usd`. La fila sale también en `/super-admin/costes`.
4. `select tipo, variantes, descartadas, aceptada from instagram_sugerencias_ia order by created_at desc limit 5;`.

Deshacer:

1. Retira primero el componente del panel.
2. Ejecuta el rollback `supabase/rollbacks/20261108000000_instagram_ia_ROLLBACK.sql`.
3. Deja de desplegar la función o bórrala.

## Pruebas

```bash
npx vitest run supabase/functions/instagram-ia src/components/instagram/ia   # sin red; OpenAI simulado
npm run test:instagram-ia:db                                                  # PGlite: tablas, RLS, siembra, rollback
```

Las pruebas de la función nunca llaman a OpenAI: `fetch` está simulado. Cubren:

- precio inventado y «sin gluten» falso, que se bloquean;
- emoji, que se corrigen;
- el reintento;
- el cupo;
- la migración sin aplicar;
- el registro del uso con el disparador correcto;
- que la clave nunca sale en la respuesta.

`plantillas.test.ts` falla si la copia de plantillas del servidor se separa de `src/lib/instagram/plantillas`.

## Límites conocidos

- Detectar platos inventados es heurístico. Se comprueban:
  - los `platos_citados` que declara el modelo;
  - una lista de platos concretos (pulpo, percebes, bogavante…) contra los nombres de la carta.

  Una variante con un nombre inventado («pulpo a feira» si la carta dice «pulpo a la gallega») pasa si la palabra clave existe en la carta. Por eso la persona revisa siempre.
- Los cócteles de TOUZA están en otra tabla («Cocteles») y no entran en la carta que ve la IA. En TOUZA, la IA habla de la casa y del ambiente, no de cócteles concretos.
- El tope diario cuenta las filas de `instagram_sugerencias_ia` del usuario. Si guardar la sugerencia falla, esa petición no cuenta.
- Alcohol (TOUZA): solo hay una regla de prompt. **Sin verificar** con un asesor (Ley General de Publicidad y normativa autonómica).
