# Batería de pruebas del chatbot web "Tomy" (chat-web)

Pruebas de extremo a extremo del chatbot público de la web de Casa Tomás
(`supabase/functions/chat-web/index.ts`, widget en
`casa-tomas-story/src/components/AIChatbot.tsx`). Sirven para validar el bot
**antes de hacerlo público** y para repetir la validación cada vez que se cambie
el prompt, el modelo, la carta o la configuración de `configBotWeb`.

| Archivo | Qué es |
|---|---|
| `escenarios.json` | 69 escenarios (es/en/fr, uno o varios turnos) con sus aserciones y un criterio para el juez LLM. |
| `run.mjs` | Ejecutor. Node 18+, sin dependencias. Habla con el endpoint igual que el widget. |
| `resultados/` | Informes de cada ejecución (`AAAA-MM-DD_HHMM.md` + `.json`). Ignorado por git. |

## Qué se prueba

| Categoría | Ejemplos |
|---|---|
| `info` | horario, lunes cerrado, domingo solo hasta las 16:00, dirección, teléfono, email, cómo llegar (sin inventar parking) |
| `reservas` | cómo reservar (web + teléfono), reserva para hoy → teléfono, grupo de 15/20 → teléfono, "resérvame tú" → se niega, cancelar/modificar → no puede, antelación máx. 60 días |
| `carta` | marisco, precio de un plato real, multi-turno ("¿y cuánto cuesta el primero?"), plato inexistente → no inventar |
| `alergenos` | sin gluten, marisco, frutos secos, lactosa → con aviso de confirmarlo con el personal |
| `vinos` | maridaje con bogavante/paella, tinto < 20 €, D.O. concreta, champagne |
| `idioma` | cambio de idioma a mitad de conversación, widget en un idioma y mensaje en otro, francés siempre con "vous" |
| `tono` | saludo, brevedad, queja, despedida |
| `seguridad` | prompt injection (es/en/fr), "ahora eres un asistente de programación", roleplay, política, datos de otros clientes, "¿eres humano?", descuento falso |
| `abuso` | 3 URLs, bloque de código, código suelto, 600 y 2100 caracteres → respuesta fija sin gastar tokens |
| `limites` | turno 13 en la misma sesión → mensaje de cierre con teléfono y enlace (**costoso**, excluido por defecto) |
| `robustez` | vacío, solo espacios, solo emojis, faltas de ortografía, mayúsculas |

Cada respuesta se comprueba con:

- `debe_contener` / `debe_contener_alguno` / `no_debe_contener`: expresiones regulares (sin distinguir
  mayúsculas). El teléfono se acepta con cualquier separación (`966107887`, `+34 966 10 78 87`...).
- `no_debe_contener_global` (en `_meta`): fugas del prompt interno, nombres de herramientas, "OpenAI/GPT",
  `undefined`/`null`... Se aplica a todas las respuestas del modelo.
- `idioma_esperado`: heurística de palabras frecuentes es/en/fr. Si la respuesta es muy corta el resultado
  es "no concluyente" y no cuenta como fallo.
- `max_palabras`, `solo_horas_validas` (cualquier hora que no sea del horario real = horario inventado),
  `codigo_esperado` (`fuera_de_tema`, `limite_conversacion`...) y `success_esperado`.
- Opcional, `--juez`: un segundo modelo lee la conversación y aplica `criterio_juez` con los hechos reales
  del restaurante (`_meta.hechos`). Detecta cosas que una regex no ve (inventar parking, dar un vino de 24 €
  cuando se pidió menos de 20, no recordar el turno anterior...).

Resultados posibles por escenario: **PASS**, **FAIL** (el bot respondió mal), **INFRA** (no se pudo
probar: límites, OpenAI caído, clave mala...), **SKIP** (faltan datos de la carta) y **NO EJECUTADO**
(la batería se abortó antes).

## 1. Datos que necesitas

### Endpoint y clave (las mismas que usa la web)

El widget de `casa-tomas-story` llama a `${VITE_SUPABASE_URL}/functions/v1/chat-web` con la clave
`VITE_SUPABASE_PUBLISHABLE_KEY` (ver `casa-tomas-story/src/lib/supabase-functions.ts`). Usa esos mismos
valores:

| Variable | De dónde sale |
|---|---|
| `CHAT_WEB_URL` | `VITE_SUPABASE_URL` del `.env` de casa-tomas-story (o de Vercel → Settings → Environment Variables). Vale la base (`https://xxxx.supabase.co`) o la URL completa de la función. |
| `CHAT_WEB_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY` del mismo sitio (o Supabase → Project Settings → API Keys → *publishable*). Es la clave pública; aun así, no la pegues en informes ni la subas al repo. |

`run.mjs` nunca imprime ni guarda las claves.

### Datos reales de la carta (opcionales)

Dos escenarios necesitan saber qué hay en la carta. Míralo en el panel (Carta / Vinos) y ponlo en variables:

| Variable | Ejemplo | Escenario |
|---|---|---|
| `EVAL_PLATO` | `Arroz negro` | `carta-precio-plato-es` |
| `EVAL_PLATO_PRECIO` | `16.50` | idem (se acepta `16,50 €`, `16.5€`...) |
| `EVAL_DO` | `Rioja` | `vino-do-es` (una D.O. que tenga al menos un vino activo) |

Si faltan, esos escenarios salen como SKIP y el resto se ejecuta igual.

## 2. Antes de lanzar la batería completa: subir los límites

La batería completa hace ~70 peticiones seguidas desde tu IP. Con los topes de producción
(`max_req_ip_hora = 20`) se cortaría a la 20.ª petición con `cupo_agotado` (el ejecutor lo detecta,
aborta y te lo dice).

1. Panel de administración (super admin) → **Bot Web** (`/super-admin/bot-web`) → tarjeta **Protección y consumo**.
2. Apunta los valores actuales y sube temporalmente:
   - **Por IP y hora** (`max_req_ip_hora`) → **200**
   - **Por sesión y hora** (`max_req_sesion_hora`) → **60**
   - Comprueba que **Bot activo** está encendido y que queda presupuesto diario (la batería gasta céntimos).
   - Comprueba que **URL de reservas** (`url_reservas`) = `https://casa-tomas-story.vercel.app/reservas`
     (la migración `20260926130000_chat_web_url_reservas.sql` la rellena si está vacía; aun sin ella, `chat-web`
     usa esa URL como valor por defecto). Si pones otra, los escenarios que buscan `{{URL_RESERVAS}}` fallarán.
   - No cambies **Turnos por conversación** (12) ni **Caracteres por mensaje** (500): los escenarios de
     `limites` y `abuso` los dan por supuestos.
3. Lanza la batería.
4. **Al terminar, deja "Por IP y hora" y "Por sesión y hora" como estaban** (20 y 30 por defecto) y guarda.

Hay límites que NO se pueden tocar desde el panel porque están fijos en `index.ts`: 5 peticiones / 10 s,
15 / minuto y **50 / 15 minutos por IP**, y 8 / minuto por sesión. El ejecutor ya se autolimita por debajo
(4 / 10 s, 14 / min, 45 / 15 min, 7 / min por sesión) y, si aun así el servidor contesta "estás escribiendo
muy rápido", espera 65 s y reintenta. Por eso una batería completa tarda **~20 minutos** aunque subas los
topes del panel.

Recuerda también que el escenario de límites necesita que las 13 peticiones de su sesión quepan en
`duracion_max_min` (30 min por defecto); el ejecutor lo lanza el primero por eso.

## 3. Cómo ejecutarla (PowerShell)

```powershell
cd C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\adminpanelct\supabase\functions\chat-web\evals

# 0) Validar escenarios.json y ver el plan, sin red ni claves
node run.mjs --dry-run

# 1) Variables de la sesión de PowerShell (se pierden al cerrar la ventana)
$env:CHAT_WEB_URL = "https://<tu-proyecto>.supabase.co"      # = VITE_SUPABASE_URL
$env:CHAT_WEB_KEY = "<clave publicable>"                      # = VITE_SUPABASE_PUBLISHABLE_KEY
$env:EVAL_PLATO = "Arroz negro"; $env:EVAL_PLATO_PRECIO = "16.50"; $env:EVAL_DO = "Rioja"   # opcional

# 2) Prueba rápida de humo (5-6 peticiones, cabe en los límites normales)
node run.mjs --solo info-telefono-es,res-como-reservar-es,abuso-urls-es,rob-vacio-es,seg-injection-prompt-es

# 3) Una categoría o un idioma
node run.mjs --solo carta,vinos
node run.mjs --idioma fr

# 4) Batería completa (sin el escenario costoso de límites) — sube antes los límites (paso 2)
node run.mjs

# 5) Todo, incluido el turno 13, y con juez LLM
$env:OPENAI_API_KEY = "<tu clave de OpenAI>"
node run.mjs --incluir-costosos --juez

# Limpiar las variables al acabar
Remove-Item Env:CHAT_WEB_KEY, Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
```

Opciones:

| Opción | Efecto |
|---|---|
| `--dry-run` | Valida `escenarios.json` (ids, regex, idiomas...) e imprime el plan con coste y duración estimados. Sin red. |
| `--solo a,b` | Solo esos ids o categorías. Un id costoso nombrado aquí sí se ejecuta. |
| `--idioma es\|en\|fr` | Solo escenarios de ese idioma. |
| `--excluir-costosos` | (por defecto) salta los escenarios `costoso` / `limites`. |
| `--incluir-costosos` | Los ejecuta. |
| `--pausa-ms N` | Pausa entre peticiones (defecto 1500). |
| `--max-15min N` | Tope propio de peticiones por 15 min (defecto 45; no pasar de 50). |
| `--juez` | Juez LLM (`OPENAI_API_KEY`; modelo `JUEZ_MODELO`, defecto `gpt-5.6-luna`). |
| `--salida ruta.md` | Ruta del informe (defecto `resultados/<fecha>.md`; el `.json` va al lado). |

Código de salida: `0` todo bien · `1` hay FAIL · `2` problema de infraestructura o batería abortada.

## 4. Coste esperado

Precios de `gpt-5.6-luna`: 0,20 $ / 1M tokens de entrada (0,02 $ cacheados) y 1,20 $ / 1M de salida.
Una pregunta simple son ~2.500 tokens de entrada (el prompt del sistema) + ~150 de salida ≈ **0,0007 $**;
una de carta/vinos hace 2 llamadas con el resultado de la herramienta ≈ **0,0015 $**.

| Ejecución | Peticiones al modelo | Coste estimado |
|---|---:|---:|
| Batería por defecto | ~62 | ~0,06 $ (peor caso ~0,15 $) |
| + escenario de límites (`--incluir-costosos`) | +12 | +0,01 $ |
| + juez LLM | ~63 llamadas del juez | +0,03 $ |

Es decir, **menos de 0,25 $ la batería completa con juez** — muy por debajo del presupuesto diario de 3 $.
`node run.mjs --dry-run` recalcula la estimación con los filtros que uses. El gasto real queda en el panel
(Protección y consumo) y en la vista `chat_web_uso_diario`.

Los escenarios de `abuso` y `robustez` vacíos no llegan a OpenAI (0 tokens). El de 600 caracteres tampoco ocupa
fila de cupo: `max_chars` se comprueba antes de `chat_web_reservar_cupo` (con `chat_web_config` cacheada 60 s).

## 5. Cómo leer los resultados

En consola verás una línea por escenario y, en los que fallan, los motivos y el principio de la respuesta:

```
FAIL   res-hoy-es
         - turno 1: no contiene /{{TEL}}/
         respuesta: ¡Buenas tardes! Puedes reservar en https://casa-tomas-story.vercel.app/reservas ...
```

- `no contiene /{{TEL}}/`: faltó el teléfono. Las macros (`{{TEL}}`, `{{URL_RESERVAS}}`, `{{TUTEO_FR}}`...)
  están definidas en `_meta.macros` de `escenarios.json`.
- `contiene prohibido /.../ → "texto"`: muestra exactamente lo que ha saltado.
- `horas no reales en la respuesta: 12:00`: el bot se ha inventado un horario.
- `idioma detectado es, se esperaba en`: respondió en otro idioma.
- `[juez] ...`: motivo que da el juez LLM.
- `INFRA`: no es culpa del bot (límites, OpenAI, clave). Arregla la causa y repite solo ese escenario con `--solo`.

El informe `resultados/<fecha>.md` tiene el resumen por categoría e idioma, la conversación completa de cada
fallo y la última respuesta de los que pasan (útil para revisar el tono a ojo). El `.json` sirve para
comparar ejecuciones.

Algunos escenarios llevan una `nota` sobre una corrección concreta del bot (reglas de reservas, idioma del
cliente, aviso de alérgenos, filtro de precio de vinos, transparencia IA). Esas correcciones ya están en
`index.ts` (2026-09-26): si uno de esos escenarios falla, es una **regresión** real, no un fallo esperado.

## 6. Añadir escenarios

Copia uno parecido en `escenarios.json`, cambia el `id` (único) y ejecuta `node run.mjs --dry-run`: valida
la estructura y que todas las regex compilan. Las aserciones del escenario se aplican a la **última**
respuesta; para comprobar un turno intermedio usa `"esperado": { ... }` dentro de ese turno. Un turno con
`"veces": N` se repite N veces en la misma sesión, y `"mensaje": {"repetir": "texto ", "hasta": 600}` genera
un mensaje largo.
