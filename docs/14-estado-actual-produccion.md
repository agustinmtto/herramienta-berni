# 14 - Estado del proyecto y GO / NO GO

Estado actualizado: 06-oct-2026. Rama: `fix/quiz-leads-auditoria-v5`. Ultimo commit: consolidacion del modulo post-revision de arquitectura.

## Producto revisado

- Funnel publico `/quiz`.
- `POST /api/lead` y tracking/consentimiento/telefono.
- Persistencia y RPC del paquete `0068_quiz_leads.sql` (estado final consolidado) + `0069_funnel_db_role.sql` + `0070_auditoria_lead_del_envio.sql` (historico `0069–0073` retirado, nunca llego a produccion).
- Modulo privado `/leads`, vinculacion, descarte y rollback.

## Veredicto

**GO tecnico local completo: el modulo esta listo para despliegue.** Las unicas piezas pendientes son operativas/externas: patch validado contra el HEAD central real, rate limit distribuido del operador y el smoke post-despliegue (runbook `docs/18`).

La consolidacion (auditoria v5) incorporo al estado final: terminalidad de eventos, privacidad de la auditoria, inmutabilidad de versiones publicadas, un solo esquema de lock canonico por contacto y cronologia del consentimiento — todo sin la maquinaria de compatibilidad historica, que era innecesaria porque lau no habia datos en produccion.

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
| Reset limpio `0001` a `0070` | OK; **67 migraciones aplicadas** (0068 módulo + 0069 rol funnel + 0070 lookup RPC) |
| Suite completa con DB obligatoria | **1.379 passed, 0 failed, 0 skipped** (suites RPC, ruta HTTP, carreras de concurrencia incluidas) |
| TypeScript | OK, limpio |
| ESLint | 0 errores, 16 warnings preexistentes del OS (ajenos al funnel) |
| Build Inbox | OK |
| Supabase CLI | `2.119.0` via `npx` |
| Matriz historica | **Ya no aplica** — el historico de migraciones del modulo se consolido; produccion nunca tuvo datos del modulo |
| Dependencias | `npm audit --omit=dev`: 1 moderada + 1 alta transitivas en PostCSS; el fix propuesto exige Next 16 y queda fuera de alcance |
| Patch final | 25 archivos (497 KB); `git apply --check` y aplicacion completa sobre baseline limpio del OS (`041d6a6`) OK; validacion contra HEAD central pendiente del acceso al repo central |

Estos conteos corresponden al checkout actual y datos ficticios locales. No sustituyen las compuertas externas de produccion.

## Condiciones para GO

Runbook completo y actualizado: `docs/18-guia-deploy-go.md`.

1. Validar el patch contra el HEAD central real (checkout limpio + `git apply --check` + compuertas).
2. Primera ejecucion verde del workflow remoto.
3. Backup/restauracion probados antes de migrar.
4. Migracion unica `0068` antes del codigo y smoke posterior (`docs/18` §5).
5. Rate limit distribuido configurado por el operador.
6. Riesgo transitivo de PostCSS aceptado o resuelto en una actualizacion de dependencias separada.

Los problemas generales del OS quedan fuera de este documento y de esta correccion.
