## Tasks

<!--
  Cada task lleva el agente que la ejecuta. Una ronda implementa una sola task de código.
  El linter y el formateador van dentro de cada task de código.
  El orquestador marca las tasks de code-developer y code-tester cuando su ronda pasa,
  y las de concept-developer y concept-tester cuando pasa el cierre del bloque.
-->

### Fase 1: Preparación

- [ ] **TASK-01:** Ejecutar la suite de tests actual para conocer el estado de partida
  - **Agente:** `code-tester`

### Fase 2: Implementación

- [ ] **TASK-02:** Modificar o crear la lógica técnica definida en el plan
  - **Agente:** `code-developer`
- [ ] **TASK-03:** Implementar el manejo de errores y los casos de borde de la spec
  - **Agente:** `code-developer`
- [ ] **TASK-04:** Al cerrar el bloque, actualizar la documentación desfasada. Si no la hay, se marca hecha sin editar.
  - **Agente:** `concept-developer`

### Fase 3: Verificación

- [ ] **TASK-05:** Escribir y ejecutar los tests definidos en el plan
  - **Agente:** `code-tester`
- [ ] **TASK-06:** Comprobar que la documentación y la spec dicen lo mismo que el código
  - **Agente:** `concept-tester`

### Fase 4: Pull request

- [ ] **TASK-07:** Generar el mensaje de commit y guardar el trozo
  - **Agente:** `manage-commit`
- [ ] **TASK-08:** Pedir la revisión si la issue nombra revisores
  - **Agente:** `manage-pr`
