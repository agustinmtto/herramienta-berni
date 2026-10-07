# 16 - Tracker de auditoria del modulo quiz/leads

La checklist v4 fue superada por la auditoria v5. La especificacion autoritativa es `docs/17-spec-correcciones-auditoria-v5-quiz-leads.md`.

Estado actualizado: 28-sep-2026. Base auditada: `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`.

> **Nota de cierre (06-oct-2026):** el historico de migraciones `0068–0073` del modulo se **consolido en la migracion unica `0068_quiz_leads.sql`** (produccion nunca aplico nada; revision anti-sobre-ingenieria). Este documento se conserva como registro del trabajo de auditoria, ya no como estado. Ver `docs/14` y `docs/18`.

## Estado por hallazgo v5

| # | Problema | Estado actual | Evidencia pendiente |
|---:|---|---|---|
| 1 | Upgrade historico con strings vacios | Cerrado local | Validacion remota/operativa |
| 2 | Seguridad de tests destructivos | Corregido y validado local | Primera ejecucion del workflow remoto |
| 3 | Tracking fuera de orden | Cerrado local | Workflow remoto |
| 4 | Lock canonico de `desvincular_lead` | Cerrado local | Workflow remoto |
| 5 | Inmutabilidad del quiz | Cerrado local | Workflow remoto |
| 6 | Telefono argentino | Cerrado local | Workflow remoto |
| 7 | CI obligatorio | Corregido en codigo | Primera ejecucion del workflow |
| 8 | Rate limit | Parcial | Cuotas separadas listas; distribuido depende del operador |
| 9 | Consentimiento historico | Cerrado local | Workflow remoto |
| 10 | Selector de clientes | Cerrado local | Workflow remoto |
| 11 | Validacion de `/leads` | Cerrado local | Workflow remoto |
| 12 | Validacion de `/api/lead` | Corregido y validado local | Primera ejecucion del workflow remoto |
| 13 | Documentacion y transferencia | Cerrado local; patch de 25 archivos (0068–0070) aplicado sobre baseline reconstruido | `git apply --check` contra HEAD central |

`Corregido en codigo` no significa cerrado para merge: cada fila requiere su evidencia final de `docs/17`.

## Cambios con prueba roja y verde

La primera corrida enfocada de v5 produjo 11 fallos y 46 pases. Tras implementar `0073`, un reset limpio `0001` a `0073` aplico 70 migraciones; la integracion RPC produjo 47 pases, incluidas seis carreras, y la suite Inbox completa produjo 1.380 pases con DB; la regresion pura final de doble submit elevo el total a 1.381, todo con 0 fallos y 0 omitidos. TypeScript paso; ESLint termino con 0 errores y los 16 warnings preexistentes; ambos builds y los 39 tests de raiz pasaron. La matriz historica paso las rutas `0068`, `0068+0069`, `0070`, `0071` y pre-`0072` con el preflight documentado; `0073` tambien se reaplico sobre una base ya actualizada sin error.

La evidencia anterior cierra el desarrollo local. No prueba compatibilidad con un HEAD central no disponible ni las compuertas de infraestructura/produccion.

## Bloqueos

1. `0073` esta libre en referencias disponibles, pero requiere confirmacion global del operador.
2. El rate limit distribuido requiere infraestructura externa.
3. El HEAD real del repositorio central no esta disponible para `git apply --check` final.
4. `npm audit --omit=dev` informa riesgos transitivos de PostCSS cuya correccion automatica exige Next 16; se trata fuera de este cambio acotado.

## Compuerta CI versionada

`.github/workflows/quiz-leads-integration.yml` levanta Supabase local, ejecuta `supabase db reset`, exporta credenciales locales y corre:

```bash
npx --no-install vitest run <suites-integradas> --reporter=json
npx --no-install vitest run --reporter=json
npm run typecheck
npm run lint
npm run build
cd <raiz> && npm test && npm run build
```

El job falla si Supabase no responde o cualquiera de los dos resumenes Vitest contiene tests omitidos. Tambien rechaza skips en la suite de raiz. Las suites y cada helper destructivo rechazan URLs no loopback antes de llamar a `fetch`.

## Cierre

Solo se marca el modulo listo cuando los trece hallazgos tienen prueba previa fallando, correccion, prueba posterior pasando, base limpia, upgrade historico y documentacion coincidente. Los riesgos generales del OS no forman parte de este tracker.
