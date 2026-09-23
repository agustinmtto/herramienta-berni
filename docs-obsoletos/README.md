# docs-obsoletos/ — Documentación jubilada

**Nada de lo que hay acá debe usarse como especificación o referencia técnica.** Se conserva por trazabilidad histórica y por decisión del proyecto (no se borra material). Cada archivo explica por qué se jubiló y dónde vive su contenido vigente.

## Documentos jubilados

| Archivo | Qué era | Por qué se jubiló | Su contenido vigente vive en |
|---|---|---|---|
| `01-reunion-integracion.md` | Síntesis de la reunión con Miled/Berni (17-sep-2026) donde se decidió la integración por código vs. Go High Level | Las decisiones que siguen vigentes están consolidadas en `docs/00` §Decisiones y en `docs/11`; el resto son requerimientos históricos ya implementados o descartados | `docs/00-OVERVIEW.md`, `docs/11-migracion-modulo-leads.md` |
| `02-audio-berni-requisitos.md` | Requisitos de negocio del audio de WhatsApp de Berni (4-sep-2026): qué preguntar y por qué, ganchos psicológicos del diagnóstico | Las 8 preguntas definitivas ya están implementadas y publicadas (definición `diagnostico-cripto-v1-a`); los ganchos quedaron plasmados en el motor determinístico | `docs/11` §4 (definición de preguntas), `metacrypto-os-app/apps/inbox/lib/quiz/` (config + engine) |
| `03-especificacion-mvp-standalone.md` | Especificación del MVP standalone (app propia pre-integración): JSON `pregunta/respuesta`, contrato efímero, deploy aparte | Superada por completo: el funnel vive en el OS del negocio con el contrato versionado (decisión D1 de `docs/11`) | `docs/11-migracion-modulo-leads.md` |
| `05-prototipo.md` | Descripción del prototipo descartable `prototipos/index.html` y cómo migrarlo | La migración está terminada (el funnel portado a `/quiz`); el prototipo queda como referencia histórica en `prototipos/` | `docs/11`, el código real en `metacrypto-os-app/apps/inbox/app/quiz/` |

## Fuentes primarias (`fuentes-primarias/`)

Material crudo de donde salió todo lo demás — **no editar, no borrar**:

- `Transcripcion_Reunion-OBSOLETO-fuente-primaria-20260917.md` — transcripción completa de la reunión de integración.
- `transcripcion_audio-OBSOLETO-fuente-primaria-20260904.md` — transcripción del audio de WhatsApp de Berni.
- `ANALISIS_INTEGRACION_QUIZ_LEADS-v1.0-20260916.md` — análisis pre-integración del esquema del OS; superado por `docs/11` + `docs/12`.

*Jubilados el 22-sep-2026 al reorganizar la documentación viva (ver `docs/README.md`).*
