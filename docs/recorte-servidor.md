# Recorte de fotos en el servidor (respaldo del móvil)

Decisión del dueño (03-11-2026, versión final): **el móvil (Android, iPhone y iPad, por el mismo camino) quita el fondo primero en su propio navegador**, con el mismo modelo que el ordenador. El **servidor** es el **respaldo** cuando eso falla (memoria, descarga, error). Si el servidor también falla, no responde o se llega al tope, la foto pasa a un **ordenador**. Un móvil que se queda sin memoria recortando queda marcado y sus siguientes fotos van directas al servidor; desde la ficha se puede volver a probar en el móvil. El ordenador sigue recortando en el formulario, como siempre.

Toda foto de cámara (12-48 Mpx) se decodifica **ya reducida** (`medidasFoto.ts`, `createImageBitmap` con `resizeWidth`) antes de cualquier lienzo: Safari limita los lienzos a ~16,7 Mpx.

## Cómo funciona

1. En el móvil se elige la foto y el fondo, y se guarda la ficha **con la foto original** (nunca se pierde).
2. Justo después, el móvil reduce la foto (lado mayor 1200 px) e intenta quitar el fondo él mismo. Sale el aviso «Poniendo el fondo de carta…» con el progreso: descarga del modelo (solo la primera vez) y recorte. Si falla, manda la foto reducida (JPEG ~0,3-0,6 MB) a `POST /api/recortar-foto` con el JWT de su sesión, con las fases *Subiendo…* → *Quitando el fondo en el servidor…* → *Componiendo…*.
3. La función (`api/recortar-foto.ts`, Vercel Function con runtime Node, en `fra1`) hace esto:
   - Comprueba la sesión contra el Supabase de su entorno: la demo en Preview y producción en Production. Usa las mismas variables `VITE_SUPABASE_*` del panel.
   - Llama, **como ese usuario**, a `recorte_servidor_reservar()`, que exige el permiso de carta (`can_write_section('gestor_carta')`) y que quede cupo (ver *Gasto*).
   - Pasa la foto por `isnet-general-use` cuantizado (`public/modelos/isnet-general-use-u8.onnx`, el mismo fichero que usa el ordenador) con `onnxruntime-node`, y la refina con el mismo código del navegador (`mascaraRecorte.ts` y `refinarMascara.ts`: limpieza, filtro guiado y alfa suave).
   - Devuelve **solo la máscara**: un PNG gris de 1 canal (~50 KB) al tamaño de la foto.
4. El móvil aplica la máscara a su foto, la compone con el fondo elegido y la guarda en la ficha. Es el mismo resultado que en el ordenador.
5. Si algo falla, la ficha se queda con la foto normal, sale un aviso con el motivo y se crea un **trabajo para un ordenador** (`trabajos_recorte`). Los casos son estos:
   - El servidor no responde en 90 s.
   - Hay un error del servidor.
   - La sesión ha caducado.
   - Se ha alcanzado el tope de gasto.
   - El panel se cierra a medias.

   Si el modelo no encuentra el producto (422), solo se avisa: el ordenador usa el mismo modelo.

Esto vale para todas las tablas (Platos, Vinos, Bebidas, Cócteles), «Varias botellas», «Foto rápida» y «Quitar fondo» / «Cambiar fondo» en el móvil. Si la foto ya viene sin fondo (por ejemplo, el recorte del iPhone pegado como PNG), no se llama al servidor.

## Límites

| | |
|---|---|
| Foto de entrada | JPEG, PNG o WebP, ≤ 4 MB (Vercel admite como mucho 4,5 MB de cuerpo) y lado ≤ 4096 px. El móvil manda ≤ 1200 px. |
| Respuesta | PNG de 1 canal, ~50 KB (Vercel admite como mucho 4,5 MB). |
| Tiempo máximo | 120 s en la función (`vercel.json`); el móvil espera 90 s. |
| Memoria | Plan Hobby: 2 GB y 1 vCPU por instancia. Medido en local: pico de 770 MB y ~260 MB en reposo (sin la arena de CPU de ORT, que la hacía crecer hasta 1,5 GB). |
| Concurrencia | Una inferencia cada vez por instancia (cola); el móvil manda las fotos de una en una. |
| Bundle | ~115 MB: el modelo (45 MB), onnxruntime-node para linux-x64 (45 MB) y sharp (~20 MB). Vercel admite 250 MB. Los binarios de otras plataformas se excluyen en `vercel.json`. |

## Tiempos medidos (03-11-2026, Node 24, foto de 1200×1600, ordenador de desarrollo)

| | 1 hilo | 2 hilos |
|---|---|---|
| Carga de la sesión (en frío) | 0,13-0,16 s | 0,13 s |
| Decodificar y preparar la entrada | 0,03-0,05 s | 0,03 s |
| Inferencia | 3,4-3,8 s | 1,8 s |
| Refinado (limpieza, filtro guiado y alfa) | 0,17-0,30 s | 0,15-0,19 s |
| PNG de la máscara | 0,015 s | 0,013 s |
| **Total por foto** | **~3,9 s** | **~2,0 s** |

En Vercel la CPU puede ser más lenta y el arranque en frío añade el `import` de onnxruntime y la lectura del modelo. La medida real de cada foto queda en los logs de la función (`[recortar-foto] {…}`) y en `ia_uso.duracion_ms`.

## Gasto (plan Hobby de Vercel)

El plan Hobby da **4 h de CPU activa cada 30 días** para todo el equipo. Si se pasa, Vercel **pausa las funciones** hasta que pasen 30 días. Por eso hay un control propio (migración `20261103180000_recorte_servidor_cupo.sql`):

- **Cada recorte deja una fila en `ia_uso`** (`funcion = 'recortar-foto'`, modelo `vercel:recortar-foto`, 0 USD) con `duracion_ms` = el trabajo de CPU de esa foto. Se ve en **Costes** como las demás funciones.
- **Topes** (en **Super Admin › Servicios › Vercel**, editables):
  - `recortes_servidor_mes`: **600 fotos/mes**. Peor caso estimado de ~12 s de CPU por foto (×3 la medida local, con arranques en frío) → 2 h, la mitad del cupo.
  - `recortes_servidor_dia`: **60 fotos/día**, de seguridad.
  - `cpu_recortes_mes`: **120 min/mes** con la duración **real** anotada.
- Al llegar a un tope, la función responde 429 **sin gastar CPU** y el móvil avisa: «Se ha alcanzado el tope mensual de recortes en el servidor». La foto va a un ordenador. El móvil recuerda el tope hasta que pasa (medianoche o el día 1) y mientras tanto ni llama al servidor.
- En Super Admin › Servicios, la fila de Vercel enseña las fotos del mes y de hoy y los minutos de CPU frente a esos topes. La nota de «Tiempo de CPU de las funciones» dice cuánto de ese tiempo son recortes. Estos datos salen de nuestra BD, así que se ven aunque falte el token de Vercel.
- **Coste estimado:** 4-8 s de CPU por foto (≈ 2-4 s medidos en local; ×2 de margen para Vercel). Con el cupo entero (4 h) caben **~1.800-3.600 fotos al mes**. Con el tope por defecto (600) se gastan ~40-80 min.
- Los contadores van **por proyecto de Supabase**: la demo y producción cuentan aparte, aunque el cupo de Vercel es del equipo.

> **Aviso:** el plan Hobby de Vercel es **solo para uso no comercial**. El panel de un restaurante es uso comercial. Si Vercel lo detecta o se necesitan más recursos, el paso es el plan **Pro** (20 USD por persona y mes; 1.000 h de CPU de funciones incluidas).

## Diagnóstico en el móvil

Abre el panel con `?diag=recorte` en la URL, por ejemplo `https://admin-casatomas-git-staging-casa-tomas.vercel.app/?diag=recorte`. Abajo sale un registro con cada paso del camino de la foto:

- foto elegida, rama, destino y lectura de la IA;
- «tras guardar» y la petición al servidor;
- la respuesta, con estado, tiempos (`Server-Timing`) y medidas;
- el resultado o el motivo del fallo.

El registro tiene botones **Copiar**, **Borrar** y **±**. Se recuerda en la pestaña hasta cerrarla; `?diag=no` lo apaga. No crea tablas ni manda nada fuera del navegador.

`GET /api/recortar-foto`, sin sesión, dice si el modelo está en el bundle y si cargan `onnxruntime-node` y `sharp`. No recorta nada.

## Ficheros

- `api/recortar-foto.ts`, `api/_lib/recorteServidor.ts` (modelo y refinado) y `api/_lib/autorizacion.ts` (sesión y cupo).
- `src/components/carta/recorte/quitarFondoServidor.ts` (cliente: petición, tope y aplicar la máscara), `recorteEnSegundoPlano.ts` (flujo tras guardar, cola y avisos), `recorteMovil.ts` (marcas y motivos) y `diagnostico.ts`.
- `supabase/migrations/20261103180000_recorte_servidor_cupo.sql`, más su rollback y `npm run test:recorte-servidor:db`.
- Pruebas: `api/_lib/__tests__/recortarFoto.test.ts` (con `RECORTE_INFERENCIA=1`, una inferencia real; en CI corre en Linux), `src/components/carta/__tests__/recorteMovilTrasGuardar.test.ts` y `anadirVinoMovilServidor.test.tsx`.
- `.npmrc`: `onnxruntime-node-install=skip`, para que la instalación en Linux no baje los binarios de CUDA (cientos de MB).
