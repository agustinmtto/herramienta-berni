# 16 - Tracker de auditoria del modulo quiz/leads

La checklist v4 fue superada por la auditoria v5. La especificacion autoritativa es `docs/17-spec-correcciones-auditoria-v5-quiz-leads.md`.

Estado actualizado: 24-sep-2026. Base auditada: `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`.

## Estado por hallazgo v5

| # | Problema | Estado actual | Evidencia pendiente |
|---:|---|---|---|
| 1 | Upgrade historico con strings vacios | Bloqueado | Numero global y matriz DB |
| 2 | Seguridad de tests destructivos | Corregido y validado local | Primera ejecucion del workflow remoto |
| 3 | Tracking fuera de orden | Bloqueado | Nueva migracion y test RPC |
| 4 | Lock canonico de `desvincular_lead` | Bloqueado | Nueva migracion y carreras deterministas |
| 5 | Inmutabilidad del quiz | Bloqueado | Nueva migracion y matriz por columna/transicion |
| 6 | Telefono argentino | Corregido en aplicacion | Matriz integrada con persistencia |
| 7 | CI obligatorio | Corregido en codigo | Primera ejecucion del workflow |
| 8 | Rate limit | Parcial | Cuotas separadas listas; distribuido depende del operador |
| 9 | Consentimiento historico | Parcial | UI corregida; procedencia DB requiere migracion |
| 10 | Selector de clientes | Corregido en codigo | Prueba integrada con mas de 50 clientes |
| 11 | Validacion de `/leads` | Parcial | Parser/query corregidos; falta integracion PostgREST y UI |
| 12 | Validacion de `/api/lead` | Corregido y validado local | Primera ejecucion del workflow remoto |
| 13 | Documentacion y transferencia | Parcial | Patch final se regenera al cerrar SQL y gates |

`Corregido en codigo` no significa cerrado para merge: cada fila requiere su evidencia final de `docs/17`.

## Cambios con prueba roja y verde

La primera corrida enfocada de v5 produjo 11 fallos y 46 pases. Las regresiones posteriores cubrieron telefono, fechas, pais, pasos, bytes, pagina, selector, guarda local, invalidacion inmediata de busquedas y sincronizacion de tracking. Tras un reset limpio `0001` a `0072`, la integracion RPC + `/api/lead` produjo 48 pases y la suite Inbox completa 1.362 pases, ambas con 0 fallos y 0 omitidos. TypeScript paso tambien despues del build; ESLint termino con 0 errores y los 16 warnings preexistentes; ambos builds y los 39 tests de raiz pasaron.

La evidencia anterior prueba el esquema actual sobre una instalacion limpia. No prueba upgrades historicos hacia una migracion que todavia no puede crearse ni numerarse.

## Bloqueos

1. El numero posterior a `0072` no esta confirmado globalmente. No se crea SQL provisional.
2. La matriz de upgrades y las nuevas carreras SQL dependen de esa migracion; no se simulan contra `0072`.
3. El patch existente tiene 36 archivos pero esta obsoleto respecto de esta rama; no se regenera una entrega incompleta.
4. El rate limit distribuido requiere infraestructura externa.
5. El HEAD real del repositorio central no esta disponible para `git apply --check` final.

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
