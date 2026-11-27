#!/usr/bin/env bash
# Resume la rama, la rama base, el modo, el forge, el token del .env, Node, el remoto y los cambios locales.

set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

# Rama base: GIT_WORKFLOW_BASE, staging si existe en origin, o la rama por defecto de origin.
detect_base() {
  local head candidate
  if [[ -n "${GIT_WORKFLOW_BASE:-}" ]]; then
    if [[ ! "$GIT_WORKFLOW_BASE" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "GIT_WORKFLOW_BASE tiene que ser el nombre de una rama." >&2
      return 1
    fi
    echo "${GIT_WORKFLOW_BASE#origin/}"
    return
  fi
  if git show-ref --verify --quiet refs/remotes/origin/staging; then
    echo "staging"
    return
  fi
  if head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${head#origin/}"
    return
  fi
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${candidate}"; then
      echo "$candidate"
      return
    fi
  done
  echo "No se pudo detectar la rama base. Defínela con GIT_WORKFLOW_BASE." >&2
  return 1
}

# Rama por defecto de origin: origin/HEAD, o main o master.
default_branch() {
  local head candidate
  if head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${head#origin/}"
    return
  fi
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${candidate}"; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

# Modo de .delivery-workflow.yml: una sola línea «modo: equipo» o «modo: unipersonal». Sin fichero, equipo.
read_mode() {
  local file=.delivery-workflow.yml line value="" found=0
  local blank='^[[:space:]]*(#.*)?$'
  local entry='^modo:[[:space:]]+("(equipo|unipersonal)"|'\''(equipo|unipersonal)'\''|(equipo|unipersonal))([[:space:]]+#.*)?[[:space:]]*$'
  if [[ ! -e "$file" && ! -L "$file" ]]; then
    echo equipo
    return
  fi
  [[ -f "$file" && -r "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ $blank ]] && continue
    [[ "$line" =~ $entry ]] || return 1
    value=${BASH_REMATCH[2]}${BASH_REMATCH[3]}${BASH_REMATCH[4]}
    found=$((found + 1))
  done <"$file"
  [[ $found -eq 1 ]] || return 1
  echo "$value"
}

list_changes() {
  local changes=$1
  local status path rest label
  if [[ -z "$changes" ]]; then
    echo "  (ninguno)"
    return
  fi
  while IFS=$'\t' read -r status path rest; do
    case "$status" in
      M) label="modificado" ;;
      A) label="nuevo" ;;
      D) label="borrado" ;;
      T) label="tipo cambiado" ;;
      U) label="sin fusionar" ;;
      R*) label="renombrado" ;;
      C*) label="copiado" ;;
      *) label="$status" ;;
    esac
    if [[ -n "$rest" ]]; then
      echo "  ${label}  ${path} -> ${rest}"
    else
      echo "  ${label}  ${path}"
    fi
  done <<<"$changes"
}

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD)

echo "Repositorio: ${root}"
echo "Rama: ${branch}"

if base=$(detect_base 2>/dev/null); then
  echo "Rama base: ${base}"
else
  echo "Rama base: no detectada. Defínela con GIT_WORKFLOW_BASE."
fi

# solo_target queda con la rama de destino solo cuando el modo unipersonal puede usarse.
solo_target=""
if ! mode=$(read_mode); then
  echo "Modo: no válido. .delivery-workflow.yml lleva una sola línea «modo: equipo» o «modo: unipersonal»."
elif [[ "$mode" == equipo ]]; then
  echo "Modo: equipo"
else
  target=$(default_branch) || target=""
  problem=""
  if ! git show-ref --verify --quiet refs/remotes/origin/staging; then
    problem="Falta la rama staging en origin. Créala, o ejecuta git fetch si ya existe."
  elif [[ "$base" != staging ]]; then
    problem="La rama base es ${base:-desconocida} y tiene que ser staging: quita GIT_WORKFLOW_BASE."
  elif [[ -z "$target" ]]; then
    problem="No se pudo detectar la rama por defecto de origin."
  elif [[ "$target" == staging ]]; then
    problem="La rama por defecto es staging y tiene que ser otra, como main."
  fi
  if [[ -n "$problem" ]]; then
    echo "Modo: unipersonal. ${problem}"
  else
    echo "Modo: unipersonal"
    echo "Rama por defecto: ${target}"
    solo_target=$target
  fi
fi

gitlab="$(dirname "${BASH_SOURCE[0]}")/gitlab.mjs"
token=no
token_error=$(mktemp)
forge_error=$(mktemp)
trap 'rm -f "$token_error" "$forge_error"' EXIT

# Sin Node: dice si el repositorio es de GitLab, por GIT_WORKFLOW_FORGE (entorno o .env) o por origin.
looks_like_gitlab() {
  local declared=${GIT_WORKFLOW_FORGE:-} top common file line
  if [[ -z "$declared" ]] && top=$(git rev-parse --show-toplevel 2>/dev/null); then
    file="${top}/.env"
    if [[ ! -f "$file" ]]; then
      common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
      file="$(dirname "$common")/.env"
    fi
    if [[ -f "$file" ]]; then
      line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?GIT_WORKFLOW_FORGE[[:space:]]*=' "$file" | tail -n 1) || line=""
      declared=$(sed -E "s/^[^=]*=//; s/[[:space:]]+#.*$//; s/[\"'[:space:]]//g" <<<"$line")
    fi
  fi
  if [[ -n "$declared" ]]; then
    grep -qix 'gitlab' <<<"$declared"
    return
  fi
  # El host tiene que ser gitlab.com, no un nombre que lo contenga ni una ruta.
  git remote get-url origin 2>/dev/null | grep -qiE '^([a-z+]+://)?([^/@]*@)?(altssh\.)?gitlab\.com[:/]'
}

# El forge decide qué token y qué cuenta se comprueban. Con "ninguno" no se comprueba ninguno.
forge=github
if command -v node >/dev/null 2>&1; then
  forge_status=0
  forge=$(node "$gitlab" forge 2>"$forge_error") || forge_status=$?
  if [[ $forge_status -eq 3 ]]; then
    # Falta GITHUB_TOKEN en un host propio: se dice cómo declarar GitLab y se sigue como en GitHub.
    echo "Forge: $(cat "$forge_error")"
    forge=github
  elif [[ $forge_status -ne 0 || ( "$forge" != github && "$forge" != gitlab ) ]]; then
    reason=$(cat "$forge_error")
    echo "Forge: ${reason:-no se pudo comprobar.}"
    forge=ninguno
  fi
elif looks_like_gitlab; then
  forge=gitlab
fi

if [[ "$forge" == gitlab ]]; then
  if command -v node >/dev/null 2>&1; then
    node "$gitlab" status 2>&1 || true
  else
    echo "Forge: GitLab. No se puede comprobar el token ni la cuenta sin Node."
  fi
elif [[ "$forge" == github ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/gh.sh"
  if load_github_token 2>"$token_error"; then
    token=yes
    echo "Token de GitHub: GITHUB_TOKEN en .env"
  else
    echo "Token de GitHub: $(cat "$token_error")"
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI: no instalado. Hace falta para la issue, la pull request, las etiquetas y la spec."
  elif [[ "$token" == no ]]; then
    echo "GitHub CLI: instalado, sin token"
  elif login=$(gh api user --jq .login 2>/dev/null) && [[ -n "$login" ]]; then
    echo "GitHub CLI: cuenta ${login}"
  else
    echo "GitHub CLI: GitHub rechaza el token del .env. Crea otro y cámbialo."
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node: no instalado. Hace falta Node 24 o superior."
else
  node_version=$(node -p 'process.versions.node')
  if (( ${node_version%%.*} >= 24 )); then
    echo "Node: ${node_version}"
  else
    echo "Node: ${node_version}. Hace falta Node 24 o superior."
  fi
fi

# Modelos de los agentes. Nunca para el script: si algo falla, se dice y se sigue.
models_script="$(dirname "${BASH_SOURCE[0]}")/../../configure-models/scripts/configure-models.mjs"
models=""
if [[ -f "$models_script" ]] && command -v node >/dev/null 2>&1; then
  models=$(node "$models_script" status 2>/dev/null) || models=""
fi
echo "Modelos: ${models:-no se pudo comprobar (falta Node o la skill configure-models)}"

if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
  counts=$(git rev-list --left-right --count "HEAD...${upstream}")
  ahead=${counts%%[[:space:]]*}
  behind=${counts##*[[:space:]]}
  echo "Remoto: ${upstream} (${ahead} por subir, ${behind} por bajar)"
else
  echo "Remoto: esta rama no sigue a ninguna"
fi

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Último commit: $(git log -1 --pretty=format:'%h %s')"
else
  echo "Último commit: todavía no hay commits"
fi

# En unipersonal la pull request es la de staging a la rama por defecto, se esté en la rama que se esté.
if [[ "$forge" == gitlab ]]; then
  if command -v node >/dev/null 2>&1; then
    pr_branches=("$branch")
    if [[ -n "$solo_target" ]]; then
      pr_branches=(staging "$solo_target")
    fi
    if pr_line=$(node "$gitlab" mr status "${pr_branches[@]}" 2>"$forge_error"); then
      echo "$pr_line"
    else
      echo "Pull request: no se pudo consultar. $(cat "$forge_error")"
    fi
  fi
elif [[ "$token" == yes ]] && command -v gh >/dev/null 2>&1; then
  pr_failed=no
  if [[ -n "$solo_target" ]]; then
    none="ninguna abierta de staging a ${solo_target}"
    pr_json=$(gh pr list --head staging --base "$solo_target" --state open --json number,reviewDecision,body,isCrossRepository 2>"$forge_error") &&
      [[ -n "$pr_json" ]] || pr_failed=yes
  else
    none="ninguna abierta en esta rama"
    pr_json=$(gh pr view --json number,reviewDecision,body 2>/dev/null || true)
  fi
  if [[ "$pr_failed" == yes ]]; then
    echo "Pull request: no se pudo consultar. $(cat "$forge_error")"
  elif ! echo "$pr_json" | grep -q '"number"'; then
    echo "Pull request: ${none}"
  elif ! command -v node >/dev/null 2>&1; then
    echo "Pull request: no se pudo comprobar (falta Node)"
  else
    pr_line=$(printf '%s' "$pr_json" | node -e '
      const fs = require("fs");
      // La lista de unipersonal trae también las ramas staging de otros repositorios.
      const p = [].concat(JSON.parse(fs.readFileSync(0, "utf8"))).find((item) => !item.isCrossRepository);
      if (!p) process.exit(0);
      const body = p.body || "";
      const match = body.match(/(?:closes|close|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/i);
      const decision = p.reviewDecision || "—";
      process.stdout.write("#" + p.number + " " + decision + (match ? " issue #" + match[1] : ""));
    ')
    echo "Pull request: ${pr_line:-$none}"
  fi
fi

echo
echo "Preparados para el commit:"
list_changes "$(git diff --cached --name-status)"

echo "Modificados y sin preparar:"
list_changes "$(git diff --name-status)"

echo "Sin seguimiento:"
untracked=$(git ls-files --others --exclude-standard)
if [[ -z "$untracked" ]]; then
  echo "  (ninguno)"
else
  while IFS= read -r path; do
    echo "  ${path}"
  done <<<"$untracked"
fi
