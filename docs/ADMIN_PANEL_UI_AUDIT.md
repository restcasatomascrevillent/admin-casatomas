# Fase 3 — Auditoría visual y rediseño del Admin Panel (seguimiento)

> Documento vivo. Si se corta la sesión: lee esto, mira `git log` de la rama `feature/fase3-auditoria-ui` y sigue en
> **«Próxima acción»**. No reinicies la auditoría.

## Objetivo
El panel de Casa Tomás debe tener nivel de producto SaaS profesional y la identidad de la web oficial
(restaurantecasatomascrevillente.es):
- todas las pestañas y contadores unificados;
- responsive de 320 a 1920 px;
- contraste WCAG 2.2 AA y estados claros.

Petición del dueño del 11/11/2026; el encargo completo está en la conversación de esa fecha.

## Cómo se revisa (herramientas reales)
- **Navegador automático:** Playwright + Chromium con el **Supabase falso** de `tests/e2e-movil/`. No usa cuenta ni
  datos reales, y entra como super admin, así que ve todos los módulos.
- **Barrido:** `tests/e2e-movil/barrido-fase3.mjs` (uso en su cabecera).
  - Recorre 42 pantallas en 320, 375, 430, 768, 1024, 1366 y 1920 px.
  - Mide desborde horizontal, elementos fuera de pantalla, pestañas cortadas, contadores ocultos, objetivos táctiles
    < 24 px, letra < 12 px y errores de JavaScript.
  - Saca capturas en 375, 768 y 1366 px.
- **Límites:**
  - No hay control del ordenador del dueño ni sesión en la demo real. Los datos son sintéticos: pantallas que dependen
    de respuestas concretas (Stripe, listados de Cheques) pueden verse vacías.
  - La web oficial sí se ha inspeccionado en vivo.

## Identidad visual (web oficial, inspeccionada con el navegador el 11/11/2026)
- **Tipografía:** Libre Baskerville (serif) en toda la web.
- **Texto:** gris pizarra `rgb(57,65,71)` = `hsl(206 11% 25%)`.
- **Fondo:** blanco con degradado piedra cálido.
- **CTA «Reservar mesa»:** píldora dorada `hsl(38 59% 35%)` con texto blanco. El secundario es una píldora clara con
  borde.
- **Etiquetas:** versalitas espaciadas («COCINA GALLEGA · MARISCO · CREVILLENTE»).
- **El panel ya parte de esa paleta:** `--primary` pizarra, `--secondary` piedra, `--accent` dorado (`src/index.css`).
- **Decisión:** el panel mantiene la letra sans (UI densa de uso diario, mejor legibilidad en tablas). La serif de la
  marca queda para el logotipo y los títulos grandes, sin tocar la letra de trabajo.

## Sistema de diseño (decisiones)
| Pieza | Regla |
|---|---|
| Dorado | Tokens `gold` (bordes, subrayados e iconos; 3:1), `gold-strong` (texto dorado; ≥ 4,5:1) y `gold-deep` (hover). Prohibido `hsl(38,59%,…)` a mano. |
| Pestañas nivel 1 | `PestanasPagina`: **activa rellena en pizarra** (el estilo que el dueño pidió el 10/11 para Reservas y Carta, ahora en todo el panel). Inactivas con texto fuerte. 40 px con ratón y 44 px con dedo. Si no caben, se desplazan con degradado; nunca se cortan. |
| Pestañas nivel 2 | `ChipsSubnivel`, o `PestanasPagina nivel={2}` si hacen falta acciones o scroll: píldoras claras con la activa en `primary/10` y negrita. Nunca dos barras de nivel 1 apiladas. |
| Contadores | `CLASE_CONTADOR` + `formatoContador`: píldora de 20 px, cifra tabular centrada, separador de miles («1.903»), **siempre visibles**; con 0 no se pintan. |
| Segmentados de filtro | `ToggleGroup` / `SEGMENTO` (Facturas): no son pestañas, son filtros. |
| Botón de crear reserva | Azul clarito: `bg-sky-100 text-sky-900 border-sky-300`. |

## Inventario de pantallas (42 rutas del barrido)
Estados: A = auditada en el barrido, C = corregida, V = validada tras corregir.

| Módulo | Rutas | A | C | V | Notas |
|---|---|---|---|---|---|
| Dashboard | `/dashboard` | ☑ | ☑ | ☑ | Cifras clicables y «Próximas» (11/11) |
| Reservas | día, Lista, Calendario, Blacklist, Configuración (reglas, servicio, mesas, turnos, plantillas) | ☑ | ☑ | ☑ | Turnos › modo → chips |
| Gestor web | carta, bebidas, vinos, novedades, menús, tapas | ☑ | ☑ | ☑ | Novedades › partes → chips |
| Marketing / RRSS | `/marketing`, `/rrss` | ☑ | ☑ | ☑ | |
| Cheques | `/cheques` | ☑ | ☑ | ☑ | Datos sintéticos no traen listado |
| Tienda | `/tienda` | ☑ | ☑ | ☑ | |
| Facturas | análisis, márgenes, compras, cargar | ☑ | ☑ | ☑ | Móvil arreglado el 11/11 (`#161`) |
| Albaranes | `/albaranes` | ☑ | ☑ | ☑ | |
| Usuarios | `/usuarios` | ☑ | ☑ | ☑ | |
| Avisos | `/avisos` | ☑ | ☑ | ☑ | «Ver» abre la ficha (`#158`) |
| Ayuda | `/ayuda` | ☑ | ☑ | ☑ | |
| Super Admin | panel, ecommerce, asistente, gestor de gasto, reseñas, tráfico web, logs, espacios, bot web, usuarios, auditoría, servicios (+costes), informes | ☑ | ☑ | ☑ | Auditoría › vista y Servicios › paquetes → chips |

## Hecho
- [x] Inventario de rutas (`src/App.tsx`) y de los sistemas de pestañas: 19 `PestanasPagina`, 8 `ChipsSubnivel`,
  7 `TabsList` sueltos. De los sueltos, 5 están migrados; los otros 2 son específicos y se quedan: salas del plano con
  cifras y tira de días.
- [x] Identidad de la web oficial (captura y estilos calculados).
- [x] Tokens de dorado y fuera los colores a mano. Commit `89c6e746`.
- [x] Contadores siempre visibles y con formato. Commit `89c6e746`.
- [x] Barrido «antes» (294 medidas).
- [x] Pestañas unificadas en dos niveles. Commit `2b3fe84c`.
- [x] Críticos del barrido corregidos (320 px, Reseñas, contraste de «Verificada»).
- [x] Diálogos: título a la izquierda y pie con hueco. `<main>` con nombre de sección.

## Pendiente
- [x] Analizar el barrido «antes» y abrir la lista de problemas por gravedad.
- [x] Corregir lo crítico: desbordes, cortes, solapes y modales.
- [x] Revisar el contraste de `muted-foreground` sobre `muted` (5,6:1) y de las insignias de estado («Verificada» corregida).
- [x] Barrido «después» y capturas comparadas.
- [ ] PR a `staging` e informe final.

## Problemas detectados (barrido «antes»: 294 medidas, 42 pantallas × 7 anchos)
| Gravedad | Problema | Dónde | Estado |
|---|---|---|---|
| Crítica | La página se sale de ancho (358 px en 320): «Avisos» queda fuera | Reservas (todas las pestañas), 320 px | ✅ fila que se parte |
| Crítica | La página se sale de ancho (359 px en 320): «Pesos por página» | Tráfico web, 320 px | ✅ `flex-wrap` |
| Crítica | Pantalla de error si el estado de Google llega incompleto (`conectada` de undefined) | Reseñas Google | ✅ `?.` |
| Alta | Contadores de pestañas ocultos en el móvil | Gestor web, Servicios (y todas las `PestanasPagina`) | ✅ siempre visibles |
| Alta | Tres estilos de pestaña distintos y dos barras de nivel 1 apiladas | Carta, RRSS › Instagram, Plantillas, Mi cuenta, Suscriptores + 5 `TabsList` sueltos | ✅ dos niveles |
| Alta | «Verificada»: blanco sobre azul 3,8:1 (< 4,5 AA) | Insignias de estado | ✅ 5,2:1 |
| Media | Dorado escrito a mano en 17 sitios | Facturas, Servicios, pestañas | ✅ tokens `gold*` |
| Media | Títulos de diálogo centrados en el móvil (y desviados por la X) | Todos los diálogos | ✅ a la izquierda |
| Media | Letra de 11 px | «Tú» (Usuarios), vista previa del bot, contadores | ✅ 12 px |
| Media | Las páginas no tienen `h1` (decisión del dueño: sin títulos) | 32 de 42 | ✅ `<main aria-label="Sección">` |
| Baja | Consola: `PGRST116` en Cheques con datos sintéticos | Cheques (Supabase falso) | ⏸ solo con datos falsos |
| Baja | Insignia de versión a 10 px en la cabecera móvil | Cabecera | ⏸ decorativa, se deja |

Sin incidencias en el barrido: objetivos táctiles < 24 px (ninguno) y pestañas cortadas (ninguna).

## Pruebas ejecutadas
- tsc: 14 errores, la misma línea base que antes.
- Vitest de lo tocado: `src/components/panel` (44), carta, gestión web, reservas › turnos, facturación y Super Admin
  auditoría (585 en total, en verde tras actualizar el test de contadores).
- `lint:cambios`: ningún fichero empeora.

## Decisiones
- Una sola rama `feature/fase3-auditoria-ui` desde `staging`, con commits por bloques y PR a `staging`. Producción
  solo con una release que acepte el dueño.
- No se toca lógica, permisos, APIs ni base de datos.

## Preguntas pendientes
- (ninguna por ahora)

## Próxima acción
PR a `staging` abierta; tras fusionar, el dueño la revisa en la demo. Siguiente tanda posible: los pendientes de abajo
(tercer nivel en Gestor de gasto y Logs, repaso con datos reales de los diálogos de Vinos, Tapas, Novedades e Instagram).

---

# Informe final de la Fase 3 (11/11/2026)

## Resumen ejecutivo
**Antes:** el panel ya partía de la paleta de la web, pero tenía tres estilos de pestaña y contadores que desaparecían en
el móvil. Reservas se salía de ancho a 320 px, Reseñas se rompía con datos incompletos, el dorado estaba escrito a mano
en 17 sitios y la insignia «Verificada» no llegaba al contraste AA.

**Después:**
- Un sistema de pestañas en dos niveles en todo el panel, con contadores siempre visibles y con formato.
- Tokens de marca para el dorado.
- Sin desbordes en ninguna de las 42 pantallas en 7 anchos (ver «Responsive»).
- Diálogos coherentes en el móvil.
- Contraste AA en las insignias de estado.

## Identidad visual
Ver «Identidad visual» y «Sistema de diseño» al principio de este documento:
- Paleta de la web: pizarra, piedra y dorado.
- Tokens `gold*`.
- Pestañas en dos niveles y contador común.
- Botón azul de crear reserva.

## Componentes reutilizados (sin duplicar)
- `PestanasPagina` (nivel 1 y `nivel={2}`).
- `ChipsSubnivel`.
- `CLASE_CONTADOR` / `formatoContador`.
- Los `Dialog`, `AlertDialog` y `Sheet` de `src/components/ui`.
- No se han añadido dependencias.

## Responsive (barrido con Playwright: 42 pantallas × 7 anchos = 294 medidas)
| Métrica | Antes | Después |
|---|---|---|
| Pantallas que se salen de ancho / elementos fuera | 10 | **0** |
| Pestañas con el nombre cortado | 0 | 0 |
| Contadores de pestañas ocultos | 15 | **0** |
| Errores de JavaScript | 3 (Reseñas roto + Cheques) | 1 (Cheques, solo con datos sintéticos) |
| Objetivos táctiles < 24 px | 2 | 6¹ |

¹ Los nuevos son el enlace «Place ID Finder», que va dentro de un párrafo de Reseñas: es la excepción de enlace en línea
de WCAG 2.5.8 y aparece porque Reseñas ya no se rompe. El botón de Servicios ya mide 44 px en tablet táctil
(`pointer-coarse`).

La letra < 12 px que queda es la insignia de versión de la cabecera (10 px, decorativa) y las leyendas de las barras
de uso de Servicios.

## Capturas antes / después (`docs/fase3-capturas/`)
| Pantalla | Fichero |
|---|---|
| Dashboard 375 | `dashboard-375.jpg` |
| Gestor web › Carta 375 (dos niveles, contador «Platos 12») | `gestion-web-375.jpg` |
| RRSS › Instagram 375 (segundo nivel en píldoras) | `rrss-375.jpg` |
| Reservas › Configuración 768 | `reservas_tab_configuracion-768.jpg` |
| Facturas › Compras 375 | `facturas_tab_compras-375.jpg` |
| Newsletter 1366 | `marketing-1366.jpg` |
| Super Admin › Servicios 768 | `super-admin_servicios-768.jpg` |
| Reservas (móvil) 375 | `reservas-375.jpg` |
| Super Admin › Reseñas 375 (antes, pantalla de error) | `super-admin_resenas-375.jpg` |
| Super Admin › Auditoría 1366 (vista en chips) | `super-admin_auditoria-1366.jpg` |

## Pruebas
- `npx tsc --noEmit -p tsconfig.app.json`: 14 errores, la misma línea base de antes (todos en ficheros que no se tocan).
- `npm run lint:cambios`: ningún fichero empeora (36 ficheros).
- Vitest de `src/components` y `src/pages`: 4.202 de 4.203 en verde. El que faltaba ya fallaba en `staging`
  (`DialogoAccionReserva`) y se ha puesto al día.
- Barrido con Playwright: ver «Responsive».
- Suite completa y build de producción: se pasan en la rama `release/X.Y.Z` (regla del repo; CI la pasa en modo
  completo).

## Riesgos
- **Pestaña activa rellena en todo el panel:** cambio visible en todos los módulos. Es reversible en un solo sitio
  (`CLASE_PESTANA` en `PestanasPagina.tsx`).
- **Títulos de diálogo a la izquierda en el móvil:** afecta a todos los diálogos. Es más legible y no cambia ninguna
  función.
- **Datos sintéticos:** pantallas que dependen de respuestas reales (listado de Cheques, Stripe, datos de Google) se han
  visto vacías o en su estado de error. Conviene repasarlas en la demo.

## Pendientes (fuera de esta entrega)
- Tercer nivel de navegación propio en Gestor de gasto (pasos «1. Cliente… 4. Revisar») y en Logs («Sesiones |
  Eventos», `SelectorSubrayado`). Son selectores de paso o de vista, no pestañas de página. Se dejan como están.
- Repasar en la demo, con datos reales, los diálogos de Vinos, Tapas, Novedades, Instagram y Usuarios de Super Admin.
- Letra de 10 px en la insignia de versión de la cabecera (decorativa).
