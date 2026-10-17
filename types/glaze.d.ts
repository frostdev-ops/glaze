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
  /** Worker only: the canvas of a slot has this size, in device pixels. */
  'canvas.size': { slot: string; w: number; h: number; dpr: number };
  /** Worker only: nothing of the slot's canvases shows (page hidden, motion off, or no canvas on the page); animation frames are on hold. */
  'canvas.pause': { paused: boolean };
}

interface GlazePage {
  site: 'ultra' | 'canvas' | 'moodle' | '';
  kind: 'course' | 'courses' | 'dashboard' | 'grades' | 'calendar' | 'other';
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

interface GlazeNav {
  /**
   * Called with the navigation's items; give back a layout to stand in for the student's own, or nothing to leave it.
   * The first mod in the student's order that gives one wins. `null` stops.
   */
  items(fn: ((items: GlazeNavItem[]) => GlazeNavLayout | null | void | Promise<GlazeNavLayout | null | void>) | null): void;
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

type GlazeEffectKind = 'burst' | 'confetti' | 'rain' | 'ring' | 'sprite';
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

/** The parts of a theme code: shader or layered backgrounds, animations, event effects, a cursor, a nav layout and rules. */
interface GlazeLookParts {
  bg?: { shader?: { src: string }; layers?: Record<string, unknown>[] };
  anim?: Record<string, unknown>;
  fx?: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  nav?: GlazeNavLayout;
  rules?: GlazeRule[];
}

interface GlazeLook {
  /** A layer over the worn Look while the mod runs, never saved. `null` takes it away. */
  override(parts: GlazeLookParts | null): Promise<unknown>;
}
