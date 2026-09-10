# Roadmap de implementación

Cómo pasamos del prototipo (`prototipos/index.html`) al producto integrado en el stack del negocio (Supabase + Next.js). Los requisitos viven en `docs/03-especificacion.md` (fuente de verdad); este doc define el **cómo**: entornos, ramas, migraciones, división de trabajo y fases. Cualquier cambio de requisitos se edita primero en `docs/03` y se refleja aquí.

## 1. Modelo de trabajo

Resumen del flujo acordado:

1. Sacamos el **schema/DDL de producción** de Supabase del negocio.
2. Lo levantamos **localmente con Supabase CLI + Docker**.
3. Cada dev tiene su **propia copia local** para desarrollar sin tocar producción.
4. Trabajamos con ramas de Git: `feature/...` para cada tarea (ver `docs/07` §3 para naming).
5. Nos dividimos por **funcionalidad/responsabilidad**, no por carpetas (§2).
6. Cada cambio de DB genera **su propia migration**, para no pisarnos.
7. Tarea terminada → **PR → revisión → merge a main**.
8. Probamos todo **integrado en local** (main + Docker arriba).
9. Cuando está OK, aplicamos las migrations a **producción** (§4, con Miled).

### 1.1 Por qué local con Docker (y no branch de Supabase)

- La reunión (`docs/01` §2) propuso una branch de Supabase como entorno dev, pero Supabase **cobra compute por branch** y no escala a un branch por persona.
- Con Supabase CLI + Docker: **N copias locales a costo cero**, idénticas a producción vía migrations, riesgo cero para producción.
- Lo único compartido es el repo: las **migrations son el contrato** entre devs y con producción.
- Esto reemplaza el pendiente #3 de `docs/06` (validar branch de Supabase como dev).

### 1.2 Setup inicial (una sola vez)

| Paso | Acción | Nota |
|---|---|---|
| Accesos | Miled da acceso al proyecto Supabase (lectura basta para el dump) y al repo GitHub del negocio | Secrets de servicio en variables de entorno, nunca en repo (`docs/07` §5) |
| Extraer schema | `supabase link --project-ref <ref>` → `supabase db pull` (alternativa: `pg_dump --schema-only`) | Genera la migration **baseline** (`<ts>_remote_schema.sql`); sin datos |
| Init local | `supabase init` + `supabase start` | Studio `:54323` · API `:54321` · DB `:54322` |
| Seed | `supabase/seed.sql` con leads/sesiones de prueba | No reinventar data a mano en cada `db reset` |
| Módulo | Crear estructura del módulo "diagnóstico" dentro del repo Next.js del negocio, en branch | `docs/03` §5: la herramienta es un módulo del sistema, no un sistema aparte |

Si el repo del negocio ya tiene carpeta `supabase/`, respetar su `config.toml` y solo añadir migrations nuevas.

### 1.3 Ciclo por tarea

```text
git checkout main && git pull
git checkout -b feature/<slug>
  ├─ cambio de DB → supabase migration new <nombre> → SQL → supabase db reset
  ├─ cambio de app → código contra localhost:54321
  └─ probar el flujo entero con supabase start + npm run dev
git commit (conventional commits, docs/07 §4)
PR a main → revisión (Agustín/Lisandro; Miled si cruza su infra)
merge → borrar branch (PRs acotados: Supabase/CI cobra por branches vivas)
```

Reglas de migrations:

- **Append-only:** una migration por cambio de DB, nombre descriptivo. Nunca editar una migration ya mergeada; se agrega una nueva encima.
- `supabase db reset` antes de abrir el PR: garantiza que todas las migrations corren desde cero.
- Si producción cambia mientras desarrollamos (Miled u otro proceso): re-sincronizar con un nuevo `db pull` → migration de diff, antes del push.

## 2. División de responsabilidades (propuesta a confirmar)

Por funcionalidad/responsabilidad (no por carpetas):

| Frente | Contenido | Owner propuesto |
|---|---|---|
| DB / modelo de datos | Migrations: leads, respuestas, sesiones, tracking; RLS; índices | - |
| Wizard + UI | Migrar prototipo → Next.js con el design system (`docs/04`) | - |
| Tracking | `session_id` + dropoff (hasta qué pregunta llega el lead) | - |
| Motor determinístico | Reglas/algoritmo sobre las respuestas (tono/ganchos de `docs/03` §4), salida estructurada | - |
| Entrega | Pantalla final de video (3 videos: 2 genéricos + 1 variable por pregunta final, mapeo config-driven), alerta lead caliente | - |
| Módulo de leads (admin) | Entrada en menú lateral + reporte filtrable | - |

## 3. Fases

### Fase 0 — Infraestructura de desarrollo
**Objetivo:** poder desarrollar sin tocar producción, con el repo del negocio listo.
- [ ] Accesos: repo GitHub del negocio, Supabase (lectura), coordinación con Miled
- [ ] `db pull` → schema de producción como migration baseline (commit en branch `feature/infra-local-supabase`)
- [ ] Supabase local (Docker) corriendo para ambos devs + seed de prueba
- [ ] Estructura del módulo dentro del repo Next.js definida

**Salida:** ambos devs levantan el sistema completo en local (`supabase start` + `npm run dev`).

### Fase 1 — Captación
**Objetivo:** wizard real, datos a Supabase y tracking mínimo, con el diagnóstico determinístico del prototipo (el prototipo sigue siendo referencia de comportamiento).
- [x] Wizard en Next.js con preguntas genéricas config-driven (mientras Berni define las definitivas — bloqueante #1 de `docs/06`; el swap es barato: solo `lib/question-config.js`) — branch `feature/wizard-mvp`
- [x] `POST` del JSON agnóstico (`docs/03` §2) — stub con validación (`app/api/lead`); falta apuntar a Supabase del negocio
- [x] Tracking: `session_id` + dropoff por `sendBeacon` (`docs/03` §6)
- [x] Suite de tests en `test/` (`npm test`, unit + integración + seguridad)
- [x] Captura de teléfono obligatoria en contacto + payload/API
- [ ] Migrations: tablas de leads/respuestas/sesiones + flag `hot_lead` (> 10.000 USD, bloqueante #8) — requiere Fase 0
- [ ] Deploy en Netlify (conectar repo) y merge del PR

**Salida (parcial):** flujo completo funcionando en local (pantallas wizard → segmentación → análisis → final única diagnóstico+videos) con lead visible en logs del endpoint.

### Fase 2 — Motor determinístico definitivo
- [x] Motor determinístico stub (`lib/engine.js`) con reglas por tags sobre opciones múltiples, 4 secciones canónicas (`docs/03` §4)
- [ ] Recalibrar reglas cuando Berni entregue las preguntas definitivas

**Salida:** diagnóstico determinístico real, visible en local.

### Fase 3 — Entrega y triaje
- [x] **Pantalla final única** (`docs/03` §9): diagnóstico + grid de 3 video-cards placeholders (2 genéricos + 1 destacado según pregunta de segmentación) — mapeo config-driven
- [x] PDF base por botón (`docs/03` §9.1), generado desde un documento HTML fijo personalizado por nombre
- [x] CTA a WhatsApp con mensaje generado desde todas las respuestas
- [x] Documento HTML/PDF base y ajustes mobile-first
- [ ] PDF por email vía Resend + tracking de apertura (bloqueante #12) y quitar botón dev
- [ ] Videos reales de Berni + host del player + embed trackeable (sub-pendiente del #11)
- [ ] Alerta al triaje para lead caliente (notificación en el sistema)
- [ ] Módulo de leads en el sistema (menú lateral, reporte filtrable — bloqueante #4, definir con Miled quién lo hace)

**Salida:** flujo punta a punta funcionando en local: wizard → diagnóstico → entrega (video + PDF) → alerta → reporte.

### Fase 4 — Producción y lanzamiento orgánico
- [ ] Revisión integrada final: todo merged a main, probado en local punta a punta
- [ ] Aplicar migrations a producción (`supabase db push`) — con Miled (§4)
- [ ] Deploy de la app al hosting del negocio
- [ ] Smoke test en producción con datos de prueba
- [ ] Link con UTMs → Berni lanza en Instagram (orgánico primero)

**Salida:** herramienta viva; métricas de `docs/06` corriendo desde el día 1.

### Fase 5 — Experimentación (post-lanzamiento)
A/B de formatos (largo vs. pop-up de continuación, orden de preguntas), análisis de data y automatizaciones de outreach (`docs/01` §4, `docs/06`).

## 4. Política de despliegue a producción

- Producción del negocio **nunca** se toca desde local ni desde branches: solo recibe migrations consolidadas y aprobadas.
- Ritmo: al cierre de cada fase (o antes si Miled lo pide) → PR de release con el set de migrations → revisión de Miled → `supabase db push` → verificación.
- Rollback: las migrations son append-only; revertir = nueva migration inversa.
- La app (Next.js) se despliega según el pipeline del negocio; el criterio es el mismo: main integrado y probado en local antes de deploy.

## 5. Definition of Done (por tarea)

- [ ] Si toca requisitos: spec actualizada primero (`docs/03`)
- [ ] Si toca DB: migration propia + `supabase db reset` en limpio
- [ ] Probado contra Supabase local real (no mocks del medio)
- [ ] PR con qué/por qué + screenshots si toca UI (`docs/07` §5)
- [ ] `docs/06` actualizado si el cambio afecta bloqueantes/estado

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Schema de producción sin historial de migrations | `db pull` captura el estado actual como baseline; de ahí en adelante todo es append-only |
| Drift entre devs o con producción | `db reset` antes de cada PR; re-sincronizar con `db pull` si producción cambió |
| Supabase cobra compute por branches | Local Docker = cero branches de DB; solo producción del negocio |
| Berni tarda con las preguntas definitivas | Fase 1 con preguntas del prototipo; JSON agnóstico permite el swap sin refactor |
| Migrations destructivas sobre tablas del negocio | Review obligatoria de Miled en el PR de release; nunca `drop` sin migración inversa |
| Secrets (Supabase/Resend) | Solo variables de entorno, nunca en repo (`docs/07` §5) |
líneas 3-141
