// The wording rules Glaze's tasks share (docs/ai-harness.md): whether a model's words offer the student wording for their
// paper (an example sentence, a quoted suggestion, "try writing…", "you could open with…"), in Glaze's six locales, and
// whether they speak to the student or about their work. Copied verbatim from ai/tasks/writer-feedback.js at main 27942c14
// (its OFFERS, LOCALES, quotedRanges and ABOUT); feature/local-ai's writer-feedback.js predates them. When the branches
// meet, writer-feedback.js imports these instead of keeping its own copy. Used by ai/tasks/study-help.js.
// Classic script; module.exports for node.
var GZ_AI_WORDING = globalThis.GZ_AI_WORDING || (() => {
  const OFFERS = [
    /\b(?:try|consider)\s+(?:writing|saying|adding|phrasing|wording|opening with|starting with|something like)\b/i,
    /\b(?:you|u)\s+(?:could|might|can|should)\s+(?:write|say|add|phrase|word|open with|start with|begin with|end with|conclude with|replace)\b/i,
    /\b(?:try|use|write|say)\s*["\u201c\u2018']/i, /\b(?:rewrite|revise|rephrase|reword|try|instead|replace (?:it|this|that) with)\s*:/i,
    /\bfor (?:example|instance)\s*[:,]/i, /\bsuch as\s*[:,]?\s*["\u201c\u2018']/i, /:\s*["\u201c\u2018']/,
    /\bhere(?:'|\u2019)?s\s+(?:a|an|one|how)\b|\bhere is\s+(?:a|an|one)\b/i,
    /\b(?:a|an)\s+(?:thesis|sentence|opening|topic sentence|conclusion|transition)\s+(?:like|such as)\b/i,
  ];
  // The same rules in Glaze's other locales, from each language's second person, its words for the draft and its ways of
  // offering wording. \b is ASCII-only, so words sit between Unicode letter boundaries. A form that is an everyday word in
  // another of these languages stays out or needs context, so English comments are judged exactly as before: su, seu and
  // sua (also his and her), te (Dutch "to"), os (Portuguese "the"), ton and copies stay out; shared words (Text, travail),
  // pronouns (u, dir, ti, ta) and determiners (son, die) need a native grammatical context.
  // Dutch je counts only beside its verb (French je is "I"), German du only beside its -st verb (French du is "of the");
  // German nouns, Sie and Ihr only capitalised.
  const B = String.raw`(?<![\p{L}\p{N}])`, E = String.raw`(?![\p{L}\p{N}])`, Q = '["“‘\'«»‹›„‚]';
  // Up to n words between a modal and its verb: Romance adverbs ("pourriez aussi écrire"), Germanic verb-final clauses.
  const gap = (n) => String.raw`(?:\s+[^\s.!?:;]+){0,${n}}?\s+`;
  const wordsOf = (list, flags = 'iu') => new RegExp(`${B}(?:${list.join('|')})${E}`, flags);
  const offer = (source, flags = 'iu') => new RegExp(B + source, flags);
  // Words that are English too (sections, criteria) count only after one of the language's determiners.
  // With adjectives, up to that many lowercase words may stand between (die klare, gewichtete These; de scherpe these).
  const after = (determiners, list, adjectives = 0) => String.raw`(?<=${B}(?:${determiners})(?:\s+\p{Ll}+,?){0,${adjectives}}\s*)(?:${list.join('|')})`;
  // A German noun alone or as the head of a compound (Hauptthese), with any ending (Quellenangaben, Kriterien).
  const noun = (w, compound = true) => `${compound ? String.raw`(?:\p{Lu}\p{Ll}*${w[0].toLowerCase()}|${w[0]})` : w[0]}${w.slice(1)}\\p{Ll}*`;
  const LOCALES = {
    'pt-BR': {
      about: [wordsOf(['vocês?', 'tu', 'teus?', 'tuas?', '(?:a|de|para|por|em|sobre)\\s+ti', 'contigo',
        'rascunhos?', 'trabalhos?', 'textos?', 'trechos?', 'passagens?', 'redaç(?:ão|ões)', 'ensaios?', 'artigos?', 'postagens?', 'respostas?', 'parágrafos?',
        'frases?', 'teses?', 'afirmaç(?:ão|ões)', 'argument(?:os?|ação)', 'evidências?', 'fontes?', 'citaç(?:ão|ões)', 'introdução',
        'conclus(?:ão|ões)', 'seç(?:ão|ões)', 'secç(?:ão|ões)', 'análises?', 'requisitos?', 'exigências?', 'rubricas?', 'critérios?',
        'instruções', 'enunciado', 'palavras?', 'extensão', 'organização', 'estrutura', 'transiç(?:ão|ões)'])],
      offers: [
        offer(String.raw`(?:(?:você|tu)\s+)?(?:poderia|pode|podia|deveria)${gap(2)}(?:escrever|dizer|acrescentar|adicionar|formular|redigir|(?:abrir|começar|iniciar|terminar|encerrar|concluir)${gap(3)}com|substituir|trocar)${E}`),
        offer(String.raw`(?:tente|experimente|considere|procure)\s+(?:escrever|dizer|acrescentar|adicionar|formular|redigir|(?:abrir|começar|iniciar)${gap(3)}com|algo\s+como)${E}`),
        offer(String.raw`(?:use|usar|escreva|diga|tente|experimente)\s*[:,]?\s*${Q}`),
        offer(String.raw`(?:reescreva|reformule|substitua|troque|em\s+vez\s+disso)(?:\s+(?:por|assim|isso|isto))*\s*:`),
        offer(String.raw`por\s+exemplo\s*[:,]`), offer(String.raw`(?:tal\s+como|como\s+por\s+exemplo)\s*[:,]?\s*${Q}`),
        offer(String.raw`(?:aqui\s+(?:está|vai|segue)|eis)\s+(?:uma?|como)${E}|segue\s+uma\s+sugestão`),
        offer(String.raw`uma?\s+(?:tese|frase|abertura|frase\s+de\s+abertura|frase-tópico|conclusão|transição)\s+(?:como|tal\s+como)${E}`),
      ],
    },
    es: {
      about: [wordsOf(['tú', 'tus?', '(?:a|de|para|por|en|sobre|sin|ante)\\s+ti', 'contigo', 'usted(?:es)?', 'vosotr[oa]s', 'vuestr[oa]s?',
        'borrador(?:es)?', 'trabajos?', 'textos?', 'pasajes?', 'fragmentos?', 'redacción', 'ensayos?', 'artículos?', 'publicaci(?:ón|ones)', 'respuestas?', 'párrafos?',
        'frases?', 'oraci(?:ón|ones)', 'tesis', 'afirmaci(?:ón|ones)', 'argument(?:os?|ación)', 'evidencias?', 'fuentes?', 'citas?',
        'citaci(?:ón|ones)', 'introducción', 'conclusi(?:ón|ones)', 'secci(?:ón|ones)', 'análisis', 'requisitos?', 'rúbricas?', 'criterios?',
        'instrucciones', 'consignas?', 'enunciado', 'palabras?', 'extensión', 'longitud', 'organización', 'estructura', 'transici(?:ón|ones)'])],
      offers: [
        offer(String.raw`(?:(?:tú|usted|vos)\s+)?(?:podrías|podría|puedes|puede|podés|deberías|debería)${gap(2)}(?:escribir|decir|añadir|agregar|formular|redactar|(?:abrir|empezar|comenzar|iniciar|terminar|cerrar|concluir)${gap(3)}con|reemplazar|sustituir)${E}`),
        offer(String.raw`(?:intenta|intente|prueba|pruebe|considera|considere)\s+(?:escribir|decir|añadir|agregar|formular|redactar|(?:abrir|empezar|comenzar|iniciar)${gap(3)}con|algo\s+como)${E}`),
        offer(String.raw`(?:usa|use|escribe|escriba|di|diga|prueba|pruebe)\s*[:,]?\s*${Q}`),
        offer(String.raw`(?:reescribe|reescriba|reformula|reformule|sustituye|sustituya|reemplaza|reemplace|en\s+su\s+lugar|en\s+cambio)(?:\s+(?:por|así|lo|la))*\s*:`),
        offer(String.raw`por\s+ejemplo\s*[:,]`), offer(String.raw`(?:tal(?:es)?\s+como|como\s+por\s+ejemplo)\s*[:,]?\s*${Q}`),
        offer(String.raw`(?:aquí|acá)\s+(?:tienes|tiene|va)\s+(?:una?|cómo)${E}|he\s+aquí\s+(?:una?|cómo)${E}`),
        offer(String.raw`una?\s+(?:tesis|frase|oración|apertura|oración\s+temática|conclusión|transición)\s+(?:como|tal\s+como)${E}`),
      ],
    },
    fr: {
      about: [wordsOf(['vous', 'votre', 'vos', 'tu', 'toi', 'tes',
        String.raw`ta\s+\p{L}+(?:\s+\p{L}+){0,2}\s+(?:est|reste|semble|manque|demeure|présente|montre)`,
        'brouillons?', 'travaux', 'textes?', 'extraits?', 'copie', 'devoirs?', 'rédactions?', 'essais?', 'réponses?', 'paragraphes?',
        'thèses?', 'preuves?', 'exigences?', 'consignes?', 'critères?', 'rubriques?', 'longueur',
        after('le|du|au|un|ce|mon|ton|son|notre|leur', ['travail']),
        after('son', ['analyse', 'organisation', 'argumentation']) + String.raw`(?=\s+(?:est|reste|semble|manque|demeure|présente|montre)${E})`,
        after(String.raw`le|la|les|des|du|de|un|une|sa|ses|votre|vos|ta|tes|ce|cet|cette|ces|au|aux|leurs?|deux|trois|quatre|plusieurs|chaque|quelques|[ld]['’]`,
          ['dissertations?', 'phrases?', 'affirmations?', 'arguments?', 'argumentation', 'conclusions?', 'sections?', 'analyses?', 'organisation',
            'transitions?', 'mots?', 'passages?'])])],
      offers: [
        offer(String.raw`(?:(?:vous|tu)\s+(?:pourriez|pouvez|devriez|pourrais|peux|devrais)|(?:pourriez|pouvez|devriez)-vous|(?:pourrais|peux|devrais)-tu)${gap(2)}(?:écrire|dire|ajouter|formuler|rédiger|(?:ouvrir|commencer|débuter|terminer|conclure|finir)${gap(3)}(?:par|avec)|remplacer)${E}`),
        offer(String.raw`(?:essayez|essaie|envisagez|envisage|pensez\s+à|pense\s+à)\s+(?:d['’]\s*(?:écrire|ajouter|ouvrir)|de\s+(?:dire|formuler|rédiger|commencer|débuter|terminer|conclure|finir)|écrire|ajouter|quelque\s+chose\s+comme)${E}`),
        offer(String.raw`(?:utilisez|utilise|écrivez|écris|dites|dis|essayez|essaie)\s*[:,]?\s*${Q}`),
        offer(String.raw`(?:réécrivez|réécris|reformulez|reformule|remplacez|remplace|plutôt)(?:\s+(?:le|la|les|par|ainsi|ceci|cela))*\s*:`),
        offer(String.raw`par\s+exemple\s*[:,]`), offer(String.raw`tel(?:le)?s?\s+que\s*[:,]?\s*${Q}`),
        offer(String.raw`voici\s+(?:une?|comment)${E}`),
        offer(String.raw`une?\s+(?:thèse|phrase|ouverture|accroche|phrase\s+d['’]accroche|conclusion|transition)\s+(?:comme|telle?\s+que|du\s+type)${E}`),
      ],
    },
    de: {
      about: [
        wordsOf([String.raw`du\s+(?!(?:test|post|christ|est)${E})\p{L}+st`, String.raw`(?!est${E})\p{L}+st\s+du`, 'dich',
          '(?:bei|mit|von|zu|nach)\\s+dir', 'dir\\s+(?:fehlt|fehlen|gelingt|gelingen|fällt|fallen|ist|sind|wird|werden)',
          '(?:fehlt|fehlen|gelingt|gelingen|fällt|fallen)\\s+dir', 'dein(?:e[nmrs]?)?', 'euch', 'eu(?:er|re[nmrs]?)']),
        wordsOf(['Sie', 'Ihnen', 'Ihr(?:e[nmrs]?)?',
          ...['Entwurf', 'Entwürf', 'Aufsatz', 'Aufsätz', 'Beitrag', 'Beiträg', 'Abschnitt', 'Absatz', 'Absätz', 'Beleg', 'Quelle', 'Zitat', 'Einleitung',
            'Anforderung', 'Kriteri', 'Rubrik', 'Aufgabenstellung', 'Gliederung', 'Struktur', 'Behauptung', 'Fazit', 'Übergang', 'Übergäng'].map((w) => noun(w)),
          ...['Antwort', 'Satz', 'Sätz', 'Wort(?!h)', 'Wört', 'Schluss', 'Länge', 'Umfang', 'Aufbau'].map((w) => noun(w, false)),
          String.raw`(?:(?:Haus|Seminar|Fach|Abschluss|Bachelor|Master|Studien)a|A)rbeit\p{Ll}*`,
          after(String.raw`[Dd](?:er|ie|as|em|en|es)|[Ee]in(?:e[nmrs]?)?|[Dd]ein(?:e[nmrs]?)?|[Ss]ein(?:e[nmrs]?)?|[Ii]hr(?:e[nmrs]?)?|[Uu]nser(?:e[nmrs]?)?|[Dd]iese[nmrs]?|[Kk]ein(?:e[nmrs]?)?|mit|ohne|als|durch|für|über|zur|zum|im|aus|bei|nach|statt|und|oder|doch|aber|sowie`,
            ['Text', 'These', 'Analyse', 'Argument', 'Essay', 'Passage'].map((w) => noun(w)), 3)], 'u'),
      ],
      offers: [
        offer(String.raw`(?:[Dd]u\s+(?:könntest|kannst|solltest)|(?:[Kk]önntest|[Kk]annst|[Ss]olltest)\s+du|Sie\s+(?:könnten|können|sollten)|(?:[Kk]önnten|[Kk]önnen|[Ss]ollten)\s+Sie)${gap(6)}(?:schreiben|sagen|formulieren|ergänzen|hinzufügen|einfügen|beginnen|anfangen|einsteigen|eröffnen|einleiten|abschließen|schließen|enden|ersetzen)${E}`, 'u'),
        offer(String.raw`(?:[Vv]ersuch|[Pp]robier|[Ee]rwäg|[Üü]berleg)(?:e|en\s+Sie)?,?${gap(6)}(?:zu\s+(?:schreiben|sagen|formulieren|ergänzen|beginnen|eröffnen|schließen|enden|ersetzen)|anzufangen|hinzuzufügen|einzufügen|einzusteigen|einzuleiten|abzuschließen|etwas\s+wie)${E}`, 'u'),
        offer(String.raw`(?:[Ss]chreib|[Vv]erwend|[Nn]utz|[Ss]ag|[Ff]ormulier)(?:e|en\s+Sie)?\s*[:,]?\s*(?:(?:etwa|zum\s+Beispiel|z\.\s?B\.)\s*[:,]?\s*)?${Q}`, 'u'),
        offer(String.raw`(?:[Ss]tattdessen|[Bb]esser|[Ee]twa\s+so|[Ff]ormulierungsvorschlag|[Vv]orschlag|[Uu]mformuliert|[Nn]eu\s+formuliert)\s*:`, 'u'),
        offer(String.raw`(?:[Zz]um\s+Beispiel|[Zz]\.\s?B\.|[Bb]eispielsweise)\s*[:,]`, 'u'), offer(String.raw`(?:wie\s+etwa|wie\s+zum\s+Beispiel|etwa)\s*[:,]?\s*${Q}`, 'u'),
        offer(String.raw`[Hh]ier\s+(?:ist|wäre)\s+(?:ein|eine)\s+(?:Vorschlag|Beispiel|Formulierung|mögliche[rs]?|stärkere[rs]?|bessere[rs]?)${E}`, 'u'),
        offer(String.raw`(?:[Ee]ine?)\s+(?:These|Satz|Einstieg|Einleitungssatz|Themensatz|Schlusssatz|Übergang|Überleitung)\s+(?:wie|etwa\s+wie)${E}`, 'u'),
      ],
    },
    nl: {
      about: [wordsOf(['jij', 'jou', 'jouw', 'jullie',
        'u\\s+(?:bent|hebt|heeft|legt|beschrijft|gebruikt|geeft|noemt|maakt|laat|toont|bespreekt|onderbouwt|verbindt|verklaart|schrijft|kunt|kan|zou|moet|mag)',
        '(?:bent|hebt|heeft|legt|beschrijft|gebruikt|geeft|noemt|maakt|laat|toont|bespreekt|kunt|kan|zou|moet|mag)\\s+u',
        'uw', String.raw`je\s+\p{L}+t`,
        String.raw`(?:kun|kan|heb|zou|wil|moet|mag|ga|ben|noem|gebruik|geef|maak|laat|toon|beschrijf|bespreek|leg)\s+je`,
        'conceptversies?', 'tekst(?:en)?', 'werkstuk(?:ken)?', 'scripties?', 'fragmenten', 'verslag(?:en)?', 'betoog', 'betogen', 'reacties?', 'alinea(?:[\'’]s)?',
        'paragra(?:af|fen)', '(?:kern|slot|openings|hoofd|deel)?zin(?:nen)?', '(?:hoofd|kern|tegen)?stelling(?:en)?', 'standpunt(?:en)?',
        'bewering(?:en)?', '(?:tegen)?argument(?:en|atie)?', 'onderbouwing', 'bewijs(?:materiaal)?', 'bron(?:nen|vermelding(?:en)?)?',
        'citaat', 'citaten', 'verwijzing(?:en)?', 'inleiding', 'conclusies?', 'afsluiting', 'slotalinea', 'secties?',
        'eis(?:en)?', 'vereisten?', 'criterium', 'beoordelingscriteri(?:um|a)', 'opdracht(?:en)?', 'instructies?', 'woord(?:en)?', 'lengte', 'omvang',
        'opbouw', 'structuur', 'overgang(?:en)?',
        after('de|het|een|je|jouw|uw|deze|dit|alle|beide|twee|drie|vier|vijf|zijn|haar|geen|zonder', ['these', 'essays?', 'analyses?', 'criteria', 'passages?', 'fragment'], 3),
        after('die', ['these', 'essays?', 'analyses?', 'criteria', 'passages?', 'fragment']) + String.raw`(?=\s+(?:is|zijn|blijft|blijven|mist|missen|bevat|bevatten)${E})`])],
      offers: [
        offer(String.raw`(?:(?:je|jij|u)\s+(?:zou|kunt|kan|moet)|(?:zou|kun|kan|moet)\s+(?:je|jij|u))${gap(6)}(?:schrijven|zeggen|toevoegen|formuleren|(?:beginnen|openen|starten|eindigen|afsluiten|besluiten)(?:\s+met)?|vervangen)${E}`),
        offer(String.raw`(?:probeer|overweeg)${gap(4)}(?:te\s+(?:schrijven|zeggen|formuleren|beginnen|openen)|toe\s+te\s+voegen|iets\s+(?:als|zoals))${E}`),
        offer(String.raw`(?:gebruik|schrijf|zeg|formuleer|probeer)\s*[:,]?\s*(?:(?:bijvoorbeeld|iets\s+als)\s*[:,]?\s*)?${Q}`),
        offer(String.raw`(?:herschrijf|herformuleer|vervang|in\s+plaats\s+daarvan|bijvoorbeeld\s+zo)(?:\s+(?:het|dit|dat|door|als|zo))*\s*:`),
        offer(String.raw`bijvoorbeeld\s*[:,]`), offer(String.raw`zoals\s*[:,]?\s*${Q}`),
        offer(String.raw`hier\s+is\s+(?:een\s+(?:voorbeeld|voorstel|suggestie|mogelijke|sterkere|betere)|hoe)${E}`),
        offer(String.raw`een\s+(?:stelling|zin|opening|openingszin|kernzin|conclusie|overgang|slotzin)\s+(?:als|zoals)${E}`),
      ],
    },
  };
  // A colon before another locale's opening quote mark, as /:\s*["“‘']/ above.
  const LOCALE_OFFERS = [/:\s*[«»‹›„‚]/, ...Object.values(LOCALES).flatMap((l) => l.offers)].map((r) => new RegExp(r.source, r.flags + 'g'));
  const LOCALE_ABOUT = Object.values(LOCALES).flatMap((l) => l.about);
  // Keep the delimiters' ranges too: a German closing “ or ‘ must not open an English quotation that swallows the next
  // quote. Include short spans so a quoted word such as "sag" is not mistaken for a German imperative.
  const localeQuotes = (s) => [...s.matchAll(/«([^«»]*)»|»([^«»]*)«|‹([^‹›]*)›|›([^‹›]*)‹|„([^„“”]*)[“”]|‚([^‚‘]*)‘/gu)]
    .map((m) => ({ start: m.index + 1, end: m.index + m[0].length - 1, text: m.slice(1).find((x) => x !== undefined) }));
  const quotedRanges = (s, locales = false) => {
    const out = locales ? localeQuotes(s) : [], word = (c) => !!c && /[\p{L}\p{M}\p{N}_]/u.test(c);
    const opens = { single: null, double: null };
    for (const m of s.matchAll(/["“”'‘’]/g)) {
      const c = m[0], at = m.index, single = /['‘’]/.test(c);
      if (locales && out.some((q) => at >= q.start - 1 && at <= q.end)) continue;
      const before = [...s.slice(0, at)].at(-1), after = [...s.slice(at + 1)][0];
      if (single && word(before) && word(after)) continue;
      const group = single ? 'single' : 'double', open = opens[group];
      if (!open) {
        if (c === '”' || c === '’' || (single && (word(before) || /^\d{2}s\b/.test(s.slice(at + 1))))) continue;
        opens[group] = { at: at + 1, close: c === '“' ? '”' : c === '‘' ? '’' : c };
      } else if (c === open.close) {
        const span = s.slice(open.at, at); if (locales || span.length >= 3) out.push({ start: open.at, end: at, text: span });
        opens[group] = null;
      }
    }
    return out;
  };
  // An assessment speaks to the student or about the draft; a bare sentence with neither is wording for the paper.
  const ABOUT = /\b(?:you|your|yours|draft|paper|essay|post|reply|paragraph|sentence|thesis|claim|argument|evidence|sources?|citations?|quotes?|quotation|introduction|conclusion|section|analysis|requirement|rubric|criterion|instructions|prompt|words?|length|organization|structure|transition)\b/i;
  const LOCALE_NAMES = Object.freeze(['en', ...Object.keys(LOCALES)]);
  // "For example," and its locale forms introduce an example; in a comment they are an offer, in an explanation they are not.
  const introduces = (r) => r.source.endsWith(String.raw`\s*[:,]`);
  const offerRules = (examples) => [...OFFERS.filter((r) => examples || !introduces(r)).map((r) => ({ r, quoted: true })),
    ...LOCALE_OFFERS.filter((r) => examples || !introduces(r)).map((r) => ({ r, quoted: false }))];
  const RULES = { true: offerRules(true), false: offerRules(false) };
  // Whether text offers wording: an English rule anywhere, a locale rule outside a quotation (a quoted command word
  // describes supplied wording, as writer-feedback.js judges it). examples: false lets "for example," and its forms stand.
  const offers = (text, { examples = true } = {}) => {
    const c = String(text), quoted = quotedRanges(c, true);
    return RULES[examples === true].some(({ r, quoted: anywhere }) => (anywhere ? new RegExp(r.source, r.flags.replace('g', '')).test(c)
      : [...c.matchAll(r)].some((m) => !quoted.some((q) => m.index >= q.start && m.index < q.end))));
  };
  // Whether text speaks to the student or about their work, in any of the six locales.
  const about = (text) => ABOUT.test(text) || LOCALE_ABOUT.some((r) => r.test(text));
  return { OFFERS, LOCALES, LOCALE_NAMES, LOCALE_OFFERS, LOCALE_ABOUT, ABOUT, quotedRanges, offers, about, introduces };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_WORDING; else GZ_AI_WORDING;
