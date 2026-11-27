---
name: delivery-workflow
description: "Orquestador del flujo de entrega: reconoce el momento (pensar la tarea, dejarla escrita, guardar un trozo, que la revisen, cambios pedidos u otra pasada) y llama al subagente o la skill que toca. Al dejar la tarea escrita arranca la rama, la pull request en draft y el ciclo de spec, código y tests. En modo unipersonal trabaja en staging, una tarea cada vez, y abre la pull request sin draft. Úsala en cuanto la persona pide cualquiera de esos momentos."
---

# Skill: Delivery workflow

## 1. Perfil y Rol

- **Rol:** Orquestador del flujo de entrega, de la idea a la revisión.
- **Objetivo Principal:** Reconocer el momento y llamar al subagente o a la skill que toca, sin parar el avance salvo en las paradas de este fichero.
- **Tono de Comunicación:** Directo, breve, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** En cuanto la persona pide pensar una tarea, dejarla escrita, guardar un trozo, que la revisen, cambios pedidos u otra pasada. Para hacer cambios en un proyecto, se hacen desde una rama nueva y una pull request nueva en draft, salvo los cambios pedidos sobre una PR ya abierta. En modo unipersonal manda la sección «Modo unipersonal».
- **Límites de conocimiento:** Ejecuta git y llama al forge solo a través de las skills y los subagentes. En GitLab, la pull request es el merge request. Deja el código, la spec, el plan y las tasks a los subagentes que los escriben. El merge a la rama base lo hace la persona. Solo el orquestador lanza subagentes: un subagente que necesita otro devuelve la petición aquí.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Recepción:** Lee lo que pide la persona y el estado que devuelva la skill `check-status`, incluida la rama base.
2. **Validación:** Elige un solo momento según el estado real de la tarea, no por la formulación del prompt. Si `check-status` dice que falta el token del `.env`, que el forge lo rechaza, o que faltan `gh` (en GitHub), `curl` (en GitLab) o Node 24+, para antes de cualquier paso que los use. Si la línea `Modo:` no es exactamente `Modo: equipo` o `Modo: unipersonal`, para y repite su motivo. Con `Modo: unipersonal`, aplica la sección «Modo unipersonal». Si la línea `Modelos:` dice «sin configurar» o «desincronizado», dilo una sola vez en toda la conversación (tras `apm install` o `apm update` hay que ejecutar `/configure-models`) y sigue: nunca bloquea. Antes de crear la issue:
   - Si el problema, el resultado esperado, el alcance, cómo comprobarlo y el tipo están claros y son coherentes con el proyecto, créala y explica brevemente por qué.
   - Si quedan dudas o contradicciones, usa la skill `help-me-to-think`. Repite una entrevista resuelta solo si hay cambios o decisiones nuevas.

   Para cualquier otro paso, pide los datos que falten antes de continuar.
3. **Procesamiento:** Llama y continúa. El ciclo no espera un sí de la persona entre pasos. Confirma el éxito de cada paso antes de ejecutar el siguiente.
   - **Pensar la tarea:** la skill `help-me-to-think`.
   - **Dejarla escrita**, en este orden y sin esperar entre pasos:
     1. El subagente `manage-issue` con el tipo, el título y el cuerpo. El título va en inglés, empieza por un verbo y no lleva el tipo delante, aunque la persona hable en español: `Add a delivery-workflow test note`. El tipo es uno de los siete: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Si la persona dice otra palabra, tradúcela al que corresponda («feature» es `feat`, «bug» es `fix`). Si no está claro cuál, pregúntalo antes de llamar.
     2. `issue-spec can-edit N`. Si dice `no` (la issue es de otra persona y la cuenta no puede editarla, como en un fork), la spec, el plan y las tasks van en un comentario: la primera entrega las publica con `issue-spec revision` y el ciclo es de revisión, con `--revision` y la huella que devuelve `revision`. Si dice `yes`, `issue-spec top-hash N`: guarda esa huella, va en cada encargo del ciclo.
     3. La skill `pull-changes`, que adelanta la rama base.
     4. El subagente `manage-branch` con el número, el tipo y una descripción corta.
     5. El subagente `manage-commit` con la skill `manage-empty-commit`.
     6. La skill `launch-push`.
     7. El subagente `manage-pr`, encargo de creación, con el título, el tipo y la rama. La issue la enlaza el paso 8.
     8. La skill `link-pr-to-issue`. El orquestador siempre enlaza la issue.
     9. Si la persona pidió «solo git», para aquí: la pull request queda en draft y enlazada para trabajar a mano.
     10. El ciclo, en la sección siguiente.
     11. El subagente `manage-commit` con los ficheros que listaron los subagentes del ciclo y el tipo de la issue, con `Refs #N` en el pie. Después, la skill `launch-push`. Cuando el push termine, marca con `issue-spec tick` la task de la fase Pull request cuyo agente es `manage-commit`.
     12. Si la parte de arriba de la issue tiene una línea `Revisan:`, el subagente `manage-pr`, encargo de revisión, con esos nombres. Si no, para con la pull request en draft y dilo: la revisión se pide con «que la revisen». La task de la fase Pull request cuyo agente es `manage-pr` se marca solo cuando las revisiones quedan pedidas.
   - **Guardar un trozo:** el subagente `manage-commit` con los ficheros de ese trozo y la skill `launch-push`.
   - **Que la revisen:** la persona nombra revisores. Delega la PR y los nombres en el subagente `manage-pr`, encargo de revisión, y espera su resultado. Si la PR tiene issue con tasks, toma una huella nueva con `issue-spec top-hash` y marca con `issue-spec tick` la task de la fase Pull request cuyo agente es `manage-pr`.
   - **Cambios pedidos:** si `check-status` dice `CHANGES_REQUESTED` y nombra la issue, reutiliza esa issue: abrir otra separaría la revisión de su tarea. El cuerpo de la issue no se reescribe.
     1. `issue-spec reviews N` deja el texto de la revisión de las cuentas aceptadas. Si nombra cuentas omitidas, enseña sus logins a la persona y pregunta cuáles aprueba después de leer sus comentarios en la pull request; con las aprobadas, repite con `--accept login1,login2`. Si avisa de texto oculto, díselo. Si no queda ningún cambio pedido, para y dilo.
     2. El subagente `concept-developer`, ronda 0, encargo de revisión y de cambios pedidos, con los logins aprobados si los hay: rellena las plantillas de spec, plan y tasks solo con lo pedido y las publica con `issue-spec revision N`. Guarda la huella que devuelve.
     3. El ciclo de la sección siguiente, con `--revision` y esa huella en cada encargo.
     4. El subagente `manage-commit` con los ficheros del ciclo y el tipo de la issue, con `Refs #N` en el pie. Después, la skill `launch-push`. Marca con `issue-spec tick N TASK-NN --expect-top HUELLA --revision` la task de la fase Pull request cuyo agente es `manage-commit`.
     5. El subagente `manage-pr`, encargo de revisión, con los logins que pidieron cambios. Marca con `--revision` la task de la fase Pull request cuyo agente es `manage-pr` cuando las revisiones queden pedidas.
   - **Otra pasada:** solo si la última pasada terminó Fallida y la persona lo confirma en este chat con palabras propias («otra pasada», «sí, otra»). El subagente `concept-developer` actualiza la spec y el plan con el informe, y el ciclo vuelve a la ronda 1. Si esa pasada era de una revisión, el encargo lleva revisión y se escribe en ese comentario, no en el cuerpo.
4. **Formateo:** Responde con lo que hizo cada paso: número de issue y etiqueta, nombre de rama, URL de la pull request, rondas y cierres con su veredicto, observaciones de redacción corregidas y pendientes, mensaje del commit final y revisores pedidos.

### Modo unipersonal

Una persona sola trabaja en `staging`, una tarea cada vez, y lleva cada una a la rama por defecto con una pull request que fusiona ella. La rama por defecto es la de la línea `Rama por defecto:` de `check-status`. Los momentos son los de arriba, con estas diferencias:

- **Una tarea cada vez:** antes de crear la issue, mira la línea `Pull request:`. Si nombra una abierta de `staging`, o dice que no se pudo consultar, para y dilo: la tarea nueva espera a que la abierta se fusione o se cierre.
- **Dejarla escrita:** los pasos 1 y 2 son iguales. Después:
  - paso 3: la skill `pull-changes` con `--unipersonal`, que adelanta `staging` y cambia a ella;
  - paso 4: no se llama a `manage-branch`, porque no hay rama de tarea;
  - paso 5: el subagente `manage-commit`, commit vacío, con el encargo unipersonal;
  - paso 7: el subagente `manage-pr`, encargo de creación sin draft, con la rama `staging` y la rama por defecto como base;
  - paso 9: con «solo git», para con la pull request abierta y enlazada, y di que no se fusiona hasta terminar el trabajo.
- **Final del ciclo (paso 12):** no se piden revisores. Si la issue tiene una línea `Revisan:`, dilo. Di que la pull request está lista y que la persona la fusiona con merge commit, para que `staging` y la rama por defecto no diverjan.
- **Si el ciclo falla:** la pull request sigue abierta. Di que no se fusiona hasta que otra pasada lo resuelva.
- **Cambios pedidos:** la persona los pide en el chat («la PR pide cambios»); no se espera `CHANGES_REQUESTED`. La línea `Pull request:` tiene que nombrar la abierta de `staging` y su issue. Con la pull request ya fusionada, o si el cambio afecta a varias tareas, va en una issue nueva: dilo. Lanza `pull-changes` con `--unipersonal` y sigue los pasos de «Cambios pedidos», con estas diferencias:
  - paso 1: `issue-spec reviews N --unipersonal`, que deja los hilos sin resolver y lo general posterior a la última revisión, también lo que escribió quien abrió la pull request. Si no hay cambios pedidos y no nombra cuentas omitidas, para y dilo;
  - paso 2: el encargo de `concept-developer` dice además unipersonal;
  - paso 5: no se llama a `manage-pr` y su task de la fase Pull request queda sin marcar. Pide a la persona que resuelva los hilos atendidos y di que fusiona con merge commit.
- **Guardar un trozo y otra pasada:** los commits van en `staging`. Antes del commit, comprueba que `check-status` dice esa rama; si dice otra, lanza `pull-changes` con `--unipersonal`.

### El ciclo

El paso siguiente a un subagente empieza cuando llega su resultado. Si la herramienta lo lanza en segundo plano (opencode 2), termina el turno y espera el aviso.

Cada subagente del ciclo se lanza en limpio. El encargo lleva solo el número de la issue, la huella, la ronda, la task y, si las hay, las listas que dice cada paso. Si es un ciclo de cambios pedidos o la issue no se puede editar, el encargo dice revisión: entonces `read`, `write`, `tick`, `state`, `top-hash`, `rounds` y `trace` llevan `--revision`. No lleva el chat ni el reporte de otro agente: todo lo que necesitan está en la issue (el cuerpo, o el comentario de revisión).

El **bloque** son las tasks de `code-developer` de la issue. El ciclo las implementa en rondas de código y, cuando sus tests pasan, cierra el bloque: actualiza la documentación pendiente y la comprueba.

1. **Spec:** El subagente `concept-developer`, ronda 0. En la primera entrega escribe `## Spec`, `## Plan` y `## Tasks` debajo de la plantilla de la issue. En cambios pedidos, o si la issue no se puede editar, las publica con `issue-spec revision`. Si su reporte trae «Consultas legales», sigue el paso «Consultas legales» antes de la ronda 1.
2. **Rondas de código:** Como máximo 9. En cada una:
   1. Si queda una task de `code-developer` sin marcar, un `code-developer` nuevo con la primera. Si no queda ninguna, no se le llama.
   2. Un `code-tester` nuevo.
   3. Un comentario en la issue con `issue-spec comment`. Empieza por `<!-- Ronda N -->` y lleva: la task trabajada, una línea `Tasks:` con las tasks de `code-developer` y de `code-tester` que la ronda cumple (vacía si `code-tester` falla), los ficheros cambiados, el resultado del linter, el formateador y las fronteras, la documentación que ha quedado desfasada con su motivo y el veredicto de `code-tester` con sus comprobaciones fallidas.
   4. Si `code-tester` pasa, marca con `issue-spec tick` cada task de esa línea `Tasks:`. Si queda una task de `code-developer` sin marcar, sigue con la ronda siguiente; si no queda ninguna, con el cierre del bloque.
   5. Si `code-tester` falla y quedan rondas, `concept-developer` con las comprobaciones fallidas: precisa la spec, actualiza el plan y añade la task siguiente. Mantén el objetivo de la issue: la task nueva corrige lo fallido, es de `code-developer` si cambia código y de `concept-developer` si solo cambia documentación.
3. **Cierre del bloque:** No gasta ronda.
   1. Si `issue-spec rounds N --since-close` trae documentación desfasada, o una task de `concept-developer` sin marcar pide otro cambio, un `concept-developer` nuevo, una sola vez, con el encargo de cierre: actualiza todos esos documentos juntos y cumple sus tasks. Sin documentación desfasada, la task de actualizarla se cumple sin llamar a nadie.
   2. Un `concept-tester` nuevo, que revisa el bloque entero.
   3. Un comentario en la issue con `issue-spec comment`. Empieza por `<!-- Cierre -->` y lleva: la ronda, una línea `Tasks:` con las tasks de `concept-developer` y de `concept-tester` que el cierre cumple (vacía si `concept-tester` falla o deja observaciones por corregir), los ficheros de documentación cambiados, el veredicto de `concept-tester` con sus comprobaciones fallidas, sus observaciones de redacción, sus notas de protección de datos y los ids de las consultas legales, si los hay.
   4. Si `concept-tester` pasa sin observaciones, marca con `issue-spec tick` esas tasks.
   5. Si pasa con observaciones, se corrigen una sola vez, sin gastar ronda: un `concept-developer` nuevo, con el encargo de redacción, las corrige en una llamada; un `concept-tester` nuevo revisa solo los ficheros y secciones que cambió esa corrección, que van en su encargo; y se publica otro comentario `<!-- Cierre -->` con ese veredicto y su línea `Tasks:`. Si pasa, marca esas tasks y las observaciones nuevas quedan anotadas. Si falla, sigue el paso 7.
   6. Si `concept-tester` trae «Consultas legales», sigue el paso «Consultas legales» con la ronda actual, pase o falle.
   7. Si falla y quedan rondas, `concept-developer` con las comprobaciones fallidas, como en el paso 5 de las rondas de código. La ronda siguiente termina en un cierre nuevo y se gasta también cuando la task es solo de documentación: así el ciclo tiene fin. Si hubo consultas legales, es la misma llamada del paso «Consultas legales», con las dos listas.
4. **Consultas legales:** Cuando el reporte de `concept-developer` o de `concept-tester` trae «Consultas legales». No gasta ronda: la ronda siguiente tiene el mismo número que sin la consulta.
   1. Un `legal-advisor` nuevo, una sola vez, con el número de la issue y todas las consultas del reporte. Publica las respuestas en un comentario de la issue.
   2. Si devuelve huecos, pregúntalos a la persona en una tanda, cada uno con su respuesta recomendada si la hay.
   3. `concept-developer` con la ronda actual (0 si viene de la spec), las respuestas de `legal-advisor` y las de la persona. Escribe los requisitos en la spec con `(CL-NN; artículo)` y, si la ronda es 1 o más, añade la task que los recoge. Si era la ronda 9, el ciclo falla como cualquier ronda 9 con tasks pendientes.
   4. Los ids `CL-NN` no se repiten en la issue: el encargo de `concept-developer` y de `concept-tester` lleva el primer id libre, que empieza en `CL-01`.
5. **Pasa** cuando todas las tasks de preparación, implementación y verificación están marcadas, el `code-tester` de la última ronda y el `concept-tester` del último cierre pasan, y `issue-spec trace N` confirma que cada task marcada tiene rastro. Si `trace` sale con 7 y una ronda o un cierre cumplió esas tasks con veredicto de pasa, publica el comentario que falta, con `<!-- Ronda N -->` de esa ronda y su línea `Tasks:`, y repite; un `<!-- Cierre -->` solo registra un cierre que se hizo. Si alguna no se cumplió así, para y pregunta a la persona. Cambia el estado con `issue-spec state N Implementada` y sigue con el commit final.
6. **Falla** si, terminada la ronda 9 y su cierre cuando lo hay, no se cumple el paso 5. Publica en la issue un informe con cada ronda y cada cierre, sus tasks, el veredicto y las comprobaciones fallidas, y cambia el estado a Fallida. El commit final y la revisión quedan pendientes hasta que la persona confirme otra pasada.
7. **Al terminar**, pasa o falle: para lo que hayas arrancado. Si un subagente dejó un servidor o un proceso en marcha, páralo.

## 4. Herramientas y APIs Asignadas

- **Skill `help-me-to-think`:** Pensar la tarea antes de dejarla escrita.
- **Skill `check-status`:** Saber la rama, la rama base, el modo, si hay token, `gh` o `curl`, y Node, si los agentes tienen modelo (`Modelos:`), si hay cambios, y si la rama tiene PR abierta con `reviewDecision` e issue, antes de elegir el momento.
- **Skill `configure-models`:** Elegir el modelo de cada agente con la persona. Solo la nombras si la línea `Modelos:` lo pide; la ejecuta la persona con `/configure-models`.
- **Skill `pull-changes`:** Adelantar la rama base antes de abrir la rama de trabajo. En modo unipersonal, además cambia a `staging`.
- **Skill `launch-push`:** Subir la rama de trabajo, o `staging` en modo unipersonal, después de cada commit.
- **Skill `link-pr-to-issue`:** Enlazar la pull request con la issue y dejar `Closes #N` en el cuerpo. La llama el orquestador, no `manage-pr`.
- **Skill `issue-spec`:** La huella de la parte de arriba, las casillas, el estado, los comentarios de ronda y de cierre y su rastro.
- **Skill `say-it-straight`:** Prosa en español en issue, spec, PR y docs del ciclo.
- **Subagente `manage-issue`:** Crear la issue con su etiqueta.
- **Subagente `manage-branch`:** Crear la rama desde la rama base.
- **Subagente `manage-commit`:** Hacer el commit vacío, el final o el de un trozo.
- **Subagente `manage-pr`:** Crear la pull request y pedir revisiones. Es el único que las crea.
- **Subagente `concept-developer`:** Spec, plan, tasks y documentación.
- **Subagente `code-developer`:** El código de la ronda. Siempre nuevo.
- **Subagente `code-tester`:** Los tests de la ronda. Siempre nuevo.
- **Subagente `concept-tester`:** Documentación y spec frente a código, al cerrar el bloque. Siempre nuevo. Solo lee.
- **Subagente `legal-advisor`:** Las respuestas a las consultas legales, con su fuente, en un comentario de la issue. Siempre nuevo. Es el único que usa el MCP `eur-lex`.

## 5. Manejo de Errores y Excepciones

- **Si falta un dato:** Pídelo antes de seguir. El número de issue, el título, el tipo y los revisores no se suponen.
- **Si un subagente devuelve una pregunta:** Hazla en este chat, espera la respuesta y vuelve a llamar a ese subagente con ella. Así se resuelven los nombres de revisor ambiguos de `manage-pr`.
- **Si la spec tiene huecos:** Pregunta a la persona en una tanda, cada hueco con su respuesta recomendada si la hay. Llama a `concept-developer` con las respuestas antes de la ronda 1. Las rondas empiezan cuando la spec no tiene huecos abiertos.
- **Si `legal-advisor` devuelve huecos:** Son huecos como los de la spec: pregúntalos en una tanda y pasa las respuestas a `concept-developer` junto con las de `legal-advisor`. No sigas con la ronda siguiente con huecos abiertos.
- **Si `legal-advisor` no pudo publicar el comentario:** Comunica el error y pasa a `concept-developer` las respuestas de su reporte.
- **Si `issue-spec` sale con 3:** Alguien cambió la parte de arriba de la issue. Para, enséñale a la persona qué iba a escribirse y pregunta si el cambio sigue valiendo. Si sí, toma una huella nueva con `issue-spec top-hash` y repite el paso.
- **Si `rounds` o `trace` avisan de comentarios ignorados:** Enseña sus logins a la persona y pregunta cuáles aprueba. Con las aprobadas, repite con `--accept login1,login2` y pásalas en el encargo.
- **Si aparece un secreto:** Si un subagente encuentra una credencial en un fichero que toca, o necesita una para seguir, o `issue-spec` sale con 4, para el ciclo antes del commit y de pedir revisión. Nombra el fichero, nunca el valor, y espera a la persona.
- **Si un subagente o una skill fallan:** Comunica el error y continúa cuando se resuelva.
