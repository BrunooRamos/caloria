# Modelo de datos

MongoDB con cuatro collections, tipadas con TypeScript + esquemas Mongoose. Solo acceden el Backend y el Worker.

`?` = opcional · `[]` = array embebido · `Range = { min: number; max: number }`

## `users`

Identidad, perfil y configuración.

```ts
_id: ObjectId
createdAt: Date
email: string                 // índice único, en minúsculas
passwordHash: string          // bcrypt, cost 12
profile: {
  sex: "female" | "male"
  birthDate: string           // "YYYY-MM-DD"; la edad se calcula
  heightCm: number
  weightKg: number
  activity: "sedentary" | "light" | "moderate" | "active" | "very_active"
  goal: "lose" | "maintain" | "gain"
  timezone: string            // ej. "America/Montevideo"; define el "día" del usuario
}
targets: { kcal: number; proteinG: number; carbsG: number; fatG: number }   // recalculadas al editar profile
tone: "motivador" | "neutro" | "roast" | "off"
plan: { tier: "free" | "premium"; since: Date; renewsAt?: Date }
usage: { month: string; analyses: number }   // "2026-10"; se reinicia al cambiar de mes
pushTokens: string[]
sessions: { tokenHash: string; family: string; expiresAt: Date; rotatedAt?: Date; revokedAt?: Date }[]
```

- `sessions.tokenHash` es el SHA-256 del refresh (nunca el token) y tiene índice: `/auth/refresh` y `/auth/logout` buscan por ahí.
- Los refresh rotados (`rotatedAt`) y revocados (`revokedAt`) no se borran hasta que vencen: así un reuso se distingue de un token inventado.
- En cada escritura de `sessions` se descartan las vencidas y se aplican dos topes: 10 sesiones activas y 100 rotadas o revocadas; al pasarlos se descartan las más viejas.

## `meals`

Cada comida con su media, transcripción, análisis, comentario y el historial de correcciones que alimenta el compounding.

```ts
_id: ObjectId
userId: ObjectId
capturedAt: Date
localDate: string             // "YYYY-MM-DD" en la zona del usuario; para historial, dashboard y racha
status: "processing" | "ready" | "failed"
media: { photoKey: string; audioKey?: string }
transcript?: string
note?: string
analysis?: {
  dish: string
  items: { name: string; grams: Range; kcal: Range }[]
  kcal: Range
  macros: { protein: Range; carbs: Range; fat: Range }
  confidence: number          // 0 a 1
  promptVersion: string       // `version` del frontmatter de prompts/analisis-comida.md
  model: string               // el modelo que devolvió OpenAI
}
corrections: { field: string; from: unknown; to: unknown; at: Date }[]
comment?: { tone: string; text: string }
attempts: number              // reintentos del job de análisis
error?: { code: string }      // con status "failed": "ENQUEUE_FAILED" (no se pudo encolar; reprocesable) o "NOT_FOOD" (la foto no es comida; no consume cupo)
```

La media vive en `users/{userId}/meals/{mealId}/photo.{jpg|png|heic}` y `…/audio.m4a`.

Los valores que se muestran y que suman en el dashboard son los del análisis **con las correcciones aplicadas**. `corrections` guarda el historial de cambios.

## `weekly_summaries`

El Wrapped de cada usuario y semana. Se genera una vez por cron para no recalcular en cada lectura.

```ts
_id: ObjectId
userId: ObjectId
week: string                  // ISO week, ej. "2026-W38"
status: "pending" | "ready" | "failed"
metrics: { avgKcal: number; daysLogged: number; streak: number; topDish: string }
insights: string[]            // generados por IA
promptVersion: string
generatedAt: Date
```

## `gamification`

Racha e hitos. Está separada de `users` porque se escribe en cada registro de comida.

```ts
_id: ObjectId
userId: ObjectId              // índice único
streak: { current: number; best: number; lastLogDate: string }   // "YYYY-MM-DD"
badges: { code: string; at: Date }[]
```

## Índices

| Collection | Índice | Tipo |
|---|---|---|
| `users` | `email` | único |
| `meals` | `{ userId, capturedAt }` | compuesto |
| `meals` | `{ userId, localDate }` | compuesto |
| `weekly_summaries` | `{ userId, week }` | único |
| `gamification` | `userId` | único |

## Cálculo de metas (RF-02)

1. **Metabolismo basal:** Mifflin-St Jeor.
   - Mujer: `10·peso + 6.25·altura − 5·edad − 161`
   - Hombre: `10·peso + 6.25·altura − 5·edad + 5`
2. **Gasto diario:** basal × factor de actividad (sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9).
3. **Ajuste por objetivo:** lose −500 kcal · maintain 0 · gain +300 kcal. Nunca por debajo de 1200 kcal (RNF-10).
4. **Macros:** proteína 1.8 g/kg · grasas 25% de las kcal (÷ 9) · carbohidratos el resto (÷ 4).

Se redondea a la unidad. Las metas se recalculan cada vez que cambia `profile`.
