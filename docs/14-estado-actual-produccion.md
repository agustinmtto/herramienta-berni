# 14 - Estado del proyecto y GO / NO GO

Estado actualizado: 28-sep-2026. Rama: `fix/quiz-leads-auditoria-v5`. Base: `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`.

## Producto revisado

- Funnel publico `/quiz`.
- `POST /api/lead` y tracking/consentimiento/telefono.
- Persistencia y RPC de las migraciones `0068` a `0073`.
- Modulo privado `/leads`, vinculacion, descarte y rollback.

## Veredicto

**GO para auditoria independiente; NO GO para produccion.** El cierre local de desarrollo esta completo, pero faltan las compuertas externas y operativas.

`0073_reconciliacion_quiz_leads_v3.sql` corrige la convergencia historica, terminalidad, procedencia, privacidad, inmutabilidad y locks canonicos sin editar migraciones publicadas. La matriz historica y las carreras requeridas convergen en local.

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
| Reset limpio `0001` a `0073` | OK; 70 migraciones aplicadas |
| Integracion RPC enfocada | 47 passed, 0 failed, 0 skipped; incluye seis carreras v5 |
| Suite Inbox con DB obligatoria | 1.381 passed, 0 failed, 0 skipped (1.380 integrada con DB + regresion pura de doble submit) |
| TypeScript | OK, incluido despues del build |
| ESLint | 0 errores, 16 warnings preexistentes |
| Build Inbox | OK |
| Tests y build de raiz | 39/39, 0 skipped; build OK |
| Supabase CLI | `2.118.0` via binario local de `npx` |
| Matriz historica | PASS: `0068`, `0068+0069`, `0070`, `0071` y pre-`0072` con preflight; `0073` tambien reaplica sin error |
| Dependencias | `npm audit --omit=dev`: 1 moderada + 1 alta transitivas en PostCSS; el fix propuesto exige Next 16 y queda fuera de alcance |
| Patch final | 44 archivos; `git apply --check` y aplicacion sobre baseline reconstruido OK; validacion contra HEAD central pendiente |

Estos conteos corresponden al checkout actual y datos ficticios locales. No sustituyen las compuertas externas de produccion.

## Condiciones para GO

1. Confirmacion global de `0073` y validacion del patch contra el HEAD central real.
2. Primera ejecucion verde del workflow remoto.
3. Backup/restauracion probados antes de migrar.
4. Migraciones antes del codigo y smoke posterior.
5. Rate limit distribuido configurado por el operador.
6. Riesgo transitivo de PostCSS aceptado o resuelto en una actualizacion de dependencias separada.

Los problemas generales del OS quedan fuera de este documento y de esta correccion.
