Miled Gassibe: 00:00 
 Buenas, buenas.  ¿Cómo están muchachos?

Lisandro Pecchenino: 00:05 
 ¿Cómo va?  ¿Todo bien?

Miled Gassibe: 00:06 
 Todo bien.  Maestros, ¿Qué tal?  ¿Qué hacen ustedes?  ¿Se dedican a hacer trading o No?

Lisandro Pecchenino: 00:15 
 No, yo invierto y hago un poco de trading, pero nada más.  No es que me dedico a eso.  Estamos estudiando ingeniería en sistema nosotros dos, y estamos desarrollando algunos software por nuestra cuenta.

Miled Gassibe: 00:29 
 Bueno, genial, me alegro mucho.  ¿Y están en la mentoría de berni?

Lisandro Pecchenino: 00:35 
 Sí, yo sí, yo estoy desde hace mucho, desde sus inicios, 2023 más o menos.   bueno, claro, por eso nos conocemos hace un montón.

Miled Gassibe: 00:46 
 Me alegro, loco.  Oye, no sé si.  Yo empecé a trabajar con también una agencia de inteligencia artificial.  Empiezo a trabajar, como saben, obviamente la IA permite avanzar un montón.  Yo soy un hombre de negocio, siendo muy sincero, pero aprendí los conceptos técnicos y hoy tengo equipos que me pueden ayudar con la parte técnica, obviamente.  Y metí de lleno como al mundo info, sistemas de info y otros nichos también.  Así que en eso ando, la verdad.  Eso soy yo.  Me dicen Milo.  Dígame Milo, muchachos, por favor.  Mi nombre es un poco complicado.

Lisandro Pecchenino: 01:23 
 Sí, inclusive en la llamada, no sé si viste, se llamada con Milo.

Miled Gassibe: 01:29 
 Sí, sin problemas.  A ustedes lo digo.  Agustín.  Lisandro.

Lisandro Pecchenino: 01:32 
 Lisandro.

Miled Gassibe: 01:33 
 Bueno, me alegro mucho.  Bueno, cuéntenme muchachos qué puedo.  No sé si Denis a su madre, capaz que más tardecito, siempre anda un poco apurado.  ¿En qué los puedo ayudar?

Lisandro Pecchenino: 01:44 
 Claro.  Bueno, nosotros estábamos viendo cómo podemos conectar, berni me comentó que ustedes usan Go High Level.  Bueno, cómo conectar su Go High Level con el formulario que vamos a hacer nosotros para el diagnóstico.  Porque la idea, no sé si te contó berni, pero es reclutar todos los datos de la información de los futuros leads, y en base a eso, bueno, hacer llamadas en caliente, digamos.

Miled Gassibe: 02:13 
 ¿Pero me podés explicar el flujo completo, Lisandro, por favor?  Porque dame onda, sí usamos Google y estamos haciendo un software también para gestión de como el backend, pero me gustaría saber como, de principio a fin, cuál es el alcance qué va a tocar cada cosa, qué mecanismo necesitas tú para que se transmita la información, cuál es el impacto en realidad de lo que vamos a hacer, como poder ya entender a mayor escala y después vamos cerrando.

Lisandro Pecchenino: 02:41 
 Bueno, dale, bien, nosotros, la herramienta funciona así.  Berni va a tener el link de la herramienta seguramente.  Y viste que él cuando hace los vídeos dice, comentá, no sé diagnóstico o herramienta y te mando la herramienta.  Entonces él la envía, el futuro lead entra a esa herramienta y se abre un formulario.  Ese formulario tiene algunas preguntas como por ¿Cuántos dólares tenés para invertir?  ¿Qué perfil de riesgo tenés?  Eso lo tenemos que definir todavía.  Así podemos armar el JSON para que nos conectemos bien entre su hoja y level y el formulario nuestro.  Después de eso, al final del formulario nosotros le pedimos que ingresen el gmail y el número de teléfono y le vamos a mandar un PDF con un diagnóstico de su situación, de su portafolio.  Todavía no definimos si se lo vamos a mandar por mail o por número, pero la idea es tener los dos datos.  Nosotros habíamos hecho un prototipo, no sé si querés que te lo muestre.  ¿Me tendría que conectar desde la compu?

Miled Gassibe: 03:54 
 Si conectas de la compu, porque me imagino mientras te conecta.  Por el momento imagino que.  OK, perfecto, tenemos eso.  Ya es como de lead magnets.  Va a estar conectado efectivamente por correos y por Gmail.  ¿Podemos conectarlo tanto a este software?  ¿Es un software que están haciendo o es como más un workflow?

Lisandro Pecchenino: 04:18 
 Es más un workflow porque se conectaría directamente a su base de datos.

Miled Gassibe: 04:26 
 Porque si es así lo que podemos hacer es, si me das.  Aún tenés como para triggerear una llamada a un endpoint o no, yo te puedo pasar una API.  Básicamente me hace la llamada porque puede caer en Google o puede caer en el otro sistema, depende qué tan importante es que podamos gestionar eso porque después podemos hacer.  Ya me estoy yendo en volada en realidad, pero no sé si corresponde el scope o no, pero bueno, podemos incluso me pasa el PDF, le podemos poner o un HTML o un PDF, le podemos poner un UTM y podemos saber si efectivamente cliquea o no cliquea la persona.  Sabemos si se abre o No se abre.  ¿Qué tal berni?

Lisandro Pecchenino: 05:08 
 Buenas berni.

Berni Pérez: 05:09 
 ¿Qué tal señores?  Estaba en otra, Disculpadme, he llegado tarde.

Lisandro Pecchenino: 05:13 
 No pasa nada, no pasa nada, estamos.

Miled Gassibe: 05:15 
 poniendo el día.

Berni Pérez: 05:16 
 ¿Ya habéis conocido a Milo, el fenómeno?

Lisandro Pecchenino: 05:19 
 Sí, estuvimos hablando.

Berni Pérez: 05:21 
 El cerebro detrás de la máquina.

Lisandro Pecchenino: 05:25 
 ¿Puedes transmitir vos que estás de la compu?  Si, le estábamos contando del prototipo que hicimos y qué fin tenía y bueno, estábamos viendo justo nos comentaba que nos podría pasar la API para que nosotros hagamos las llamadas y es justamente lo que necesitamos.

Berni Pérez: 05:46 
 Básicamente, Milo, para que entiendas, lo que necesitamos es tener la data de las respuestas de la gente para que lleguen rápido, imagino que a Go High Level, y que de alguna forma tengamos avisos para tener a un triaje que llame a todos los que pongan, por ejemplo, que tienen más de 10 mil dólares, que podamos llamar rápido y bueno, y luego que le llegue al correo el diagnóstico completo y tal, con algún vídeo, alguna llamada a la acción, yo que sé, dependiendo un poco de la persona.  Y nada, ellos pueden crear todo eso por su lado.  Pero necesitábamos como esta conversación para ver cómo su info llegaba a la nuestra base de datos.

Miled Gassibe: 06:26 
 Claro,.

Agustin Maretto: 06:30 
 estoy compartiendo pantalla.  Bien, el prototipo que habíamos armado era este.  Sería como vos habías dicho, como un workflow, no como un sistema aparte.  La idea es que los datos que recopilemos con.  Con este formulario estén en la misma base que tienen los datos ustedes ahora.  Así no tenemos que manejar dos bases diferentes y no corremos riesgo por el tema de la integridad de los datos y demás.  El formulario es un workflow determinístico.  Hay que ver bien el tema de las preguntas, que creo que había hablado Lisandro con berni para el tema de ajustar un par de cambios.  Por eso el único tema que tenemos ese, que para definir la estructura del JSON habría que hacerlo como agnóstico para su endpoint, por ejemplo, que diga que tenga los parámetros como pregunta y respuesta.  Pero todavía no tenemos bien el formato bien específico de las preguntas y demás como para ir integrando más o menos.  Bueno, nada, sería un formulario con diferentes preguntas donde uno va respondiendo.

Lisandro Pecchenino: 07:34 
 Sí, lo que hablamos estaría bueno, a lo mejor en esta llamada si podemos definir cuáles van a ser las preguntas.  Entonces nosotros ya podemos ir pensando el JSON para armar y que ustedes pongan también en su Go High Level esos campos con esa información.

Berni Pérez: 07:56 
 Bueno, eso quiero pensarlo bien, no te lo voy a decir ahora en la llamada, pero intento sacarlo en estos días para que podáis empezar.  Porque es importante no solamente el que preguntamos, sino el cómo y en qué orden.  Porque si mi primera pregunta hola, ¿Cuánto dinero tienes?  Genera mucha fricción, entonces hay que pensar bien la estructura para conseguir la mayor cantidad de respuestas.  Igual que también pedir los datos al principio también es un error, como hola, deja tu correo y tu teléfono.  Bueno, espérate entonces tenemos que hacer que completen todo y que luego cuando hayan completado todo sea como por cierto, para mandártelo tienes que dejar tus datos .  Las posibilidades de que lo completen son más altas que si pedimos los datos al principio.  Entonces quiero pensar bien cómo hacemos las preguntas y luego ya el resto ya queda en vuestras manos de cómo conseguimos esa info.

Lisandro Pecchenino: 08:50 
 Yo pensaba que algunas de las preguntas podíamos usar las que ustedes usan para la agenda de llamada que me habías mostrado el otro día, ir llevándolo por ese lado y después obviamente lo podemos modificar, no hay problema.

Berni Pérez: 09:06 
 Mira, hay un tema, si lo vamos a llamar tal cual, rellenen el formulario.  Es muy importante que sientan el dolor en ese momento.  Entonces hay preguntas que tienen que ser sobre eso.  Por ejemplo del formulario.  En el formulario de acceso para agendar la llamada preguntamos cosas ¿Qué es lo que buscas un poco de nosotros?  No sé ¿Cómo es la pregunta exactamente?  Es no sé cuándo debo comprar, no sé cómo crear un portfolio, no sé gestionar mi riesgo, no sé si estoy llegando a tiempo, no sé.  Entonces la gente va respondiendo las cosas que no sabe y si yo te llamo en ese momento te das cuenta, acabas de poner en papel que no sabes un montón de cosas, estás más dispuesto a decir, o sea, pues igual si necesito ayuda.  Hay varias preguntas que igual nos importan.  A mí me da igual lo que pongan en el formulario de si necesitan ayuda para una cosa o para otra porque sé que le puedo ayudar pero es para de alguna forma condicionar a la persona porque tú no le puedes vender algo a alguien que no piensa que lo necesita.

Lisandro Pecchenino: 10:12 
 Sí, sí, tal cual.

Berni Pérez: 10:13 
 Y en cripto pasa mucho que la gente piensa que lo puede hacer solo normalmente hasta que la cagan y luego sí que buscan ayuda, pero así de primeras.  Entonces de alguna forma el formulario tiene que ser un poco psicológico en el sentido de que tenemos que hacer relucir porque igual no necesitan ayuda de nada.  Yo lo sé hacer todo perfecto, toma tu diagnóstico y sigue con tu vida.  Pero la gran mayoría sí que tienen ciertas dudas, no saben, yo que sé, si yo te pongo en el diagnóstico ¿Y qué vas a hacer en el Clarity Act?  ¿Tienes un plan para Clarity Act?  La verdad la gente no tiene ni puta idea qué es lo que va a hacer.  Pues si yo te llamo justo en el momento y Acabo de ver tu diagnóstico, acabo de ver que no tienes ningún plan para esta semana que viene.  ¿Qué vas a hacer?  ¿Qué pasa si se aprueba?  ¿Qué pasa Si no?  Bueno, no sé, es que claro, yo no tengo ni idea, no lo hecho nunca y te gustaría que hiciéramos una llamada para ver si te podemos ayudar con eso.  Necesitamos como algo que lo podamos anclar, que sea como o duda o vacío de conocimiento que se le llama, para que podamos llevarlo a llamada.  El formulario tiene como esas dos queremos dar valor, queremos ayudar a la gente y si alguien hace el diagnóstico y le sirve aunque nos compre, está fantástico.  Yo encantado de ayudar a la gente o a la gente que no tiene el dinero para trabajar con nosotros.  Oye, tengo tres mil dólares, haz un diagnóstico que te va a servir algo de alguna forma te ayudará.  No vas a poder ser cliente porque no llegas al mínimo, pero está bien.  Entonces tiene que ser ni todo humo que sea solo de venta, ni solamente valor, que sea como gracias, ya sabes, tenemos que encontrar el punto intermedio.  Entonces el tema preguntas, yo me encargo de cómo hacemos las preguntas y a vosotros os encargáis de el diagnóstico.  Yo contigo luchando ya hablé un poco como generar duda y luego las preguntas que yo voy a poner ya también vais a ver que llevan un poco hacia el tema duda.  Luego a nivel estético, que también es importante, no sé si os habéis fijado algunas veces, no sé si os habéis apuntado alguna vez algún evento y tal, como que suele salir una barrita arriba como del porcentaje que llevas completado y siempre marca más de lo que llevas y Luego el primer 90% lo haces en 3 clics y luego el último 10 tardas un montón.  Eso es un poco para dar la sensación a Milo cómo se ríe, seguro que le ha hecho alguno de esos.  ¿Eso al final como que de alguna forma la persona llegue allí y diga joder, qué pereza, cuántas preguntas me van a hacer?  Porque no lo saben.  Tampoco quiero poner pregunta 1 de 12 o 1 de 8, no quiero dar esa info, pero si yo le das a la primera pregunta y pone 33% completado, va a ser rápido.  Alguna forma de que con una barrita o algo así, Perfecto, lo hacemos sin problema.

Miled Gassibe: 13:01 
 Muchachos.  Capaz que sea una buena idea también como lo tengan en consideración que a partir de las preguntas podemos hacer como distintos experimentos.  Entonces por ejemplo, en el caso del 90 al 10 por ciento puede ser una buena opción para saber cuál convierte mejor o capaz que también otro responde tres preguntas y sale un pop up.  Oh, qué interesante.  Oye, tenemos un par de preguntas más porque era un caso especial o lo que sea y capaz veamos cuál convierte mejor porque en el marketing todo se trata de un poco de experimentación, lo han hecho así, pero puede ser una opción o si lo pueden ver HTML.  Bueno,.

Berni Pérez: 13:39 
 Pensad también que mira, vamos a probar primero esto en orgánico, es decir, yo lo voy a regalar por Instagram al final de algunos vídeos si quieres la herramienta no sé qué, no sé cuántos y vamos a testearla en orgánico.  Pero si luego funciona y la gente realmente lo usa y lo completa y tenemos buena info y nos funciona la prospección de llamar a los leads y tal, le meteremos publicidad.  Entonces es una herramienta que puede dar mucho juego al negocio y por eso a mí me gusta el tema de lo que dice milo de vamos a probar diferentes cosas, vamos a tomar este primer mes y medio, dos meses como testeo, lanzamos y medimos qué tal está funcionando porque bueno, te lo enseñé a ti Lisandro.  Ramiro lo está usando.  Ramiro cubre lo está usando el funnel que está usando ahora, inclusive creo que.

Lisandro Pecchenino: 14:30 
 Alex Ormosi lo estaba usando también.

Berni Pérez: 14:32 
 Ormosi empezó a usarlo desde hace tiempo y todo el mundo le ha copiado, no es que Ramiro lo inventó.  Claro, pero sí esto viene del mercado americano y es como muy natural porque el cliente siente que está recibiendo algo desde el primer momento, mira, voy a recibir esto gratis, ¿Sabes?  Y si es algo de valor, cuanto más valor perciba el cliente, más probabilidades tiene de que lo rellene.  Entonces bueno, de alguna forma es venderlo bien y que luego el resultado valga la pena, que no sea como me prometieron un súper diagnóstico y no me dieron ni luego fue cualquier cosa.  Entonces tiene que tener valor, pero tiene que tener buenas preguntas.

Miled Gassibe: 15:09 
 Perfecto.  ¿Esta es la primera vez que lo van a hacer o ya lo llenan haciendo como en distintos casos?

Lisandro Pecchenino: 15:21 
 No, ya lo llenamos probando diferentes casos.  Igualmente ahora está todo hecho con reglas de JavaScript, todavía no usamos la API de Cloud.

Miled Gassibe: 15:30 
 Eso te iba a decir.  Claro.  ¿Por qué hacerlo determinístico?

Lisandro Pecchenino: 15:34 
 No, no lo hicimos determinístico solamente para el prototipo.

Agustin Maretto: 15:37 
 Claro, para validarlo, para ver si teníamos más o menos la misma idea y no empezar a desarrollar y que después no sea lo que esperaban y demás.

Miled Gassibe: 15:44 
 Bueno, claro, si le meten una API estaría buenísimo.

Lisandro Pecchenino: 15:48 
 Sí, es que es lo que vamos.

Agustin Maretto: 15:50 
 A hacer, lo vamos a hacer en la parte final.

Lisandro Pecchenino: 15:52 
 Queríamos preguntar eso, si íbamos a usar la API de Cloud de berni, o que preferían que nosotros usemos nuestra API y les pasamos cuánto está gastando.

Berni Pérez: 16:02 
 No, no, es la nuestra.

Miled Gassibe: 16:04 
 La nuestra.

Lisandro Pecchenino: 16:06 
 Bien, listo.

Berni Pérez: 16:08 
 Luego, Milo, habíamos pensado de poner un vídeo o tener diferentes versiones de vídeo mías, como para cada caso, digamos, para que salga solo la gente que Tiene más de 10.000, como esa gente que puede ser un buen lead, que en su propio diagnóstico le aparezca un vídeo mío.  ¿Qué te parece esa idea y cómo lo ejecutarías a nivel del vídeo?  Porque claro, tiene que ser genérico, pero claro, como podemos hacer tres o cuatro vídeos, pues igual para cada podemos intentar que tenga que ver con su diagnóstico.

Miled Gassibe: 16:45 
 ¿Yo creo que hay muchachos, Lisandro, Agus, confírmenme qué tan fuera del scope estoy yendo o no, como para obviamente mantener la conversación clara en esta hora que tenemos, pero qué tanto traqueo podemos hacer?  Porque yo me imagino que cada clic, o sea, la persona hace clic en la acción, obviamente tiene un UTM en particular, con un ID en particular de ese traqueo, y podemos, como efectivamente podemos hacerlo sofisticadamente, podemos ver cada paso de lo que contestó y eventualmente sabemos cuándo se cae la persona, entonces sabemos si hay una pregunta que es un poco más complicada o no, y al mismo tiempo, si es que esa persona termina respondiendo todo, sale este video.  Y también podemos ver eventualmente cuánto tiempo estuvo la persona viendo el vídeo, si lo vio completo o no, por ejemplo, en el cual yo eso sí lo haría determinístico, berni, tipo cualificación financiera, si es que tiene el dinero suficiente como del capital que estamos buscando.  Y ese sería como, oye, mira, tengo un club, y empezar a hablar del club básicamente, y como mira, si te interesa, bien, agenda acá.  Y ese mismo agendamiento también puede ser como con UTM y lo podemos trackear.

Berni Pérez: 17:56 
 Entonces lo pondrías directamente como en el Thank You Page, digamos, del formulario, no lo pondrías en el correo que reciben, porque esa es otra.  ¿Por dónde lo mandamos por correo?  Es la forma más sencilla, ¿No?  El diagnóstico, sí lo hacemos PDF y.

Lisandro Pecchenino: 18:15 
 Lo mandamos por correo.

Miled Gassibe: 18:18 
 Y ese correo tratemos de meterle como un.  Sí, un clicker básicamente, como un UTM para ver si es que lo abrió o no lo abrió.

Berni Pérez: 18:27 
 Lo abren o no lo abren, Esa es clave.

Miled Gassibe: 18:30 
 Bueno, Go Helen tiene como automáticamente, así que no habría problema.  Creo que la mejor opción que tenemos como para trackear bien, medir y a partir de la métrica como tomar decisiones.

Berni Pérez: 18:42 
 OK, Y eso sería entonces formularios de Go High Level a nivel técnico, ¿Cómo cogemos la info de , lo llevamos a Go High Level para que aparezca, digamos, como las respuestas de cada lead?  Porque yo entiendo que lo que vamos a pedir es, bueno, primero queremos la info del lead, queremos el capital del lead, queremos ver el portfolio que tiene actualmente y queremos ver sus miedos, sus errores, como esa parte despertarle ese vacío.  Y luego yo le dejaría una zona de notas, que es un poco la que Cloud tiene más para jugar.  ¿Cómo podemos llevar eso a Go High Level y que podamos ver relleno el formulario, Milo tiene 25 mil dólares, tiene este portfolio, tiene estos miedos y tal, y tiene no sé qué?

Lisandro Pecchenino: 19:32 
 Si, eso ya lo estuvimos charlando.  Pensábamos nosotros en el formulario, armar un JSON con las respuestas, que es un archivo en el que van a estar todas las preguntas y respuestas, y se lo mandaríamos directamente los campos que generen ustedes en el website level en su base.

Miled Gassibe: 19:52 
 Por mi lado sería saber muy bien en realidad cómo trabajan ustedes, Lisandro y Agustín.  Porque si me dicen que OGL, mantengámoslo en OGL, si es que funciona bien .  OK, onda, lo que funciona, repite, creo yo que es importante.  Pero si es que no estamos experimentando, capaz que también sería bueno generar un formulario hosteado en un link en particular, que puede ser la misma app que estamos teniendo básicamente y así también todo queda adentro.  Pero va a depender mucho como su experiencia para saber un poquito qué funciona mejor y qué no.  Digámoslo.

Lisandro Pecchenino: 20:26 
 Bueno, yo de Go High Level la verdad que no conozco tanto, por eso no sabría decirte.

Berni Pérez: 20:32 
 La otra opción es llevar la supabase directamente, dices.

Miled Gassibe: 20:35 
 Claro, porque Google de vez en cuando es medio como rígido en su formulario, entonces no sé si tendremos mucha facilidad, pero por eso interesante.

Berni Pérez: 20:46 
 Está perfecto porque además podemos meterle notificaciones al de triaje y tal.  O sea si lo podemos hacer directamente pues mejor,.

Miled Gassibe: 20:56 
 Eso sí seguramente va a generar una coordinación más intensa entre nosotros seguramente.  Pero si pueden por ejemplo, alguno de ustedes es técnico, como desarrolla los dos, pásenme un PRD sobre esta nueva feature, que lo tengan bien escrito, documentado y nos ponemos a conversar aquello y empezamos a ver cómo lo implementamos, hacemos un próximo, lo sacamos, hacemos un preview y vemos cómo funciona, hacemos como testeo y cuando esté listo sacamos.  Creo yo.

Agustin Maretto: 21:28 
 La pregunta que tenía era justamente donde la información va a ingresar por parte del formulario este que estamos desarrollando, pero el determinante es donde berni la quería ver, por ejemplo, si en el sistema de gestión actual que tiene un nuevo módulo o si prefieren en otra página, porque si lo querés integrado en el sistema que ya tenés actualmente, sí deberíamos manejar un endpoint activo en lo que viene siendo high level y nosotros directamente solamente hacer la llamada y si lo queremos hacer aparte de o high level, ya sí hay que levantar una base aparte y levantar un dominio aparte.

Miled Gassibe: 22:03 
 Es que eso lo tenemos.  Entonces creo que podría ser fácil que se integren, digámoslo.

Agustin Maretto: 22:09 
 Me parece que va a ser mucho más fácil con un endpoint que espere determinado JSON y después lo mostrás con un reportito nomás sin hacer un formulario en VO high level por así decirlo.

Miled Gassibe: 22:17 
 Claro, yo creo que lo mejor hacerlo lo más ágil posible, porque Vouhl es medio jodido de vez en cuando en temas de formulario y cosas así, que sea lo mejor que les demos acceso a Supabase como un developer, hacemos un branch de la base de datos, un branch del repositorio GitHub, ustedes pueden trabajar en ese lado por ejemplo, y como que hacen un PR, traten de tratar de hacerlo como acotado porque su país nos va a cobrar por cada vez que hacemos un branch como por compute usage.  Entonces creo que sería una buena idea si tomamos esa decisión y creo que tenemos toda la posibilidad de poder hacerlo.  Me imagino que ustedes van a desarrollar y lo pueden desarrollar por cuando estén listos, vemos si hay conflicto, veamos si la arquitectura tiene sentido, integramos y salimos.  No sé si querés Andrés en volar más fácil.

Lisandro Pecchenino: 23:09 
 Ustedes trabajan con un entorno desarrollo y uno de producción,.

Miled Gassibe: 23:14 
 La verdad no, producción y local, entonces, pero podemos armar un entorno desarrollo estaría bueno por.

Lisandro Pecchenino: 23:23 
 Las dudas de los primeros datos que no se ingresen al sistema sin sentido, digamos.

Miled Gassibe: 23:28 
 Sí, obvio, pero por eso mismo creo que si no me equivoco, les dije que era una persona de negocios, pero algo me manejo.  Si no me equivoco, la branch de supabase, si hacemos una bifurcación, si les va a permitir llenarlo de datos, digámoslo, y hacer testeo con el code base original o también un.  Y pueden trabajar con esas dos hasta que tenga sentido, vemos si hay conflicto o no y después merchamos corriente equivocado.  ¿Está bien esa lógica?

Lisandro Pecchenino: 23:59 
 Sí, sí, sí.

Agustin Maretto: 23:59 
 Puede ser que sea así la parte de las branchas de Superb, puede ser.  Entonces, para aclararme la duda, actualmente ustedes tienen código, código desplegado y de base usan SupaBase y en ese el sistema de gestión que tienen ahora.  Y la idea sería agregar, por ejemplo, en el menú lateral donde se ven todas las cosas, una entrada más donde sea la parte del formulario este un reporte con todos los clientes que entraron, o los posibles lead, perdón, y se pueden filtrar y hacer todas las operaciones.  ¿Es así?

Miled Gassibe: 24:34 
 Claro, literalmente sería eso y sería buenísimo porque si la data empieza a caer, eventualmente con harta data ya podemos empezar a hacer automatizaciones y agentes que hagan el outreach o cadencias de emails.  Tenemos conectado como para que tengan una idea del tech stack, si quieren, como ya ver ideas a futuro.  Y bueno, en dónde tenemos Supice Next JS, está conectado Recent, en este momento tenemos un Recent, no sé si lo ubican, es como un developer y sirve como para mandar correos, básicamente, súper sencillo.  Capso, tenemos un problemita en ese momento.  Capso es una plataforma integrador de WhatsApp conectada con API oficial.  ¿Qué más?  Bueno, Goha y Level, porque traemos información de , vemos los calendarios, las agendas, los sistemas de distribución, y por el momento nada más.  Eventualmente queremos conectar Instagram y Fathom Fatom es la que está en la integración.  Ahora bien, bueno, no sé si eso responde mucho a las preguntas que teníamos.

Lisandro Pecchenino: 25:43 
 Al principio de la reunión, y bastante.  Por lo menos ya tenemos el stack tecnológico que están usando, entonces buenísimo, creo.

Miled Gassibe: 25:53 
 Que sería la mejor idea también, porque si bien GOGL es un buen CRM, entre que capaz que la llamada a la API no va a funcionar también, y entre que también la información de los custom field son medio jodidos, digámoslo, capaz que sea bueno tenerlo acá y después que llamemos la información a UGL.

Agustin Maretto: 26:11 
 Sí, sí, perfecto.  Si tienen el repo con el código, el stack y demás, con todo lo que nos nombraste, sería agregar una nueva branch para no modificar producción y bueno, e ir desarrollando en esa hasta que veamos cómo evoluciona y pasamos el PR y vamos viendo.  Pero sería en el stack de código.  Eso está bueno, porque a mí la única duda era si teníamos que unir Go High Level con código.  Aparte, sí ya había un problema con las APIs y endpoints.  Pero si está todo en código en un repo de 10.

Miled Gassibe: 26:41 
 Sí, igual miren, les pasé mi número para que hablemoslo.  Sí, porque ahora mi pregunta en realidad, y sería bueno que lo valemos todos juntos, en realidad es como, dado la flexibilidad, o sea, como hacerlo en gogl es un trade off en el sentido de como gogl ya sí está la plataforma funcional y para nosotros espejar esa información en el sistema es mucho más fácil que construir branches y construir distintos ambientes desarrollo de producción.  Entonces, ¿Qué tan rápido queremos sacarlo?  Eso uno.  Y segundo, ¿Qué limitancias podemos encontrar en GOGL desde este lado?  Entonces, me imagino que usan cloud o chatGPT como codecs.  Les puedo pasar, si es que así lo desean, como un token, un private integration token para que puedan revisar un poco el scope y con eso, como la arquitectura en gogl, evaluar y si en Google no tiene mucho sentido, le damos con supabase y entorno.  ¿Les parece bien?

Agustin Maretto: 27:46 
 La mayor cantidad de contexto que se pueda para poder entender bien cómo funciona el sistema de su lado, estaría espectacular.

Miled Gassibe: 27:52 
 Claro, nunca han utilizado gogl, ¿Cierto?  No, solamente lo sé.  Si les parece bien, yo soy muy de como borrow before build, lo que podemos sacar de algún lugar que ya está construido.  Mucho mejor.  Hagamos lo siguiente.  Les paso acceso a Go High Level como un member, y ustedes pueden ver qué podemos integrar, digámoslo, qué limitancias encuentran y qué limitancias no encuentran al respecto.  Y si me dicen, miro, ¿Sabéis que?  Es muy jodido esto, Como no creemos que va a salir un buen resultado.  Vale, vamos con el branch de código con Supabase y el código en GitHub, ¿Les parece?

Lisandro Pecchenino: 28:29 
 Bueno, bueno.

Miled Gassibe: 28:32 
 Me dan sus correos para poder invitarlos y tener claridad.  Eso.

Agustin Maretto: 29:03 
 Milo, una pregunta para aclarar unas dudas que anoté acá.  ¿Ustedes tienen actualmente la parte del código de GitHub y las branches, la parte de un sistema en código y otro sistema en Go High Level es así?

Miled Gassibe: 29:18 
 Sí, lo de Go High Level lo que hacemos es separar la parte como comercial, promoción, conversión, servicio y una operación.  Entonces la promoción está en redes sociales, básicamente todo lo que van a ver, ni en redes sociales con los anuncios y en orgánico, la verdad más orgánico que anuncios realmente.  ¿Después la conversión, que eso pasa mucho en Google, es decir, las agendas, los recordatorios de las agendas, por ejemplo, ahora vamos a implementar como un sistema como pre selling, es decir, antes de la llamada de ventas que lleguen y efectivamente como que llega bien calentito el lead, pero eso todavía no sé dónde lo implementé, si en backend o en Google, pero GOHL pierde como visibilidad hasta el cierre de la venta, ni siquiera la agenda, porque después qué es lo que pasa?  Nosotros tenemos el control con Fathom que entra, arregla información, sabemos qué pasó en la llamada de ventas y eventualmente el closet tiene que notificar en el sistema como hice un cierre, por tanto, por cuánto, a quién, dónde, etcétera, etcétera.  Eso es como el testimonio, el pase de información y después no mandamos nada a GOGL.  ¿Se entiende?  Como que Google termina en agendas, conversión.

Berni Pérez: 30:33 
 Sí, exacto, o sea desde que llega la agenda todo es Go High Level, sabemos si viene de settings, si viene del evento, si viene de no sé dónde, toda la parte de atribución se coge de Go High Level, la agenda se divide a un closer o a otro en Go High Level, el recordatorio de en dos horas tienes tu llamada, todo eso level, pero una vez ya va al Google Meet con el closer, ya Go High Level no sabe nada más.  Y luego el closer cuando cierra la venta ya lo pone en un formulario que está en supabase o está conectado directamente a nuestro sistema operativo.  Y ya toda la parte de servicio, que si llamadas de sesiones de consultoría, todo eso ya va por otro lado.

Agustin Maretto: 31:14 
 Bien, entonces lo más probable es que lo vamos a analizar vival con la info que nos pase, pero lo más probable es que lo vamos a implementar por la parte del código y no por el ambiente de gohighlev.  Es lo más probable.  Viéndolo así, para quede integrado ya con el actual, digamos que mayor abarca,.

Miled Gassibe: 31:34 
 Voy a pasarles acceso como a los workflows en Google solamente como para que evalúen, que evalúen si hay integraciones válidas o no.  Los calendarios no necesitan verlos.  Comunidades, contactos y conversaciones y formularios Funnels y las integraciones.  Voy a dejarle , ¿Vale?  Para que lo puedan ver.  Bueno, También el tema del vídeo es importante porque hay que saber dónde alojar el video y que redireccione, digámoslo, eventualmente en el formulario, porque no sé si coge el.  Te va a permitir como alojar un embeb, puede ser un embed de Loom por ejemplo o algo por el estilo y así podemos saber muy bien cuánto tiempo.

Berni Pérez: 32:31 
 High Level al rellenar cualquier formulario te deja redirigir a donde tú quieras.

Miled Gassibe: 32:37 
 ¿Con los funnels, cierto?  ¿Es la parte de funnels, no?

Berni Pérez: 32:41 
 Ni siquiera hace falta que sean funnels todos los forms en el propio for, tú vas a cualquier calendario, cualquier forma que tú alojes.  Hay una opción que es al completar o mandas un mensajito o mandas un correo o redirige a tal sitio.  Podemos redirigir al sitio donde esté el vídeo.

Agustin Maretto: 33:00 
 Bien, Sí estaría bueno que la parte del PDF se envíe por mail o por WhatsApp, pero que el vídeo esté en la parte de la página porque ya si involucramos al lead que tenga que descargarlo desde su mail ya es mucha fricción, digamos, para verlo y demás.

Miled Gassibe: 33:20 
 Le estoy mandando.  Agustín, te mandé invitación.  Lisandra, un segundo.

Berni Pérez: 33:27 
 Lisandro, te voy a pedir un favor.

Lisandro Pecchenino: 33:29 
 Sí.

Berni Pérez: 33:30 
 Métete en el embudo de Ramiro y haz el s completo.  Bueno, métete a ver cómo esto del quiz funnel que él hace.  No sé si lo hace por arts o cómo lo hace y si yo encuentro alguno te lo mando también porque igual encontramos buenas ideas en ese proceso.  Yo no me quiero meter porque si meto yo ya me van a tener clichado y ya no me van a soltar.  Pero si te metes tú que no sabe quién eres, mejor que mejor.

Lisandro Pecchenino: 34:01 
 Inclusive podría grabar pantalla y después lo vemos juntos.

Berni Pérez: 34:05 
 Perfecto.  Te pones a grabar pantalla y vas viendo un poco qué preguntas te hacen y tal.

Lisandro Pecchenino: 34:10 
 Bien, bien.

Berni Pérez: 34:12 
 Y quiero ver si encuentro alguno más.

Lisandro Pecchenino: 34:13 
 Berni, ¿Pudiste conseguir la información de los reels que me mandaste?

Berni Pérez: 34:19 
 No, me mandaron el recurso directamente me empezaron a hacer preguntas.  ¿A ti no te contestaron?

Lisandro Pecchenino: 34:24 
 A mí uno me contestó, me hizo dos preguntas y me cortó y otro ni me contestó directamente.

Agustin Maretto: 34:31 
 ¿Ya.

Berni Pérez: 34:33 
 Les pediré a ver si los.

Miled Gassibe: 34:34 
 Consigo a quién, berni?  ¿A quién?

Berni Pérez: 34:39 
 Nada, en unos reels que hablaban justamente del embudo este y tal, y bueno, comenta la palabra tal y te lo envío.  Pero comentas la palabra y no te lo envían, sino que te empiezan a hacer preguntas para calificarte.  Voy a ver si se lo consigo yo el recurso.

Miled Gassibe: 34:58 
 Muchachos, confirmen si les llegó por correo la invitación de un gel.  Es ¿Como se llama?  Lead Connector, como la empresa.  Sí, sí, buenísimo.  Bueno, si necesitan más permiso, o sea, entre Gemina y Claudio ChatGPT seguramente les puedan responder algunas preguntas del funcionamiento.  No tienen todos los permisos, les puse todos los permisos que creo que son suficientes como para que evalúen.  Si necesitan más, me hacen saber.  Nomás me falta este permiso según Claude.  Perfecto, voy, tú lo saco y si ven que no, vamos con el siguiente plan que sería Supabase y código y bueno.

Lisandro Pecchenino: 35:40 
 Bueno, perfecto.

Miled Gassibe: 35:45 
 Creo que estamos OK, ¿Cierto?  No hay ninguna duda o algún tema que deberíamos haber hablado que no hemos hablado, ¿Cierto?

Lisandro Pecchenino: 35:51 
 Creo que no.  Quedaría definir las preguntas, el JSON y nada, y analizar este tema de si lo vamos a ir por el lado de o por el lado de código.

Berni Pérez: 36:12 
 ¿Vale, chicos?  Pues, ¿Quieres que hagamos un grupo, Milo de WhatsApp?

Miled Gassibe: 36:21 
 Si quieren hacemos un grupito, Ben, y lo haces tú los números de todos, me imagino.

Berni Pérez: 36:25 
 Sí, yo meto en el grupo, hacemos un grupo y mantenemos la conversación por allí.

Lisandro Pecchenino: 36:30 
 Perfecto, dale, muy bien.

Berni Pérez: 36:33 
 Pues nada, chicos, gracias por vuestro tiempo y empezamos con el proyecto.

Lisandro Pecchenino: 36:37 
 Gracias a ustedes.  Así, bueno, nos vemos.  Muy bien.

notas finales resumen: 
Notes
Integración y Flujo de Datos de Formularios
La reunión definió la necesidad de integrar un formulario de diagnóstico con la base de datos y el CRM Go High Level para capturar leads y permitir seguimiento inmediato.

Diseño del flujo de información para leads se centró en enviar respuestas del formulario en formato JSON a Go High Level, buscando que la data se sincronice rápido para llamadas en caliente (02:41)
El formulario recogerá datos clave como capital disponible, perfil de riesgo, correo y teléfono.
La intención es enviar un diagnóstico en PDF al lead, con posible envío por correo o WhatsApp.
Se busca evitar manejar dos bases de datos distintas para minimizar riesgos de integridad.
Berni resaltó que la estructura y orden de preguntas es crucial para evitar fricción y maximizar respuestas.
Evaluación de integración técnica con Go High Level o Supabase para decidir si alojar el formulario y datos en Go High Level o en un ambiente de desarrollo propio con Supabase y GitHub (20:26)
Se acordó que los desarrolladores tendrán acceso a Go High Level para evaluar limitaciones.
Si Go High Level presenta restricciones técnicas, se usará un entorno separado con Supabase.
El equipo planea usar ramas (branches) en Supabase para desarrollo y pruebas sin afectar producción.
Miled propuso usar un token privado para que los desarrolladores exploren la arquitectura y decidan la mejor opción.
Confirmación del stack tecnológico actual que incluye Supabase, Next.js, Go High Level, Capso (WhatsApp API), y Fathom para seguimiento, facilitando integraciones futuras (24:34)
Se busca que el formulario y reporte de leads quede integrado en el sistema actual, con acceso a filtrado y operación desde un módulo nuevo.
El objetivo es simplificar la sincronización y evitar fragmentación de datos en distintas plataformas.
Berni y Miled coincidieron que Go High Level se usa para agendas y conversión inicial, pero el backend queda en Supabase.
Estrategia y Diseño de Preguntas en el Formulario
Se acordó que la estructura del formulario debe maximizar la tasa de respuesta y generar un sentido de necesidad en el prospecto.

Berni enfatizó la importancia de diseñar preguntas que generen duda y necesidad real para que el lead esté más dispuesto a recibir ayuda tras completar el diagnóstico (09:06)
Se evitará preguntar datos personales al principio para reducir abandono.
Las preguntas deben reflejar vacíos de conocimiento o preocupaciones reales del usuario.
Se incluirán preguntas psicológicas que condicionen a la persona a buscar ayuda.
Berni se encargará de definir la estructura y orden óptimos de las preguntas en los próximos días.
Consideraciones de experiencia de usuario para evitar que el formulario parezca largo o tedioso (11:24)
Se propondrá una barra de progreso que muestre un porcentaje de avance alto en las primeras preguntas para motivar.
Se evitará mostrar el número total de preguntas para no generar percepción de mucha carga.
Milo sugirió hacer experimentos con diferentes formatos, como salir tras pocas preguntas o extender con pop-ups según la respuesta, para medir conversiones.
Uso de ejemplos y benchmarking en el diseño para inspirarse en funnels existentes que funcionan (33:29)
Berni pidió a Lisandro revisar funnels de Ramiro y otros para analizar preguntas y dinámicas.
La idea es identificar buenas prácticas y adaptar el quiz a la audiencia objetivo.
Se evaluará también el contenido visual, como videos personalizados según capital disponible.
Automatización, Seguimiento y Contenido Multimedia
La integración busca no solo recopilar datos, sino también activar comunicaciones automáticas y personalizadas para aumentar conversiones.

Incorporación de videos personalizados en el diagnóstico para leads con capital alto, como un incentivo y llamada a la acción directa (16:08)
Berni planteó tener varios videos genéricos para distintos rangos de inversión.
Milo explicó que el video podría alojarse en la página de agradecimiento, con seguimiento de visualización y clics via UTMs.
Se busca medir cuánto tiempo ven el video para ajustar la estrategia.
Seguimiento del diagnóstico enviado por correo incluyendo links con UTMs para saber si el lead abrió el correo y accedió al PDF (18:18)
Go High Level tiene capacidades automáticas para medir apertura y clics.
Esto permitirá evaluar la eficacia del diagnóstico y tomar decisiones basadas en datos.
Automatización futura de outreach y cadencias de emails conforme se acumule más data en la base (24:34)
El sistema permitirá filtrar leads y definir flujos para agentes o campañas automáticas.
Se planea usar esta información para mejorar la prospección y cerrar más ventas.
Decisiones Técnicas y Gobernanza del Desarrollo
Se definieron pasos claros para el desarrollo, pruebas y puesta en marcha del formulario integrado.

Uso de entornos de desarrollo separados con ramas en Supabase y código en GitHub para evitar impactos en producción y facilitar pruebas (23:59)
El equipo desarrollará primero en ramas para validar sin afectar la base activa.
Se realizarán pull requests para revisión y merge cuando esté listo.
Esta metodología permitirá detectar conflictos y asegurar calidad antes de la entrega final.
Colaboración entre equipos con documentación clara para alinear expectativas y evitar re-trabajos (20:56)
Se solicitó un PRD detallado de la nueva funcionalidad para tener claridad técnica y funcional.
Se acordó crear un grupo de WhatsApp para mantener comunicación fluida y resolver dudas rápidas.
Milo proporcionará accesos a Go High Level para que los desarrolladores puedan evaluar integraciones.
Balance entre rapidez y robustez en la implementación para decidir si usar Go High Level directamente o un sistema propio (27:46)
Milo destacó la filosofía de "tomar lo que ya funciona" antes de construir desde cero.
Se evaluará qué opción ofrece menos fricción y mejor escalabilidad.
El equipo está abierto a pivotear según los hallazgos técnicos tras la exploración.
Visión Comercial y Posicionamiento del Producto
El formulario y diagnóstico se proyectan como una herramienta clave para captar leads y aportar valor real, más allá de la venta directa.

Berni destacó que la herramienta debe ofrecer valor genuino para ganar confianza y no solo vender, buscando un equilibrio justo (11:24)
El diagnóstico debe ayudar incluso a quienes no califican para ser clientes.
Esto fortalece la reputación y puede generar recomendaciones y engagement a largo plazo.
La estrategia incluye lanzar primero en orgánico para validar antes de invertir en publicidad.
Importancia de un buen marketing y presentación para aumentar conversiones (14:30)
Mostrar que el lead recibe algo útil desde el primer contacto impulsa la tasa de llenado.
El producto se basa en demostrar valor con datos útiles y recomendaciones claras.
Se prevé que este enfoque aumente la calidad de los leads y reduzca fricción en llamadas.
Segmentación dinámica para atención prioritaria de leads con capital alto o perfiles específicos (05:46)
El sistema permitirá identificar leads con más de 10,000 dólares para contacto rápido.
Se usarán alertas para asignar llamadas de manera eficiente.
Esto maximiza el potencial de conversión y optimiza recursos comerciales.
Action items

Miled Gassibe
Proveer accesos a Go High Level para que el equipo técnico pueda evaluar la viabilidad y limitaciones de integración (34:58)
Enviar token de integración privada para revisión de arquitectura e integración con Go High Level (27:46)
Compartir número y coordinar comunicación directa con el equipo para facilitar la colaboración (23:59)
Lisandro Pecchenino
Definir y estructurar las preguntas para el formulario diagnóstico junto con Berni Pérez (07:34)
Revisar y grabar pantalla del embudo/quiz funnel que utiliza Ramiro para análisis de flujo y preguntas (33:29)
Participar en la elaboración del PRD para la nueva funcionalidad y desarrollo de la integración (20:56)
Berni Pérez
Elaborar y definir cuidadosamente las preguntas del formulario con enfoque psicológico para generar conversación y conversión (07:56)
Buscar y compartir recursos sobre embudos y reels para mejorar contenido y enfoque del formulario y diagnóstico (34:13)
Crear un grupo de WhatsApp para facilitar la comunicación y coordinación continua del proyecto (36:12)
Agustin Maretto
Revisar el repositorio de código y estructura del sistema actual para planificar rama de desarrollo y pruebas (20:56)
Evaluar el mejor enfoque para enviar videos y PDFs, recomendando video en página y PDF por mail/WhatsApp para reducir fricción (33:00