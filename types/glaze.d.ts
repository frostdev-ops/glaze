// Types for the `glaze` object that Glaze gives a mod's code (docs/mods-api.md describes everything here).
// In hooks.js or a frame UI's script, for completion in your editor:
//   /// <reference path="path/to/glaze.d.ts" />

declare const glaze: Glaze;

/** A palette token Glaze wears (`accent`, `ink-muted`, ...) or `#rrggbb`. */
type GlazeColor =
  | 'accent' | 'accent-hi' | 'accent-soft' | 'accent-ink' | 'surface' | 'surface-2' | 'ink' | 'ink-muted' | 'ink-faint'
  | 'line' | 'line-strong' | 'ok' | 'warn' | 'err'
  | `#${string}`;

/** The palette's token names, as `glaze.theme().tokens` keys. */
type GlazeToken = Exclude<GlazeColor, `#${string}`>;

/** Where a slot is: `tile:<id>` or `rail:<id>` from `ui.tiles` / `ui.rail` in mod.json, `nav` or `background`. */
type GlazeSlot = `tile:${string}` | `rail:${string}` | 'nav' | 'background';

interface Glaze {
  /** The raw call behind the methods below, by the name Glaze checks it under (`'storage.get'`). Prefer the methods. */
  call(name: string, ...args: unknown[]): Promise<unknown>;
  /** Listen for an event. Handlers run in the order added. In a Worker, an error a handler throws stops the mod on that page: catch what can fail. */
  on<K extends keyof GlazeEvents>(event: K, handler: (data: GlazeEvents[K]) => void): void;
  /** Stop listening with the same function given to `on`. */
  off<K extends keyof GlazeEvents>(event: K, handler: (data: GlazeEvents[K]) => void): void;

  /** This mod's own storage on this device: JSON values, 1 MiB in all, keys of 1 to 256 characters. */
  storage: GlazeStorage;
  /** The colours Glaze wears now, whether they are dark, and the motion level. */
  theme(): Promise<GlazeTheme>;
  /** The courses Glaze has seen on this site. Needs the `courses` permission; Worker only. */
  courses(): Promise<GlazeCourse[]>;
  /** The student's plan on this site. Needs the `todo` permission; Worker only. */
  todo(): Promise<GlazeTodoItem[]>;
  /** Cached due items in [from, to], non-negative safe integer ms since 1970; at most 60 days and 500 items. Needs `todo`; Worker only. */
  schedule(from: number, to: number): Promise<GlazeTodoItem[]>;
  /** Each course's latest grade, or one course's. Needs the `grades` permission; Worker only. */
  grades(courseId?: string): Promise<GlazeGrade[]>;
  /** Fetch an `https://` address on a host declared as `network:<host>` and granted. Cookies are never sent. */
  fetch(url: string, init?: GlazeFetchInit): Promise<GlazeFetchResult>;
  /** The values of the settings mod.json declares, as the student set them (the default where unset). */
  settings(): Promise<Record<string, boolean | number | string>>;
  /** Draw this mod's slots. */
  ui: GlazeUi;
  /** Put a badge, an accent or a note on course cards. Needs the `courses` permission. */
  cards: GlazeCards;
  /** Lay out the navigation. */
  nav: GlazeNav;
  /** Add commands to Ctrl+K. */
  palette: GlazePalette;
  /** Restyle, hide, move or relabel named parts of the school's pages. */
  rules: GlazeRules;
  /** Play a particle effect. */
  effects: GlazeEffects;
  /** Lay Look parts over the student's Look while this mod runs. */
  look: GlazeLook;
  /** Send data to this mod's other Worker and frames on the page (not back to the sender). At most 64 KiB. */
  broadcast(data?: unknown): Promise<unknown>;
  /** The student's documents, on the Documents page only. Needs `documents` (and `documents.read` for their text); Worker only. */
  documents: GlazeDocuments;
}

// ---- storage, theme, data ------------------------------------------------------------------------------------------

interface GlazeStorage {
  /** One value as JSON gave it back (`null` when it isn't set). */
  get(key: string): Promise<any>;
  /** Everything this mod stored, as an object. */
  get(): Promise<Record<string, any>>;
  /** Keep a JSON value (not `undefined`). Rejects with `quota` past 1 MiB. */
  set(key: string, value: unknown): Promise<true>;
  remove(key: string): Promise<true>;
}

interface GlazeTheme {
  /** Colours by token name, as `#rrggbb`. */
  tokens: Record<GlazeToken, string>;
  dark: boolean;
  motion: 'off' | 'subtle' | 'expressive';
}

interface GlazeCourse {
  id: string;
  name: string;
  code: string;
  /** `#rrggbb`, or null. */
  color: string | null;
}

interface GlazeTodoItem {
  id: string;
  type: string;
  courseId: string;
  course: string;
  title: string;
  /** When it is due, in ms since 1970, or null. */
  due: number | null;
  /** A full address on this site (`https://school.example/courses/1/assignments/2`), or ''. */
  url: string;
  done: boolean;
  submitted: boolean;
  graded: boolean;
  late: boolean;
  missing: boolean;
}

interface GlazeGrade {
  courseId: string;
  name: string;
  percent: number | null;
  /** When that grade was read, in ms since 1970. */
  at: number | null;
}

interface GlazeFetchInit {
  method?: 'GET' | 'POST';
  /** Only `accept`, `accept-language`, `content-language`, `content-type` and `authorization`. */
  headers?: Record<string, string>;
  /** A string, with `POST` only. */
  body?: string;
}

interface GlazeFetchResult {
  status: number;
  ok: boolean;
  /** `content-type`, `content-length`, `etag`, `last-modified`, `date` and `cache-control`, where the answer has them. */
  headers: Record<string, string>;
  /** The body as text, at most 2 MiB. */
  text: string;
}

// ---- events ------------------------------------------------------------------------------------------------------------

/** Event names and what each hands its handler. */
interface GlazeEvents {
  /** Glaze is about to stop this mod on the page (the page is going, mods are paused, Glaze is off). */
  stop: undefined;
  /** Where the student is; sent at start and when the address changes. */
  page: GlazePage;
  /** Whether the page is shown (not in a hidden tab). */
  visible: boolean;
  /** Glaze's colours or motion level changed: ask `glaze.theme()` again. */
  theme: undefined;
  /** The student changed this mod's settings: ask `glaze.settings()` again. */
  settings: Record<string, never>;
  /** Glaze saw new courses. `courses` permission. Ask `glaze.courses()`. */
  courses: Record<string, never>;
  /** The student's plan changed. `todo` permission. Ask `glaze.todo()`. */
  todo: Record<string, never>;
  /** A grade came in. `grades` permission. Ask `glaze.grades()`. */
  grade: Record<string, never>;
  /** Work was ticked off. `todo` permission. */
  complete: Record<string, never>;
  /** Work was handed in. `todo` permission. */
  submit: Record<string, never>;
  /** A moment this mod replaces (`effect:<moment>` in `replaces`, turned on by the student) happened. x and y are fractions of the window. */
  effect: { moment: string; x?: number; y?: number };
  /** A button was pressed or an input changed in a tree drawn with `ui.render`. */
  ui: { slot: string; id: string; kind: 'click' | 'change'; value?: string | number | boolean | null };
  /** Another of this mod's Workers or frames on the page called `glaze.broadcast`. */
  broadcast: unknown;
  /** The cards on the page changed (`courses` permission). `cards.decorate` answers this for you. */
  cards: { courses: GlazeCourseRef[] };
  /** The navigation's items changed. `nav.items` answers this for you. */
  'nav.items': { items: GlazeNavItem[] };
  /** Glaze's bar changed (`nav.read`). Ask `glaze.nav.model()`. */
  'nav.change': Record<string, never>;
  /** The student used an item of the bar (`nav.read`). */
  'nav.navigate': { id: string };
  /** The rail opened (`nav.read`). */
  'nav.expand': Record<string, never>;
  /** The rail closed (`nav.read`). */
  'nav.collapse': Record<string, never>;
  /** A phone's More sheet opened or closed (`nav.read`). */
  'nav.sheet': { open: boolean };
  /** The student clicked one of this mod's own items added with `action: true` (`nav.items`). `id` is the mod's id for it. */
  'nav.action': { id: string };
  /** On the Documents page: the student clicked one of this mod's own items; `doc` for an item in a card's menu (`documents`). */
  'documents.action': { slot: GlazeDocumentSlot; id: string; doc?: GlazeDocument };
  /** On the Documents page: the documents changed (`documents`). Ask `glaze.documents.list()`. */
  'documents.change': Record<string, never>;
  /** Worker only: the canvas of a slot has this size, in device pixels. */
  'canvas.size': { slot: string; w: number; h: number; dpr: number };
  /** Worker only: nothing of the slot's canvases shows (page hidden, motion off, or no canvas on the page); animation frames are on hold. */
  'canvas.pause': { paused: boolean };
}

interface GlazePage {
  site: 'ultra' | 'canvas' | 'moodle' | 'documents' | '';
  kind: 'course' | 'courses' | 'dashboard' | 'grades' | 'calendar' | 'documents' | 'other';
  courseId: string | null;
}

// ---- UI: component trees ---------------------------------------------------------------------------------------------

interface GlazeUi {
  /** Draw a component tree in a slot of the manifest that has no `file`, or `null` to clear it. */
  render(slot: GlazeSlot, tree: GlazeNode | null): Promise<{ slot: string; tree: GlazeNode | null }>;
  /** The slot's `canvas` component as an OffscreenCanvas (Workers only), sized to the slot in device pixels. */
  canvas(slot: GlazeSlot): Promise<OffscreenCanvas>;
  /** Send the canvas to the page now, without waiting for the next animation frame. */
  commit(slot: GlazeSlot): void;
}

type GlazeSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/** At most 8 levels, 200 nodes, 50 children a node, and one `canvas`. Ids are unique in a tree: `a-z`, `0-9`, `-`, up to 32. */
type GlazeNode =
  | GlazeStack | GlazeRow | GlazeList | GlazeText | GlazeNumber | GlazeRing | GlazeProgress | GlazeCountdown
  | GlazeImage | GlazeButton | GlazeInput | GlazeCanvas;

interface GlazeStack {
  type: 'stack';
  children: GlazeNode[];
  /** Read out as a group by screen readers. */
  label?: string;
  /** Space between children, 0 to 6. */
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
}

interface GlazeRow {
  type: 'row';
  children: GlazeNode[];
  label?: string;
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  wrap?: boolean;
}

interface GlazeList {
  type: 'list';
  children: GlazeNode[];
  label?: string;
  ordered?: boolean;
}

interface GlazeText {
  type: 'text';
  /** Up to 500 characters; line breaks stay. */
  text: string;
  size?: GlazeSize;
  weight?: 'normal' | 'bold';
  color?: GlazeColor;
  muted?: boolean;
}

interface GlazeNumber {
  type: 'number';
  value: number;
  label?: string;
  /** Up to 12 characters. */
  unit?: string;
  /** Decimal places, 0 to 4. */
  digits?: number;
  size?: GlazeSize;
  color?: GlazeColor;
}

interface GlazeRing {
  type: 'ring';
  value: number;
  /** The full value; 100 when left out. */
  max?: number;
  label?: string;
  color?: GlazeColor;
}

interface GlazeProgress {
  type: 'progress';
  value: number;
  max?: number;
  label?: string;
  color?: GlazeColor;
}

interface GlazeCountdown {
  type: 'countdown';
  /** When it ends, in ms since 1970. */
  to: number;
  label?: string;
  /** What it says once it has ended. */
  done?: string;
}

interface GlazeImage {
  type: 'image';
  /** One of the mod's own files: png, jpg, gif, webp or avif, at most 4096 pixels a side. */
  src: string;
  /** What it shows, for screen readers; '' marks a decoration. */
  alt: string;
  w?: number;
  h?: number;
  fit?: 'contain' | 'cover';
}

interface GlazeButton {
  type: 'button';
  id: string;
  label: string;
  tone?: 'primary' | 'plain';
  disabled?: boolean;
}

type GlazeInput = GlazeTextInput | GlazeNumberInput | GlazeToggleInput | GlazeSelectInput;

interface GlazeTextInput {
  type: 'input';
  kind: 'text';
  id: string;
  label: string;
  value?: string;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
}

interface GlazeNumberInput {
  type: 'input';
  kind: 'number';
  id: string;
  label: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

interface GlazeToggleInput {
  type: 'input';
  kind: 'toggle';
  id: string;
  label: string;
  value?: boolean;
  disabled?: boolean;
}

interface GlazeSelectInput {
  type: 'input';
  kind: 'select';
  id: string;
  label: string;
  /** 1 to 32 different choices. */
  options: string[];
  value?: string;
  disabled?: boolean;
}

interface GlazeCanvas {
  type: 'canvas';
  /** Height in CSS pixels, 24 to 800; the width is the slot's. */
  h?: number;
  label?: string;
}

// ---- transforms and Look parts ---------------------------------------------------------------------------------------------

interface GlazeCourseRef {
  id: string;
  name: string;
}

/** At least one of the three. */
interface GlazeDecoration {
  /** Up to 12 characters. */
  badge?: string;
  accent?: GlazeColor;
  /** Up to 120 characters. */
  note?: string;
}

type GlazeDecorations = Record<string, GlazeDecoration>;

interface GlazeCards {
  /**
   * Called with the courses whose cards are on the page; give back decorations by course id (`{}` takes them all away).
   * Applied on the next pass: a slow function is late, it never holds the page up. `null` stops decorating.
   */
  decorate(fn: ((courses: GlazeCourseRef[]) => GlazeDecorations | void | Promise<GlazeDecorations | void>) | null): void;
}

interface GlazeNavItem {
  id: string;
  label: string;
}

/** A Look's nav layout. Ids are the navigation's own (`course`, `calendar`, ...), `link:<id>` or `w:<widget>`. */
interface GlazeNavLayout {
  place?: 'left' | 'top' | 'bottom' | 'dock';
  /** Up to 6 groups; items not in any group follow in the page's order. */
  groups?: { label?: string; items: string[] }[];
  hidden?: string[];
  /** Up to 8 links of your own: `id` is 12 characters of `a-z0-9`. */
  links?: { id: string; n: string; u: string; i?: string }[];
  icons?: Record<string, string>;
}

/** One item of Glaze's bar, as `glaze.nav.model()` gives it. */
interface GlazeBarItem {
  id: string;
  label: string;
  icon: string;
  /** Up to 4 characters, `''` for none. */
  badge: string;
  active: boolean;
  /** The label of its group, `''` for none. */
  group: string;
}

/** Glaze's bar (`nav.read`): no addresses; at most 64 items. */
interface GlazeBarModel {
  place: 'rail' | 'top' | 'none';
  items: GlazeBarItem[];
  groups: { label: string; items: string[] }[];
  /** The open course's own menu. */
  course: { name: string; items: GlazeBarItem[] } | null;
  /** The id of the item for where the student is, or `''`. */
  active: string;
}

/** An item a mod adds to Glaze's bar (`nav.items`). Exactly one of `href` (a page of this school's site) and `action`. */
interface GlazeBarAdd {
  /** `a-z`, `0-9`, `-`, up to 32, starting with a letter: the mod's own name for it. */
  id: string;
  /** One line, up to 40. */
  label: string;
  /** One of the bar's icons; any other name draws the link icon. */
  icon?: string;
  href?: string;
  /** `true`: a click sends this mod a `nav.action` event. */
  action?: true;
  /** A number, or up to 4 characters. */
  badge?: number | string;
  /** A group of the bar, by its label or its place (0 to 7); or `slot`. */
  group?: string | number;
  slot?: 'top' | 'bottom';
}

interface GlazeNav {
  /**
   * Called with the navigation's items; give back a layout to stand in for the student's own, or nothing to leave it.
   * The first mod in the student's order that gives one wins. `null` stops.
   */
  items(fn: ((items: GlazeNavItem[]) => GlazeNavLayout | null | void | Promise<GlazeNavLayout | null | void>) | null): void;
  /** Glaze's bar now, or `null` where it isn't drawn. Worker. `nav.read` permission. */
  model(): Promise<GlazeBarModel | null>;
  /** Adds (or replaces) one of this mod's own items; at most 8. `nav.items` permission. */
  add(item: GlazeBarAdd): Promise<GlazeBarAdd>;
  /** Changes one of this mod's own items. `nav.items` permission. */
  update(id: string, patch: Partial<Omit<GlazeBarAdd, 'id'>>): Promise<{ id: string; patch: Partial<GlazeBarAdd> }>;
  /** Removes one of this mod's own items. `nav.items` permission. */
  remove(id: string): Promise<{ id: string }>;
  /** Proposes a layout over the student's while the mod runs, never saved; `null` withdraws it. `nav.layout` permission. */
  layout(patch: GlazeNavLayout | null): Promise<GlazeNavLayout | null>;
  /**
   * Opens a bar item as a click on it would. Only for the mod whose nav replacement the student turned on, drawn from a
   * tree, within a second of a click in its `nav` slot.
   */
  go(id: string): Promise<{ id: string }>;
}

interface GlazeCommand {
  /** `a-z`, `0-9`, `-`, up to 32, starting with a letter; each once. */
  id: string;
  /** Up to 60 characters. */
  title: string;
  /** Up to 40 characters; the mod's name when left out. */
  hint?: string;
  /** Called here, in the mod, when the student picks the command. */
  run: () => void;
}

interface GlazePalette {
  /** At most 16 commands; replaces the list from before. */
  commands(list: GlazeCommand[]): Promise<unknown>;
}

/** One restyle rule on a named part (`ultra.course-card.title`, ...). */
interface GlazeRule {
  p: string;
  do: 'hide' | 'show' | 'move' | 'style' | 'label';
  /** `move`: the part to move beside, and which side. */
  to?: string;
  at?: 'before' | 'after';
  /** `style`: colours as tokens or `#rrggbb`, `bw` 0-4, `r` 0-32, `p` and `g` 0-6, `sh` 0-3, `o` 0-100, `f` a font id. */
  st?: { bg?: GlazeColor; fg?: GlazeColor; bc?: GlazeColor; bw?: number; r?: number; p?: number; g?: number; sh?: number; o?: number; f?: string };
  /** `label`: the new text, up to 60 characters. */
  t?: string;
}

interface GlazeRules {
  /** Up to 64 rules including the worn Look's; `[]` takes this mod's away. */
  set(rules: GlazeRule[]): Promise<unknown>;
}

type GlazeEffectKind = 'burst' | 'confetti' | 'rain' | 'ring' | 'sprite' | 'contour';
type GlazeShape = 'dot' | 'star' | 'snow' | 'heart' | 'leaf' | 'spark';

interface GlazeEffectOptions {
  /** 1 to 60. */
  count?: number;
  /** Up to 4. */
  shapes?: GlazeShape[];
  /** Up to 6 colours. */
  c?: GlazeColor[];
  /** Degrees, 0 to 360. */
  spread?: number;
  /** -2 to 2. */
  gravity?: number;
  /** Milliseconds, 200 to 2500. */
  life?: number;
  /** 2 to 48. */
  size?: number;
  /** Where, as fractions of the window, 0 to 1. */
  x?: number;
  y?: number;
}

interface GlazeEffects {
  /** At most one every 200 ms per mod, and none with motion off or the page hidden. */
  play(kind: GlazeEffectKind, options?: GlazeEffectOptions): Promise<unknown>;
}

/** The parts of a theme code: shader, layered or media backgrounds, animations, event effects, a cursor, a nav layout and rules. */
interface GlazeLookParts {
  bg?: {
    shader?: { src: string };
    layers?: Record<string, unknown>[];
    /** src: an https address, or in mod.json `./<path>` for a file in the bundle (.webm, .mp4, .webp, .avif, .json). In overrides, src and type must match the media declared in mod.json. */
    media?: { type: 'video' | 'image' | 'lottie'; src: string; fit?: 'cover' | 'contain' | 'fill'; dim?: number; loop?: boolean };
  };
  anim?: Record<string, unknown>;
  fx?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  nav?: GlazeNavLayout;
  rules?: GlazeRule[];
}

interface GlazeLook {
  /** A layer over the worn Look while the mod runs, never saved. `null` takes it away. Media src/type must match mod.json. */
  override(parts: GlazeLookParts | null): Promise<unknown>;
}

// ---- the Documents page ----------------------------------------------------------------------------------------------

type GlazeDocumentSlot = 'documents.toolbar' | 'documents.card';

/** A document's public summary (`documents`): never its text. */
interface GlazeDocument {
  /** Opaque handle for this mod on this page; expires on page load or mod restart. Never an internal storage key. */
  key: string;
  /** Its kind of document: `paper`. */
  kind: string;
  /** As the page shows it. */
  title: string;
  /** `plain`, `mla9`, `apa7` or `chicago17`. */
  format: string;
  words: number;
  /** Last edited, ms since 1970. */
  updated: number;
  /** The course's name, `''` for none. */
  course: string;
}

/** An item of this mod's own on the Documents page: a button in the toolbar or an entry in each card's ⋯ menu. */
interface GlazeDocumentItem {
  /** `a-z`, `0-9`, `-`, up to 32, starting with a letter. */
  id: string;
  /** One line, up to 40. */
  label: string;
}

/** The page's --gd-* hooks, each in its range. */
interface GlazeDocumentStyle {
  /** Corner radius of the band, toolbar and cards, 0 to 32 px. */
  radius?: number;
  /** Blur of the glass, 0 to 40 px. */
  glass?: number;
  /** The thumbnails' scale, 0.6 to 1.6. */
  thumb?: number;
  /** The grid's narrowest column, 160 to 400 px. */
  column?: number;
}

interface GlazeDocuments {
  /** Every document listed on the page, newest first: public fields only. `documents`. */
  list(): Promise<GlazeDocument[]>;
  /** Opens a listed document in this tab, within a second of a click on one of this mod's items. `documents`. */
  open(key: string): Promise<{ key: string }>;
  /** Starts a new document in a format (Blank by default), within a second of a click on one of this mod's items. `documents`. */
  create(options?: { format?: 'plain' | 'mla9' | 'apa7' | 'chicago17' }): Promise<{ format: string }>;
  /** A listed document's text, a line a paragraph. `documents.read`. */
  read(key: string): Promise<{ key: string; title: string; text: string }>;
  /** A listed document as the file its kind saves (a .docx). `documents.read`. */
  export(key: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
  /** Adds (or replaces) one of this mod's items in a slot; at most 4 a slot. `documents`. */
  add(slot: GlazeDocumentSlot, item: GlazeDocumentItem): Promise<{ slot: GlazeDocumentSlot; id: string; label: string }>;
  /** Removes one of this mod's items. `documents`. */
  remove(slot: GlazeDocumentSlot, id: string): Promise<{ slot: GlazeDocumentSlot; id: string }>;
  /** Sets the page's --gd-* hooks while the mod runs; `null` withdraws them. The first mod in the student's order to set one wins it. `documents`. */
  style(vars: GlazeDocumentStyle | null): Promise<GlazeDocumentStyle | null>;
}

// ---- mod.json tools --------------------------------------------------------------------------------------------------
// Not on the `glaze` object: the shape of mod.json's `tools`, for agent apps the student connects (docs/mods-api.md).

/** A tool in mod.json `tools`: answered by Glaze from what it keeps, or (`code: true`) by the mod's Worker. Needs `agents`. */
type GlazeTool = GlazeTodoTool | GlazeCourseTool | GlazeGradeTool | GlazeCodeTool;

/** The fields of `glaze.todo()`'s items, for `from: 'todo'` and `'schedule'`. */
type GlazeTodoField = 'id' | 'type' | 'courseId' | 'course' | 'title' | 'due' | 'url' | 'done' | 'submitted' | 'graded' | 'late' | 'missing';
/** The fields of `glaze.courses()`'s items. */
type GlazeCourseField = 'id' | 'name' | 'code' | 'color';
/** The fields of `glaze.grades()`'s items. */
type GlazeGradeField = 'courseId' | 'name' | 'percent' | 'at';

/** `eq`: the field is that value exactly (`null` for no date, grade or colour). `days`, on `due` or `at`: within that many days from now, -366 to 366, not 0; negative looks back. */
type GlazeToolWhere<F extends string> = { field: F; eq: string | number | boolean | null } | { field: F; days: number };

interface GlazeToolBase {
  /** `[a-z][a-z0-9_]`, at most 24 characters, unique in the mod. */
  name: string;
  /** One line, at most 60 characters. Apps show "<mod name> (mod): <title>". */
  title: string;
  /** One line, at most 500 characters, for the app's model. Apps get it after "Written by the mod's author, not Glaze." */
  description: string;
}

/** What the app may pass: `course`, one course's items by its id; `days`, 1 to 60 days ahead (for grades, back). */
interface GlazeToolInput {
  course?: true;
  days?: true;
}

/** A tool Glaze answers from the cached plan: every to-do, or (`schedule`) those with a due date. Needs `todo`. */
interface GlazeTodoTool extends GlazeToolBase {
  from: 'todo' | 'schedule';
  /** The fields each answer has, in this order; all of them when left out. */
  select?: GlazeTodoField[];
  /** At most 8; an item passes all of them. */
  where?: GlazeToolWhere<GlazeTodoField>[];
  /** Empty values last; ties keep the plan's order. */
  sort?: { field: GlazeTodoField; order: 'asc' | 'desc' };
  /** 1 to 200; 200 when left out. */
  limit?: number;
  input?: GlazeToolInput;
}

/** A tool Glaze answers from the courses it has seen. Needs `courses`. */
interface GlazeCourseTool extends GlazeToolBase {
  from: 'courses';
  select?: GlazeCourseField[];
  where?: GlazeToolWhere<GlazeCourseField>[];
  sort?: { field: GlazeCourseField; order: 'asc' | 'desc' };
  limit?: number;
  /** `course` only: courses have no date. */
  input?: { course?: true };
}

/** A tool Glaze answers from each course's latest grade. Needs `grades`. */
interface GlazeGradeTool extends GlazeToolBase {
  from: 'grades';
  select?: GlazeGradeField[];
  where?: GlazeToolWhere<GlazeGradeField>[];
  sort?: { field: GlazeGradeField; order: 'asc' | 'desc' };
  limit?: number;
  input?: GlazeToolInput;
}

/** A tool the mod's Worker (`hooks`) answers, in Chrome, while a school page is open. */
interface GlazeCodeTool extends GlazeToolBase {
  code: true;
  /** The arguments' JSON Schema: an object at the root, in the subset lib/ai/schema.js checks, with no `reason` property. None when left out. */
  input?: { type: 'object'; [keyword: string]: unknown };
}
