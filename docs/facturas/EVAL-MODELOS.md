# Evaluación de modelos para el copiloto de Facturas

Fecha: **07/11/2026**. Proyecto: **demo** (`sfonaclosuafvlhutkon`). Coste total de la evaluación:
**0,23 $** (fuente: `ia_uso`, disparador `evaluar:%`; presupuesto máximo 3 $).

Pregunta del dueño: ¿qué modelo pongo en `chat-facturas`: **gpt-6-sol** (el actual de la demo),
**gpt-6.1-terra**, **gpt-6-luna** o el de siempre, **gpt-4.1-mini**? (y **gpt-6.1-sol**, si encaja).

> Esto es solo una recomendación. **No se ha cambiado el modelo** de `chat-facturas` en la demo
> (sigue en `gpt-6-sol`, con respaldo `gpt-4.1-mini`). Se cambia en Super Admin › Servicios › Modelos.

## Resultado en una línea

**Recomiendo `gpt-6.1-terra`**: acierta lo mismo que el mejor (10/12), no dio **ninguna cifra
equivocada**, nunca termina con «¿quieres que…?» y cuesta unos **1,65 $ al mes** (la mitad que
`gpt-6-sol`). Si se quiere lo más barato, **`gpt-6-luna`** (10/12, 0,20 $/mes) es casi igual de bueno,
pero en una respuesta metió un dato de detalle mal. `gpt-4.1-mini` es claramente peor y
**`gpt-6.1-sol` no se puede usar** tal como está hecho el copiloto.

## Tabla

| Modelo | Aciertos | Puntuación media (0-3) | Cifra / Herramienta / Sin «¿quieres…?» / Claridad | Coste medio por pregunta | Coste al mes (300 preguntas) | Tiempo de OpenAI por pregunta | Llamadas al modelo por pregunta |
|---|---:|---:|---|---:|---:|---:|---:|
| **gpt-6.1-terra** | **10/12** | **2,75** | 2,58 / 2,67 / 3,00 / 2,75 | 0,0055 $ | **1,65 $** | 5,3 s | 2,4 |
| gpt-6-sol (actual) | 9/12 | 2,75 | 2,50 / 2,67 / 3,00 / 2,83 | 0,0110 $ | 3,31 $ | 3,1 s | 2,1 |
| **gpt-6-luna** | **10/12** | 2,73 | 2,50 / 2,67 / 3,00 / 2,75 | **0,0007 $** | **0,20 $** | 4,4 s | 2,7 |
| gpt-4.1-mini (respaldo) | 8/12 | 1,98 | 2,17 / 2,42 / 1,17 / 2,17 | 0,0018 $ | 0,54 $ | 2,5 s | 2,0 |
| gpt-6.1-sol | — | — | no funciona (ver abajo) | 0 $ | — | — | — |

- **Coste**: suma de `ia_uso.coste_usd` de las 12 preguntas / 12, con las tarifas de `ia_precios`
  (GPT-6 cobra aparte la **escritura en caché**: en gpt-6-sol 2,5 $/M, más cara que la entrada normal).
  Al mes = × 300. En uso real el historial de la conversación añade tokens de entrada: calcula
  hasta ~1,5× (terra ≈ 2,5 $/mes, sol ≈ 5 $/mes, luna ≈ 0,30 $/mes).
- **Tiempo de OpenAI** = suma de lo que tardan las llamadas al modelo en una pregunta. Es lo
  comparable entre modelos. El tiempo total de cada pregunta (mediana 11-27 s) **no** es comparable:
  la batería se lanzó en paralelo (36 y luego 24 preguntas a la vez) y las consultas a la base de datos
  se ralentizaron por la carga. Por llamada: 4.1-mini 1,3 s, sol 1,5 s, luna 1,6 s, terra 2,2 s.
  luna sube a 4,4 s por pregunta porque en dos preguntas difíciles dio 6 vueltas.
- Tokens medios por pregunta (entrada / cacheados / salida): 4.1-mini 8.134 / 6.027 / 214;
  luna 12.199 / 8.501 / 231; terra 10.717 / 7.653 / 255; sol 9.051 / 6.052 / 234. Razonamiento: 0
  en todos (GPT-6 va con `reasoning_effort: "none"`, obligatorio para usar herramientas).

## Cómo se ha medido

- **Lo evaluado es el copiloto real.** El bucle de `chat-facturas` (prompt, herramientas, traducción a
  RPC, pista de la pregunta, topes) se ha sacado a `supabase/functions/chat-facturas/bucle.ts` sin
  cambiar su comportamiento; lo usan el copiloto y la nueva acción **«evaluar»** de
  `ia-modelos-openai`. Las RPC van contra la base de datos de la demo con el mismo cliente de service
  role que usa `chat-facturas`. No se guarda conversación.
- **Batería**: `supabase/functions/chat-facturas/__tests__/eval/preguntas.json`: 12 preguntas reales
  del dueño, con la cifra de referencia calculada con SQL directo en la demo, su tolerancia y la
  consulta. Las dos de seguimiento («hazme la comparativa», «¿y en cerveza?») llevan el turno anterior.
- **Llamada**: desde SQL con `net.http_post` y el secreto de Vault `ocr_trabajos_secret` (no sale de
  Vault), una petición por pregunta y modelo:
  `{ "accion": "evaluar", "modelo": "gpt-6-luna", "preguntas": [{ "id": "q01", "mensaje": "…", "historial": [] }] }`.
  La función se niega a seguir si el gasto acumulado de evaluaciones en `ia_uso` llega a 3 $.
- **Puntuación** (la he puesto yo leyendo cada respuesta), 0-3 en cada criterio:
  - **Cifra**: 3 = correcta y completa (dentro de la tolerancia); 2 = la cifra principal es correcta
    pero algún detalle está mal o el criterio es flojo; 1 = no da cifra pero no inventa (explica por
    qué); 0 = cifra equivocada o inventada. **Acierto = cifra ≥ 2.**
  - **Herramienta**: 3 = la adecuada con el periodo correcto; 2 = adecuada pero argumentos mejorables
    o vueltas de más; 1 = rodeos con herramientas que no sirven; 0 = herramienta equivocada.
  - **Sin «¿quieres que…?»**: 3 = no termina ofreciendo/preguntando; 2 = «si quieres…, dime»;
    0 = termina con «¿quieres…?».
  - **Claridad/brevedad en español**: 3 = clara, breve, dice si va con o sin IVA; 2 = larga o con algo
    raro; 1 = confusa o engañosa; 0 = inservible.

### Puntuación por pregunta (cifra-herramienta-pregunta-claridad)

| Pregunta | Referencia | 4.1-mini | luna | terra | sol |
|---|---|---|---|---|---|
| q01 litros de cerveza este año | 20.520,9 l | 3-3-2-2 | 3-3-3-3 | 3-3-3-3 | 3-3-3-3 |
| q02 €/l de cerveza por proveedor, último año | 4,61 €/l, un solo proveedor (Catral) | 3-3-0-3 | 3-3-3-3 | 3-3-3-2 | 3-3-3-3 |
| q03 «hazme la comparativa» | ídem | 3-3-3-2 | **2**-3-3-2 | 3-3-3-2 | 3-3-3-3 |
| q04 vino, último mes | 43,92 € (octubre incompleto) | 3-3-3-3 | 3-3-3-3 | 3-3-3-3 | 3-3-3-3 |
| q05 «¿y en cerveza?» | 0 € (no hay compras) | 3-3-3-3 | 3-3-3-3 | 3-3-3-2 | 3-3-3-3 |
| q06 marisco más caro | Nicolás y Valero / Nuevo Tomás y Carmen / Pesquero MYT por €/kg | 2-2-3-2 | 2-2-3-3 | 2-2-3-3 | **1**-2-3-2 |
| q07 kilos y €/kg de gamba roja | 42,05 kg a 130,56 €/kg | 1-3-0-2 | 1-3-3-3 | 1-3-3-3 | 1-3-3-3 |
| q08 qué ha subido este año | 130 productos > 10 % | 3-2-0-2 | 3-3-3-3 | 3-3-3-3 | 3-3-3-2 |
| q09 septiembre y familias | 134.154,74 € + Bebidas, Pescado, Carnes | **1**-3-0-1 | 3-2-3-2 | 3-2-3-3 | 3-2-3-3 |
| q10 qué le compro a Makro | brioche, queso crema, pimiento… | 3-3-0-3 | 3-3-3-3 | 3-3-3-3 | 3-3-3-3 |
| q11 albaranes sin factura | 41 albaranes, 17.993,28 € | **0-0-0-1** | 3-3-3-3 | 3-3-3-3 | 3-3-3-3 |
| q12 IRPF retenido este año | 5.920,09 € (ninguna herramienta lo suma) | 1-1-0-2 | 1-1-3-2 | 1-1-3-3 | 1-1-3-3 |

## Ejemplos

**Bueno: gpt-6-sol / gpt-6.1-terra / gpt-6-luna, q02 (comparativa de cerveza).** Los tres dicen que
en el último año solo hay un proveedor (Catral), que no hay comparativa posible, dan 4,61 €/l sin IVA
y el desglose por formato (barril de 50 l a 4,08 €/l, tercio a 5,16 €/l…). Ninguno se inventa otros
proveedores.

**Bueno: gpt-6.1-terra, q06 (marisco más caro).** Es el único que no da un veredicto engañoso:
«No puedo señalar un proveedor como el más caro de todo el marisco: […] cada uno vende productos
distintos», y compara el **mismo producto** (quisquilla: Pescados Moltó 93,41 €/kg frente a Hermanos
Narejos 69,33 €/kg). Es justo lo que pide la rúbrica.

**Malo: gpt-6-sol, q06.** «el más caro es Hermanos Narejos, S.L.: 40,26 €/kg». Narejos está entre los
**más baratos** por kilo (hay proveedores a 138, 128 y 115 €/kg); el modelo solo miró los 8
proveedores que traía el desglose. Lo matiza, pero la frase principal engaña.

**Malo: gpt-4.1-mini, q11 (albaranes sin factura).** «Hay 2 albaranes sin total registrado…».
Confunde «sin factura» con «sin total» (el prompt lo prohíbe expresamente) y no usa
`albaranes_sin_factura`. La respuesta buena (luna, terra, sol): **41 albaranes, 17.993,28 €**, con
el aviso de que uno no tiene total.

**Malo: gpt-4.1-mini, q09 (septiembre).** Da **117.783,29 € «con IVA incluido»**, que es la suma de
las líneas **sin IVA**; el gasto real es **134.154,74 €** (lo dan bien luna, terra y sol).
Además termina 7 de 12 respuestas con «¿Quieres…?» (y otra con «si quieres…, dime»).

**Detalle malo: gpt-6-luna, q03.** La conclusión es buena (un proveedor, 4,61 €/l), pero en la tabla
pone «Tercio de 33 cl: 11.118 l», cuando la propia herramienta da 7.337,88 l (el resto de modelos lo copió bien). Es el único
número equivocado de los tres GPT-6 en preguntas con cifra.

**Raro: gpt-6.1-terra, q05.** Responde bien (octubre sin compras de cerveza) pero añade «Corrección:
antes indiqué por error que el último mes iba del 8 de octubre al 7 de noviembre», corrigiendo el turno
anterior del historial. No es grave, pero sobra.

## Problemas que NO dependen del modelo (para arreglar aparte)

1. **«Kilos de gamba roja» falla con TODOS los modelos.** `volumen_comprado_agente('gamba roja', …)`
   tarda **~8,5 s** en la demo y PostgREST corta a los **8 s** (`statement_timeout` del rol
   `authenticator`): la herramienta devuelve error y el modelo dice «no he podido consultar».
   Desde SQL la cifra sale bien (42,05 kg, 130,56 €/kg). Hay que acelerar la búsqueda por texto de esa
   RPC (índice o filtrar antes de `volumen_linea`). Los modelos lo manejaron bien (ninguno inventó;
   4.1-mini terminó con «¿Quieres que intente…?»).
2. **IRPF: ninguna herramienta suma `retencion_irpf`** (solo `detalle_documento` la enseña documento a
   documento), así que ningún modelo puede responder «cuánto IRPF me han retenido» (5.920,09 € en 2026).
   Todos dijeron que no podían, sin inventar; luna y 4.1-mini lo dijeron como si no hubiera retenciones,
   que es engañoso. Solución: una métrica `sum_retencion_irpf` en `consulta_flexible` o el dato en
   `resumen_periodo`.
3. **gpt-6.1-sol no sirve con el copiloto tal como está.** Con `reasoning_effort: "none"` (el que manda
   `parametrosModelo` a toda la familia GPT-6) OpenAI responde 400 «does not support 'none' with this
   model»; con `"low"`, 400 «Function tools with reasoning_effort are not supported for gpt-6.1-sol in
   /v1/chat/completions. To use function tools, use /v1/responses». Usarlo exige pasar `chat-facturas`
   a la API Responses. Además, si alguien lo pone en Super Admin › Modelos, cada pregunta fallaría y
   pasaría al respaldo. No ha costado nada (OpenAI rechaza antes de procesar).
4. **El tiempo total por pregunta es alto** (10-40 s con carga), y casi todo es base de datos, no el
   modelo (el modelo suma 2-5 s). Con el uso normal (una pregunta a la vez) es mucho menor.

## Recomendación razonada

- **Calidad.** Los tres GPT-6 que funcionan están muy por encima de gpt-4.1-mini: no terminan con
  «¿quieres que…?», usan la herramienta correcta en «albaranes sin factura», dan bien el gasto de
  septiembre y avisan de los meses incompletos. Entre ellos la diferencia es pequeña: **terra** es el
  único sin ninguna cifra mal y el que mejor razonó la pregunta abierta del marisco; **luna** iguala en
  aciertos pero metió un dato de detalle inventado y da más vueltas en las preguntas difíciles; **sol**
  (el actual) dio la respuesta más engañosa de la batería (marisco) y no gana en nada.
- **Coste.** Todos son baratos en términos absolutos: de 0,20 $ (luna) a 3,31 $ (sol) al mes para 300
  preguntas. sol cuesta el doble que terra y 16 veces luna sin ser mejor.
- **Elección**: **gpt-6.1-terra** como modelo de `chat-facturas` (mejor relación calidad/coste cuando lo
  que importa es que las cifras sean correctas; ~1,65 $/mes, ~2,5 $/mes con historial), con
  **gpt-4.1-mini de respaldo** como ahora. Si el dueño prefiere gastar lo mínimo, **gpt-6-luna** es una
  opción válida (0,20 $/mes) asumiendo algún detalle flojo. **No** recomiendo seguir con gpt-6-sol ni
  volver a gpt-4.1-mini. gpt-6.1-sol queda descartado hasta migrar a la API Responses.
- Antes de pasar a producción conviene arreglar los dos problemas de herramientas (gamba roja e
  IRPF): suben dos aciertos a cualquier modelo.

## Repetir la evaluación

1. Desplegar `ia-modelos-openai` (lleva `chat-facturas/bucle.ts`).
2. Por cada pregunta de `preguntas.json` y modelo, desde el editor SQL de la demo:

   ```sql
   select net.http_post(
     url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='project_url') || '/functions/v1/ia-modelos-openai',
     headers := jsonb_build_object('Content-Type','application/json',
       'x-ocr-secret', (select decrypted_secret from vault.decrypted_secrets where name='ocr_trabajos_secret')),
     body := '{"accion":"evaluar","modelo":"gpt-6-luna","preguntas":[{"id":"q01","mensaje":"cuántos litros de cerveza he comprado este año"}]}'::jsonb,
     timeout_milliseconds := 150000);
   -- y luego: select content from net._http_response where id = <el id devuelto>;
   ```
3. Gasto: `select modelo, sum(coste_usd) from ia_uso where disparador like 'evaluar:%' group by 1;`
   (el tope de 3 $ cuenta TODAS las evaluaciones hechas).
4. Las referencias cambian con los datos: recalcularlas con la columna `sql` de cada pregunta.
