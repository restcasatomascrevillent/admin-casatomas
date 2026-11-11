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
| Pestañas nivel 1 | `PestanasPagina`: texto con subrayado dorado; 40 px con ratón y 44 px con dedo; si no caben, se desplazan con degradado; nunca se cortan. |
| Pestañas nivel 2 | `ChipsSubnivel`: píldoras; activa con fondo suave; las filas se parten. |
| Contadores | `CLASE_CONTADOR` + `formatoContador`: píldora de 20 px, cifra tabular centrada, separador de miles («1.903»), **siempre visibles**; con 0 no se pintan. |
| Segmentados de filtro | `ToggleGroup` / `SEGMENTO` (Facturas): no son pestañas, son filtros. |
| Botón de crear reserva | Azul clarito: `bg-sky-100 text-sky-900 border-sky-300`. |

## Inventario de pantallas (42 rutas del barrido)
Estados: A = auditada en el barrido, C = corregida, V = validada tras corregir.

| Módulo | Rutas | A | C | V | Notas |
|---|---|---|---|---|---|
| Dashboard | `/dashboard` | ☐ | ☐ | ☐ | Cifras clicables y «Próximas» (11/11) |
| Reservas | día, Lista, Calendario, Blacklist, Configuración (reglas, servicio, mesas, turnos, plantillas) | ☐ | ☐ | ☐ | Turnos › modo → chips |
| Gestor web | carta, bebidas, vinos, novedades, menús, tapas | ☐ | ☐ | ☐ | Novedades › partes → chips |
| Marketing / RRSS | `/marketing`, `/rrss` | ☐ | ☐ | ☐ | |
| Cheques | `/cheques` | ☐ | ☐ | ☐ | Datos sintéticos no traen listado |
| Tienda | `/tienda` | ☐ | ☐ | ☐ | |
| Facturas | análisis, márgenes, compras, cargar | ☐ | ☐ | ☐ | Móvil arreglado el 11/11 (`#161`) |
| Albaranes | `/albaranes` | ☐ | ☐ | ☐ | |
| Usuarios | `/usuarios` | ☐ | ☐ | ☐ | |
| Avisos | `/avisos` | ☐ | ☐ | ☐ | «Ver» abre la ficha (`#158`) |
| Ayuda | `/ayuda` | ☐ | ☐ | ☐ | |
| Super Admin | panel, ecommerce, asistente, gestor de gasto, reseñas, tráfico web, logs, espacios, bot web, usuarios, auditoría, servicios (+costes), informes | ☐ | ☐ | ☐ | Auditoría › vista y Servicios › paquetes → chips |

## Hecho
- [x] Inventario de rutas (`src/App.tsx`) y de los sistemas de pestañas: 19 `PestanasPagina`, 8 `ChipsSubnivel`,
  7 `TabsList` sueltos. De los sueltos, 5 están migrados; los otros 2 son específicos y se quedan: salas del plano con
  cifras y tira de días.
- [x] Identidad de la web oficial (captura y estilos calculados).
- [x] Tokens de dorado y fuera los colores a mano. Commit `89c6e746`.
- [x] Contadores siempre visibles y con formato. Commit `89c6e746`.
- [x] Barrido «antes» (en marcha → `resultados.json`).

## Pendiente
- [ ] Analizar el barrido «antes» y abrir la lista de problemas por gravedad.
- [ ] Corregir lo crítico: desbordes, cortes, solapes y modales.
- [ ] Revisar el contraste de `muted-foreground` sobre `muted` y de las insignias de estado.
- [ ] Barrido «después» y capturas comparadas.
- [ ] PR a `staging` e informe final.

## Problemas detectados
_(se rellena con el barrido)_

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
Leer `resultados.json` del barrido «antes» y priorizar los problemas.
