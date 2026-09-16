# MetaCrypto OS — el código

Guía para quien trabaja en este repositorio, humano o Claude Code. Léela entera antes de tocar
nada: las trampas de abajo ya han mordido y cuestan horas.

---

## Qué es esto

El sistema operativo interno de MetaCrypto Club: una aplicación **Next.js (App Router)** sobre
**Supabase**, que el equipo usa para registrar ventas, cobrar cuotas, llevar clientes, agendar
consultorías y generar y firmar contratos.

**Está en producción y lo usa gente todos los días.** Hay dinero real y clientes reales detrás de
casi todas las pantallas.

```
apps/inbox/            La aplicación. Es autónoma: no depende de nada fuera de esta carpeta.
  app/                 Rutas. `(os)/` = pantallas internas (piden sesión).
                       `c/[token]/` y `e/[token]/` = PÚBLICAS, las abre un cliente.
  components/          Componentes de React.
  lib/                 La lógica. Aquí vive casi todo lo que importa.
  lib/__tests__/       1.246 tests. Corren en menos de un segundo.
supabase/migrations/   El esquema, en orden. Numeradas 0001…
```

## Arrancar

```bash
cd apps/inbox
npm install
cp .env.example .env.local   # pide las credenciales al operador
npm run dev                  # http://localhost:3000
npm test                     # los 1.246, en ~1s
npx tsc --noEmit             # tipos
```

**No vas a recibir las credenciales de producción.** Se te dará un Supabase de desarrollo con datos
de mentira. Si algo solo se puede probar contra producción, no lo pruebes: pídelo.

---

## Cinco trampas que ya han mordido

**1 · `npm run build` machaca el `.next` de un `next dev` que esté corriendo.** Comparten
directorio: el dev se queda con `MODULE_NOT_FOUND` en rutas sueltas y parece que la app está rota.
**Para el dev antes de construir.**

**2 · Las fechas de calendario se formatean con `timeZone: "UTC"`.** `new Date("YYYY-MM-DD")` es
medianoche UTC; sin fijar la zona se pinta en la del proceso, y desde América el día sale
cambiado. `lib/format.ts` ya lo hace bien y hay tests que lo fijan. Si escribes otra función de
fecha, hazlo igual. `shortTime`/`fullTime` son la excepción — esas sí son marcas de tiempo reales
y van en hora local.

**3 · El CSS nuevo va a `app/inbox.css`, nunca a `globals.css`.** `inbox.css` se importa DESPUÉS,
así que en un empate de especificidad gana, y eso permite corregir reglas viejas sin editarlas.
Cada bloque de ese fichero dice contra qué regla concreta compite. Mantén esa costumbre.

**4 · Una migración que falta NO da error: da un 400 de PostgREST que la app se traga en
silencio.** Ha pasado cuatro veces. Si añades una columna al esquema Y al código, **la migración
va primero**; si se despliega el código antes, la consulta entera falla, la función devuelve
`null` y la pantalla se queda vacía sin un solo error visible.

**5 · Las migraciones se numeran en una secuencia global y las aplica el operador a mano.** No hay
`supabase db push` aquí. Antes de crear una, mira el número más alto que existe **y pregunta**:
puede haber otras escritas en ramas sin mergear que ya reclamaron el siguiente.

---

## Lo que NO está en este repositorio, y por qué

Este repo contiene **solo la aplicación y el esquema**. Se preparó a propósito así.

- **La firma manuscrita del fundador.** Se estampa en los contratos y quien tenga esos bytes puede
  firmar cualquier documento. Aquí hay un trazo de relleno; la de verdad entra por la variable
  `CONTRATO_FIRMA_PNG_BASE64` solo en producción. **No hace falta para desarrollar**: el contrato
  se genera igual, con la raya de relleno. Ver `apps/inbox/lib/contratos/firma.ts`.
- **`scripts/`** — los scripts de operación del negocio. Un test
  (`lib/__tests__/numero-emisor.test.ts`) los nombra y se salta los que no encuentra, avisando por
  consola. Es correcto: la regla que vigila es más ancha que este repositorio.
- **Datos de clientes.** Los nombres, correos y teléfonos que aparecen en comentarios y tests son
  inventados. **Los comentarios explican incidentes reales** —por qué una función hace lo que
  hace— y esa explicación es justo lo que hay que conservar; solo se cambió la identidad de quien
  aparecía. Si escribes un comentario sobre un caso real, **no pongas el nombre de nadie**.

---

## Cómo se contribuye

1. Rama desde `main`, nombre descriptivo (`fix/…`, `feat/…`).
2. **Tests primero.** Se escribe el test, se ve fallar, y entonces se implementa. No es ceremonia:
   un test que nunca falló no demuestra que sirva para algo.
3. Que pasen los 1.246 y `tsc --noEmit` salga limpio.
4. Pull request. **Nadie despliega**: el despliegue lo hace el operador a mano por CLI.

### Sobre los comentarios

Este código está comentado de una forma poco habitual: los comentarios explican **por qué** algo
es como es, normalmente citando el incidente que lo provocó. No son ruido y no se borran al
refactorizar — suelen ser la única memoria de por qué una línea rara tiene que seguir siendo rara.
Si cambias el comportamiento que un comentario describe, **actualiza el comentario**.

### Lo que no se toca sin preguntar

- Nada bajo `app/c/` ni `app/e/`: son las pantallas que ve un **cliente**, y `app/c/` es donde se
  firma un documento legal.
- `lib/contrato-firma*.ts` — llevan la invariante del módulo: **el cliente firma exactamente lo
  que leyó**, demostrable por hash. Romperla es un problema legal, no un bug.
- Cualquier cosa que mande un correo o un WhatsApp. Se manda a personas reales.
