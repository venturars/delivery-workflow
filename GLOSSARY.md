# Delivery workflow

El paquete lleva una tarea desde que se piensa hasta que se pide su revisión: la deja escrita, abre su rama y su pull request, la especifica, la implementa y la comprueba por rondas.

## Momentos

**Momento**:
Cada punto del trabajo en el que el orquestador interviene. Hay seis: pensar la tarea, dejarla escrita, guardar un trozo, que la revisen, cambios pedidos y otra pasada.
_Evitar_: paso, fase, etapa

**Pensar la tarea**:
Momento en que una entrevista afila la idea hasta que se puede dejar escrita.

**Dejarla escrita**:
Momento en que la tarea queda como issue. Arranca todo lo demás sin esperar: la rama, la pull request en draft y el ciclo. En modo unipersonal no hay rama nueva y la pull request no queda en draft.

**Guardar un trozo**:
Momento en que una parte del trabajo queda en un commit y en el remoto, a petición de la persona.

**Que la revisen**:
Momento en que la pull request recibe revisores y sale de draft.

**Cambios pedidos**:
Momento en que la pull request abierta tiene `CHANGES_REQUESTED`. En GitLab basta un hilo sin resolver de alguien distinto del autor. Spec, plan y tasks van en un comentario de la issue y se repite el ciclo.

**Revisión** (comentario):
El comentario de la issue que empieza por `<!-- Revisión N -->` y lleva las plantillas de spec, plan y tasks de lo que pidió la persona revisora.

**Cuenta aceptada**:
La cuenta cuyo texto `issue-spec` entrega a los agentes desde la revisión. Cuáles son lo dice la skill [`issue-spec`](.apm/skills/issue-spec/SKILL.md).

**Otra pasada**:
Momento en que la persona confirma que el ciclo vuelve a empezar después de que falle la novena ronda o su cierre.

**Solo git**:
La forma de dejar la tarea escrita que para con la pull request enlazada, sin ciclo, para trabajar a mano. La pull request queda en draft, salvo en modo unipersonal.

## Modos

**Modo**:
La forma de trabajo de todo el proyecto, que `check-status` lee de `.delivery-workflow.yml`: equipo o unipersonal.

**Modo equipo**:
El modo por defecto. Cada tarea tiene su rama de trabajo y su pull request, en draft hasta que sale a revisión.

**Modo unipersonal**:
Una persona sola trabaja en `staging`, una tarea cada vez, y lleva cada una a la rama por defecto con una pull request que fusiona ella.
_Evitar_: modo solo, modo individual

## Forge

**Forge**:
El servicio donde viven las issues y las pull requests del proyecto: GitHub o GitLab.
_Evitar_: proveedor, plataforma

**Merge request**:
El nombre que GitLab da a la pull request. El flujo dice pull request para los dos forges.

## Tarea

**Tarea**:
Lo que se quiere hacer, desde la idea hasta la revisión. Tiene una issue, una pull request y, en modo equipo, una rama de trabajo.
_Evitar_: ticket, historia

**Tipo**:
La clase de la tarea: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Decide la plantilla, la etiqueta, el nombre de la rama y el del commit.
_Evitar_: categoría

**Etiqueta**:
La marca del forge que lleva el nombre exacto del tipo, en la issue y en la pull request.
_Evitar_: label (en español), tag

**Spec**:
La sección de la issue que dice qué tiene que hacer el cambio y cómo se comprueba, sin decir cómo se construye.
_Evitar_: especificación (como fichero), requisitos

**Plan**:
La sección de la issue que dice cómo se construye el cambio y qué tests lo comprueban.
_Evitar_: diseño

**Tasks**:
La sección de la issue con la lista de pasos del cambio, cada uno marcado cuando se cumple.
_Evitar_: tareas (se confunde con la tarea), checklist

**Hueco**:
Un dato que la spec necesita y que el proyecto no responde. Para el ciclo hasta que la persona lo contesta.
_Evitar_: duda, TODO

**Consulta legal**:
Una duda de protección de datos que la guía `data-protection-guideline` no resuelve. La devuelven `concept-developer` o `concept-tester` con un id `CL-NN`, la responde `legal-advisor` en un comentario de la issue con su fuente, y lo que decide entra en la spec como requisito. Si no tiene respuesta, pasa a ser un hueco. No gasta ronda.
_Evitar_: consulta jurídica, dictamen

## Ciclo

**Ciclo**:
La sucesión de rondas y cierres que convierte la spec en código comprobado. Lo abre `concept-developer` y termina cuando un cierre pasa sin tasks pendientes o falla la novena ronda o su cierre.
_Evitar_: bucle, pipeline

**Ronda**:
Una vuelta del ciclo: una task de código y sus tests. Hay nueve como máximo.
_Evitar_: iteración, intento

**Pasada**:
Un ciclo completo de hasta nueve rondas. Una pasada nueva solo empieza con la confirmación de la persona.
_Evitar_: ejecución, run

**Bloque**:
Las tasks de código de la issue, que se comprueban juntas contra la documentación.

**Cierre del bloque**:
Lo que sigue a la última task de código: `concept-developer` actualiza la documentación pendiente y `concept-tester` comprueba el bloque. Las observaciones de redacción se corrigen y se vuelven a comprobar una vez. No gasta ronda.

**Veredicto**:
Lo que concluye un tester: pasa o falla, con las comprobaciones que fallaron. `concept-tester` puede concluir que pasa con observaciones de redacción.
_Evitar_: resultado

## Piezas

**Orquestador**:
La pieza que reconoce el momento y llama a quien toca. No escribe código, ni la spec, ni ejecuta git por su cuenta.
_Evitar_: agente principal, coordinador

**Trozo**:
Un conjunto pequeño de ficheros nombrados que se guarda en un solo commit.
_Evitar_: cambio, parte, chunk

**Rama base**:
La rama de la que salen las ramas de trabajo y contra la que se abren las pull requests.
_Evitar_: staging (cuando se habla en general), rama principal

**Rama de trabajo**:
La rama `número-tipo-descripcion` de una issue.
_Evitar_: feature branch

**Commit vacío**:
El primer commit de una tarea, `chore: open #N`, que permite abrir la pull request antes de tener cambios.
_Evitar_: commit inicial

**Entrevista**:
La conversación con la que se piensa la tarea, en tandas de preguntas con respuesta recomendada. Hay dos: con el repositorio y libre.
_Evitar_: grill

**Tanda**:
El grupo de preguntas que una entrevista hace de una vez antes de esperar las respuestas.
_Evitar_: ronda (es del ciclo)

**Documentos que mandan**:
Los ficheros de documentación del proyecto que el cambio tiene que obedecer y contra los que se compara el código.
_Evitar_: referencias, fuentes

**Mapa de capas**:
El fichero `docs/ARCHITECTURE.md` del proyecto, que dice dónde va cada capa y qué reglas de fronteras comprueba.

**Verificación de fronteras**:
La comprobación automática de que los imports respetan las capas del mapa. La herramienta y el comando los elige cada proyecto y se anotan en `docs/ARCHITECTURE.md`.

**Say it straight**:
Skill del paquete que fija la prosa en español de issues, spec, PRs y docs: declarativa, sin relleno defensivo. No rige commits ni el chat del orquestador. **Fuera de esto** en una issue es alcance, no disclaimer.
_Evitar_: prose, copywriting

## Modelos

**Nivel**:
Grado de exigencia de la tarea de un agente: pesado, estándar o ligero. Cada herramienta determina qué modelo, entre los disponibles, corresponde a cada nivel.
