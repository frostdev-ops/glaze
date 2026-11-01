// Ask Glaze (docs/ai-harness.md "Ask Glaze"), in the worker: the student asks in a panel over the page (ai/page/ask.js) and
// Glaze either helps with their coursework (study.help, which never hands over the answer) or answers from their own
// records with Agents' tools (agent.tools), one tool call a turn.
//   route(question, { attempt, locale }) → { task: 'study.help', subject } | { task: 'agent.tools', tools }: agent.tools only
//     for a question about the student's own records (TOPICS: to-dos and due dates, grades, assignments, Writer documents)
//     that asks for no help with work (WORK) and comes with no attempt. Words in English and the student's locale.
//   episode({ question, tools, locale, now, zone, run, call, signal }) → { answer, steps } | { declined, steps }: the step
//     loop. run(task, input) → the task's checked output; call({ name, arguments, kind }) → { result, asked? }. A write the
//     student didn't allow (asked isn't 'yes') ends it with no further run; a seventh call ends it as 'steps'.
//   connect(port, env): the panel's port 'glaze:ask' (background/background.js checks its sender with the AI port's rules).
//     page → { id, op: 'ask', question, attempt?, locale }  { id, op: 'cancel' }  { id, op: 'status' }
//     worker → { id, type: 'route', task }, 'look' (a read starts), 'approve' (Glaze's approval window waits), 'keepalive',
//       then { id, type: 'end', task, output (study.help's) | answer: { text } | declined: true } or { id, type: 'error',
//       error }; status → the broker's status for the feature 'ask'.
//     Model runs go to the AI broker over a channel in the worker (env.broker(port): ai/broker.js connect with this sender's
//     checks), as the feature 'ask'. Tool calls go through agents/calls.js: Ask's own switch is the grant of Agents' groups,
//     the one write waits for the student in Agents' approval window (env.approve), and results reach the model as the tool
//     gave them (calls.js's note, source and age left out, as agent.tools was trained). An agent answer must also pass
//     study.help's answer-giving rules (hands), so no path hands over work.
//   env: { allowed(what), broker(port), settings() (storage.local ai), enabled(), registry, state(), approve: { ask },
//     refresh, accounts(), local, keys, now(), turn(f), zone? }.
// Classic script for the worker; module.exports for node.
var GZ_AI_ASK = globalThis.GZ_AI_ASK || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const SET = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./settings.js'));
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('./tasks/agent-tools.js'));
  const SH = () => (typeof GZ_AI_TASK_STUDY_HELP !== 'undefined' ? GZ_AI_TASK_STUDY_HELP : require('./tasks/study-help.js'));
  const CALLS = () => (typeof GZ_MCP_CALLS !== 'undefined' ? GZ_MCP_CALLS : require('../agents/calls.js'));
  const FEATURE = 'ask', APP = 'Ask Glaze';
  // question: agent.tools' own; attempt: study.help's; tools: offered at once (training offered three to six, and Glaze's own
  // model's 4,096-token window can't hold all twelve); material: what an agent answer is measured against.
  const LIMIT = { question: 2000, attempt: 12000, tools: 6, material: 24000 };
  const GROUPS = ['courses', 'grades', 'assignments', 'writer'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // ---- the routing rule ------------------------------------------------------------------------------------------------
  // Each entry a regular expression's source, matched as whole words, case folded.
  const TOPICS = {
    todo: {
      en: ['due', 'deadlines?', 'to-?dos?', 'to do', 'schedule', 'calendar', 'this week', 'next week', 'today', 'tonight', 'tomorrow', 'weekend', 'upcoming', 'overdue', 'coming up', "what's next"],
      es: ['entregas?', 'entregar', 'vencen?', 'fechas? l[ií]mite', 'pendientes?', 'horario', 'calendario', 'esta semana', 'pr[oó]xima semana', 'hoy', 'mañana', 'fin de semana', 'atrasad[oa]s?'],
      'pt-BR': ['prazos?', 'vencem?', 'entregas?', 'entregar', 'pendentes?', 'agenda', 'calend[aá]rio', 'esta semana', 'pr[oó]xima semana', 'hoje', 'amanh[ãa]', 'fim de semana', 'atrasad[oa]s?', 'a fazer'],
      fr: ['[ée]ch[ée]ances?', '[àa] rendre', 'dates? limites?', '[àa] faire', 'emploi du temps', 'calendrier', 'cette semaine', 'semaine prochaine', "aujourd'hui", 'demain', 'week-?end', 'en retard'],
      de: ['f[äa]llig', 'fristen?', 'abgaben?', 'abgabetermine?', 'to-?dos?', 'aufgabenliste', 'stundenplan', 'kalender', 'diese woche', 'n[äa]chste woche', 'heute', 'morgen', 'wochenende', '[üu]berf[äa]llig', 'versp[äa]tet'],
      nl: ['deadlines?', 'inleveren', 'inlevermoment', 'te doen', 'takenlijst', 'rooster', 'agenda', 'kalender', 'deze week', 'volgende week', 'vandaag', 'morgen', 'weekend', 'te laat'],
    },
    // Marking a to-do done: the one write.
    mark: { en: ['mark', 'check off', 'tick off', 'cross off'], es: ['marca(?:r|la|lo)?', 'm[áa]rca(?:la|lo)'], 'pt-BR': ['marca(?:r)?', 'marque'], fr: ['marque(?:r|z)?', 'coche(?:r|z)?'],
      de: ['markier\\p{L}*', 'abhaken', 'hake'], nl: ['markeer', 'markeren', 'afvinken', 'vink'] },
    grades: { en: ['grades?', 'graded', 'scores?', 'gpa', 'how am i doing', 'my average'], es: ['notas?', 'calificaci[oó]n(?:es)?', 'promedio', 'puntajes?'],
      'pt-BR': ['notas?', 'm[ée]dia', 'pontua[çc][ãa]o', 'conceitos?'], fr: ['notes?', 'moyenne', 'bulletin'], de: ['noten?', 'durchschnitt', 'punkte', 'bewertungen?'], nl: ['cijfers?', 'gemiddelde', 'punten'] },
    assignments: { en: ['assignments?', 'instructions', 'rubrics?', 'quiz(?:zes)?'], es: ['tareas?', 'instrucciones', 'r[uú]bricas?'], 'pt-BR': ['tarefas?', 'atividades?', 'instru[çc][õo]es', 'rubricas?'],
      fr: ['devoirs?', 'consignes?', 'grilles?'], de: ['aufgaben?', 'hausaufgaben?', 'anleitung', 'bewertungsraster'], nl: ['opdrachten?', 'instructies', 'rubrics?'] },
    documents: { en: ['documents?', 'drafts?', 'my papers?', 'writer documents?'], es: ['documentos?', 'borrador(?:es)?'], 'pt-BR': ['documentos?', 'rascunhos?'], fr: ['documents?', 'brouillons?'],
      de: ['dokumente?', 'entw[üu]rfe', 'entwurf'], nl: ['documenten', 'document', 'kladversies?'] },
  };
  // Help with work: study.help, whatever records the question names.
  const WORK = {
    en: ['how (?:do|can|could|would|should|does) (?:i|you|we|one)', 'how to', 'explain\\p{L}*', 'solv\\p{L}*', 'help me', 'help with', 'answers?', 'solutions?', 'check my', 'is (?:this|my|it) (?:right|correct|wrong)',
      'why', "i don'?t (?:get|understand)", 'hints?', 'calculat\\p{L}*', 'prove', 'derive', 'define', 'write (?:me|my|an?|the)', 'what does .{1,40} mean', 'teach me', 'practice'],
    es: ['c[oó]mo (?:se|hago|puedo|resuelvo|calculo|escribo)', 'expl[ií]ca\\p{L}*', 'resuel\\p{L}*', 'resolver', 'ay[uú]dame', 'ayuda con', 'respuestas?', 'soluci[oó]n', 'revisa', 'por qu[eé]', 'no entiendo', 'pistas?', 'calcula\\p{L}*'],
    'pt-BR': ['como (?:eu|fa[çc]o|posso|resolvo|calculo|escrevo|se)', 'expli\\p{L}*', 'resolv\\p{L}*', 'me ajud\\p{L}*', 'ajuda com', 'respostas?', 'solu[çc][ãa]o', 'confer\\p{L}*', 'verifi\\p{L}*', 'por qu[eê]', 'n[ãa]o entendo', 'dicas?', 'calcul\\p{L}*'],
    fr: ['comment (?:faire|je|on|r[ée]soudre|calculer|[ée]crire)', 'expliqu\\p{L}*', 'r[ée]sou\\p{L}*', 'aide-moi', 'aide avec', 'r[ée]ponses?', 'solutions?', 'v[ée]rifi\\p{L}*', 'pourquoi', 'je ne comprends pas', 'indices?', 'calcul\\p{L}*'],
    de: ['wie (?:kann|mache|l[öo]se|rechne|schreibe|berechne|soll|finde) ich', 'erkl[äa]r\\p{L}*', 'l[öo]s(?:e|en|t|ung\\p{L}*)', 'hilf mir', 'hilfe bei', 'antwort(?:en)?', 'warum', 'verstehe (?:\\p{L}+ )?nicht', 'tipps?', 'berechn\\p{L}*', '[üu]berpr[üu]f\\p{L}*'],
    nl: ['hoe (?:moet|kan|doe|los|bereken|schrijf) ik', 'uitleg\\p{L}*', 'leg uit', 'los op', 'oploss\\p{L}*', 'help me', 'hulp bij', 'antwoord\\p{L}*', 'controleer', 'waarom', '(?:snap|begrijp) (?:\\p{L}+ )?niet', 'hints?', 'bereken\\p{L}*'],
  };
  // The tools each topic needs, in this order; accounts_list where an account may need choosing.
  const TOOLS = { todo: ['todo_list', 'schedule_list'], mark: ['todo_mark_done'], grades: ['grades_list', 'course_grades'], assignments: ['assignments_list', 'assignment_read', 'courses_list'],
    documents: ['documents_list', 'document_read', 'document_assignment'] };
  const ACCOUNTS = ['todo', 'grades', 'assignments'];
  // study.help's subject: the first that matches, by its symbols or its words (any language), else other.
  const SUBJECTS = [
    ['code', /```|`[^`\n]+`|=>|[;{}]\s*$|\b(?:def|return|print|console\.log|#include|public static)\b/m, ['code', 'coding', 'program(?:s|ming)?', 'variables?', 'loops?', 'arrays?', 'compil\\p{L}*', 'syntax', 'python', 'java(?:script)?',
      'typescript', 'c\\+\\+', 'sql', 'html', 'css', 'recursion', 'algorithms?', 'debug\\p{L}*', 'bugs?', 'c[oó]digo', 'programa\\p{L}*', 'programme', 'programm', 'schleife', 'programma']],
    ['math', /\d\s*[a-z]\b|[a-z]\s*[=<>≤≥^]\s*[-\d(a-z]|\d\s*[+\-*/×÷^=]\s*[-\d(a-z]|[√∫π]|\b[a-z]\(\s*[a-z]\s*\)/i, ['math\\p{L}*', 'equations?', 'algebra', 'calculus', 'derivatives?', 'integrals?', 'fractions?',
      'percent\\p{L}*', 'slope', 'graph\\p{L}*', 'geometr\\p{L}*', 'triangles?', 'angles?', 'probabilit\\p{L}*', 'statistic\\p{L}*', 'matri(?:x|ces)', 'polynomials?', 'logarithms?', 'trigonometr\\p{L}*',
      'ecuaci\\p{L}*', 'matem[áa]tic\\p{L}*', 'derivadas?', 'fracci\\p{L}*', 'equa[çc]\\p{L}*', 'fra[çc]\\p{L}*', '[ée]quations?', 'math[ée]matiques', 'd[ée]riv[ée]es?', 'gleichung\\p{L}*', 'mathe\\p{L}*',
      'ableitung\\p{L}*', 'br[üu]che?', 'vergelijking\\p{L}*', 'wiskunde', 'afgeleide', 'breuk\\p{L}*']],
    ['science', null, ['biolog\\p{L}*', 'chemi\\p{L}*', 'physic\\p{L}*', 'cells?', 'atoms?', 'molecul\\p{L}*', 'elements?', 'reactions?', 'forces?', 'energy', 'gravity', 'photosynthesis', 'dna', 'genes?', 'genetic\\p{L}*',
      'evolution', 'ecosystems?', 'velocity', 'acceleration', 'electrons?', 'mitosis', 'meiosis', 'qu[íi]mic\\p{L}*', 'f[íi]sica', 'c[ée]lulas?', 'fotoss?[íi]nte\\p{L}*', 'physique', 'cellules?',
      'photosynth[èe]se', 'physik', 'zellen?', 'scheikunde', 'natuurkunde', 'cel(?:len)?']],
    ['essay', null, ['essays?', 'thesis', 'paragraphs?', 'arguments?', 'introduction', 'conclusion', 'outline', 'citations?', 'cite', 'mla', 'apa', 'ensayos?', 'tesis', 'p[áa]rrafos?', 'reda[çc][ãa]o', 'ensaios?',
      'tese', 'par[áa]grafos?', 'dissertation', 'th[èe]se', 'paragraphes?', 'aufs[äa]tze?', 'er[öo]rterung', 'absatz', 'betoog', 'scriptie', 'alinea']],
    ['reading', null, ['reading', 'chapters?', 'novels?', 'poems?', 'poetry', 'story', 'stories', 'authors?', 'passages?', 'characters?', 'themes?', 'plot', 'book', 'lectura', 'cap[íi]tulos?', 'novela', 'poemas?',
      'cuentos?', 'autor(?:es|a)?', 'personajes?', 'leitura', 'romance', 'contos?', 'personagens?', 'lecture', 'chapitres?', 'roman', 'po[èe]mes?', 'auteur', 'personnages?', 'lekt[üu]re', 'kapitel',
      'gedichte?', 'figur', 'hoofdstuk\\p{L}*', 'personage']],
  ];
  const compiled = new Map();
  const words = (list) => {
    const key = list.join('|');
    if (!compiled.has(key)) compiled.set(key, new RegExp(`(?<![\\p{L}\\p{N}])(?:${key})(?![\\p{L}\\p{N}])`, 'iu'));
    return compiled.get(key);
  };
  const lists = (table, locale) => [...table.en, ...(locale !== 'en' && Array.isArray(table[locale]) ? table[locale] : [])];
  const subjectOf = (text) => SUBJECTS.find(([, symbols, list]) => symbols?.test(text) || words(list).test(text))?.[0] || 'other';
  const route = (question, { attempt = '', locale = 'en' } = {}) => {
    const q = String(question).replace(/[‘’]/g, "'"), work = typeof attempt === 'string' ? attempt : '';
    const has = (table) => words(lists(table, locale)).test(q);
    const on = Object.keys(TOPICS).filter((k) => has(TOPICS[k]));
    if (work.trim() || has(WORK) || !on.length) return { task: 'study.help', subject: subjectOf(`${q}\n${work}`) };
    if (on.includes('mark') && !on.includes('todo')) on.push('todo');
    const tools = Object.keys(TOOLS).filter((k) => on.includes(k)).flatMap((k) => TOOLS[k]);
    if (on.some((k) => ACCOUNTS.includes(k))) tools.push('accounts_list');
    return { task: 'agent.tools', tools: [...new Set(tools)].slice(0, LIMIT.tools) };
  };

  // ---- the step loop ---------------------------------------------------------------------------------------------------
  const cancelled = () => Object.assign(R().error('cancelled'), { category: 'cancelled' });
  const episode = async ({ question, tools, locale, now, zone, run, call, signal }) => {
    const steps = [];
    for (;;) {
      if (signal?.aborted) throw cancelled();
      const out = await run('agent.tools', { question, tools, steps: steps.map((s) => ({ call: s.call, result: s.result })), now, zone, locale });
      if (signal?.aborted) throw cancelled();
      if (out?.answer) return { answer: out.answer, steps };
      if (!isObj(out?.call)) throw R().error('check');
      if (steps.length >= AT().LIMIT.steps) throw R().error('steps');
      const { name, arguments: args, kind } = out.call;
      const r = await call({ name, arguments: args, kind });
      if (signal?.aborted) throw cancelled();
      // A change the student didn't allow: nothing more is asked, so nothing can claim it was done.
      if (kind === 'write' && r?.asked !== 'yes') return { declined: r?.asked || 'refused', steps };
      steps.push({ call: { name, arguments: args }, result: r?.result ?? null });
    }
  };

  // ---- the panel's port ------------------------------------------------------------------------------------------------
  // A pair of ports in this worker, as runtime ports behave: messages copied and delivered later, a disconnect heard by the
  // other end only. The broker gets one end, as it gets a page's port.
  const channel = () => {
    const side = () => ({ on: [], gone: [], closed: false });
    const a = side(), b = side();
    const end = (me, other) => ({
      postMessage: (m) => {
        if (me.closed) throw new Error('disconnected');
        const copy = structuredClone(m);
        setTimeout(() => { if (!other.closed) for (const f of other.on) f(copy); }, 0);
      },
      onMessage: { addListener: (f) => { me.on.push(f); } },
      onDisconnect: { addListener: (f) => { me.gone.push(f); } },
      disconnect: () => {
        if (me.closed) return;
        me.closed = true;
        setTimeout(() => { if (other.closed) return; other.closed = true; for (const f of other.gone) f(); }, 0);
      },
    });
    return [end(a, b), end(b, a)];
  };
  const LOCALES = () => SH().LOCALES;
  // A calls.js answer as the model reads it: the tool's own answer (calls.js's note, source and age out), or its failure.
  const resultOf = (r) => {
    if (r?.isError) return { ok: false, error: String(r.content?.[0]?.text || 'The tool failed.') };
    const { note: _n, source: _s, ageSeconds: _a, ...rest } = isObj(r?.structuredContent) ? r.structuredContent : {};
    return rest;
  };

  const connect = (port, env) => {
    let closed = false, current = null, seq = 0;
    const waits = new Map(); // a broker message id → its handler
    const [mine, theirs] = channel();
    const post = (m) => { if (closed) return; try { port.postMessage(m); } catch { close(); } };
    const close = () => {
      if (closed) return;
      closed = true;
      current?.control.abort();
      try { mine.disconnect(); } catch { /* gone */ }
      try { port.disconnect(); } catch { /* gone */ }
    };
    port.onDisconnect.addListener(close);
    mine.onDisconnect.addListener(close);
    mine.onMessage.addListener((m) => waits.get(m?.id)?.(m));
    env.broker(theirs);
    // One message to the broker → the message that ends it (end, error or status); events before it go to each.
    const broker = (m, signal, each) => new Promise((resolve, reject) => {
      const id = ++seq;
      const stop = () => { waits.delete(id); try { mine.postMessage({ id, op: 'cancel' }); } catch { /* gone */ } reject(cancelled()); };
      if (signal?.aborted) return reject(cancelled());
      signal?.addEventListener('abort', stop, { once: true });
      waits.set(id, (a) => {
        if (!['end', 'error', 'status'].includes(a.type)) return each?.(a);
        waits.delete(id); signal?.removeEventListener('abort', stop);
        if (a.type === 'error') reject(R().error(R().CODES.includes(a.error) ? a.error : 'request')); else resolve(a);
      });
      try { mine.postMessage({ id, ...m }); } catch { waits.delete(id); reject(R().error('connection-lost')); }
    });

    // Ask's tool calls, through Agents' one call path, as an app of Glaze's own that Ask's switch has granted every group.
    const live = async () => SET().allowed(SET().clean(await env.settings()), FEATURE) && (await env.enabled()) === true;
    let asked; // the student's answer to the current call's change, from Agents' approval window
    const calls = CALLS().create({
      registry: env.registry, state: env.state, refresh: env.refresh, accounts: env.accounts, local: env.local, keys: env.keys, now: env.now, turn: env.turn,
      settings: async () => ({ on: await live() }), enabled: async () => true, record: () => {},
      grants: { get: async (id) => ({ id, name: APP, grants: Object.fromEntries(GROUPS.map((g) => [g, true])) }), pair: async () => null, grant: async () => null, decline: async () => null, touch: async () => null },
      approve: { ask: async (kind, view, o) => {
        if (kind !== 'action') return 'no';
        post({ id: current?.id, type: 'approve' });
        asked = await env.approve.ask(kind, { ...view, app: { name: APP, exe: null } }, o);
        return asked;
      } },
    });
    const tool = async (c, signal) => {
      if (await env.allowed({ op: 'run', feature: FEATURE }) !== true) throw R().error('permission');
      asked = undefined;
      if (c.kind !== 'write') post({ id: current?.id, type: 'look' });
      const r = await calls.call({ name: c.name, args: c.arguments, peer: { name: APP, exe: '' }, client: { name: APP }, signal,
        progress: () => post({ id: current?.id, type: 'keepalive' }) });
      if (r?.rpcError) throw R().error(r.rpcError.code === CALLS().OFF ? 'off' : 'tool');
      return { result: resultOf(r), ...(c.kind === 'write' && { asked }) };
    };

    const ask = async (m) => {
      const { id } = m;
      const fail = (error) => post({ id, type: 'error', error });
      if (Object.keys(m).some((k) => !['id', 'op', 'question', 'attempt', 'locale'].includes(k)) || typeof m.question !== 'string' || !m.question.trim()
        || (m.attempt !== undefined && typeof m.attempt !== 'string') || (m.locale !== undefined && typeof m.locale !== 'string')) return fail('request');
      const question = m.question.trim(), attempt = (m.attempt || '').trim();
      if (question.length > LIMIT.question || attempt.length > LIMIT.attempt) return fail('size');
      if (current) return fail('busy');
      const locale = LOCALES().includes(m.locale) ? m.locale : 'en';
      const control = new AbortController(), signal = control.signal;
      current = { id, control };
      const keep = (a) => { if (a.type === 'keepalive') post({ id, type: 'keepalive' }); };
      const run = async (task, input) => (await broker({ op: 'run', feature: FEATURE, task, input }, signal, keep)).output;
      try {
        const r = route(question, { attempt, locale });
        post({ id, type: 'route', task: r.task });
        if (r.task === 'study.help') {
          const output = await run('study.help', { question, ...(attempt && { attempt }), subject: r.subject, locale });
          return post({ id, type: 'end', task: r.task, output });
        }
        const zone = env.zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await episode({ question, tools: r.tools, locale, now: env.now(), zone, run, call: (c) => tool(c, signal), signal });
        if (res.declined) return post({ id, type: 'end', task: r.task, declined: true });
        // The study rule on this path too: an answer about records never gives the answer to work.
        const material = res.steps.map((s) => AT().readable(s.result, zone) || '').join('\n').slice(0, LIMIT.material);
        const inp = SH().task.input({ question, subject: 'math', locale, ...(material && { material }) });
        if (!inp || SH().hands(res.answer.text, inp)) throw R().error('check');
        post({ id, type: 'end', task: r.task, answer: { text: res.answer.text } });
      } catch (e) {
        fail(signal.aborted ? 'cancelled' : R().code(e));
      } finally { if (current?.control === control) current = null; }
    };
    const status = async (m) => {
      try { const { id: _, type: __, ...st } = await broker({ op: 'status', feature: FEATURE }); post({ id: m.id, type: 'status', ...st }); }
      catch (e) { post({ id: m.id, type: 'error', error: R().code(e) }); }
    };
    // Each message through the sender check in the order sent; an ask runs on while later messages (a cancel) come in.
    let order = Promise.resolve();
    port.onMessage.addListener((m) => {
      order = order.then(async () => {
        if (closed) return;
        const ok = await Promise.resolve().then(() => env.allowed({ op: isObj(m) && typeof m.op === 'string' ? m.op : '', feature: FEATURE })).catch(() => false);
        if (ok === false || ok === undefined || ok === null) return close();
        if (!isObj(m) || !Number.isSafeInteger(m.id) || m.id < 0) return post({ id: null, type: 'error', error: 'request' });
        if (ok !== true && m.op !== 'cancel') return post({ id: m.id, type: 'error', error: R().CODES.includes(ok) ? ok : 'permission' });
        if (m.op === 'cancel') { if (current?.id === m.id) current.control.abort(); return; }
        if (m.op === 'status') return void status(m);
        if (m.op === 'ask') return void ask(m);
        post({ id: m.id, type: 'error', error: 'request' });
      }).catch(() => {});
    });
    return { close };
  };

  return { FEATURE, LIMIT, TOPICS, WORK, TOOLS, SUBJECTS, route, episode, connect, channel };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ASK; else GZ_AI_ASK;
