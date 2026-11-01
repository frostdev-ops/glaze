// Ask Rime (docs/ai-harness.md "Ask Rime"), Glaze's assistant, in the worker: the student asks in a panel over the page (ai/page/ask.js) and
// Glaze either helps with their coursework (study.help, which never hands over the answer) or answers from their own
// records with Agents' tools (agent.tools), one tool call a turn.
//   route(question, { attempt, locale }) → { task: 'study.help', subject } | { task: 'agent.tools', tools }: agent.tools only
//     for a question about the student's own records (TOPICS: to-dos and due dates, grades, assignments, Writer documents)
//     that asks for no help with work (WORK) and comes with no attempt. Words in English and the student's locale.
//   episode({ question, tools, locale, now, zone, run, call, signal }) → { answer, steps } | { declined, steps }: the step
//     loop. run(task, input) → the task's checked output; call({ name, arguments, kind }) → { result, asked? }. A write the
//     student didn't allow (asked isn't 'yes') ends it with no further run; a seventh call ends it as 'steps'.
//   connect(port, env): the panel's port 'glaze:ask' (background/background.js checks its sender with the AI port's rules).
//     page → { id, op: 'ask', question, attempt?, locale, history?, site?, text?, fired? }  { id, op: 'fired' }  { id, op: 'cancel' }
//       { id, op: 'status' }; site: the school's LMS (canvas, ultra, moodle), its address the sender's; text: the page's
//       visible words (page_highlight's check); fired: the id of a fired record 'fired' gave (its own turn at level 3).
//       history: the panel's conversation so far, [{ question, answer }] (at most six), for study.help's follow-ups (a cloud
//       model reads it; ai/tasks/study-help.js); agent.tools' trained turns hold no conversation, so it never gets it.
//     worker → { id, type: 'route', task }, { id, type: 'step', step: { n, name, kind, state, ms? } } as each tool call
//       runs (state run, then done or fail; a write: ask while Glaze's approval window waits, then done or no),
//       'approve' (Glaze's approval window waits), 'keepalive', a step's detail (run_js's value or error, a place's title),
//       { id, type: 'action', action: { kind: 'open' | 'highlight', … } } just before an answer's end (the panel performs them
//       once it shows the answer); 'fired' → { id, type: 'end', fired: [{ id, what, watch?, say, at }] }.
//       then { id, type: 'end', task, output (study.help's) | answer: { text } | declined: true } or { id, type: 'error',
//       error }; status → the broker's status for the feature 'ask'.
//     Model runs go to the AI broker over a channel in the worker (env.broker(port): ai/broker.js connect with this sender's
//     checks), as the feature 'ask'. Tool calls go through agents/calls.js: Ask's own switch is the grant of Agents' groups,
//     the one write waits for the student in Agents' approval window (env.approve), and results reach the model as the tool
//     gave them (calls.js's note, source and age left out, as agent.tools was trained). An agent answer must also pass
//     study.help's answer-giving rules (hands), so no path hands over work.
//   env: { allowed(what), broker(port), settings() (storage.local ai), enabled(), registry, state(), approve: { ask },
//     level() (the tools level of Ask's model: 1, Agents' twelve; 3, Rime's own too), page() ({ url }: the sender's),
//     own: { read(name, args, account), writer(), wakes (ai/agent/wakes.js env) },
//     refresh, accounts(), local, keys, now(), turn(f), zone? }.
// Classic script for the worker; module.exports for node.
var GZ_AI_ASK = globalThis.GZ_AI_ASK || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const SET = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./settings.js'));
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('./tasks/agent-tools.js'));
  const SH = () => (typeof GZ_AI_TASK_STUDY_HELP !== 'undefined' ? GZ_AI_TASK_STUDY_HELP : require('./tasks/study-help.js'));
  const CALLS = () => (typeof GZ_MCP_CALLS !== 'undefined' ? GZ_MCP_CALLS : require('../agents/calls.js'));
  const F = () => (typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js'));
  const TL = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('./tools.js'));
  const JS = () => (typeof GZ_AI_RIME_JS !== 'undefined' ? GZ_AI_RIME_JS : require('./agent/js.js'));
  const PLACES = () => (typeof GZ_AI_RIME_PLACES !== 'undefined' ? GZ_AI_RIME_PLACES : require('./agent/places.js'));
  const WAKES = () => (typeof GZ_AI_RIME_WAKES !== 'undefined' ? GZ_AI_RIME_WAKES : require('./agent/wakes.js'));
  const SCHOOL = () => (typeof GZ_AI_RIME_SCHOOL !== 'undefined' ? GZ_AI_RIME_SCHOOL : require('./agent/school.js'));
  const SITES = ['canvas', 'ultra', 'moodle'];
  // Fired records the panel was shown, by id, until the click that asks about one (or an hour).
  const KEPT = new Map();
  let scopes = 0;
  const prune = (now) => { for (const [k, v] of KEPT) if (v.until <= now) KEPT.delete(k); };
  const FEATURE = 'ask', APP = 'Ask Rime';
  // question: agent.tools' own; attempt: study.help's; tools: offered at once (training offered three to six, and Glaze's own
  // model's 4,096-token window can't hold all twelve); material: what an agent answer is measured against.
  // text: the page's visible words a question may carry, for page_highlight's check.
  const LIMIT = { question: 2000, attempt: 12000, tools: 6, material: 24000, sender: 5000, turns: 6, turn: 2000, text: 20000 };
  const GROUPS = ['courses', 'grades', 'assignments', 'writer'];
  // Navigation handoffs live only in the extension. Page sessionStorage is controlled by school scripts.
  const CARRY = 'rimeCarry';
  let carried = [], carryQueue = Promise.resolve();
  const address = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname + u.search : ''; } catch { return ''; } };
  const handoff = (env, change) => {
    const p = carryQueue.then(async () => {
      const now = env.now(), raw = env.session ? (await env.session.get(CARRY))[CARRY] : carried;
      const before = JSON.stringify(Array.isArray(raw) ? raw : []);
      const list = (Array.isArray(raw) ? raw : []).filter((c) => c.until > now && c.until <= now + 60e3);
      const result = change(list);
      carried = list.slice(-100);
      if (env.session && JSON.stringify(carried) !== before) await env.session.set({ [CARRY]: carried });
      return result;
    });
    carryQueue = p.catch(() => {});
    return p;
  };
  const arrival = (env, take = false) => handoff(env, (list) => {
    if (!Number.isInteger(env.tab)) return [];
    const at = list.findIndex((c) => c.tab === env.tab && c.url === address(env.page?.()?.url));
    if (at < 0) return [];
    const marks = structuredClone(list[at].marks);
    if (take) list.splice(at, 1);
    return marks;
  });
  const carry = (env, actions) => handoff(env, (list) => {
    if (!Number.isInteger(env.tab)) return;
    const here = address(env.page?.()?.url);
    const at = actions.findIndex((a) => a.action === 'open' && a.url && address(a.url) !== here);
    if (at < 0) return;
    const url = address(actions[at].url);
    if (!here || !url || new URL(here).origin !== new URL(url).origin) return;
    const marks = actions.slice(at + 1).filter((a) => a.action === 'highlight').slice(0, 5).map((a) => ({ text: a.text, note: a.note }));
    for (let i = list.length - 1; i >= 0; i--) if (list[i].tab === env.tab) list.splice(i, 1);
    if (marks.length) list.push({ tab: env.tab, url, marks, until: env.now() + 60e3 });
  });
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
  // Rime's own tools (agent-tools.js OWN) for a model trained on them, tools level 3 (env.level(): a local model's models.json
  // `tools`, round 3 on; every other provider): computing, opening a place, reminders and watches. At level 1 (Rime r5) the
  // routing, the tools offered and so every request are as before.
  const TOPICS3 = {
    compute: {
      en: ['convert\\p{L}*', 'conversion', 'average of', 'mean of', 'median', 'standard deviation', 'how many days', 'days (?:until|till|left)', 'what (?:grade|score|average) do i need', 'what do i need on (?:my|the|an?) (?:exam|test|quiz|final|midterm)',
        'percent of', 'sum of', 'total of', 'table of', '(?:my|the) grade (?:if|would)', 'gpa'],
      es: ['convi[eé]rte\\p{L}*', 'convertir', 'promedio de', 'media de', 'cu[aá]ntos d[ií]as', 'qu[eé] nota necesito', 'por ciento de', 'mi promedio', 'mi nota si'],
      'pt-BR': ['convert\\p{L}*', 'm[ée]dia de', 'quantos dias', 'que nota preciso', 'por cento de', 'minha m[ée]dia', 'minha nota se'],
      fr: ['convertis\\p{L}*', 'convertir', 'moyenne de', 'combien de jours', 'quelle note me faut', 'pour cent de', 'ma moyenne', 'ma note si'],
      de: ['umrechn\\p{L}*', 'rechne\\p{L}* .{1,30} um', 'durchschnitt von', 'wie viele tage', 'welche note brauche ich', 'prozent von', 'mein(?:en)? durchschnitt', 'meine note,? wenn'],
      nl: ['omreken\\p{L}*', 'reken .{1,30} om', 'gemiddelde van', 'hoeveel dagen', 'welk cijfer moet ik halen', 'procent van', 'mijn gemiddelde', 'mijn cijfer als'],
    },
    navigate: {
      en: ['take me to', 'go to', 'open (?:my|the)', 'where (?:is|are|can i find)', 'show me where', 'navigate to', 'bring me to'],
      es: ['ll[eé]vame a', 've a', 'abre (?:mi|mis|la|el|los|las)', 'd[oó]nde (?:est[aá]n?|encuentro)'],
      'pt-BR': ['me leve (?:para|at[ée])', 'v[aá] para', 'abr[ae] (?:a|o|as|os|minha|meu|minhas|meus)', 'onde (?:est[aá]o?|fica|encontro)'],
      fr: ['emm[eè]ne-moi', 'va (?:à|a|aux|au|sur)', 'ouvre (?:ma|mon|mes|la|le|les)', 'o[uù] (?:est|sont|trouver)'],
      de: ['bring mich zu', 'geh(?:e)? zu', '[öo]ffne (?:meine?n?|die|den|das)', 'wo (?:ist|sind|finde ich)'],
      nl: ['breng me naar', 'ga naar', 'open (?:mijn|de|het)', 'waar (?:is|zijn|vind ik)'],
    },
    remind: {
      en: ['remind\\p{L}*', 'reminders?', 'wake me', "(?:don'?t|do not) let me forget", 'cancel\\p{L}*'],
      es: ['recu[eé]rd\\p{L}*', 'recordatorios?', 'no me dejes olvidar', 'cancela\\p{L}*'],
      'pt-BR': ['lembr\\p{L}*', 'lembretes?', 'n[ãa]o me deixe esquecer', 'cancel\\p{L}*'],
      fr: ['rappel\\p{L}*', 'ne me laisse pas oublier', 'annul\\p{L}*'],
      de: ['erinner\\p{L}*', 'nicht vergessen', 'storn\\p{L}*', 'l[öo]sch\\p{L}*'],
      nl: ['herinner\\p{L}*', 'niet vergeten', 'annuleer\\p{L}*'],
    },
    watch: {
      en: ['let me know (?:when|if)', 'tell me (?:when|if)', 'watch (?:for|my|the)', 'monitor\\p{L}*', 'keep an eye', 'notify me'],
      es: ['av[ií]same', 'vigila\\p{L}*', 'dime cu[aá]ndo'],
      'pt-BR': ['me avis\\p{L}*', 'avise-me', 'monitor\\p{L}*', 'me diga quando'],
      fr: ['pr[ée]viens-moi', 'dis-moi quand', 'surveill\\p{L}*'],
      de: ['sag mir,? wenn', 'benachrichtig\\p{L}*', '[üu]berwach\\p{L}*', 'beobacht\\p{L}*'],
      nl: ['laat (?:me )?weten', 'houd in de gaten', 'waarschuw\\p{L}*'],
    },
  };
  // The school's other records, read through Glaze's own readers (ai/agent/school.js).
  Object.assign(TOPICS3, {
    announcements: {
      en: ['announcements?', '(?:course|class) news', 'what did (?:my )?(?:professor|teacher|instructor) (?:say|post)'], es: ['anuncios?', 'avisos?'], 'pt-BR': ['an[úu]ncios?', 'avisos?', 'comunicados?'],
      fr: ['annonces?'], de: ['ank[üu]ndigung\\p{L}*', 'mitteilung\\p{L}*', 'neuigkeiten'], nl: ['aankondiging\\p{L}*', 'mededeling\\p{L}*'],
    },
    content: {
      en: ['modules?', 'course (?:content|materials?)', 'lecture notes', 'slides', 'readings', '(?:my|the|assigned) reading', 'week \\d+'], es: ['m[óo]dulos?', 'contenido', 'materiales?', 'apuntes', 'diapositivas'],
      'pt-BR': ['m[óo]dulos?', 'conte[úu]do', 'materiais?', 'apostilas?'], fr: ['modules?', 'contenu', 'supports? de cours', 'diapos'],
      de: ['module?', 'kursinhalt\\p{L}*', 'materialien', 'folien', 'skript'], nl: ['modules?', 'lesmateriaal', 'inhoud', 'slides'],
    },
    syllabus: {
      en: ['syllabus', 'office hours', 'grading (?:policy|scale)', 'grade weights?'], es: ['programa del curso', 's[íi]labo', 'horario de (?:atenci[óo]n|tutor[íi]as)', 'ponderaci[óo]n'],
      'pt-BR': ['plano de ensino', 'ementa', 'hor[áa]rio de atendimento', 'pesos?'], fr: ['syllabus', 'plan de cours', 'permanences?', 'pond[ée]ration'],
      de: ['syllabus', 'kursplan', 'sprechstunden?', 'gewichtung'], nl: ['syllabus', 'studiehandleiding', 'spreekuur', 'weging'],
    },
    discussions: {
      en: ['discussions?', 'forums?', 'discussion board'], es: ['foros?', 'debates?'], 'pt-BR': ['f[óo]runs?', 'discuss[ãa]o', 'discuss[õo]es'], fr: ['forums?', 'discussions?'],
      de: ['diskussion\\p{L}*', 'forum\\p{L}*'], nl: ['discussies?', 'forums?'],
    },
  });
  const TOOLS3 = { compute: ['run_js'], navigate: ['places_list', 'place_open', 'page_highlight'], remind: ['wake_create', 'wakes_list', 'wake_cancel'],
    watch: ['monitor_create', 'wakes_list', 'todo_list', 'grades_list'], announcements: ['announcements_list', 'announcement_read', 'courses_list'],
    content: ['content_list', 'content_read', 'courses_list'], syllabus: ['syllabus_read', 'courses_list'], discussions: ['discussions_list', 'discussion_read', 'courses_list'] };
  // A help question naming a piece of the student's work or a course (a course code, a lab report, an essay…): its reads are
  // the assignments' (route's read).
  const NAMED = { en: ['lab reports?', 'projects?', 'papers?', 'essays?', 'homework', 'worksheets?', 'problem sets?', 'assignments?'], es: ['informes?', 'proyectos?', 'ensayos?', 'tareas?'],
    'pt-BR': ['relat[óo]rios?', 'projetos?', 'trabalhos?', 'reda[çc][ãa]o', 'tarefas?'], fr: ['rapports?', 'projets?', 'dissertations?', 'devoirs?'],
    de: ['berichte?', 'projekte?', 'hausarbeit\\p{L}*', 'aufs[äa]tze?', 'hausaufgaben?'], nl: ['verslag\\p{L}*', 'projecten', 'project', 'opdracht\\p{L}*', 'essays?', 'huiswerk'] };
  const CODE = /(?<![\p{L}\p{N}])[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?(?![\p{L}\p{N}])/u;
  // The topics that read the student's records, which a help question naming one reads first (route's read).
  const READS = ['todo', 'grades', 'assignments', 'documents', 'announcements', 'content', 'syllabus', 'discussions'];
  const PARTICULAR = /\b(?:my|our|the|this|that|mi|mis|nuestro|este|minha?|meus?|esse|este|mon|ma|mes|ce|cet|cette|mein\p{L}*|unser\p{L}*|dies\p{L}*|mijn|ons|onze|deze|dit)\b/iu;
  const SCHOOL_WORDS = /\b(?:course|class|lecture|school|cours|curso|aula|kurs|les|college)\b/iu;
  const DEFINITION = /\b(?:what (?:is|are) (?:an? )|define (?:an? )?)/iu;
  // WORK's computing verbs, which a compute question that isn't graded work may use: "Calculate my grade if…".
  const COMPUTING = ['calculat\\p{L}*', 'calcula\\p{L}*', 'calcul\\p{L}*', 'berechn\\p{L}*', 'bereken\\p{L}*'];
  const route = (question, { attempt = '', locale = 'en', level = 1 } = {}) => {
    const q = String(question).replace(/[‘’]/g, "'"), work = typeof attempt === 'string' ? attempt : '';
    const has = (table) => words(lists(table, locale)).test(q);
    const on = Object.keys(TOPICS).filter((k) => has(TOPICS[k]));
    const school = CODE.test(q) || SCHOOL_WORDS.test(q) || /\b(?:my|our)\b/iu.test(q);
    const own = level >= 3 ? Object.keys(TOPICS3).filter((k) => has(TOPICS3[k])
      && (!READS.includes(k) || school || !DEFINITION.test(q))
      && (k !== 'content' || school || subjectOf(q) !== 'code')) : [];
    // A compute question's own computing verb is no help request, unless it would work out graded work.
    const computing = own.includes('compute') && !AT().gradedWork(AT().fold(q));
    const working = computing ? words(lists(WORK, locale).filter((w) => !COMPUTING.includes(w))).test(q) : has(WORK);
    const subject = () => subjectOf(`${q}\n${work}`);
    // Tool first (level 3): help with work that names the student's records reads them first (read: agent.tools' help turn,
    // its tools these topics' reads), then study.help answers with what was read; help naming nothing is study help alone.
    if (work.trim() || working) {
      const numbered = words(lists(NAMED, locale).map((n) => `(?:${n}) #?\\d+`)).test(q);
      const particular = words(lists(NAMED, locale).map((n) => `${PARTICULAR.source}[ -]+(?:[\\p{L}-]+[ -]+){0,2}(?:${n})`)).test(q);
      const named = level >= 3 && (CODE.test(q) || particular || numbered) && !on.includes('assignments') ? TOOLS.assignments : [];
      const reads = level >= 3 ? [...on.filter((k) => READS.includes(k) && k !== 'mark').flatMap((k) => TOOLS[k]), ...own.filter((k) => READS.includes(k)).flatMap((k) => TOOLS3[k]), ...named] : [];
      return reads.length ? { task: 'study.help', subject: subject(), read: [...new Set(reads)].slice(0, LIMIT.tools - 1).concat('accounts_list') } : { task: 'study.help', subject: subject() };
    }
    if (!on.length && !own.length) return { task: 'study.help', subject: subject() };
    if (on.includes('mark') && !on.includes('todo')) on.push('todo');
    // Rime's own topics first: their tools must fit the window before records' ones fill it.
    const tools = [...Object.keys(TOOLS3).filter((k) => own.includes(k) && (k !== 'compute' || computing)).flatMap((k) => TOOLS3[k]),
      ...Object.keys(TOOLS).filter((k) => on.includes(k)).flatMap((k) => TOOLS[k])];
    if (!tools.length) return { task: 'study.help', subject: subjectOf(`${q}\n${work}`) };
    const accounts = on.some((k) => ACCOUNTS.includes(k)) || own.some((k) => k === 'watch' || READS.includes(k));
    // Multiple topics may fill the window. Keep discovery available so a student with two accounts can still choose one.
    return { task: 'agent.tools', tools: [...new Set(tools)].slice(0, LIMIT.tools - (accounts ? 1 : 0)).concat(accounts ? ['accounts_list'] : []) };
  };
  // A wake or monitor that fired (ai/agent/wakes.js take()), asked again by the student's click: agent.tools with its record
  // and the tools what it watched needs.
  const FIRED_TOOLS = { wake: ['todo_list', 'schedule_list', 'wakes_list', 'wake_create'], grade: ['course_grades', 'grades_list', 'wakes_list'],
    due: ['todo_list', 'assignment_read', 'wakes_list'], submitted: ['todo_list', 'wakes_list'], announcement: ['todo_list', 'wakes_list'] };
  const routeFired = (f) => ({ task: 'agent.tools', tools: [...FIRED_TOOLS[f.what === 'wake' ? 'wake' : f.watch], 'accounts_list'] });

  // ---- the step loop ---------------------------------------------------------------------------------------------------
  const cancelled = () => Object.assign(R().error('cancelled'), { category: 'cancelled' });
  const episode = async ({ question, tools, locale, now, zone, run, call, signal, fired, first, help }) => {
    const steps = [];
    for (;;) {
      if (signal?.aborted) throw cancelled();
      const out = await run('agent.tools', { question, tools, steps: steps.map((s) => ({ call: s.call, result: s.result })), now, zone, locale, ...(fired && { fired }), ...(first && { first: true }), ...(help && { help }) });
      if (signal?.aborted) throw cancelled();
      if (out?.answer) return { answer: out.answer, steps };
      if (!isObj(out?.call)) throw R().error('check');
      if (steps.length >= AT().LIMIT.steps) throw R().error('steps');
      const { name, arguments: args, kind } = out.call;
      const r = await call({ name, arguments: args, kind });
      if (signal?.aborted) throw cancelled();
      // A change the student didn't allow: nothing more is asked, so nothing can claim it was done.
      if ((kind === 'write' || kind === 'confirm') && r?.asked !== 'yes') return { declined: r?.asked || 'refused', steps };
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
    const scope = typeof env.scope === 'string' ? `page:${env.scope}` : `port:${++scopes}`;
    const firedKey = (id) => `${scope}|${id}`;
    // The same bound as the AI broker: a stalled renderer must not park every later message, including Stop.
    const allowed = (what) => {
      let timer;
      return Promise.race([Promise.resolve().then(() => env.allowed(what)).catch(() => false),
        new Promise((resolve) => { timer = setTimeout(resolve, LIMIT.sender, 'timeout'); })]).finally(() => clearTimeout(timer));
    };
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
    const live = async () => SET().allowed(SET().clean(await env.settings()), FEATURE) && (await env.enabled()) === true
      && await allowed({ op: 'run', feature: FEATURE }) === true;
    let asked; // the student's answer to the current call's change, from Agents' approval window
    const calls = CALLS().create({
      registry: env.registry, state: env.state, refresh: env.refresh, accounts: env.accounts, local: env.local, keys: env.keys, now: env.now, turn: env.turn,
      settings: async () => ({ on: await live() }), enabled: async () => true, record: () => {},
      grants: { get: async (id) => ({ id, name: APP, grants: Object.fromEntries(GROUPS.map((g) => [g, true])) }), pair: async () => null, grant: async () => null, decline: async () => null, touch: async () => null },
      approve: { ask: async (kind, view, o) => {
        if (kind !== 'action') return 'no';
        current?.asking?.();
        post({ id: current?.id, type: 'approve' });
        asked = await env.approve.ask(kind, { ...view, app: { name: APP, exe: null } }, o);
        return asked;
      } },
    });
    // Each call as a card in the panel: its name and kind (never its arguments or the records it read: the page's own scripts
    // can read what the panel shows), how it went and how long it took; for run_js its value or error and for a place its
    // title (detail), which the answer shows anyway.
    const card = (mine, c, kind) => {
      const n = mine ? ++mine.n : 0, start = Date.now();
      const step = (state, more) => post({ id: mine?.id, type: 'step', step: { n, name: c.name, kind, state, ...more } });
      return { step, ms: () => Date.now() - start };
    };
    const tool = async (c, signal) => {
      const ok = await allowed({ op: 'run', feature: FEATURE });
      if (ok !== true) throw R().error(R().CODES.includes(ok) ? ok : 'permission');
      if (AT().OWN.includes(c.name)) {
        if ((await env.level?.().catch(() => 1) ?? 1) < 3) throw R().error('changed');
        if (signal?.aborted) throw cancelled();
        return own(c, signal);
      }
      asked = undefined;
      const mine = current, kind = c.kind === 'write' ? 'write' : 'read', { step, ms } = card(mine, c, kind);
      if (kind === 'read') step('run'); else if (mine) mine.asking = () => step('ask');
      const r = await calls.call({ name: c.name, args: c.arguments, peer: { name: APP, exe: '' }, client: { name: APP }, signal,
        progress: () => post({ id: current?.id, type: 'keepalive' }) });
      if (r?.rpcError) { step('fail', { ms: ms() }); throw R().error(r.rpcError.code === CALLS().OFF ? 'off' : 'tool'); }
      if (mine) mine.asking = null;
      const result = resultOf(r);
      if (kind === 'write' && asked !== 'yes') step('no');
      else step(r?.isError || result?.ok === false ? 'fail' : 'done', { ms: ms() });
      return { result, ...(c.kind === 'write' && { asked }) };
    };

    // Rime's own tools (ai/agent/*.js), run here with what they need, never through agents/calls.js: the account (the one
    // the call names, else the one on this school's site Glaze read last), the student's zone and language, the page (its
    // site from the panel, its address from the sender), its courses, Writer's switch, the page's words (for page_highlight)
    // and the UI actions the panel performs after the answer. A confirm tool asks in Glaze's approval window, with the tool's
    // own sentence (summarize), never the model's; anything but Allow ends the question with nothing done.
    const TITLES = { wake_create: 'Set a reminder', monitor_create: 'Watch for a change', wake_cancel: 'Cancel a reminder or watch' };
    const owned = (signal) => {
      // Approval and execution use one reading, even if another tab refreshes the cache while the window waits.
      const reads = new Map(), wakes = env.own.wakes;
      const snapshot = { ...wakes, on: async () => !signal?.aborted && await wakes.on() && !signal?.aborted,
        read: async (name, args, account) => {
          if (signal?.aborted) throw cancelled();
          const key = JSON.stringify([name, args, account]);
          if (!reads.has(key)) reads.set(key, Promise.resolve(wakes.read(name, args, account)).then(structuredClone));
          return structuredClone(await reads.get(key));
        } };
      return new Map([...JS().tools(), ...PLACES().tools(), ...WAKES().tools(snapshot), ...SCHOOL().tools()].map((d) => [d.name, TL().define(d)]));
    };
    const detail = (name, r) => (name === 'run_js' ? (r?.ok ? (typeof r.value === 'string' ? r.value : JSON.stringify(r.value)) : r?.error) : name === 'place_open' ? r?.title
      : name === 'page_highlight' ? r?.marked : undefined);
    const own = async (c, signal) => {
      const mine = current, def = owned(signal).get(c.name), { step, ms } = card(mine, c, def.kind === 'confirm' ? 'write' : 'read');
      const context = await F().wait(() => ownContext(c.arguments, mine, signal), signal);
      if (signal?.aborted) throw cancelled();
      if (def.kind === 'confirm') {
        let summary;
        try { summary = String(await F().wait(() => def.summarize(structuredClone(c.arguments), context), signal)).trim().slice(0, 2000); }
        catch (e) { if (signal?.aborted) throw cancelled(); step('fail', { ms: ms() }); return { result: { ok: false, error: e instanceof Error ? e.message : 'That can\'t be done.' }, asked: 'yes' }; }
        step('ask');
        post({ id: mine?.id, type: 'approve' });
        const answer = await env.approve.ask('action', { app: { name: APP, exe: null }, tool: { name: c.name, title: TITLES[c.name] }, summary },
          { signal, progress: () => post({ id: current?.id, type: 'keepalive' }) });
        if (signal?.aborted) throw cancelled();
        if (answer !== 'yes') { step('no'); return { result: null, asked: answer || 'no' }; }
      } else step('run');
      if (signal?.aborted) throw cancelled();
      if (!(await live()) || signal?.aborted) throw signal?.aborted ? cancelled() : R().error('off');
      let result;
      try { result = await def.run(structuredClone(c.arguments), context); } catch (e) { result = { ok: false, error: e instanceof Error ? e.message : 'The tool failed.' }; }
      const more = detail(c.name, result);
      step(result?.ok === false ? 'fail' : 'done', { ms: ms(), ...(typeof more === 'string' && more && { detail: more.slice(0, 120) }) });
      return { result, ...(def.kind === 'confirm' && { asked: 'yes' }) };
    };
    const ownContext = async (args, mine, signal) => {
      const page = mine?.page || {}, accounts = await env.accounts().catch(() => []);
      const here = (() => { try { return new URL(page.url).origin; } catch { return ''; } })();
      const matches = accounts.filter((a) => a.origin === here);
      const account = typeof args?.account === 'string' ? args.account : matches.length === 1 ? matches[0].account : undefined;
      return { account, zone: mine?.zone, locale: mine?.locale, page, writer: await env.own.writer().catch(() => false), text: mine?.text,
        courses: async () => (account ? (await env.own.read('courses_list', {}, account))?.items || [] : []),
        ui: { actions: mine?.actions || [], push: (a) => mine?.actions.push(a) },
        // The school's reads: its caches (storage.local) and, for the rest, an open tab of this account's site.
        local: env.local, tab: account && env.own.tab ? (op, a) => env.own.tab(account, op, a, { signal }) : undefined };
    };

    // Wakes and monitors that fired, for the panel to show on this page; kept here by id (an hour) for the click that asks.
    const fired = async (m) => {
      if (!(await env.own.wakes.on())) return post({ id: m.id, type: 'end', fired: [] });
      const list = await WAKES().take(env.own.wakes);
      const now = env.now();
      prune(now);
      for (const f of list) KEPT.set(firedKey(f.id), { record: f, until: now + 36e5 });
      while (KEPT.size > 200) KEPT.delete(KEPT.keys().next().value);
      post({ id: m.id, type: 'end', fired: list.map((f) => ({ id: f.id, what: f.what, ...(f.watch && { watch: f.watch }), say: f.say || '', at: f.at })) });
    };

    const ask = async (m) => {
      const { id } = m;
      const fail = (error) => post({ id, type: 'error', error });
      const turn = (h) => isObj(h) && Object.keys(h).sort().join() === 'answer,question' && [h.question, h.answer].every((x) => typeof x === 'string' && x.length <= LIMIT.turn);
      if (Object.keys(m).some((k) => !['id', 'op', 'question', 'attempt', 'locale', 'history', 'site', 'text', 'fired'].includes(k)) || typeof m.question !== 'string' || !m.question.trim()
        || (m.attempt !== undefined && typeof m.attempt !== 'string') || (m.locale !== undefined && typeof m.locale !== 'string')
        || (m.history !== undefined && !(Array.isArray(m.history) && m.history.length <= LIMIT.turns && m.history.every(turn)))
        || (m.site !== undefined && !SITES.includes(m.site)) || (m.text !== undefined && typeof m.text !== 'string') || (m.fired !== undefined && typeof m.fired !== 'string')) return fail('request');
      const history = (m.history || []).filter((h) => h.question.trim() && h.answer.trim());
      const question = m.question.trim(), attempt = (m.attempt || '').trim();
      if (question.length > LIMIT.question || attempt.length > LIMIT.attempt) return fail('size');
      if (current) return fail('busy');
      const locale = LOCALES().includes(m.locale) ? m.locale : 'en';
      const control = new AbortController(), signal = control.signal;
      const zone = env.zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      current = { id, control, n: 0, locale, zone, actions: [], text: (m.text || '').slice(0, LIMIT.text), page: { site: m.site, url: env.page?.()?.url } };
      const keep = (a) => { if (a.type === 'keepalive') post({ id, type: 'keepalive' }); };
      let level = 1;
      const run = async (task, input) => {
        if (level >= 3 && (await env.level?.().catch(() => 1) ?? 1) < 3) throw R().error('changed');
        return (await broker({ op: 'run', feature: FEATURE, task, input }, signal, keep)).output;
      };
      try {
        level = await env.level?.().catch(() => 1) ?? 1;
        if (signal.aborted) throw cancelled();
        // A fired record the student asked about: its own turn for a model trained on it; else the say as any question.
        prune(env.now());
        const kept = m.fired !== undefined ? KEPT.get(firedKey(m.fired))?.record : undefined;
        if (level >= 3 && m.fired !== undefined && (!kept || (kept.say && kept.say !== question))) throw R().error('request');
        const record = kept && level >= 3 ? kept : undefined;
        if (record) KEPT.delete(firedKey(m.fired));
        const r = record ? routeFired(record) : route(question, { attempt, locale, level });
        post({ id, type: 'route', task: r.task });
        if (r.task === 'study.help') {
          // Help naming the student's records (level 3): agent.tools' help turn reads them; study.help then helps with what
          // was read as its material, under its own rules. Its reader's answer is never shown.
          let material = '';
          if (r.read) {
            const seen = await episode({ question, tools: r.read, locale, now: env.now(), zone, run, call: (c) => tool(c, signal), signal, first: true, help: r.subject });
            if (seen.declined) return post({ id, type: 'end', task: r.task, declined: true });
            material = seen.steps.map((st) => AT().readable(st.result, zone) || '').join('\n').slice(0, LIMIT.material);
          }
          const output = await run('study.help', { question, ...(attempt && { attempt }), subject: r.subject, locale, ...(history.length && { history }), ...(material && { material }) });
          return post({ id, type: 'end', task: r.task, output });
        }
        const res = await episode({ question, tools: r.tools, locale, now: env.now(), zone, run, call: (c) => tool(c, signal), signal, ...(level >= 3 && { first: true }),
          ...(record && { fired: { what: record.what, ...(record.watch && { watch: record.watch }), say: question, at: record.at, ...(record.fact && { fact: record.fact }) } }) });
        if (res.declined) return post({ id, type: 'end', task: r.task, declined: true });
        // The study rule on this path too: an answer about records never gives the answer to work.
        const material = res.steps.map((s) => AT().readable(s.result, zone) || '').join('\n').slice(0, LIMIT.material);
        const inp = SH().task.input({ question, subject: 'math', locale, ...(material && { material }) });
        if (!inp || SH().hands(res.answer.text, inp)) throw R().error('check');
        // What the tools asked of the page (open, highlight), for the panel to perform once it shows the answer.
        await carry(env, current.actions).catch(() => {});
        if (signal.aborted) throw cancelled();
        for (const a of current.actions) { const { action, ...rest } = a; post({ id, type: 'action', action: { kind: action, ...rest } }); }
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
        const ok = await allowed({ op: isObj(m) && typeof m.op === 'string' ? m.op : '', feature: FEATURE });
        if (ok === false || ok === undefined || ok === null) return close();
        if (!isObj(m) || !Number.isSafeInteger(m.id) || m.id < 0) return post({ id: null, type: 'error', error: 'request' });
        if (ok !== true && m.op !== 'cancel') return post({ id: m.id, type: 'error', error: R().CODES.includes(ok) ? ok : 'permission' });
        if (m.op === 'cancel') { if (current?.id === m.id) current.control.abort(); return; }
        if (m.op === 'status') return void status(m);
        if (m.op === 'ask') return void ask(m);
        if (m.op === 'fired') return void fired(m).catch((e) => post({ id: m.id, type: 'error', error: R().code(e) }));
        if (m.op === 'carry') return void (async () => post({ id: m.id, type: 'end', marks: await live() ? await arrival(env, true) : [] }))().catch(() => post({ id: m.id, type: 'end', marks: [] }));
        post({ id: m.id, type: 'error', error: 'request' });
      }).catch(() => {});
    });
    return { close };
  };

  return { FEATURE, LIMIT, TOPICS, TOPICS3, WORK, TOOLS, TOOLS3, READS, NAMED, SUBJECTS, route, routeFired, episode, connect, channel, arrival };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ASK; else GZ_AI_ASK;
