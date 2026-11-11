---
name: caloria-design
description: Sistema de diseño de CalorIA (colores, tipografía Telegraf, escala de tamaños, espaciado, bordes, radios, sombras, componentes y uso del logo). Usá esta skill SIEMPRE que crees o modifiques cualquier cosa visual en la app Expo, aunque el pedido no mencione el diseño: pantallas, componentes, estilos, StyleSheet, colores, íconos, splash, app icon, estados vacíos, gráficos, tarjetas del Wrapped o cualquier texto que se muestre en la UI.
---

# CalorIA · Sistema de diseño

CalorIA es una app de nutrición que tiene que sentirse cálida, honesta y tranquila: nada de estética de gimnasio ni de alarma. La identidad sale del logo, una llama verde con un núcleo salvia sobre fondo claro, y de una wordmark geométrica y redondeada. Formas suaves, mucho aire, verde profundo como color de marca y crema como base.

La regla número uno es que **ningún valor visual se escribe a mano**. Todo color, tamaño de letra, espaciado, radio o sombra sale de los tokens de `theme/`. Si necesitás un valor que no existe, agregalo al theme y explicá por qué, en vez de hardcodearlo en un componente.

## 1. Color

### Paleta de marca

| Token | Hex | Uso |
|---|---|---|
| `primary` | `#1F5637` | Color de marca. Botones principales, títulos, números destacados, barra de progreso, ícono activo |
| `primaryPressed` | `#17432A` | Estado presionado del primario |
| `sage` | `#87A27B` | Acento. Rellenos, bandas de rango, ilustraciones, bordes decorativos, estados seleccionados de fondo |
| `sageSoft` | `#E4EBDF` | Fondo tintado: chips, badges, celdas seleccionadas |
| `cream` | `#F7F4EC` | Fondo de todas las pantallas |

### Neutros y semánticos

| Token | Hex | Uso |
|---|---|---|
| `background` | `#F7F4EC` | Fondo de pantalla (= `cream`) |
| `surface` | `#FFFFFF` | Tarjetas, inputs, sheets |
| `surfaceAlt` | `#EFEBE0` | Track de barras de progreso, skeletons, superficies secundarias |
| `border` | `#E2DCCB` | Bordes y divisores |
| `borderStrong` | `#CFC7B3` | Borde de input en reposo cuando hace falta más definición |
| `ink` | `#17291E` | Texto principal |
| `inkMuted` | `#5E6B62` | Texto secundario, placeholders, captions |
| `onPrimary` | `#FFFFFF` | Texto e íconos sobre `primary` |
| `sageText` | `#4F6A47` | Versión legible del salvia para texto |
| `warning` / `warningSoft` | `#8A5D18` / `#F3E7D3` | Confianza baja, avisos suaves |
| `danger` / `dangerSoft` | `#A8452E` / `#F6E3DD` | Solo errores de sistema y validación |

### Reglas de contraste (WCAG AA, ya calculadas)

- `primary` sobre `cream`: 7.8:1 y `ink` sobre `cream`: 13.9:1. Ambos sirven para cualquier tamaño de texto.
- Blanco sobre `primary`: 8.6:1. Es la combinación de los botones principales.
- `inkMuted`, `sageText`, `warning` y `danger` superan 4.5:1 sobre `cream` y sobre blanco.
- **`sage` (`#87A27B`) nunca se usa para texto** sobre crema ni blanco (2.5:1), ni se pone texto blanco encima (2.8:1). Si hace falta texto "en salvia", usá `sageText`. Texto `primary` sobre `sage` solo para tamaños grandes (≥ 18 Bold).
- El color nunca es la única forma de transmitir información: siempre va acompañado de texto o ícono.

### Contenido responsable (RNF-10)

El consumo de comida **nunca se pinta como error**. Pasarse de la meta no usa `danger` ni rojos: la barra sigue en `primary` y el texto lo dice de forma neutra. `danger` queda reservado a fallas técnicas (un análisis `failed`, un campo inválido, sin conexión).

## 2. Tipografía

La fuente es **Telegraf** (Pangram Pangram), en todos los textos de la app. Los archivos van en `assets/fonts/` y se cargan con `expo-font` antes de ocultar el splash.

Pesos que usamos: Regular (400), Medium (500) y Bold (700). Si los archivos disponibles en `assets/fonts/` no son exactamente esos, mapeá al peso más cercano y avisalo.

En React Native, con fuentes custom **cada peso es una familia distinta** y `fontWeight` no se debe combinar con `fontFamily` (en Android rompe o cae a la fuente del sistema). Por eso los tokens exponen familias por peso:

```ts
export const fonts = {
  regular: 'Telegraf-Regular',
  medium: 'Telegraf-Medium',
  bold: 'Telegraf-Bold',
} as const;
```

### Escala

Valores en dp, con `lineHeight` absoluto.

| Token | Tamaño / interlínea | Peso | Letter spacing | Uso |
|---|---|---|---|---|
| `display` | 40 / 44 | Bold | -0.5 | Número grande de kcal, cifra principal del Wrapped |
| `h1` | 28 / 34 | Bold | -0.3 | Título de pantalla |
| `h2` | 22 / 28 | Bold | -0.2 | Título de sección, título de tarjeta grande |
| `h3` | 18 / 24 | Medium | 0 | Nombre del plato, títulos de tarjeta |
| `body` | 16 / 24 | Regular | 0 | Texto general |
| `bodyStrong` | 16 / 24 | Medium | 0 | Énfasis dentro del cuerpo, valores en listas |
| `label` | 16 / 20 | Medium | 0.1 | Texto de botones |
| `small` | 14 / 20 | Regular | 0 | Texto secundario, ayudas de inputs |
| `caption` | 12 / 16 | Medium | 0.3 | Etiquetas de macros, timestamps, badges |

Reglas: un solo `h1` por pantalla; texto de cuerpo nunca por debajo de 14; respetar el escalado de fuente del sistema (no desactivar `allowFontScaling`), con `maxFontSizeMultiplier` de 1.3 en `display` y `h1` para que no rompan el layout.

### Números y rangos

Los rangos son el corazón de la app y se escriben siempre igual: `620–780 kcal`, con guion medio (–) sin espacios y la unidad al final. Los macros como `38–46 g`. En el dashboard, el rango va en `display` o `h2` color `primary` y el valor central, si se muestra, en `small` color `inkMuted`.

## 3. Espaciado y layout

Grilla de 4. Tokens: `xxs 4 · xs 8 · sm 12 · md 16 · lg 20 · xl 24 · xxl 32 · xxxl 48`.

- Padding horizontal de pantalla: `lg` (20).
- Separación entre tarjetas o secciones: `xl` (24).
- Padding interno de tarjeta: `md` (16) a `lg` (20).
- Separación entre título y contenido: `xs` (8) a `sm` (12).
- Targets táctiles de al menos 44 × 44, aunque el elemento visible sea más chico (usar `hitSlop`).
- Respetar safe areas con `react-native-safe-area-context`.

## 4. Radios, bordes y sombras

Las formas son redondeadas como la llama del logo; nada de esquinas rectas.

| Token | Valor | Uso |
|---|---|---|
| `radius.sm` | 8 | Badges, thumbnails chicos |
| `radius.md` | 12 | Inputs, tarjetas chicas, foto en listas |
| `radius.lg` | 20 | Tarjetas, foto en detalle |
| `radius.xl` | 28 | Esquinas superiores de bottom sheets, tarjetas del Wrapped |
| `radius.full` | 999 | Botones, chips, pills, avatares, barras de progreso |

Bordes: 1 dp en `border` por defecto. Foco de input: 2 dp en `primary`. Error de input: 1.5 dp en `danger`. Divisores con `StyleSheet.hairlineWidth` en `border`.

Sombras: el estilo es plano. Las tarjetas se separan del fondo por `surface` blanco + borde, no por sombra. La sombra (`shadow.float`) se reserva para lo que flota: el botón "Registrar" de la barra de pestañas, bottom sheets y toasts.

```ts
float: {
  shadowColor: '#1F5637',
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
}
```

## 5. Componentes base

Toda pantalla se arma con estos componentes. Si falta uno, se crea en `components/` siguiendo estas reglas, no se estiliza inline.

- **Text**: wrapper de `Text` con prop `variant` (los tokens de la escala) y `color` (tokens de color). Por defecto `body` en `ink`. Nunca usar el `Text` de React Native directo en pantallas.
- **Button**: altura 52, `radius.full`, texto `label`. Variantes: `primary` (fondo `primary`, texto `onPrimary`), `secondary` (fondo `sageSoft`, texto `primary`), `ghost` (sin fondo, texto `primary`) y `destructive` (fondo `ink`, texto `onPrimary`; ver "Acciones irreversibles"). Presionado: `primaryPressed` o leve opacidad 0.85. Deshabilitado: opacidad 0.4. Estado loading con spinner del color del texto, manteniendo el ancho. Con `icon`, el ícono va antes del texto y del mismo color; el texto va siempre.
- **IconButton**: círculo de 44 con un ícono de 24. Lleva `label` para el lector de pantalla y, si la acción importa, `caption`: el texto visible debajo del ícono, dentro del mismo botón ("Galería", "Anterior", "Descartar"). Un ícono solo queda para controles que todo el mundo entiende (reproducir, pausar) y siempre con texto al lado.
- **Input**: altura 52, fondo `surface`, borde 1 `borderStrong`, `radius.md`, padding horizontal `md`. Label arriba en `small` Medium `ink`; ayuda o error abajo en `small`. Foco con borde 2 `primary`.
- **Card**: fondo `surface`, borde 1 `border`, `radius.lg`, padding `md`–`lg`. Sin sombra.
- **Chip / Badge**: `radius.full`, fondo `sageSoft`, texto `caption` en `primary`. Seleccionado: fondo `primary`, texto `onPrimary`.
- **ConfidenceBadge**: alta → fondo `sageSoft`, texto `primary`; media → fondo `surfaceAlt`, texto `sageText`; baja → fondo `warningSoft`, texto `warning`. Siempre con la palabra ("Confianza alta"), nunca solo color.
- **ProgressBar**: altura 10, `radius.full`, track `surfaceAlt`. El consumido se dibuja como relleno `primary` hasta el mínimo del rango y una banda `sage` desde el mínimo hasta el máximo, para que la incertidumbre se vea. Si se pasa de la meta, la barra queda llena en `primary`, sin rojo.
- **Sheet**: hoja que sube desde abajo, encima de todo, para un aviso con acciones de la app. Fondo `surface`, esquinas superiores `radius.xl`, `shadow.float`, padding `lg` (arriba `xl`) más la safe area de abajo, y detrás el `scrim` (el `ink` al 40 %). Se cierra con su botón, tocando afuera, con el atrás de Android o con el gesto de escape de VoiceOver, y el lector de pantalla queda adentro. Entra con un fundido y una subida corta (`motion.enter`), sin animación si se pidió reducir movimiento. Para confirmar que se borra o descarta algo no se usa: eso es `confirmAction`, el diálogo del sistema.
- **Screen**: contenedor con fondo `background`, safe area y padding horizontal `lg`. En las pestañas va con `edges={["top", "left", "right"]}` (abajo está la barra); en los detalles, con `["bottom", "left", "right"]` (arriba está el header).
- **ListGroup / ListRow**: menú estilo configuración. `ListGroup` es una tarjeta (`surface`, borde, `radius.lg`) con las filas separadas por un divisor alineado con el texto; cada `ListRow` lleva el ícono en un círculo `sageSoft`, el título, el resumen de lo que hay adentro en `small` `inkMuted` ("1.200 kcal por día", "Neutro") y la flecha, y abre la pantalla de esa sección. Una pantalla con varias secciones (como Perfil) es un menú así, no una lista larga de formularios.
- **Notice**: el estado vacío, de espera o de error de un bloque: ícono de línea en `inkMuted`, título `h3`, explicación en `inkMuted` y, como `children`, la acción con texto ("Reintentar", "Registrar comida"). Nunca un estado sin salida y nunca en rojo por la comida.
- **Toast** (`useToast()`): confirmación breve de que algo salió bien después de guardar, borrar o corregir: fondo `primary`, texto `bodyStrong` en `onPrimary`, ícono de check, `radius.lg` y `shadow.float`. Va abajo, encima de la barra, dura 3 s (`motion.toast`), no se toca y el lector de pantalla lo anuncia. El texto, en pasado y corto: "Guardamos la corrección.", "Eliminamos la comida.".
- **confirmAction**: antes de borrar o descartar algo, el diálogo del sistema. Título como pregunta ("¿Eliminar esta comida?"), qué se pierde en el mensaje y dos botones: "Cancelar" y el verbo de la acción ("Eliminar", "Descartar", "Cerrar sesión"). Sin estilo `destructive`: no va en rojo.
- **TextButton**: acción chica dentro de un bloque, en `smallStrong` `primary`. Con `color="inkMuted"`, para una acción que tiene que estar a la vista sin llamar la atención ("Eliminar cuenta").

### Acciones irreversibles

Eliminar la cuenta es la única acción que no se puede deshacer de ninguna forma, y tiene su propio estilo. No usa `danger`: el rojo queda para errores técnicos y una decisión de la persona no es un error.

- **Dónde se ofrece:** al final del perfil, debajo de "Cerrar sesión", como `TextButton` en `inkMuted`. No lleva ícono ni color, pero se encuentra si se busca.
- **Pantalla propia, no un diálogo:** un detalle ("Eliminar cuenta") que dice qué se borra, en una lista concreta (perfil y metas, comidas con fotos y audios, resúmenes y racha), qué pasa con la suscripción si la hay y, en `bodyStrong`, "No se puede deshacer ni recuperar."
- **Más que un toque:** el botón queda deshabilitado hasta escribir la palabra ELIMINAR en un `Input`, sin importar mayúsculas ni espacios. No se pide la contraseña: no hay forma de recuperarla, y quien la olvidó tiene que poder borrar su cuenta igual.
- **El botón:** `Button variant="destructive"`, con fondo `ink`, texto `onPrimary` e ícono `Trash`, y el verbo con el objeto: "Eliminar mi cuenta". Va solo en el último paso, nunca como primera acción de una pantalla. El verde `primary` dice "el camino esperado" y el `ink` es serio sin ser alarma (15:1 con el blanco).
- **Si falla:** el error va en `FormError` y se reintenta con el mismo botón. No se toca nada del teléfono hasta que el servidor confirma.
- **Después:** la app vuelve al login con un título tranquilo, "Eliminamos tu cuenta", y una línea que dice qué se borró. No lleva toast porque ya no hay sesión.

## 5b. Navegación

La app se recorre con una barra de pestañas y pantallas de detalle encima. Las pantallas nuevas entran en uno de estos dos lugares; ninguna queda sin salida.

- **TabBar** (`app/src/app/(app)/(tabs)/_layout.tsx`): Inicio (`House`) · Historial (`History`, el reloj con la flecha) · **Registrar** (`Camera`) · Semana (`CalendarDays`) · Perfil (`CircleUserRound`). Cada pestaña lleva ícono y texto `caption`. La activa va en `primary` con el ícono sobre una pastilla `sageSoft`, y la inactiva en `inkMuted`. "Registrar" no es una pestaña: es un círculo `primary` de 52 con `shadow.float`, que sobresale de la barra y abre la cámara. Los textos de la barra y del header crecen hasta 1.3× con la fuente del sistema.
- **Pestañas**: cada una tiene su título `h1` arriba ("Hoy", "Historial", "Tu semana", "Perfil") y no lleva header. El inicio lleva además el logo a color centrado arriba (`<Logo variant="color" width={sizes.logo.homeWidth} />`). El atrás de Android en una pestaña vuelve a Inicio; en Inicio, cierra la app.
- **Detalles** (Tu comida, Corregir comida, la semana de un aviso, Tu plan): van en el Stack de `(app)`, encima de las pestañas, con el header común (**ScreenHeader**): "‹ Volver" con texto arriba a la izquierda (**HeaderButton**) y, debajo, el título en `h2` (negrita) alineado con el contenido; si es largo, baja de línea. Debajo siempre quedan las pestañas (`anchor`), así una pantalla que se abre sola, por un aviso o un link, vuelve al inicio con "Volver", con el atrás de Android o con el gesto de iOS. Para volver desde código, `goBack()`; para ir al inicio, `goHome()`.
- **Pantallas completas** (la cámara): sin header ni barra, con "✕ Cerrar" (`HeaderButton`) arriba a la izquierda. Si cerrar pierde algo (un audio grabado), pregunta con `confirmAction`, también con el atrás de Android (`usePreventRemove`).

**Textos de navegación y acciones**, siempre iguales:

| Situación | Texto |
|---|---|
| Volver a la pantalla anterior | "Volver" (en el header) |
| Ir al inicio desde un estado sin salida (por ejemplo, un 404) | "Ir al inicio" |
| Salir de una pantalla completa | "Cerrar" |
| Algo falló | "Reintentar" |
| Todavía no está (un análisis que tarda, un resumen que no se armó) | "Actualizar" |
| Registrar una comida | "Registrar comida" (en la barra, "Registrar") |
| Energía del día | "Calorías"; macros: "Proteínas", "Carbohidratos", "Grasas" |
| Ir a la pantalla de planes (desde un aviso de cupo o de premium) | "Ver planes" |

### Planes y suscripción

La pantalla **Tu plan** (`/plan`) es un detalle: se llega desde la fila "Tu plan" del perfil, desde la hoja de "Registrar" cuando no quedan análisis y desde los avisos de `MEAL_QUOTA_EXCEEDED` y `PREMIUM_REQUIRED` ("Ver planes"). Reglas para todo lo que hable de planes o de cobros:

- **Precios y cupos salen de la API**, nunca escritos en la app. El precio va siempre con moneda y período, sin `$` ambiguo: `US$ 4,99 por mes`, `$U 1.290 por año`. Las fechas, en la zona del usuario: "se renueva el 4 de diciembre".
- **Antes del botón de pagar** se lee, en texto normal (no en letra chica): cuánto se cobra y cuándo, que se renueva sola y cada cuánto, y cómo se cancela. Nada de pruebas que pasan solas a pago, opciones premarcadas ni botones de cerrar escondidos.
- **Cancelar lleva los mismos pasos que suscribirse** (el botón y una confirmación) y está a la vista, como `Button` secundario con texto. El diálogo (`confirmAction`) dice hasta cuándo sigue premium y que no se cobra más, sin intentar convencer ni hacer sentir culpa: "¿Cancelar la suscripción?", con "Volver" y "Cancelar suscripción".
- **Quedarse sin análisis no es un error**: va con `Notice` o en la tarjeta del plan, en los colores de siempre, sin rojo ni signos de exclamación ("Usaste los 40 análisis de este mes. Se renuevan el 1 de diciembre.").
- **Sin análisis, "Registrar" no abre la cámara**: muestra una hoja nuestra (`QuotaSheet`, sobre `Sheet`) con lo mismo que la tarjeta de Tu plan: el título en `h2` `primary`, la barra llena y cuándo se renuevan. Abajo, "Ver planes" (`primary`) y "Cerrar" (`secondary`), del mismo tamaño y a la vista. Todo botón que abra la cámara usa `useOpenCapture()` (`features/billing/captureGate.tsx`) en vez de `router.push("/capture")`. Si el plan no se puede saber, la cámara se abre igual y el aviso de la vista previa (`MEAL_QUOTA_EXCEEDED`) queda de respaldo.
- **Mientras se confirma un pago** se muestra "Estamos confirmando tu pago" con un indicador, nunca un error, y no hay botón para pagar de nuevo.

## 6. Íconos e imágenes

Íconos de línea, con terminaciones redondeadas, trazo 1.75–2, tamaño 24 (20 en contextos densos), color `ink` o `primary`. Si el proyecto ya usa una librería de íconos, seguí esa; si no, `lucide-react-native`. No mezclar estilos rellenos y de línea.

Las fotos de comida van con `radius.md` en listas y `radius.lg` en el detalle, siempre con `resizeMode` cover y un placeholder `surfaceAlt` mientras cargan.

## 7. Logo

- Isotipo (la llama) y wordmark "CalorIA", con "Calor" en `primary` e "IA" en `sage`. En código, `<Logo variant="color" />` (`assets/logo/logo-color*.png`) sobre `cream` o blanco y `<Logo />` (la crema) sobre `primary`.
- Va sobre `cream` o blanco. Sobre fondo `primary` se usa la versión monocroma en `cream`.
- No recolorear, deformar, rotar, ponerle sombra ni ubicarlo sobre `sage` o sobre fotos.
- Espacio libre alrededor de al menos la mitad del ancho de la llama. Tamaño mínimo del isotipo: 24 dp.
- Splash: fondo `cream` con el isotipo centrado. App icon: isotipo sobre `cream`.

## 8. Movimiento

Transiciones cortas (150–250 ms) con easing de salida, sin rebotes exagerados. Respetar la preferencia de reducir movimiento del sistema. Los skeletons usan `surfaceAlt` con un pulso suave, no shimmer brillante.

## 9. Modo oscuro

En v1 la app es solo clara. Igual, todo pasa por tokens para que agregar un tema oscuro sea cambiar valores y no componentes.

## Checklist antes de dar por terminado un cambio visual

1. No hay hex, tamaños de letra, márgenes ni radios hardcodeados fuera de `theme/`.
2. Todo texto usa el componente `Text` con una variante de la escala y una familia Telegraf.
3. Nada de texto en `sage` puro ni texto blanco sobre `sage`.
4. Los rangos se escriben `min–max unidad`.
5. Pasarse de la meta no se muestra en rojo ni con tono de alarma.
6. Targets táctiles ≥ 44 y safe areas respetadas.
7. Las acciones importantes tienen texto visible, no solo un ícono.
8. Desde la pantalla se vuelve al inicio (pestañas o "Volver"), también si se abrió sola, y el atrás de Android hace lo mismo que el botón.
9. Guardar, borrar o corregir confirma con un Toast; borrar o descartar pregunta antes con `confirmAction`.
10. Si muestra un precio o un cobro: sale de la API, va con moneda y período, y antes de confirmar se lee cuándo se renueva y cómo se cancela (ver "Planes y suscripción").
11. Se probó con la fuente del sistema agrandada y en iOS y Android.
