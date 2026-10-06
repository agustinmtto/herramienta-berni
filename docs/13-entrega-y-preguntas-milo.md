# 13 - Entrega del modulo quiz/leads

Estado actualizado: 06-oct-2026. Spec tecnica vigente: `docs/17`. Runbook de despliegue: `docs/18`.

## Estado

La implementacion local del modulo esta validada con todas las compuertas (suite completa con DB, TypeScript, ESLint, builds) y el modulo consolidado tras la revision anti-sobre-ingenieria: **una sola migracion `0068_quiz_leads.sql`** con el estado final (el historico `0068–0073` de reconciliaciones se retiro; produccion nunca aplico nada del modulo y la validacion de migraciones la hacemos nosotros con la carpeta del OS, `docs/18` §1).

## Informacion necesaria

1. ~~Confirmar la reserva del numero `0073`~~ → obsoleto: el modulo es la migracion unica `0068`.
2. Dar acceso al HEAD real del repositorio central para validar el patch final. No se certifica compatibilidad contra un SHA externo no disponible.
3. Confirmar quien recibe el permiso `leads`.
4. Configurar y evidenciar el rate limit distribuido del funnel en WAF/Upstash/Redis. El limiter versionado es una defensa local por instancia.
5. Proveer las URL definitivas de los videos y aprobar editorialmente el diagnostico antes de salida.

## Decisiones cerradas

- Una version publicada no se despublica ni elimina aunque no tenga envios. Solo transiciona entre `active`, `paused` y `archived`.
- El funnel solicita telefono movil. Para Argentina, si un numero nacional valido omite `9`/`15`, se asume movil y se canoniza como `+549...`.
- ~~`sin registro/revisar` para registros sin evidencia~~ → obsoleto con la consolidacion: toda finalizacion nueva deja consentimiento canonico completo (`contacto-v1`), defendido por CHECK de la base.

## Orden de despliegue

Runbook completo en `docs/18`. Resumen:

1. Probar backup y restauracion.
2. Aplicar la migracion unica `0068` (convergente, una transaccion): valida antes el esquema con `to_regclass`/`to_regprocedure`.
3. Verificar funciones, constraints, triggers, indices, grants y RLS.
4. Desplegar el codigo del mismo checkout validado.
5. Ejecutar smoke de `/quiz`, `/api/lead` y `/leads` con datos ficticios (docs/18 §5).

No se hace push directo a `main`: la transferencia usa rama y pull request. No se ejecutan pruebas destructivas contra produccion o URLs externas.

## Evidencia requerida para cerrar

- Instalacion limpia y cinco rutas de upgrade historico, incluida una con strings vacios.
- Suites RPC y `/api/lead` con `LEAD_TESTS_REQUIRE_DB=1` y cero omitidos.
- Suite completa, TypeScript, ESLint, builds y tests de raiz.
- Patch regenerado al final; queda pendiente `git apply --check` contra el HEAD central real.

La evidencia reproducible y los conteos de cierre estan en `docs/14`. La validacion local no reemplaza backup/restauracion, infraestructura distribuida ni smoke de produccion.
