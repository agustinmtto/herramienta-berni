# 13 — Entrega del módulo de leads: pendientes e información necesaria

> **Propósito:** dejar concentrado en un único documento todo lo que todavía necesitamos definir, recibir o ejecutar del lado del negocio para poder avanzar con el lanzamiento del módulo de leads.
>
> La implementación y validación técnica del módulo ya fueron realizadas. El detalle técnico queda documentado en `docs/09`, `docs/11` y `docs/12`.

---

## 1. Lo único que necesitamos del negocio

### 1.1. Confirmar los números de migración

**Necesitamos verificar que los números `0068`, `0069`, `0070` y `0071` estén disponibles en el repositorio del OS.**

Frase para enviar:

> **"¿Podés entrar al repo del OS y fijarte si ya existen migraciones que empiecen con `0068`, `0069`, `0070` o `0071`? Si no tenés acceso o no sabés dónde verlo, pasanos acceso de lectura al repo y lo revisamos nosotros."**

**Por qué:** las migraciones forman parte de una secuencia global del OS. Si alguno de esos números ya fue utilizado, tenemos que ajustar la numeración antes de aplicar los cambios en producción. **Si algún otro entorno ya llegó a aplicar versiones ANTERIORES de `0068`/`0069`, avisarlo igualmente: para ese caso preparamos `0071_reconciliacion_leads.sql`, que lleva cualquier base (limpia, vieja o híbrida) al mismo estado final — pero conviene saberlo antes.**

---

### 1.2. Confirmar quién puede acceder a los leads

Esto es una **decisión de negocio**, no técnica.

Frase para enviar:

> **"¿Quiénes van a poder ver los leads y hacer el seguimiento de los leads calientes? Proponemos como configuración inicial que pueda acceder la persona que hace el triaje (actualmente Berni) y todos los usuarios con acceso total. Si les sirve así, confírmenos y lo dejamos de esa manera."**

---

### 1.3. Configurar `KAPSO_WEBHOOK_SECRET`

Esto requiere una acción puntual en el hosting.

Frase para enviar:

> **"En las variables de entorno del OS hay que agregar `KAPSO_WEBHOOK_SECRET` con un texto largo y aleatorio, y después redesplegar. No es una integración nueva: es una clave que el OS ya espera utilizar y que actualmente no está configurada. Sin ella, el webhook de WhatsApp no puede validar correctamente la firma de las solicitudes."**

---

### 1.4. Aplicar las migraciones antes del deploy

Cuando se haga el despliegue:

> **"Primero hay que aplicar las migraciones `0068 → 0069 → 0070 → 0071` y después hacer el deploy del código. El orden es importante porque el código nuevo depende de esas migraciones. La `0071` es de reconciliación: lleva cualquier base al mismo estado final."**

Después del deploy corresponde realizar el smoke test definido para el módulo.

---

### 1.5. Confirmar si quieren alerta de leads calientes

Esto puede esperar al lanzamiento si así se había acordado.

Frase para enviar:

> **"Cuando entra un lead caliente, ¿quieren que la notificación al equipo esté disponible desde el lanzamiento o preferimos dejarla para una fase posterior?"**

---

## 2. Contenido que todavía falta

Estos puntos **no bloquean el deploy técnico**, pero son necesarios para completar la experiencia final del funnel.

### 2.1. Videos de Berni

Faltan:

* **3 videos reales de Berni.**
* La URL final de cada video.
* El hosting/player que se utilizará, idealmente uno que permita realizar el tracking previsto.

Los espacios dentro del funnel ya están preparados; actualmente las URLs están vacías.

---

### 2.2. PDF dinámico y email

Queda pendiente para una fase posterior:

* Generación del PDF dinámico.
* Envío por email mediante Resend.
* Pixel de apertura/tracking del email.

---

### 2.3. Alerta de triaje

Queda por confirmar si:

* se incluye desde el lanzamiento, o
* se implementa después del lanzamiento.

---

## 3. Temas técnicos que quedan fuera de este módulo

El análisis del OS detectó algunos riesgos preexistentes que **no corresponden al módulo de leads y no deberían bloquear esta entrega**.

Quedan registrados como tareas independientes:

* Permisos insuficientes en algunas APIs internas de Inbox.
* Falta de rate limiting/bloqueo en el login.
* Sesiones prolongadas y falta de revalidación del estado de usuarios desactivados.
* Políticas RLS demasiado permisivas en determinadas tablas.
* Posible redirect abierto después del login.

Estos puntos deben tratarse como **tickets independientes del módulo de leads**.

---

## 4. Estado actual

El módulo de leads ya fue implementado y validado técnicamente.

La validación realizada el **22/09/2026** dejó:

* **1329/1329 tests en verde (0 omitidos).**
* TypeScript sin errores.
* Build del OS correcto.
* Prototipo: **39/39 tests en verde**.
* Migraciones probadas desde una base limpia.

Por lo tanto, **lo que queda para avanzar no es desarrollo funcional del módulo**, sino principalmente:

1. Confirmaciones del negocio.
2. Configuración puntual del entorno de producción.
3. Aplicación ordenada de las migraciones.
4. Contenido pendiente del funnel.
5. Definir qué funcionalidades quedan para una fase posterior.

*Generado el 22-sep-2026. Estado de fases según `docs/12` §6.*
