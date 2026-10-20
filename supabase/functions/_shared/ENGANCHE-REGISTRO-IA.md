# Cómo enganchar el registro de consumo de IA

Guía para instrumentar una Edge Function con `_shared/registrar-uso-ia.ts`.

**Escrita el 2026-09-28**, junto con la migración `20260928193000_costes_sistema.sql`
(sin aplicar) y la pantalla `/super-admin/costes`.

---

## Estado: quién registra y quién no

| Función | Modelo(s) | Registra | Quién la llama |
|---|---|---|---|
| `chat-web` | `gpt-5.6-luna` | **sí**, desde antes (`chat_web_uso`, migración `20260926121000`) | la web pública |
| `chat-facturas` | `gpt-4.1-mini` + `text-embedding-3-small` | **sí**, hecho aquí | el panel |
| `format-novedad` | `gpt-4o-mini` | **sí**, hecho aquí | el panel |
| `procesar-factura` | `gpt-5-mini` + `text-embedding-3-small` | **no** — ver abajo | el panel |
| `traducir-contenido` | `gpt-4.1-mini` | **no** — ver abajo | el panel (8 sitios) |
| `procesar-dibujo-perimetro` | `gpt-5-mini` | **no** — ver abajo | **nadie** |
| `buscar-precios-mercado` | `sonar` (Perplexity) | **no** | **nadie** |

Las tres del medio **no se han tocado a propósito**: el 2026-09-28 había otro agente
trabajando en `procesar-dibujo-perimetro/`, `procesar-factura/` y `traducir-contenido/`,
y tocar los mismos ficheros en paralelo es la mejor forma de perder trabajo. Esta guía
existe para que quien las tenga en la mano las enganche sin tener que reconstruir nada.

**Cuando enganches una, acuérdate del `update`**:

```sql
update public.ia_funciones set instrumentada = true where funcion = 'procesar-factura';
```

Hazlo **en el mismo momento del despliegue**, ni antes ni después. `ia_funciones.instrumentada`
es lo que hace que la pantalla avise de que le faltan datos: ponerlo a `true` antes de
desplegar apaga un aviso de un agujero que sigue abierto, que es peor que no avisar nunca.

---

## La regla

**Registrar no puede romper la función.** Todo el módulo está escrito para eso:
`sumar()` no lanza, `registrarUso()` no lanza y siempre resuelve, y si falta la service
role key sólo deja un `console.error` con los tokens perdidos. No hace falta envolver
nada en try/catch por tu cuenta.

Lo único que tienes que hacer bien es **dónde** pones la llamada.

---

## El patrón (copiado de `chat-web`, que es el único que ya lo hacía bien)

```ts
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";

// 1. Declarar FUERA del try, para que el `finally` lo vea.
const uso = new AcumuladorUso("mi-funcion", MODEL, "chat");
const inicioMs = Date.now();

try {
  const res = await fetch(`${OPENAI}/chat/completions`, { ... });
  const json = await res.json();
  uso.sumar(json.usage);        // 2. Una vez POR LLAMADA (dentro del bucle si lo hay).
  ...
  return respuestaBuena;
} catch (e) {
  uso.marcarError();            // 3. Marcar, no tragarse el error.
  throw e;
} finally {
  // 4. En el finally: así también se registra el gasto de una petición que falló.
  await registrarUso(uso, {
    disparador: `factura:${id}`,
    duracionMs: Date.now() - inicioMs,
    cliente: supabase,          // opcional; si no lo pasas, crea uno
  });
}
```

### Por qué en el `finally` y no en el camino feliz

Porque **una llamada que falla después de que OpenAI haya respondido se paga igual**.
Esas son justo las que hay que ver en la pantalla: un `JSON.parse` que revienta 200
veces seguidas es gasto puro sin ningún resultado, y en el camino feliz es invisible.

Las cuatro funciones sin instrumentar tienen **un solo `catch` que además devuelve
HTTP 200** con un fallback. Sin el `finally`, todo lo que caiga ahí se pierde.

### Un acumulador por modelo

Si la función usa chat **y** embeddings, son dos acumuladores y se registran los dos
de una vez: `registrarUso([usoChat, usoEmbed], { ... })`. La pantalla desglosa por
modelo y las tarifas se diferencian en ~20x, así que mezclarlos pierde el dato útil.

### Qué NO poner en `disparador`

Nada personal y nada de texto del usuario. Es para rastrear un pico hasta su origen:
`factura:<uuid>`, `usuario:<uuid>`, `plato:<id>`, `cron`, `bulk:carta`. La RPC lo
recorta a 200 caracteres.

---

## Lo que hay que enganchar en cada función pendiente

Los números de línea son del **2026-09-28** y se habrán movido; están como referencia,
busca por el código citado.

### `procesar-factura` — la más cara y la más enrevesada

Hasta **4 llamadas de pago por documento**: 1-2 de visión (`gpt-5-mini`,
`max_completion_tokens: 16000`, y el reintento **reenvía la imagen entera**) y 2 de
embeddings. Es el gasto más grande del sistema con diferencia.

Tres problemas, por orden:

1. **`llamarVision()` (~L825-864) sólo devuelve el documento parseado.** El `usage`
   está en `const json = await res.json();` (~L841) y se tira. Hay que sumarlo dentro
   de `llamarVision`, no en quien la llama. Se llama 2 veces desde `extraerConCuadre`
   (~L903 y ~L920) y las dos son de pago.
2. **`embed()` (~L320-328) tiene el mismo problema**: `const json = await res.json();`
   (~L326) y `return json.data.map(...)` (~L327). Se llama en ~L536 (nombres de
   producto, una llamada para todas las líneas) y ~L1054 (resumen de la factura).
3. **El cliente de service role no existe todavía cuando se llama a visión.** Se crea
   en ~L1022-1025 y la visión ocurre en ~L1013. O subes el `createClient` por encima,
   o no pasas `cliente` y dejas que `registrarUso` cree el suyo (más simple, y el
   coste es un `createClient` por petición, no por llamada).

**Cómo hacerlo sin tocar las firmas**: declara los dos acumuladores en el ámbito del
módulo del handler y que `llamarVision` y `embed` los usen por cierre, igual que
`chat-facturas` los metió en su `Ctx`. Si prefieres no usar variables de módulo
(cuidado: en Deno Deploy un aislamiento sirve varias peticiones, así que una variable
de módulo **mezclaría el consumo de peticiones distintas** — no lo hagas), pásalos como
parámetro extra opcional a las dos funciones.

`disparador`: lo natural es `factura:${facturaId}`, pero ojo — `facturaId` sólo existe
en ~L1077, **después** de las dos llamadas de OpenAI. Como el registro va en el
`finally`, para entonces ya existe: declara `let facturaId: string | null = null` antes
del try y úsalo en el `finally`. Si la factura falló antes de insertarse, queda `null`,
que es correcto.

### `traducir-contenido` — la única donde hay que cambiar una firma

`callOpenAI(system, user)` (~L44-92) devuelve **sólo el contenido parseado**
(`return JSON.parse(cleaned);`, ~L88). El `usage` está en `const body = await res.json();`
(~L80) y no sale de ahí.

Dos caminos:

- **El fácil y el que recomiendo**: registrar **dentro de `callOpenAI`**. Es la única
  función que toca OpenAI en todo el fichero, así que un acumulador por llamada y un
  `registrarUso` al final de `callOpenAI` cubre los tres modos sin tocar ni una firma.
  Coste: una fila por llamada en vez de una por petición. En modo `bulk` eso son
  **cientos de filas por ejecución**, porque `bulk.ts` hace **una llamada por fila**
  (`bulk.ts:~L124`, dentro del bucle). Es mucha fila, pero es el dato real, y la
  retención de 90 días lo limpia.
- **El limpio**: cambiar el tipo de retorno a `{ data, usage }` y actualizar los
  **4 sitios** que la llaman: `index.ts` ~L117 (bulk), ~L137 (campos), ~L162 (normal),
  y `bulk.ts` ~L124 más el tipo `CallOpenAI` de `bulk.ts` (~L25-30). Así se acumula por
  petición y en bulk sale **una** fila con las N llamadas dentro.

Aviso aparte: **esta función no comprueba permisos de usuario** (no hay `auth.getUser()`
ni `has_section_permission`; sólo `verify_jwt` y, en modo bulk, la comparación con la
service key en ~L111-115). No es cosa de esta guía, pero quien la tenga abierta que lo
mire: es una función que gasta dinero por llamada.

`disparador`: los 8 llamantes no mandan ningún id (`{ tipo, datos }`, `{ campos, destino,
contexto }`). Lo que sí se puede es `bulk:${tabla}` en modo bulk y `tipo:${tipo}` en el
normal — suficiente para separar "retraducción masiva" de "un plato suelto", que es la
distinción que importa para el coste.

### `procesar-dibujo-perimetro` — antes de instrumentarla, decidir si se borra

Es **huérfana**. Su cabecera apunta a `EditorPlanoArquitectonico.tsx`, que **ya no
existe** (el editor vivo es `EditorPlanoEspacio.tsx` / `CanvasPlano.tsx`), y no hay ni un
`functions.invoke("procesar-dibujo-perimetro")` en los 4 repos. Instrumentarla es trabajo
perdido mientras siga así.

Si aun así se engancha, es la más sencilla de las tres: el `usage` está en
`const data = await response.json();` (~L221) y la variable ya existe y está en ámbito.
Una sola llamada, sin bucle. El único detalle es que **no hay cliente de service role en
el handler** (los dos están dentro de `autenticar()` y ni siquiera lee las variables de
entorno a nivel de módulo, ~L89-91), así que no pases `cliente` y deja que
`registrarUso` cree el suyo.

Es `gpt-5-mini` **sin `reasoning_effort`**, o sea con el esfuerzo por defecto: aquí el
desglose de razonamiento es el que más va a sorprender.

`disparador`: no llega ningún id, sólo `auth.userId` (~L126). `usuario:${auth.userId}`.

### `buscar-precios-mercado` — no la instrumentes, decide si se borra

También huérfana, y además es **Perplexity, no OpenAI**. Su tarifa no encaja del todo en
`ia_precios`: Perplexity cobra por tokens **y además por búsqueda**, y la tabla sólo
modela lo primero, así que el coste que saldría está infra-declarado. Está dada de alta
en `ia_funciones` y en `ia_precios` (modelo `sonar`) a propósito: si algún día aparecen
llamadas suyas en la pantalla, es que **algo la está llamando** y hay que averiguar qué.
Ese es todo el valor que tiene ahora mismo.

---

## Detalle que se presta a doble conteo (léelo aunque tengas prisa)

`completion_tokens_details.reasoning_tokens` es un **subconjunto** de `completion_tokens`,
no un tercer cubo:

```
completion_tokens = texto_útil + reasoning_tokens
```

El módulo los guarda separados para poder ver el reparto, pero `ia_registrar_uso` cobra
**sólo `completion_tokens`** a tarifa de salida. Si alguien "arregla" esto sumando el
razonamiento aparte, el coste de la pantalla se infla en silencio. La tabla `ia_uso` tiene
un `CHECK (razonamiento_tokens <= completion_tokens)` para que no cuele.

Por qué importa: medido el 2026-09-28, `gpt-5-mini` gasta **3.060** tokens de salida
leyendo una factura y `gpt-5.4-mini` gasta **598**, con la misma tarifa. Sin el desglose,
la fila dice "3.060 tokens" y no se ve que 2.500 son el modelo pensando.

## Comprobación rápida después de desplegar

```sql
select funcion, modelo, operacion, llamadas,
       prompt_tokens, completion_tokens, razonamiento_tokens,
       coste_usd, estado, disparador, created_at
from public.ia_uso
order by created_at desc
limit 20;
```

Lo que tiene que cuadrar:

- `coste_usd` **no es NULL**. Si lo es, el modelo no está en `ia_precios`: dalo de alta.
- `razonamiento_tokens <= completion_tokens` siempre (si no, el CHECK habría rechazado
  la fila y no la verías: lo que verías es un `console.error` en los logs).
- `llamadas` cuadra con lo que esperas: `chat-facturas` puede llegar a 6 por pregunta,
  `procesar-factura` a 2 de visión.
- Una petición que falló deja fila con `estado = 'error'` y los tokens ya gastados.
