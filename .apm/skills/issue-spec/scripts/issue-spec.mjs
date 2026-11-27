#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import {
  GitLabError, LIMITS, canEditIssue, checkForge, connect, createNote, getIssue, hasPlannerRole, listNotes,
  listOpenMergeRequests, renderMarkdown, reviewSummary, updateIssue, updateNote, whoami,
} from "./gitlab.mjs";

const exec = promisify(execFile);
const SECTIONS = ["spec", "plan", "tasks"];
const HEADINGS = { spec: "## Spec", plan: "## Plan", tasks: "## Tasks" };
const HEADING = /^## (Spec|Plan|Tasks)[ \t]*$/;
const STATES = ["Borrador", "Implementada", "Fallida"];
export const MAX_BODY = 65536;

// Formas típicas de credenciales. Solo se informa del tipo, nunca del valor.
const SECRETS = [
  ["token de GitHub", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["token de GitLab", /\bglpat-[A-Za-z0-9_.-]{20,}/],
  ["clave de API", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["clave de AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["clave de Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token de Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

export class IssueSpecError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

// La parte de arriba es todo lo anterior a la primera de las tres secciones.
export function parseBody(body) {
  const lines = normalize(body).split("\n");
  const sections = {};
  let current = null;
  const top = [];
  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      current = match[1].toLowerCase();
      sections[current] = [];
    } else if (current) sections[current].push(line);
    else top.push(line);
  }
  const result = { top: top.join("\n").trim(), sections: {} };
  for (const name of SECTIONS) {
    if (sections[name]) result.sections[name] = sections[name].join("\n").trim();
  }
  return result;
}

export function hashTop(top) {
  return createHash("sha256").update(normalize(top).trim()).digest("hex").slice(0, 16);
}

export function buildBody({ top, sections }) {
  const parts = [top.trim()];
  for (const name of SECTIONS) {
    if (sections[name] !== undefined) parts.push(`${HEADINGS[name]}\n\n${sections[name].trim()}`);
  }
  return `${parts.join("\n\n")}\n`;
}

// Acepta el contenido con o sin su propio encabezado.
export function stripHeading(name, content) {
  const text = normalize(content).trim();
  const [first, ...rest] = text.split("\n");
  return first.trim() === HEADINGS[name] ? rest.join("\n").trim() : text;
}

export function findSecret(text) {
  for (const [kind, pattern] of SECRETS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

// Roles que GitHub asigna a las cuentas que el repositorio reconoce.
export const TRUSTED_ROLES = ["OWNER", "MEMBER", "COLLABORATOR"];
// GitHub devuelve además el texto tal como lo muestra, en body_text.
const RENDERED = "Accept: application/vnd.github.full+json";
// La API REST no dice qué hilos de una pull request están resueltos: solo GraphQL.
const THREADS = "query($owner:String!,$name:String!,$n:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{isResolved comments(first:100){nodes{fullDatabaseId}}}}}}}";

export function authorOf(item) {
  return item.author?.login ?? item.user?.login ?? "";
}

// Se acepta la cuenta del token, una cuenta con rol y una cuenta que la persona aprueba (en minúsculas).
export function isTrusted(item, viewer, accepted = []) {
  const login = authorOf(item).toLowerCase();
  if (!login) return false;
  const role = item.authorAssociation ?? item.author_association;
  return login === viewer.toLowerCase() || TRUSTED_ROLES.includes(role) || accepted.includes(login);
}

// GitLab da la cuenta en author.username.
function gitlabItem(note) {
  return { ...note, author: { ...note.author, login: note.author?.username } };
}

// En GitLab el rol no llega con la nota: se pide una vez por cuenta y se traduce al que isTrusted acepta.
async function addGitLabRoles(api, items, roles = new Map()) {
  const result = [];
  for (const item of items) {
    const id = item.author?.id;
    if (!roles.has(id)) roles.set(id, id != null && (await hasPlannerRole(api, id)));
    result.push({ ...item, author_association: roles.get(id) ? "MEMBER" : "NONE" });
  }
  return result;
}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(entity, name) {
  if (name[0] !== "#") return ENTITIES[name.toLowerCase()];
  const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

// Un comentario, una declaración o una etiqueta con sus atributos. Va en una sola pasada para que un «<!» dentro
// de un atributo no parta la etiqueta y deje a la vista lo que lleva.
const MARKUP = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<(\/?)([a-z][a-z0-9-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>\n?/gi;
const BLOCKS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre", "blockquote", "summary", "details"]);

// El texto que se ve en el HTML de GitLab: sin comentarios, etiquetas ni atributos.
export function visibleText(html) {
  return html
    .replace(MARKUP, (match, slash, name) => {
      const tag = name?.toLowerCase();
      if (tag === "br" || (slash && BLOCKS.has(tag))) return "\n";
      return tag && match.endsWith("\n") ? "\n" : "";
    })
    .replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, decodeEntity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function gitlabText(api, body) {
  return visibleText(await renderMarkdown(api, body));
}

// Cambia el cuerpo por el texto que el forge muestra. Sin ese texto no se entrega el original.
function renderedBody(item) {
  if (!item.body) return "";
  if (typeof item.body_text !== "string") {
    throw new IssueSpecError("No llegó el texto mostrado de un comentario. No se entrega ninguno.", 1);
  }
  return item.body_text;
}

function countHtmlComments(text) {
  return text.split("<!--").length - 1;
}

// Deja lo que puede llegar a un agente y apunta qué cuentas se omiten y cuáles llevaban texto oculto.
export function screenNotes({ reviews = [], comments = [], lineComments = [] }, viewer, accepted = []) {
  const omitted = new Set();
  const hidden = new Set();
  const screen = (list) =>
    list.flatMap((item) => {
      if (!isTrusted(item, viewer, accepted)) {
        omitted.add(authorOf(item) || "(sin autor)");
        return [];
      }
      const body = renderedBody(item);
      if (countHtmlComments(item.body ?? "") > countHtmlComments(body)) hidden.add(authorOf(item));
      return [{ ...item, body }];
    });
  const notes = {
    reviews: screen(reviews.filter(isChangeNote)),
    comments: screen(comments.filter((comment) => !comment.isResolved)),
    lineComments: screen(lineComments.filter((comment) => !comment.isResolved)),
  };
  return { notes, omitted: [...omitted], hidden: [...hidden] };
}

function isChangeNote(review) {
  return review.state === "CHANGES_REQUESTED" || review.state === "COMMENTED";
}

export const REVISION_FIRST_LINE = /^<!-- Revisión (\d+) -->[ \t]*$/;

export function isRevisionComment(body) {
  const first = normalize(body ?? "").trim().split("\n")[0] ?? "";
  return REVISION_FIRST_LINE.test(first);
}

export function latestRevision(comments) {
  const list = comments.filter((comment) => isRevisionComment(comment.body ?? ""));
  if (!list.length) throw new IssueSpecError("La issue no tiene un comentario de revisión.", 1);
  return list[list.length - 1];
}

export function nextRevisionNumber(comments) {
  let max = 0;
  for (const comment of comments) {
    const first = normalize(comment.body ?? "").trim().split("\n")[0] ?? "";
    const match = first.match(REVISION_FIRST_LINE);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function ensureRevisionHeader(text, number) {
  const body = normalize(text).trim();
  if (isRevisionComment(body)) return `${body}\n`;
  return `<!-- Revisión ${number} -->\n\n${body}\n`;
}

export function formatReviewNotes({ reviewDecision, reviews = [], comments = [], lineComments = [] }) {
  const lines = [`Decisión: ${reviewDecision ?? "—"}`, ""];
  for (const review of reviews) {
    if (!isChangeNote(review)) continue;
    const author = review.author?.login ?? review.user?.login ?? review.author ?? "revisor";
    lines.push(`## ${author} (${review.state})`);
    if (review.body) lines.push(review.body.trim(), "");
  }
  for (const comment of [...comments, ...lineComments]) {
    if (comment.isResolved) continue;
    const author = comment.author?.login ?? comment.user?.login ?? "comentario";
    const loc = comment.path ? ` ${comment.path}${comment.line != null ? `:${comment.line}` : ""}` : "";
    if (comment.body) lines.push(`- ${author}${loc}: ${comment.body.trim()}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

export const ROUND_FIRST_LINE = /^<!-- (Ronda [1-9]|Cierre) -->[ \t]*$/;

export function roundMark(body) {
  const first = normalize(body ?? "").trim().split("\n")[0] ?? "";
  return first.match(ROUND_FIRST_LINE)?.[1] ?? null;
}

// Lo posterior a una fecha. Sin fecha de corte, todo; lo que no trae fecha no se descarta.
export function newerThan(items, since) {
  if (!since) return items;
  const limit = Date.parse(since);
  return items.filter((item) => !(Date.parse(item.submitted_at ?? item.created_at) <= limit));
}

// Los comentarios posteriores al último cierre: lo que todavía no se ha comprobado.
export function sinceLastClose(notes) {
  return notes.slice(notes.findLastIndex((note) => note.mark === "Cierre") + 1);
}

// Tasks marcadas que no figuran en ninguna línea «Tasks:». Las de manage-* son de la pull request, no del ciclo.
export function untracedTasks(tasks, notes) {
  const traced = new Set(
    notes
      .flatMap((text) => text.split("\n"))
      .filter((line) => line.trim().startsWith("Tasks:"))
      .flatMap((line) => line.match(/TASK-\d+/g) ?? []),
  );
  return normalize(tasks)
    .split(/^(?=\s*- \[)/m)
    .flatMap((block) => {
      const id = block.match(/^\s*- \[[xX]\] \*\*(TASK-\d+):\*\*/)?.[1];
      const fromPullRequest = /\*\*Agente:\*\*\s*`manage-/.test(block);
      return id && !fromPullRequest && !traced.has(id) ? [id] : [];
    });
}

function parseLogins(list = "") {
  return list
    .split(",")
    .map((login) => login.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

// Las cuentas omitidas y las que llevaban texto oculto.
function accountLines({ omitted, hidden }) {
  const lines = [];
  if (omitted.length) lines.push(`Omitidos (cuentas sin rol en el repositorio): ${omitted.join(", ")}`);
  if (hidden.length) lines.push(`Texto oculto quitado en comentarios de: ${hidden.join(", ")}`);
  return lines;
}

// Las notas aceptadas, y debajo las cuentas.
function screenedLines(reviewDecision, screened) {
  const notes = formatReviewNotes({ reviewDecision, ...screened.notes }).trimEnd();
  return [notes, ...accountLines(screened)].join("\n\n");
}

export const NOTHING_PENDING = "No hay cambios pedidos desde la última revisión.";

// En unipersonal nadie marca una decisión: o queda texto pendiente o se dice que no lo hay.
function pendingLines(screened) {
  const withBody = (list) => list.filter((item) => item.body?.trim());
  const notes = {
    reviews: withBody(screened.notes.reviews),
    comments: withBody(screened.notes.comments),
    lineComments: withBody(screened.notes.lineComments.filter((comment) => !comment.isResolved)),
  };
  if (Object.values(notes).some((list) => list.length)) return screenedLines(null, { ...screened, notes });
  return [NOTHING_PENDING, ...accountLines(screened)].join("\n\n");
}

function closesIssue(body, number) {
  return new RegExp(`(?:closes|close|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s+#${number}\\b`, "i").test(
    body ?? "",
  );
}

// La revisión del merge request abierto que cierra la issue. En unipersonal cuenta también quien lo creó.
async function gitlabReviewNotes(api, number, viewer, accepted, { solo = false, since = null } = {}) {
  const found = (await listOpenMergeRequests(api)).find((item) => closesIssue(item.description, number));
  if (!found) throw new IssueSpecError("No hay un merge request abierto que cierre esta issue.", 1);
  const review = await reviewSummary(api, found, { withAuthor: solo });
  const roles = new Map();
  // Solo se pide el texto mostrado de las cuentas aceptadas.
  const withText = async (items, prefix = () => "") => {
    const result = [];
    for (const item of await addGitLabRoles(api, items, roles)) {
      if (item.body && isTrusted(item, viewer, accepted)) {
        item.body_text = `${prefix(item)}${await gitlabText(api, item.body)}`;
      }
      result.push(item);
    }
    return result;
  };
  const lineComments = review.threads.flatMap((thread) => thread.notes.filter((note) => !note.system).map((note) => ({
    ...gitlabItem(note),
    path: note.position?.new_path ?? note.position?.old_path,
    line: note.position?.new_line ?? note.position?.old_line,
  })));
  const reviews = newerThan(review.notes, since).map((note) => ({
    ...gitlabItem(note),
    state: review.askers.includes(note.author.username) ? "CHANGES_REQUESTED" : "COMMENTED",
  }));
  // Un comentario general no se resuelve: la fecha distingue lo de esta vuelta de lo anterior.
  const dated = (note) => (note.created_at ? `${note.created_at.slice(0, 10)}: ` : "");
  const screened = screenNotes(
    { reviews: await withText(reviews, dated), lineComments: await withText(lineComments) },
    viewer,
    accepted,
  );
  if (solo) return `${pendingLines(screened)}\n`;
  const extra = [`Piden cambios: ${review.askers.join(", ") || "nadie"}`];
  if (!review.statesAvailable) extra.push("Esta instancia no dice quién pidió cambios: la decisión sale de los hilos y las aprobaciones.");
  return `${screenedLines(review.decision, screened)}\n\n${extra.join("\n")}\n`;
}

function checkTop(parsed, expected) {
  if (!expected) throw new IssueSpecError("Falta --expect-top con la huella de la parte de arriba.", 1);
  if (hashTop(parsed.top) !== expected) {
    throw new IssueSpecError("La parte de arriba de la issue cambió desde que empezó el ciclo. No se escribe nada.", 3);
  }
}

function checkWritable(body, limit = MAX_BODY) {
  const secret = findSecret(body);
  if (secret) throw new IssueSpecError(`El texto contiene lo que parece un ${secret}. No se escribe nada.`, 4);
  if (body.length > limit) {
    throw new IssueSpecError(`El cuerpo tendría ${body.length} caracteres y el límite es ${limit}. Acorta el plan.`, 5);
  }
}

export function replaceSections(body, replacements, expected, limit = MAX_BODY) {
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  for (const [name, content] of Object.entries(replacements)) parsed.sections[name] = stripHeading(name, content);
  const next = buildBody(parsed);
  checkWritable(next, limit);
  return next;
}

export function tickTask(body, task, expected) {
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  if (parsed.sections.tasks === undefined) throw new IssueSpecError("La issue no tiene sección Tasks.", 1);
  const pattern = new RegExp(`^(\\s*- )\\[ \\]( \\*\\*${task}:\\*\\*)`, "m");
  if (!pattern.test(parsed.sections.tasks)) {
    const done = new RegExp(`^\\s*- \\[x\\] \\*\\*${task}:\\*\\*`, "mi");
    if (done.test(parsed.sections.tasks)) return null;
    throw new IssueSpecError(`No hay ninguna ${task} sin marcar en Tasks.`, 1);
  }
  parsed.sections.tasks = parsed.sections.tasks.replace(pattern, "$1[x]$2");
  return buildBody(parsed);
}

export function setState(body, state, date, expected) {
  if (!STATES.includes(state)) throw new IssueSpecError(`El estado tiene que ser ${STATES.join(", ")}.`, 1);
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  if (parsed.sections.spec === undefined) throw new IssueSpecError("La issue no tiene sección Spec.", 1);
  const line = /^> Estado: \*\*[^*]+\*\*/m;
  if (!line.test(parsed.sections.spec)) throw new IssueSpecError("La spec no tiene la línea Estado.", 1);
  parsed.sections.spec = parsed.sections.spec.replace(line, `> Estado: **${state} (${date})**`);
  return buildBody(parsed);
}

function parseArgs(args) {
  const [command, number, ...rest] = args;
  if (!command || !/^\d+$/.test(number ?? "")) {
    throw new IssueSpecError(
      "Uso: can-edit N | read N [--revision] [--section top|spec|plan|tasks] | top-hash N [--revision] | write N --expect-top H [--revision] [--spec F] [--plan F] [--tasks F] | tick N TASK-NN --expect-top H [--revision] | state N Borrador|Implementada|Fallida --expect-top H [--revision] | comment N F | rounds N [--revision] [--since-close] [--accept LOGINS] | trace N [--revision] [--accept LOGINS] | reviews N [--accept LOGINS] [--unipersonal] | revision N F",
      1,
    );
  }
  const options = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--revision") options.revision = true;
    else if (rest[i] === "--since-close") options.sinceClose = true;
    else if (rest[i] === "--unipersonal") options.solo = true;
    else if (rest[i].startsWith("--")) options[rest[i].slice(2)] = rest[++i];
    else options.positional.push(rest[i]);
  }
  return { command, number, options };
}

// gh.sh lanza gh con el token del .env del proyecto, nunca con la sesión de gh.
function gh() {
  const script = join(dirname(fileURLToPath(import.meta.url)), "gh.sh");
  return async (args) => (await exec("bash", [script, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;
}

async function withTemporary(text, action) {
  const path = join(tmpdir(), `issue-spec-${randomUUID()}.md`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  try {
    return await action(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

// El cliente de GitLab cuando ese es el forge. En GitHub, null.
async function gitlabClient(project) {
  return (await checkForge()).forge === "gitlab" ? connect({ project }) : null;
}

const NO_EDIT = "No puedes editar el cuerpo de esta issue. Publica la spec con revision y sigue con --revision.";

// Con run se prueba el camino de GitHub y con gitlab el de GitLab. Sin ninguno, decide el forge del repositorio.
export async function run(args, options = {}) {
  try {
    return await execute(args, options);
  } catch (error) {
    // Los códigos de salida de GitLabError son otros: aquí el 3 es la parte de arriba cambiada.
    if (error instanceof GitLabError) throw new IssueSpecError(error.message, 1);
    throw error;
  }
}

async function execute(
  args,
  { run: injected, gitlab, today = () => new Date().toISOString().slice(0, 10), warn = console.error },
) {
  const { command, number, options } = parseArgs(args);
  const api = gitlab ?? (injected ? null : await gitlabClient(options.repo));
  const call = injected ?? gh();
  const limits = api ? LIMITS : { issue: MAX_BODY, comment: MAX_BODY };
  const repo = options.repo ? ["--repo", options.repo] : [];
  const apiRepo = options.repo ? `repos/${options.repo}` : "repos/{owner}/{repo}";
  // El dueño y el nombre para GraphQL. gh sustituye {owner} y {repo} en los campos -F.
  const [owner, name] = options.repo ? options.repo.split("/") : ["{owner}", "{repo}"];
  const repoFields = ["-F", `owner=${owner}`, "-F", `name=${name}`];
  const readIssueBody = async () => {
    if (api) return (await getIssue(api, number)).description ?? "";
    return JSON.parse(await call(["issue", "view", number, ...repo, "--json", "body"])).body ?? "";
  };
  const writeIssueBody = async (body) => {
    if (api) {
      return updateIssue(api, number, { description: body }).catch((error) => {
        if (error.status === 403 && !/permiso api/.test(error.message)) throw new IssueSpecError(NO_EDIT, 6);
        throw error;
      });
    }
    return withTemporary(body, (path) => call(["issue", "edit", number, ...repo, "--body-file", path])).catch((error) => {
      if (/permission|forbidden|403|Resource not accessible/i.test(String(error.message))) {
        throw new IssueSpecError(NO_EDIT, 6);
      }
      throw error;
    });
  };
  const listComments = async () => {
    if (api) return (await listNotes(api, number)).map(gitlabItem);
    const raw = await call(["api", `${apiRepo}/issues/${number}/comments`, "--paginate"]);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  const postComment = (text) => {
    if (api) return createNote(api, number, text);
    return withTemporary(text, (path) => call(["issue", "comment", number, ...repo, "--body-file", path]));
  };
  // La cuenta del token: GITLAB_TOKEN en GitLab y, en GitHub, el GITHUB_TOKEN con el que gh.sh lanza gh.
  const viewerLogin = async () => {
    if (api) return (await whoami(api)).username;
    const { login } = JSON.parse((await call(["api", "user"])) || "{}");
    if (!login) throw new IssueSpecError("No se pudo saber de qué cuenta es el token.", 1);
    return login;
  };
  // GitHub da el rol con cada comentario. En GitLab se pide aparte.
  const withRoles = async (items) => (api ? addGitLabRoles(api, items) : items);
  const source = async () => {
    if (!options.revision) return { id: null, body: await readIssueBody() };
    const viewer = await viewerLogin();
    const revisions = await withRoles((await listComments()).filter((comment) => isRevisionComment(comment.body ?? "")));
    const trusted = revisions.filter((comment) => isTrusted(comment, viewer));
    if (revisions.length && !trusted.length) {
      const logins = [...new Set(revisions.map(authorOf))].join(", ");
      throw new IssueSpecError(`Solo hay comentarios de revisión de cuentas sin rol en el repositorio: ${logins}. No se usan.`, 1);
    }
    const latest = latestRevision(trusted);
    const newest = revisions.at(-1);
    if (newest !== latest) {
      warn(`Aviso: se ignora un comentario de revisión más nuevo, de una cuenta sin rol en el repositorio: ${authorOf(newest)}.`);
    }
    return { id: latest.id, body: latest.body ?? "" };
  };
  const listRendered = async (path) => {
    const parsed = JSON.parse((await call(["api", `${apiRepo}/${path}`, "--paginate", "-H", RENDERED])) || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  // Marca los comentarios de línea de los hilos resueltos. Sin saber cuáles son, no se entrega ninguno.
  const markResolved = async (pull, lineComments) => {
    if (!lineComments.length) return lineComments;
    const resolved = new Set();
    let cursor = null;
    do {
      const after = cursor ? ["-f", `cursor=${cursor}`] : [];
      const raw = await call(["api", "graphql", "-f", `query=${THREADS}`, ...repoFields, "-F", `n=${pull}`, ...after]);
      const threads = JSON.parse(raw || "{}").data?.repository?.pullRequest?.reviewThreads;
      if (!threads) throw new IssueSpecError("No se pudo saber qué hilos están resueltos. No se entrega ningún comentario.", 1);
      for (const thread of threads.nodes.filter((node) => node.isResolved)) {
        for (const comment of thread.comments.nodes) resolved.add(String(comment.fullDatabaseId));
      }
      cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
    } while (cursor);
    // La consulta trae hasta 100 comentarios por hilo: las demás respuestas apuntan al primero.
    return lineComments.map((comment) => ({
      ...comment,
      isResolved: resolved.has(String(comment.id)) || resolved.has(String(comment.in_reply_to_id)),
    }));
  };
  // La fecha del último comentario de revisión aceptado de la issue: lo general anterior ya se atendió.
  const lastRevisionDate = async () => {
    const viewer = await viewerLogin();
    const revisions = await withRoles((await listComments()).filter((comment) => isRevisionComment(comment.body ?? "")));
    return revisions.filter((comment) => isTrusted(comment, viewer)).at(-1)?.created_at ?? null;
  };
  // Comentarios de ronda y de cierre de las cuentas aceptadas. En una revisión, los posteriores a su comentario.
  const roundNotes = async (revisionId) => {
    const viewer = await viewerLogin();
    const accepted = parseLogins(options.accept);
    const all = api ? await listComments() : await listRendered(`issues/${number}/comments`);
    const start = revisionId == null ? 0 : all.findIndex((comment) => comment.id === revisionId) + 1;
    const marked = await withRoles(all.slice(start).filter((comment) => roundMark(comment.body)));
    const trusted = marked.filter((comment) => isTrusted(comment, viewer, accepted));
    const skipped = [...new Set(marked.filter((comment) => !trusted.includes(comment)).map(authorOf))];
    if (skipped.length) {
      warn(`Aviso: se ignoran comentarios de ronda de cuentas sin rol en el repositorio: ${skipped.join(", ")}.`);
    }
    const notes = [];
    for (const comment of trusted) {
      // GitHub ya trae el texto mostrado. GitLab lo da aparte.
      const shown = api ? { ...comment, body_text: await gitlabText(api, comment.body) } : comment;
      notes.push({ mark: roundMark(comment.body), text: renderedBody(shown) });
    }
    return notes;
  };
  const persist = async (body, id) => {
    if (id == null) return writeIssueBody(body);
    checkWritable(body, limits.comment);
    if (api) return updateNote(api, number, id, body);
    await withTemporary(JSON.stringify({ body }), (path) =>
      call(["api", `${apiRepo}/issues/comments/${id}`, "-X", "PATCH", "--input", path]),
    );
  };

  if (command === "read") {
    const { body } = await source();
    if (!options.section) return normalize(body);
    const parsed = parseBody(body);
    if (options.section === "top") return parsed.top;
    if (!SECTIONS.includes(options.section)) throw new IssueSpecError("La sección tiene que ser top, spec, plan o tasks.", 1);
    return parsed.sections[options.section] ?? "";
  }
  if (command === "can-edit") {
    if (api) return (await canEditIssue(api, number)) ? "yes" : "no";
    const query = "query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){viewerCanUpdate}}}";
    const raw = await call(["api", "graphql", "-f", `query=${query}`, ...repoFields, "-F", `n=${number}`]);
    return JSON.parse(raw).data.repository.issue.viewerCanUpdate ? "yes" : "no";
  }
  if (command === "top-hash") return hashTop(parseBody((await source()).body).top);
  if (command === "write") {
    const replacements = {};
    for (const name of SECTIONS) {
      if (options[name]) replacements[name] = await readFile(options[name], "utf8");
    }
    if (!Object.keys(replacements).length) throw new IssueSpecError("Indica al menos --spec, --plan o --tasks.", 1);
    const { id, body } = await source();
    const limit = id == null ? limits.issue : limits.comment;
    await persist(replaceSections(body, replacements, options["expect-top"], limit), id);
    return `Issue #${number}: ${Object.keys(replacements).join(", ")} escritas.`;
  }
  if (command === "tick") {
    const task = options.positional[0];
    if (!/^TASK-\d+$/.test(task ?? "")) throw new IssueSpecError("Indica la task como TASK-NN.", 1);
    const { id, body } = await source();
    const next = tickTask(body, task, options["expect-top"]);
    if (next === null) return `Issue #${number}: ${task} ya estaba marcada.`;
    await persist(next, id);
    return `Issue #${number}: ${task} marcada.`;
  }
  if (command === "state") {
    const { id, body } = await source();
    await persist(setState(body, options.positional[0], today(), options["expect-top"]), id);
    return `Issue #${number}: estado ${options.positional[0]}.`;
  }
  if (command === "comment") {
    const file = options.positional[0];
    if (!file) throw new IssueSpecError("Indica el fichero del comentario.", 1);
    const text = await readFile(file, "utf8");
    checkWritable(text, limits.comment);
    if (isRevisionComment(text)) {
      throw new IssueSpecError("El comentario de ronda no puede ser un comentario de revisión. Usa revision.", 1);
    }
    if (/^<!--\s*(ronda|cierre)/i.test(normalize(text).trim()) && !roundMark(text)) {
      throw new IssueSpecError("La primera línea tiene que ser solo <!-- Ronda N -->, de 1 a 9, o <!-- Cierre -->. No se publica.", 1);
    }
    await postComment(text);
    return `Issue #${number}: comentario publicado.`;
  }
  if (command === "rounds") {
    const all = await roundNotes(options.revision ? (await source()).id : null);
    const notes = options.sinceClose ? sinceLastClose(all) : all;
    if (!notes.length) return "No hay comentarios de ronda.";
    return notes.map((note) => `=== ${note.mark} ===\n${note.text.trim()}`).join("\n\n");
  }
  if (command === "trace") {
    const { id, body } = await source();
    const tasks = parseBody(body).sections.tasks;
    if (tasks === undefined) throw new IssueSpecError("La issue no tiene sección Tasks.", 1);
    const missing = untracedTasks(tasks, (await roundNotes(id)).map((note) => note.text));
    if (missing.length) {
      throw new IssueSpecError(`Tasks marcadas sin rastro en los comentarios de ronda: ${missing.join(", ")}.`, 7);
    }
    return `Issue #${number}: todas las tasks marcadas tienen rastro.`;
  }
  if (command === "reviews") {
    const accepted = parseLogins(options.accept);
    const since = options.solo ? await lastRevisionDate() : null;
    if (api) return gitlabReviewNotes(api, number, await viewerLogin(), accepted, { solo: options.solo, since });
    const prs = JSON.parse(await call(["pr", "list", ...repo, "--state", "open", "--json", "number,body,url,reviewDecision"])) || [];
    const pr = (Array.isArray(prs) ? prs : []).find((item) => closesIssue(item.body, number));
    if (!pr) throw new IssueSpecError("No hay una pull request abierta que cierre esta issue.", 1);
    const reviews = await listRendered(`pulls/${pr.number}/reviews`);
    const comments = await listRendered(`issues/${pr.number}/comments`);
    const lineComments = await markResolved(pr.number, await listRendered(`pulls/${pr.number}/comments`));
    const recent = { reviews: newerThan(reviews, since), comments: newerThan(comments, since), lineComments };
    const screened = screenNotes(recent, await viewerLogin(), accepted);
    return `${options.solo ? pendingLines(screened) : screenedLines(pr.reviewDecision, screened)}\n`;
  }
  if (command === "revision") {
    const file = options.positional[0];
    if (!file) throw new IssueSpecError("Indica el fichero del comentario.", 1);
    const viewer = await viewerLogin();
    const revisions = await withRoles((await listComments()).filter((comment) => isRevisionComment(comment.body ?? "")));
    const n = nextRevisionNumber(revisions.filter((comment) => isTrusted(comment, viewer)));
    const text = ensureRevisionHeader(await readFile(file, "utf8"), n);
    checkWritable(text, limits.comment);
    await postComment(text);
    return `Issue #${number}: revisión ${n} publicada. Huella: ${hashTop(parseBody(text).top)}`;
  }
  throw new IssueSpecError(`Comando desconocido: ${command}.`, 1);
}

// Node da en import.meta.url la ruta real: la de la llamada puede pasar por un enlace simbólico.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = error.code ?? 1;
    });
}
