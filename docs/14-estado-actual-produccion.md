# 14 - Estado del proyecto y GO / NO GO

Estado actualizado: 24-sep-2026. Rama: `fix/quiz-leads-auditoria-v5`. Base: `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`.

## Producto revisado

- Funnel publico `/quiz`.
- `POST /api/lead` y tracking/consentimiento/telefono.
- Persistencia y RPC de las migraciones `0068` a `0072`.
- Modulo privado `/leads`, vinculacion, descarte y rollback.

## Veredicto

**NO GO del modulo.** No se declara listo a nivel de desarrollo ni produccion.

La auditoria v5 demostro que una base historica con completed y strings vacios puede fallar al llegar a `0072`; un `progress` tardio altera el paso de un abandono; `desvincular_lead` no obtiene normalmente el lock canonico; la inmutabilidad de versiones es incompleta. Estos puntos necesitan una migracion append-only cuyo numero global todavia no esta reservado.

## Correcciones de aplicacion validadas

- Guarda local redundante para helpers destructivos y prueba de cero llamadas externas.
- Validacion de body por bytes UTF-8, fechas reales, pais catalogado y pasos canonicos.
- Telefono argentino canonico server-side bajo la regla de asumir movil.
- Cuotas separadas para tracking y `completed`.
- Pagina de `/leads` entera, finita, positiva y acotada.
- Selector de clientes paginado, con programa e ignorando respuestas obsoletas.
- Paso visible sincronizado antes de `pagehide` y eventos cliente serializados.
- Consentimiento historico presentado como `sin registro/revisar`.
- Workflow versionado con Supabase local, cero omitidos y gates de Inbox y raiz.

Estos cambios no cierran por si solos los hallazgos SQL.

## Evidencia del checkout actual

| Compuerta | Resultado |
|---|---|
| Reset limpio `0001` a `0072` | OK; 69 migraciones aplicadas |
| Integracion RPC + `/api/lead` | 48 passed, 0 failed, 0 skipped |
| Suite Inbox con DB obligatoria | 1.362 passed, 0 failed, 0 skipped |
| TypeScript | OK, incluido despues del build |
| ESLint | 0 errores, 16 warnings preexistentes |
| Build Inbox | OK |
| Tests y build de raiz | 39/39, 0 skipped; build OK |
| Supabase CLI | `2.117.0` via binario local de `npx` |
| Matriz historica | Bloqueada por migracion sin numero; el entorno DB si esta disponible |
| Patch final | No regenerado; el artefacto existente esta obsoleto para esta rama |

Estos conteos corresponden al checkout actual y a un reset limpio. No sustituyen la matriz de upgrades historicos ni permiten cerrar los hallazgos SQL.

## Condiciones para GO

1. Numero global reservado y migracion implementada sin editar `0068` a `0072`.
2. Upgrade con datos conflictivos y equivalencia de catalogo/behavior en todas las rutas historicas.
3. Concurrencia de completar/vincular/desvincular/descartar y doble rollback en verde.
4. Suite completa con DB obligatoria y cero omitidos.
5. TypeScript, ESLint, builds y tests de raiz en verde.
6. Backup/restauracion probados antes de migrar.
7. Migraciones antes del codigo y smoke posterior.
8. Rate limit distribuido configurado por el operador.

Los problemas generales del OS quedan fuera de este documento y de esta correccion.
