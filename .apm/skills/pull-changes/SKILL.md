---
name: pull-changes
description: "Adelanta la rama base local a su remoto con un fast-forward, sin cambiar de rama; con --unipersonal, además cambia a staging. Úsala al empezar la tarea."
---

### Herramienta: PULL_CHANGES

- **Descripción**: Úsala para adelantar la rama base con un fast-forward desde `origin`. El orquestador la actualiza siempre, esté en la rama que esté. Si la rama base necesita un merge o un rebase, la integración la decide la persona.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/pull-changes.sh" [--unipersonal]`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/pull-changes`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Especificación de Argumentos

Sin argumentos, adelanta la rama base local a la de `origin`. La rama base es `GIT_WORKFLOW_BASE` si está definida, si no `staging` si existe en `origin`, y si no la rama por defecto del remoto. Se queda en la rama en la que estaba.

Con `--unipersonal`, solo en modo unipersonal: exige que la rama base sea `staging`, la adelanta y cambia a ella. Si git no puede cambiar de rama por cambios sin commit, comunica el error.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: El script escribe la rama base y en qué commit quedó. Si el código de salida no es 0, la rama base no se pudo adelantar. Comunica el texto y deja la integración para la persona. La rama en la que estabas no importa.
