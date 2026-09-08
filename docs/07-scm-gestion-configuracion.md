# Gestión de Configuración de Software (SCM)

Reglas obligatorias sobre el ciclo de vida del repo: nombrado de archivos, estructura, commits y manejo de branches. Cada directiva tiene un **por qué** (marcado con **R**) para que el agente argumente en base a ellas en vez de ejecutar a ciegas.

## 1. Nombrado de archivos

- **Documentación (`docs/`):** `NN-nombre-kebab-case.md` — prefijo numérico de dos dígitos marcando el orden de lectura (consistente con `00-OVERVIEW.md` … `08-roadmap.md`). Un doc nuevo usa el siguiente número libre.
  - Si hay que congelar una versión, archivar en `docs/archive/` con sufijo `-vX.Y-YYYYMMDD.md`; **no renombrar el archivo vivo**, porque los índices y referencias apuntan al mismo nombre.
- **Código:** `kebab-case` para archivos/paths; `camelCase` para identificadores JS/TS; `PascalCase` para clases/componentes.
- **Assets (imágenes, video, fuentes):** `contexto-descripcion.ext` (ej. `landing-hero-fondo.webp`), minúsculas, sin espacios ni acentos.
- **Prohibido:** mezclar idiomas en un mismo filename, espacios, mayúsculas aleatorias, y sufijos tipo `final`, `final2`, `nuevo`, `copia`, `v2_DEFINITIVO-ok-ahora`. Versionado explícito solo vía git.
- Las fuentes primarias crudas de la raíz (`Transcripcion_Reunion.md`, `transcripcion_audio.md`) **no se renombran**: son referidas por scripts/documentación; el contenido nuevo entra directo a `docs/`.

**R:** la documentación es spec-driven y se referencia por ruta estable; renombrar archivos rompe el índice de `AGENTS.md` y los links entre docs.

## 2. Estructura del repo (invariantes)

```
docs/                # documentación viva (spec-first: cambiar aquí, luego codificar)
referencia/          # material de terceros/uso interno: NO es código, no se limpia ni refactoriza
scripts/             # utilidades (transcribe.py, etc.)
index.html           # prototipo: referencia; no es base de la implementación real
```

- Nunca borrar material de `referencia/` ni las transcripciones: son fuente primaria.
- Agregar/quitar archivos requiere actualizar los índices (`AGENTS.md` y la tabla de `docs/00-OVERVIEW.md`) en el mismo cambio.

**R:** los índices viven mencionados por ruta; mover archivos sin actualizar índice deja al siguiente agente con contexto roto.

## 3. Estrategia de branches (regla del negocio)

Acordado con Miled — ver `docs/01-reunion-integracion.md` §2:

- Se trabaja SIEMPRE en **branch de desarrollo**, nunca directo en producción.
- Naming: `feature/<slug-corto>` (ej. `feature/wizard-tracking`), `fix/<slug>`, `docs/<slug>` para cambios de documentación.
- Cambios **PR acotado por módulo**: Supabase cobra compute por branches → no mantener branches vivas largamente; merge y eliminar.
- Revisión de conflictos/arquitectura con Miled antes del merge a producción.
- Nunca `--force`, ni rewrites de historial compartido.

**R:** el negocio solo tiene producción + local; la branch es el entorno de dev de facto y cuesta dinero mantenerla.

## 4. Formato de commits

Conventional Commits ligero:

```
<type>(<alcance opcional>): <descripción en minúscula, imperativa, sin punto final>
```

- Tipos válidos: `feat`, `fix`, `docs`, `refactor`, `chore`, `style`, `test`, `perf`.
- Idioma de los mensajes: **inglés** (los textos de UI y docs van en español).
- Mensajes largos: cuerpo separado por línea en blanco, referenciando la sección del doc de origen si aplica.

Ejemplos:
```
docs(add): scm conventions
feat(wizard): send lead payload to supabase
fix(tracking): dropoff timestamps for skipped questions
```

**R:** consistencia y legibilidad del historial; facilita review del negocio (que no es dev puro) y revert quirúrgico.

## 5. Prácticas de gestión de configuración

- **Un tema por commit/PR:** mezclar "arreglo tracking + renombro archivos + cambio colores" es antipatrón.
- **Spec-first:** todo cambio de requisitos entra primero como commit de `docs/`; la implementación lo referencia (ej. `feat: ... (docs/03 §5)`).
- **Estado del proyecto:** `docs/06-pendientes-y-preguntas.md` es el tracker; actualizar bloqueantes/completados en el mismo PR que lo afecta.
- **Secrets:** nunca en el repo (tokens Supabase, keys Anthropic, tokens GHL): usar variables de entorno. Las keys de la API de IA son propiedad del negocio.
- **Prohibido:** commits vacíos, commits gigantes de "todo junto", commits de `wip` sin cuerpo a main.
- **PRs:** título en Conventional Commit, descripción con qué/por qué, screenshots si toca UI; checklist: lint + revisión con Miled si cruza su infraestructura de Supabase.

**R:** el PRD/PR acotado fue un pedido explícito de Miled en la reunión; y evita romper producción del negocio.
