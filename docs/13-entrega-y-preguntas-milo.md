# 13 — Entrega del módulo de leads: estado, pendientes y qué pedirle al negocio

> **Propósito:** documento único de cierre de entrega. Resume en un lugar: (1) qué se implementó y cómo quedó validado, (2) qué decidimos nosotros solos, y (3) el mínimo que necesita del negocio (Milo/Miled — no técnico), con las frases exactas para pedirselo.
>
> Fuente de las decisiones funcionales: `docs/11`. Estado de fases: `docs/12` §6. Checklist de seguridad del módulo: `docs/09` §"Quiz Funnel en el OS".

---

## 1. Qué se entregó (rama `feature/leads-a-migracion-rpc`)

Migraciones `0068` (esquema + RPC de ingesta), `0069` (validación de teléfono, auditoría y rollback) y `0070` (descarte de leads); el funnel portado a `/quiz` como ruta pública del OS y el módulo `/leads` con permiso propio, vinculación post-venta y descarte.

**Corrección de los 6 bloqueantes del análisis externo** (editados in place: ninguna de esas migraciones había sido aplicada a producción):

| # | Bloqueante | Corrección | Test que la ejercita |
|---|---|---|---|
| 1 | Capital falsificable desde el navegador | Los importes (`capital_min/max_usd`) se leen de la **definición publicada** vía el `answer_id` validado; el `value` del cliente nunca pisa columnas. Los textos/valores del snapshot también se sellan desde la definición | `(B1) el capital se sella desde la DEFINICIÓN...` |
| 2 | Rollback se atascaba con varios leads por cliente | `desvincular_lead(p_cliente, p_lead_id?, autor)`: revierte UNA vinculación concreta (la del lead indicado o la más reciente **sin revertir**), marca su auditoría `revertido=true` y usa la misma advisory lock por lead que vincular | `(B2) dos leads vinculados a un cliente...` |
| 3 | "Vinculado ok" al cliente incorrecto | El early-return de lead archivado verifica en `auditoria` a qué cliente fue vinculado de verdad; si difiere → `lead_vinculado_a_otro_cliente` | `(B3) vincular sobre un lead ya vinculado...` |
| 4 | Sesión revalidada contra otra versión del quiz | El RPC lockea el envío antes de validar y rechaza con `version_conflictada` si el payload trae otra versión | `(B4) una sesión existente no se revalida...` |
| 5 | Consentimiento incompleto / fecha falsificada por silencio | completed exige nombre, `consent.version` y `accepted_at` parseable (`contacto_incompleto`); el CHECK de tabla exige versión + fecha; sin defaults silenciosos | `(B5) completed sin nombre/versión/fecha...` |
| 6 | Huecos de validación | Rechaza selección vacía, ids duplicados y activos duplicados (`seleccion_vacia` / `respuestas_duplicadas` / `allocation_duplicada`, mapeados a 422 en el endpoint) | 3 tests `(B6)` |

**Flujo comercial completo** (`docs/11` §9.3–9.4):
- Un lead puede completar el funnel **varias veces** (varios envíos bajo la misma persona temporal) y un cliente puede acumular **varias vinculaciones**: cada rollback revierte exactamente SU vinculación (la auditoría guarda la lista exacta de `envio_ids`).
- Camino "sin venta": botón **"Descartar lead (sin venta)"** en el detalle del envío → estado `'descartado'` (idempotente, auditado, no borra nada). Reactivación = update manual apoyado en la auditoría; UI de reactivación queda para otra fase.
- Endurecimiento del endpoint: `Content-Type` obligatorio → `415`, `Content-Length` validado antes de leer el body → `413` temprano (paridad con el standalone, que sí lo tenía y se había perdido en el port).
- Docs: regla de lead caliente unificada a **≥ 10.000 USD (desde 10.000 inclusive)** en `AGENTS.md`, `README`, `docs/00` y el módulo `/leads` (antes decían `>` en los docs operativos, en contradicción con lo decidido en `docs/06` #8 / `docs/11` §8).

**Validación ejecutada (22-sep-2026):**

```
supabase db reset   → 0001 → 0070 aplicando limpio (Supabase local + Docker)
vitest run          → 56 archivos · 1316/1316 tests en verde · 0 omitidos
tsc --noEmit        → limpio
prototipo npm test  → 39/39
npm run build (OS)  → OK
```

Antes de este trabajo la suite del OS reportaba 22 pruebas omitidas (justamente las de RPC/API contra Supabase): hoy corren todas contra la base real.

---

## 2. Decisiones que YA tomamos nosotros (no son preguntas)

| Item | Resolución |
|---|---|
| **Upgrade de Next del OS** | Hecho en este PR: `next` 15.5.22 → **15.5.25**. Las **2 vulnerabilidades críticas (RCE) quedaron cerradas** y, con `overrides` sin cambiar versiones mayores, también `nanoid` y `sharp` (2 de las 3 altas). De 4 vulnerabilidades a 2: queda solo `postcss` alta, cuya solución exige **Next 16** (cambio mayor, ticket aparte, no bloquea el funnel: no se usa `next/image` en el camino del quiz) |
| **AVIF / `next/image`** | Verificado en el código: no hay uso de `next/image` ni AVIF — el advisory de Image Optimization queda descartado |
| **Headers de seguridad globales** | Agregados en `next.config.mjs`: `nosniff`, `Referrer-Policy`, `Permissions-Policy` y `Strict-Transport-Security` (aditivos, seguro en dev). CSP y frame-deny quedan para un ticket aparte: exigen iteración contra las pantallas del OS (portales `/e/` y `/c/`, embeds de video) |
| **Regla de lead caliente** | Unificada: `≥ 10.000 USD (desde 10.000 inclusive)` en todos los docs y el UI |
| **Rate limiting** | Mientras responde el hosting (ver #3 abajo): sigue el in-memory de `lib/quiz/rate-limit.ts`; el call site ya está aislado para cambiar a Upstash o WAF sin tocar más código |

---

## 3. Lo único que necesitamos del negocio (frases listas para enviar)

1. **Números de migración** — *"Entrá a tu repo del OS y fijate si en la carpeta de migraciones ya existen archivos que empiecen con `0068`, `0069` o `0070`. Si no tenés ni idea, pasanos acceso de lectura al repo y lo chequeamos nosotros."*
   *(Por qué: los números son de una secuencia global del OS; si otra rama los usó, aplicar los nuestros en producción choca.)*
2. **Permiso `leads` (decisión de negocio, no técnica)** — *"¿Quién va a ver los leads y llamar en caliente? Proponemos como default: la persona que hace el triaje (hoy Berni) + todos los de acceso total. Si te sirve así, decí 'sí' y listo."*
3. **Acción puntual (no decisión): pegar `KAPSO_WEBHOOK_SECRET`** — *"En tu dashboard del hosting, en Environment Variables del OS, agregá una variable llamada `KAPSO_WEBHOOK_SECRET` con un texto largo aleatorio, y redesplegá. No es una integración nueva: es una clave del OS que existía sin setear; sin ella el webhook de WhatsApp acepa cualquier firma."*
4. **Desplegar con el orden**: a quien aplique migraciones *"aplicá 0068 → 0069 → 0070 ANTES de deployar el código (sin una migración previa, la app responde 400 en silencio)"* y después el smoke test de la §4. El deploy conserva las variables existentes del OS — no se agregan claves nuevas (opcionales de tuning: `LEAD_RATE_LIMIT_*`).
5. *(Opcional)* **Alerta de triaje** — *"¿La notificación al equipo cuando cae un lead caliente la hacemos ya o sigue después del lanzamiento (como se había acordado)?"*

---

## 4. Riesgos preexistentes del OS (informados, fuera de este PR)

Identificados por el análisis externo y **no tocados por el módulo de leads** (convertir en tickets propios, no mezclar con este PR):

- APIs internas de Inbox verifican sesión pero no permiso de módulo (cualquier usuario logueado puede leer conversaciones y enviar mensajes).
- Login sin rate limiting ni bloqueo; sesión de 30 días; usuarios desactivados conservan acceso (el middleware solo valida la firma de la cookie, no `team_members.activo`).
- RLS permisivo para el rol `authenticated` de Supabase (incluye leer hashes de `team_members`, pagos y conversaciones de WhatsApp); la app usa `service_role`, así que el riesgo depende de existentes usuarios Auth en producción.
- Redirect abierto tras el login (`next.startsWith("/")` acepta `//host-atacante`).

El detalle con archivo/línea quedó en el análisis previo ("respuesta despues de analisis - herramienta berni.txt").

---

## 5. Pendientes de contenido (no bloquean el deploy técnico)

- **3 videos reales de Berni** + host del player trackeable (docs/06 #9/#11) — los slots config ya existen (`url: ""` hasta que el negocio los provea).
- **PDF dinámico por email vía Resend** + pixel de apertura (docs/06 #12) — fase posterior.
- **Alerta de triaje** — ver pregunta opcional 5.

*Generado el 22-sep-2026. Estado de fases actualizado en `docs/12` §6.*
