import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBody, hashTop, replaceSections, tickTask, setState, findSecret, run, MAX_BODY,
  isRevisionComment, latestRevision, nextRevisionNumber, ensureRevisionHeader, formatReviewNotes,
  isTrusted, TRUSTED_ROLES, roundMark, sinceLastClose, untracedTasks,
} from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const TOP = "## Qué hay que hacer\n\nAlgo.\n\n## Cómo probarlo\n\n1. Mirar.\n\nRevisan: Ada";
const BODY = `${TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-07 · Aprobada: —\n\n### Metadata\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n- [ ] **TASK-10:** Diez\n`;

test("la parte de arriba es lo anterior a las tres secciones", () => {
  const parsed = parseBody(BODY);
  assert.equal(parsed.top, TOP);
  assert.ok(parsed.sections.spec.startsWith("> Estado"));
  assert.equal(parsed.sections.plan, undefined);
});

test("escribir el plan conserva la spec, las tasks y la parte de arriba", () => {
  const next = replaceSections(BODY, { plan: "## Plan\n\n### Diseño técnico\n\nX" }, hashTop(TOP));
  const parsed = parseBody(next);
  assert.equal(parsed.top, TOP);
  assert.equal(parsed.sections.plan, "### Diseño técnico\n\nX");
  assert.ok(parsed.sections.tasks.includes("TASK-10"));
  assert.ok(next.indexOf("## Spec") < next.indexOf("## Plan") && next.indexOf("## Plan") < next.indexOf("## Tasks"));
});

test("si la parte de arriba cambió, no se escribe y sale con 3", () => {
  const edited = BODY.replace("Algo.", "Otra cosa.");
  assert.throws(() => replaceSections(edited, { plan: "X" }, hashTop(TOP)), { code: 3 });
});

test("sin huella no se escribe", () => {
  assert.throws(() => replaceSections(BODY, { plan: "X" }), { code: 1 });
});

test("un secreto bloquea la escritura sin mostrar el valor", () => {
  const token = `ghp_${"a".repeat(36)}`;
  assert.equal(findSecret(`token ${token}`), "token de GitHub");
  assert.throws(() => replaceSections(BODY, { plan: `usa ${token}` }, hashTop(TOP)), (error) => error.code === 4 && !error.message.includes(token));
});

test("un cuerpo de más de 65 536 caracteres sale con 5", () => {
  assert.throws(() => replaceSections(BODY, { plan: "x".repeat(MAX_BODY) }, hashTop(TOP)), { code: 5 });
});

test("tick marca solo la task pedida, no la que empieza igual", () => {
  const next = tickTask(BODY, "TASK-01", hashTop(TOP));
  assert.ok(next.includes("- [x] **TASK-01:**"));
  assert.ok(next.includes("- [ ] **TASK-10:**"));
  assert.equal(tickTask(next, "TASK-01", hashTop(TOP)), null);
  assert.throws(() => tickTask(BODY, "TASK-02", hashTop(TOP)), { code: 1 });
});

test("state cambia la línea Estado con la fecha", () => {
  const next = setState(BODY, "Implementada", "2026-11-08", hashTop(TOP));
  assert.ok(next.includes("> Estado: **Implementada (2026-11-08)** · Creada: 2026-11-07"));
  assert.throws(() => setState(BODY, "Aprobada", "2026-11-08", hashTop(TOP)), { code: 1 });
});

test("run write lee, sustituye y escribe con gh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-test-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const calls = [];
  let written;
  const call = async (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ body: BODY });
    if (args[1] === "edit") {
      const { readFile } = await import("node:fs/promises");
      written = await readFile(args[args.indexOf("--body-file") + 1], "utf8");
    }
    return "";
  };
  const output = await run(["write", "7", "--expect-top", hashTop(TOP), "--plan", plan], { run: call });
  assert.match(output, /plan escritas/);
  assert.deepEqual(calls[0], ["issue", "view", "7", "--json", "body"]);
  assert.equal(parseBody(written).sections.plan, "Nuevo");
  assert.equal(parseBody(written).top, TOP);
});

test("run read --section devuelve una sección", async () => {
  const call = async () => JSON.stringify({ body: BODY });
  assert.equal(await run(["read", "7", "--section", "top"], { run: call }), TOP);
  assert.equal(await run(["top-hash", "7"], { run: call }), hashTop(TOP));
});

const REV_TOP = "<!-- Revisión 1 -->";
const REV_BODY = `${REV_TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-11 · Aprobada: —\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n`;

test("un comentario de revisión se reconoce por la primera línea", () => {
  assert.equal(isRevisionComment(REV_BODY), true);
  assert.equal(isRevisionComment(BODY), false);
  assert.equal(nextRevisionNumber([{ body: REV_BODY }]), 2);
  assert.equal(latestRevision([{ body: BODY }, { body: REV_BODY, id: 9 }]).id, 9);
});

test("ensureRevisionHeader no duplica la marca", () => {
  assert.match(ensureRevisionHeader("## Spec\n\nHola", 1), /^<!-- Revisión 1 -->/);
  assert.equal(ensureRevisionHeader(REV_BODY, 9).startsWith(REV_TOP), true);
});

test("tick en un comentario de revisión no usa el cuerpo de la issue", () => {
  const next = tickTask(REV_BODY, "TASK-01", hashTop(REV_TOP));
  assert.ok(next.includes("- [x] **TASK-01:**"));
  assert.ok(next.startsWith(REV_TOP));
  assert.throws(() => tickTask(REV_BODY, "TASK-01", hashTop(TOP)), { code: 3 });
});

test("formatReviewNotes junta reviews y comentarios de línea", () => {
  const text = formatReviewNotes({
    reviewDecision: "CHANGES_REQUESTED",
    reviews: [{ author: { login: "ada" }, state: "CHANGES_REQUESTED", body: "Cambia el nombre." }],
    lineComments: [{ user: { login: "ada" }, path: "src/a.js", line: 3, body: "aquí" }],
  });
  assert.match(text, /CHANGES_REQUESTED/);
  assert.match(text, /Cambia el nombre/);
  assert.match(text, /src\/a.js:3/);
});

test("run write --revision parchea el comentario y no el cuerpo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-rev-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const calls = [];
  let patched;
  const call = async (args) => {
    calls.push(args);
    if (args[0] === "api" && args[1] === "user") return JSON.stringify({ login: "ada" });
    if (args[0] === "api" && String(args[1]).includes("/comments") && !String(args[1]).includes("/comments/")) {
      return JSON.stringify([{ id: 44, user: { login: "ada" }, author_association: "CONTRIBUTOR", body: REV_BODY }]);
    }
    if (args[0] === "api" && args.includes("PATCH")) {
      const { readFile } = await import("node:fs/promises");
      patched = JSON.parse(await readFile(args[args.indexOf("--input") + 1], "utf8")).body;
      return "{}";
    }
    return "";
  };
  const output = await run(
    ["write", "7", "--expect-top", hashTop(REV_TOP), "--revision", "--plan", plan],
    { run: call },
  );
  assert.match(output, /plan escritas/);
  assert.equal(parseBody(patched).sections.plan, "Nuevo");
  assert.equal(parseBody(patched).top, REV_TOP);
  assert.ok(!calls.some((args) => args[1] === "edit"));
});

test("run revision publica el comentario con la marca", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-rev2-"));
  const file = join(dir, "rev.md");
  await writeFile(file, "## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-11 · Aprobada: —\n");
  let posted;
  const call = async (args) => {
    if (args[1] === "user") return JSON.stringify({ login: "ada" });
    if (args[0] === "api") return "[]";
    if (args[1] === "comment") {
      const { readFile } = await import("node:fs/promises");
      posted = await readFile(args[args.indexOf("--body-file") + 1], "utf8");
      return "";
    }
    return "";
  };
  const output = await run(["revision", "7", file], { run: call });
  assert.match(output, /revisión 1 publicada/);
  assert.match(output, /Huella:/);
  assert.ok(posted.startsWith("<!-- Revisión 1 -->"));
});

test("run can-edit dice si la cuenta puede editar el cuerpo", async () => {
  const answer = (viewerCanUpdate) => async (args) => {
    assert.equal(args[0], "api");
    assert.equal(args[1], "graphql");
    return JSON.stringify({ data: { repository: { issue: { viewerCanUpdate } } } });
  };
  assert.equal(await run(["can-edit", "7"], { run: answer(true) }), "yes");
  assert.equal(await run(["can-edit", "7"], { run: answer(false) }), "no");
});

test("write sin --revision en una issue no editable sale con 6", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-noedit-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const call = async (args) => {
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ body: BODY });
    throw new Error("GraphQL: does not have permission to update the issue");
  };
  await assert.rejects(
    run(["write", "7", "--expect-top", hashTop(TOP), "--plan", plan], { run: call }),
    (error) => error.code === 6 && /revision/.test(error.message),
  );
});

const revisionDe = (id, login, role, task) => ({
  id,
  user: { login },
  author_association: role,
  body: `${REV_TOP}\n\n## Tasks\n\n- [ ] **TASK-01:** ${task}\n`,
});

// gh simulado de una issue: la cuenta del token es «ada».
function issueConComentarios(comments, patched = []) {
  return async (args) => {
    if (args[0] === "api" && args[1] === "user") return JSON.stringify({ login: "ada" });
    if (args.includes("PATCH")) {
      patched.push(args[1]);
      return "{}";
    }
    return JSON.stringify(comments);
  };
}

test("se acepta la cuenta del token, los roles del repositorio y las cuentas aprobadas", () => {
  const rest = (login, role) => ({ user: { login }, author_association: role });
  const graphql = (login, role) => ({ author: { login }, authorAssociation: role });
  assert.equal(isTrusted(rest("Ada", "CONTRIBUTOR"), "ada"), true);
  for (const role of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.equal(isTrusted(rest("eva", role), "ada"), true);
    assert.equal(isTrusted(graphql("eva", role), "ada"), true);
  }
  for (const role of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE", undefined]) {
    assert.equal(isTrusted(rest("eva", role), "ada"), false);
  }
  assert.equal(isTrusted(graphql("Eva", "NONE"), "ada", ["eva"]), true);
  assert.equal(isTrusted({ author: null, authorAssociation: "OWNER" }, "ada"), false);
});

test("read --revision ignora la revisión de una cuenta ajena", async () => {
  const call = issueConComentarios([
    revisionDe(1, "ada", "CONTRIBUTOR", "propia"),
    revisionDe(2, "eva", "NONE", "ajena"),
  ]);
  const tasks = await run(["read", "7", "--revision", "--section", "tasks"], { run: call });
  assert.match(tasks, /propia/);
  assert.doesNotMatch(tasks, /ajena/);
});

test("read --revision usa la revisión de una cuenta con rol", async () => {
  const call = issueConComentarios([revisionDe(1, "eva", "OWNER", "de quien mantiene")]);
  assert.match(await run(["read", "7", "--revision", "--section", "tasks"], { run: call }), /de quien mantiene/);
});

test("tick --revision escribe en la revisión aceptada aunque otra copie su cabecera", async () => {
  const patched = [];
  const call = issueConComentarios(
    [revisionDe(1, "ada", "CONTRIBUTOR", "propia"), revisionDe(2, "eva", "NONE", "ajena")],
    patched,
  );
  await run(["tick", "7", "TASK-01", "--revision", "--expect-top", hashTop(REV_TOP)], { run: call });
  assert.deepEqual(patched, ["repos/{owner}/{repo}/issues/comments/1"]);
});

test("si solo hay revisiones ajenas, no se usan y se nombran sus cuentas", async () => {
  const call = issueConComentarios([revisionDe(2, "eva", "NONE", "ajena")]);
  await assert.rejects(
    run(["read", "7", "--revision"], { run: call }),
    (error) => error.code === 1 && /eva/.test(error.message) && !/TASK-01|## Tasks/.test(error.message),
  );
});

// La respuesta de GraphQL con una página de hilos.
function pageOfThreads(pages, args) {
  const index = Number(args.find((arg) => arg.startsWith("cursor="))?.slice("cursor=".length) ?? 0);
  const nodes = pages[index].map(({ resolved, ids }) => ({
    isResolved: resolved, comments: { nodes: ids.map((id) => ({ fullDatabaseId: String(id) })) },
  }));
  const pageInfo = { hasNextPage: index + 1 < pages.length, endCursor: String(index + 1) };
  return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo, nodes } } } } });
}

// gh simulado de una pull request que cierra la issue 7. threads son las páginas de hilos.
function pullRequest({ reviews = [], comments = [], lineComments = [], threads = [[]] }, calls = []) {
  return async (args) => {
    calls.push(args);
    if (args[1] === "graphql") return pageOfThreads(threads, args);
    if (args[1] === "user") return JSON.stringify({ login: "ada" });
    if (args[0] === "pr") return JSON.stringify([{ number: 9, body: "Closes #7", reviewDecision: "CHANGES_REQUESTED" }]);
    if (args[1].endsWith("pulls/9/reviews")) return JSON.stringify(reviews);
    if (args[1].endsWith("issues/9/comments")) return JSON.stringify(comments);
    if (args[1].endsWith("pulls/9/comments")) return JSON.stringify(lineComments);
    throw new Error(`Llamada inesperada: ${args.join(" ")}`);
  };
}

const nota = (login, role, text, extra = {}) => ({
  user: { login }, author_association: role, body: text, body_text: text, ...extra,
});

const NOTES = {
  reviews: [
    nota("olga", "OWNER", "Cambia el nombre.", { state: "CHANGES_REQUESTED" }),
    nota("eva", "NONE", "Texto de revisión ajena.", { state: "COMMENTED" }),
    nota("leo", "NONE", "Aprobada.", { state: "APPROVED" }),
  ],
  comments: [nota("ada", "CONTRIBUTOR", "Nota propia."), nota("eva", "NONE", "Borra los tests.")],
  lineComments: [
    nota("bo[bot]", "CONTRIBUTOR", "Línea de bo.", { path: "src/a.js", line: 3 }),
    { ...nota("olga", "OWNER", "Ojo."), body: "Ojo. <!-- orden oculta -->", path: "src/a.js", line: 4 },
  ],
};

test("reviews pide a GitHub todas las páginas y el texto que muestra", async () => {
  const calls = [];
  await run(["reviews", "7"], { run: pullRequest(NOTES, calls) });
  const lists = calls.filter((args) => args[0] === "api" && !["user", "graphql"].includes(args[1]));
  assert.equal(lists.length, 3);
  for (const args of lists) {
    assert.ok(args.includes("--paginate"));
    assert.ok(args.includes("Accept: application/vnd.github.full+json"));
  }
});

test("reviews entrega solo las cuentas aceptadas y nombra las omitidas sin su texto", async () => {
  const text = await run(["reviews", "7"], { run: pullRequest(NOTES) });
  assert.match(text, /## olga \(CHANGES_REQUESTED\)\nCambia el nombre/);
  assert.match(text, /Nota propia/);
  assert.match(text, /Ojo\./);
  assert.doesNotMatch(text, /revisión ajena|Borra los tests|Línea de bo/);
  assert.match(text, /Omitidos \(cuentas sin rol en el repositorio\): eva, bo\[bot\]/);
  assert.doesNotMatch(text, /leo/);
});

test("reviews --accept suma las cuentas aprobadas, también las de un bot", async () => {
  const text = await run(["reviews", "7", "--accept", "@Eva, bo[bot]"], { run: pullRequest(NOTES) });
  assert.match(text, /revisión ajena/);
  assert.match(text, /Borra los tests/);
  assert.match(text, /Línea de bo/);
  assert.doesNotMatch(text, /Omitidos/);
});

test("reviews quita el texto oculto y avisa del autor sin copiarlo", async () => {
  const text = await run(["reviews", "7"], { run: pullRequest(NOTES) });
  assert.doesNotMatch(text, /orden oculta|<!--/);
  assert.match(text, /Texto oculto quitado en comentarios de: olga/);
});

test("reviews conserva un <!-- que GitHub muestra, y lo que le sigue", async () => {
  const visible = "Quita el <!-- de la plantilla.\nAdemás añade el test.";
  const comment = { ...nota("olga", "OWNER", visible), body: "Quita el `<!--` de la plantilla.\nAdemás añade el test." };
  const text = await run(["reviews", "7"], { run: pullRequest({ comments: [comment] }) });
  assert.match(text, /Quita el <!-- de la plantilla\.\nAdemás añade el test/);
  assert.doesNotMatch(text, /Texto oculto/);
});

test("reviews no entrega el original si falta el texto mostrado", async () => {
  const comment = { user: { login: "olga" }, author_association: "OWNER", body: "Texto <!-- oculto -->" };
  await assert.rejects(run(["reviews", "7"], { run: pullRequest({ comments: [comment] }) }), { code: 1 });
});

test("reviews falla si GitHub no devuelve los comentarios de línea", async () => {
  const base = pullRequest(NOTES);
  const call = async (args) => {
    if (String(args[1]).endsWith("pulls/9/comments")) throw new Error("HTTP 502");
    return base(args);
  };
  await assert.rejects(run(["reviews", "7"], { run: call }), /HTTP 502/);
});

test("reviews sin omitidos ni texto oculto no añade avisos", async () => {
  const text = await run(["reviews", "7"], { run: pullRequest({ comments: [nota("ada", "NONE", "Nota.")] }) });
  assert.doesNotMatch(text, /Omitidos|Texto oculto/);
});

const linea = (id, login, role, text, extra = {}) => nota(login, role, text, { id, path: "src/a.js", line: id, ...extra });

const THREADS = {
  lineComments: [
    linea(11, "olga", "OWNER", "Hilo atendido."),
    linea(12, "ada", "OWNER", "Respuesta del atendido.", { in_reply_to_id: 11 }),
    linea(13, "olga", "OWNER", "Hilo pendiente."),
  ],
  threads: [[{ resolved: true, ids: [11, 12] }, { resolved: false, ids: [13] }]],
};

test("reviews deja fuera los comentarios de un hilo resuelto, con sus respuestas", async () => {
  const text = await run(["reviews", "7"], { run: pullRequest(THREADS) });
  assert.match(text, /Hilo pendiente/);
  assert.doesNotMatch(text, /atendido/);
});

test("reviews recorre todas las páginas de hilos", async () => {
  const calls = [];
  const threads = [[{ resolved: false, ids: [13] }], [{ resolved: true, ids: [11, 12] }]];
  const text = await run(["reviews", "7"], { run: pullRequest({ ...THREADS, threads }, calls) });
  assert.match(text, /Hilo pendiente/);
  assert.doesNotMatch(text, /atendido/);
  const queries = calls.filter((args) => args[1] === "graphql");
  assert.equal(queries.length, 2);
  assert.ok(queries[1].includes("cursor=1"));
});

test("reviews reconoce una respuesta que no llega en su hilo por el comentario al que responde", async () => {
  const threads = [[{ resolved: true, ids: [11] }, { resolved: false, ids: [13] }]];
  const text = await run(["reviews", "7"], { run: pullRequest({ ...THREADS, threads }) });
  assert.doesNotMatch(text, /atendido/);
});

test("reviews no nombra como omitida a una cuenta cuyo hilo está resuelto", async () => {
  const data = { lineComments: [linea(21, "eva", "NONE", "Ya visto.")], threads: [[{ resolved: true, ids: [21] }]] };
  const text = await run(["reviews", "7"], { run: pullRequest(data) });
  assert.doesNotMatch(text, /Omitidos|Ya visto/);
});

test("reviews pide los hilos del repositorio indicado", async () => {
  const calls = [];
  await run(["reviews", "7", "--repo", "acme/web"], { run: pullRequest(THREADS, calls) });
  const query = calls.find((args) => args[1] === "graphql");
  for (const field of ["owner=acme", "name=web", "n=9"]) assert.ok(query.includes(field), field);
});

test("reviews falla sin entregar texto si no sabe qué hilos están resueltos", async () => {
  const base = pullRequest(THREADS);
  const broken = [
    async () => { throw new Error("HTTP 502"); },
    async () => JSON.stringify({ data: { repository: { pullRequest: null } } }),
    async () => "",
  ];
  for (const answer of broken) {
    const call = async (args) => (args[1] === "graphql" ? answer() : base(args));
    await assert.rejects(run(["reviews", "7"], { run: call }));
  }
});

test("reviews no consulta los hilos si no hay comentarios de línea", async () => {
  const calls = [];
  await run(["reviews", "7"], { run: pullRequest({ comments: [nota("ada", "NONE", "Nota.")] }, calls) });
  assert.equal(calls.filter((args) => args[1] === "graphql").length, 0);
});

test("read --revision avisa si ignora una revisión ajena más nueva", async () => {
  const warnings = [];
  const call = issueConComentarios([
    revisionDe(1, "ada", "CONTRIBUTOR", "propia"),
    revisionDe(2, "eva", "NONE", "ajena"),
  ]);
  await run(["read", "7", "--revision"], { run: call, warn: (message) => warnings.push(message) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /más nuevo.*eva/);
  assert.doesNotMatch(warnings[0], /TASK-01/);
});

test("revision numera sin contar los comentarios de cuentas ajenas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-num-"));
  const file = join(dir, "rev.md");
  await writeFile(file, "## Spec\n\nHola\n");
  const foreign = { ...revisionDe(2, "eva", "NONE", "ajena"), body: "<!-- Revisión 999 -->" };
  const call = issueConComentarios([revisionDe(1, "ada", "CONTRIBUTOR", "propia"), foreign]);
  assert.match(await run(["revision", "7", file], { run: call }), /revisión 2 publicada/);
});

test("la skill nombra los mismos roles aceptados que el script", async () => {
  const skill = await readFile(new URL("../.apm/skills/issue-spec/SKILL.md", import.meta.url), "utf8");
  const line = skill.split("\n").find((text) => text.startsWith("- **Cuentas aceptadas**"));
  const roles = [...line.matchAll(/`([A-Z_]+)`/g)].map((match) => match[1]);
  assert.deepEqual(roles.sort(), [...TRUSTED_ROLES].sort());
});

const comentario = (id, login, role, text) => ({
  id, user: { login }, author_association: role, body: text, body_text: text.replace(/^<!--[^\n]*-->\n/, ""),
});
const ronda = (id, n, tasks, login = "ada", role = "CONTRIBUTOR") =>
  comentario(id, login, role, `<!-- Ronda ${n} -->\nTasks: ${tasks}\nDocumentación pendiente: README.md`);
const cierre = (id, tasks) => comentario(id, "ada", "CONTRIBUTOR", `<!-- Cierre -->\nTasks: ${tasks}`);

test("un comentario de ronda o de cierre se reconoce por la primera línea", () => {
  assert.equal(roundMark("<!-- Ronda 3 -->\nTasks: TASK-02"), "Ronda 3");
  assert.equal(roundMark("<!-- Cierre -->"), "Cierre");
  assert.equal(roundMark("Texto\n<!-- Cierre -->"), null);
  assert.equal(roundMark("<!-- Revisión 1 -->"), null);
  assert.equal(roundMark("<!-- Ronda 10 -->"), null);
});

test("sinceLastClose deja las rondas posteriores al último cierre", () => {
  const marks = (list) => sinceLastClose(list.map((mark) => ({ mark }))).map((note) => note.mark);
  assert.deepEqual(marks(["Ronda 1", "Ronda 2"]), ["Ronda 1", "Ronda 2"]);
  assert.deepEqual(marks(["Ronda 1", "Cierre", "Ronda 2"]), ["Ronda 2"]);
  assert.deepEqual(marks(["Ronda 1", "Cierre"]), []);
});

test("rounds entrega solo las rondas de cuentas aceptadas y avisa de las ignoradas", async () => {
  const warnings = [];
  const call = issueConComentarios([
    ronda(1, 1, "TASK-02"),
    ronda(2, 2, "TASK-99", "eva", "NONE"),
    comentario(3, "ada", "CONTRIBUTOR", "Comentario sin marca"),
  ]);
  const text = await run(["rounds", "7"], { run: call, warn: (message) => warnings.push(message) });
  assert.match(text, /=== Ronda 1 ===\nTasks: TASK-02/);
  assert.doesNotMatch(text, /TASK-99|sin marca|<!--/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ronda.*eva/);
});

test("rounds --accept suma la cuenta aprobada", async () => {
  const call = issueConComentarios([ronda(2, 2, "TASK-03", "eva", "NONE")]);
  assert.match(await run(["rounds", "7", "--accept", "eva"], { run: call }), /TASK-03/);
});

test("rounds --since-close deja solo lo pendiente", async () => {
  const call = issueConComentarios([ronda(1, 1, "TASK-02"), cierre(2, "TASK-06"), ronda(3, 2, "TASK-03")]);
  const text = await run(["rounds", "7", "--since-close"], { run: call });
  assert.match(text, /TASK-03/);
  assert.doesNotMatch(text, /TASK-02|TASK-06/);
  const closed = issueConComentarios([ronda(1, 1, "TASK-02"), cierre(2, "TASK-06")]);
  assert.equal(await run(["rounds", "7", "--since-close"], { run: closed }), "No hay comentarios de ronda.");
});

test("rounds --revision solo lee lo posterior a la revisión en curso", async () => {
  const call = issueConComentarios([
    ronda(1, 1, "TASK-02"),
    revisionDe(2, "ada", "CONTRIBUTOR", "pedida"),
    ronda(3, 1, "TASK-05"),
  ]);
  const text = await run(["rounds", "7", "--revision"], { run: call });
  assert.match(text, /TASK-05/);
  assert.doesNotMatch(text, /TASK-02/);
});

const TASKS = [
  "- [x] **TASK-02:** Código", "  - **Agente:** `code-developer`",
  "- [x] **TASK-06:** Concepto", "  - **Agente:** `concept-tester`",
  "- [ ] **TASK-05:** Tests", "  - **Agente:** `code-tester`",
  "- [x] **TASK-07:** Commit", "  - **Agente:** `manage-commit`",
].join("\n");

test("untracedTasks nombra las tasks marcadas del ciclo que no están en una línea Tasks", () => {
  assert.deepEqual(untracedTasks(TASKS, []), ["TASK-02", "TASK-06"]);
  assert.deepEqual(untracedTasks(TASKS, ["Tasks: TASK-02\nFalló TASK-06"]), ["TASK-06"]);
  assert.deepEqual(untracedTasks(TASKS, ["Tasks: TASK-02", "Tasks: TASK-06"]), []);
});

function issueConTasks(comments) {
  const base = issueConComentarios(comments);
  return async (args) =>
    args[0] === "issue" ? JSON.stringify({ body: `${TOP}\n\n## Tasks\n\n${TASKS}\n` }) : base(args);
}

test("trace sale con 7 si una task marcada no tiene rastro", async () => {
  await assert.rejects(
    run(["trace", "7"], { run: issueConTasks([ronda(1, 1, "TASK-02")]) }),
    (error) => error.code === 7 && /TASK-06/.test(error.message) && !/TASK-02/.test(error.message),
  );
});

test("trace confirma el rastro y no cuenta el de una cuenta ajena", async () => {
  const comments = [ronda(1, 1, "TASK-02"), cierre(2, "TASK-06")];
  assert.match(await run(["trace", "7"], { run: issueConTasks(comments) }), /tienen rastro/);
  const foreign = [ronda(1, 1, "TASK-02"), ronda(2, 2, "TASK-06", "eva", "NONE")];
  await assert.rejects(run(["trace", "7"], { run: issueConTasks(foreign), warn: () => {} }), { code: 7 });
});

test("comment no publica una marca de ronda o de cierre mal escrita", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-mark-"));
  const file = join(dir, "ronda.md");
  const calls = [];
  const call = async (args) => (calls.push(args), "");
  for (const first of ["<!-- Ronda 1 --> Tasks: TASK-02", "<!--Ronda 1-->", "<!-- Ronda 10 -->", "<!-- cierre -->"]) {
    await writeFile(file, `${first}\nTexto`);
    await assert.rejects(run(["comment", "7", file], { run: call }), { code: 1 });
  }
  assert.equal(calls.length, 0);
  for (const first of ["<!-- Ronda 9 -->", "<!-- Cierre -->", "Informe de la pasada"]) {
    await writeFile(file, `${first}\nTexto`);
    assert.match(await run(["comment", "7", file], { run: call }), /comentario publicado/);
  }
});
