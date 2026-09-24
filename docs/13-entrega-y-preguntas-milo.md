# 13 - Entrega del modulo quiz/leads

Estado actualizado: 24-sep-2026. Spec tecnica vigente: `docs/17-spec-correcciones-auditoria-v5-quiz-leads.md`.

## Estado

El modulo no esta listo para PR, merge ni deploy. Las correcciones de aplicacion y el esquema limpio actual ya se validaron con Supabase local, pero persisten defectos de upgrade historico, tracking server-side, locks e inmutabilidad que requieren una nueva migracion append-only y su matriz historica.

La rama de correccion parte de `origin/main` en `79d7f4f27bc5feddf3d9a260ca26b634d3f22db8`. Las migraciones publicadas del modulo son `0068` a `0072` y no se editan.

## Informacion necesaria

1. Reservar globalmente el numero de la nueva migracion posterior a `0072`. El checkout y las ramas remotas disponibles no permiten confirmar que `0073` este libre.
2. Dar acceso al HEAD real del repositorio central para validar el patch final. No se certifica compatibilidad contra un SHA externo no disponible.
3. Confirmar quien recibe el permiso `leads`.
4. Configurar y evidenciar el rate limit distribuido del funnel en WAF/Upstash/Redis. El limiter versionado es una defensa local por instancia.
5. Proveer las URL definitivas de los videos y aprobar editorialmente el diagnostico antes de salida.

## Decisiones cerradas

- Una version publicada no se despublica ni elimina aunque no tenga envios. Solo transiciona entre `active`, `paused` y `archived`.
- El funnel solicita telefono movil. Para Argentina, si un numero nacional valido omite `9`/`15`, se asume movil y se canoniza como `+549...`.
- Un registro historico sin evidencia de consentimiento se muestra como `sin registro/revisar`; no se inventa aceptacion.

## Orden de despliegue

1. Probar backup y restauracion.
2. Ejecutar el preflight historico y guardar conteos sin PII.
3. Aplicar `0068 -> 0069 -> 0070 -> 0071 -> 0072 -> <nueva reconciliacion>`.
4. Verificar funciones, constraints, triggers, indices, grants, RLS y firmas RPC.
5. Desplegar el codigo del mismo checkout validado.
6. Ejecutar smoke de `/quiz`, `/api/lead` y `/leads` con datos ficticios.

No se hace push directo a `main`: la transferencia usa rama y pull request. No se ejecutan pruebas destructivas contra produccion o URLs externas.

## Evidencia requerida para cerrar

- Instalacion limpia y cinco rutas de upgrade historico, incluida una con strings vacios.
- Suites RPC y `/api/lead` con `LEAD_TESTS_REQUIRE_DB=1` y cero omitidos.
- Suite completa, TypeScript, ESLint, builds y tests de raiz.
- Patch regenerado al final y `git apply --check` sobre checkout limpio.

La evidencia intermedia reproducible esta en `docs/14`. Los conteos de cierre y archivos del patch se publican solo despues de la migracion y la matriz final; los valores historicos `1.343 tests` y `36 archivos` describen el SHA auditado, no esta rama en curso.
