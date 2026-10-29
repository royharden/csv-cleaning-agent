/**
 * Closed-vocabulary constants (PLAN.md §3 and C §2.6, with PLAN.md §2 overrides: rows 3, 4, 7, 13, 26).
 * Every list here is mirrored verbatim in docs/VOCABULARY.md (M7) so scorer ceilings are reproducible.
 * Pure data: no imports, no side effects. Safe in the browser, Node and Deno.
 */

/** Bump when any grammar/vocabulary constant below changes; recorded in the journal genesis event. */
export const VOCABULARY_VERSION = 1;

/** Tag that opens canonical table serialisation v1 (C §2.4; see src/core/journal/canonical.ts). */
export const CANONICAL_VERSION = 'T1';

// ---------------------------------------------------------------------------------------------------
// Input caps (spec item 1). Checked before decode (bytes) and during parse (records, columns).
// ---------------------------------------------------------------------------------------------------

export const MAX_INPUT_BYTES = 5_000_000;
/** Data records, excluding the header record. */
export const MAX_RECORDS = 20_000;
/** Columns; an over-wide malformed record also counts against this cap. */
export const MAX_COLUMNS = 60;
/** Ragged records: the validation report lists the count plus the first N locations. */
export const RAGGED_LOCATIONS_REPORTED = 5;

// ---------------------------------------------------------------------------------------------------
// Delimiters, record terminators, encodings (PLAN.md row 12, row 13).
// ---------------------------------------------------------------------------------------------------

/** Detection candidates, in tie-break order. */
export const DELIMITERS = Object.freeze([',', ';', '\t', '|'] as const);
export type Delimiter = (typeof DELIMITERS)[number];
/** Used when no candidate delimiter appears in the sample (single-column file). */
export const DEFAULT_DELIMITER: Delimiter = ',';
/** Bounded detection sample: at most this many characters ... */
export const DELIMITER_SAMPLE_CHARS = 65_536;
/** ... and at most this many records. */
export const DELIMITER_SAMPLE_RECORDS = 50;

/** Record terminators, in majority tie-break order. */
export const TERMINATORS = Object.freeze(['\r\n', '\n', '\r'] as const);
export type Terminator = (typeof TERMINATORS)[number];
/** Used when the file has a single record and no terminator at all. */
export const DEFAULT_TERMINATOR: Terminator = '\n';

export const ENCODINGS = Object.freeze(['utf-8', 'windows-1252'] as const);
export type Encoding = (typeof ENCODINGS)[number];
export const UTF8_BOM_BYTES = Object.freeze([0xef, 0xbb, 0xbf] as const);

// ---------------------------------------------------------------------------------------------------
// Operations and guards (C §2.7, spec items 3 and 4).
// ---------------------------------------------------------------------------------------------------

export const OP_NAMES = Object.freeze([
  'rename_headers',
  'trim_whitespace',
  'null_tokens',
  'normalize_case',
  'parse_number',
  'standardize_date',
  'map_categories',
  'drop_duplicate_rows',
] as const);
export type OpName = (typeof OP_NAMES)[number];

export const GUARD_IDS = Object.freeze([
  'leading_zero_id',
  'thousands_ambiguity',
  'date_order',
  'two_digit_year',
  'null_shape_majority',
  'title_on_mixed',
  'category_target',
  'dedup_before_trim',
] as const);
export type GuardId = (typeof GUARD_IDS)[number];

// ---------------------------------------------------------------------------------------------------
// null_tokens (PLAN.md row 4: C's 14 tokens + "(blank)"). Exact, case-sensitive; no implicit trim.
// ---------------------------------------------------------------------------------------------------

export const NULL_TOKENS = Object.freeze([
  'NA',
  'N/A',
  'n/a',
  'NULL',
  'null',
  'None',
  'none',
  'nan',
  'NaN',
  '#N/A',
  '-',
  '--',
  '?',
  'missing',
  '(blank)',
] as const);
export type NullToken = (typeof NULL_TOKENS)[number];
/** null_shape_majority guard: a selected token's shape class equals that of >= this share of non-empty cells. */
export const NULL_SHAPE_MAJORITY_SHARE = 0.5;

// ---------------------------------------------------------------------------------------------------
// standardize_date (PLAN.md row 3: 12 purely numeric formats; month names are out of scope).
// Day/month tokens accept 1-2 digits. Output is always YYYY-MM-DD. Gregorian validation incl. leap years.
// ---------------------------------------------------------------------------------------------------

export const DATE_FORMATS = Object.freeze([
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYY.MM.DD',
  'YYYYMMDD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD.MM.YYYY',
  'MM.DD.YYYY',
  'DD/MM/YY',
  'MM/DD/YY',
] as const);
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DATE_OUTPUT_FORMAT = 'YYYY-MM-DD';

/** Formats with a two-digit year token: trigger the two_digit_year guard. YYYY-first formats never do. */
export const TWO_DIGIT_YEAR_FORMATS: readonly DateFormat[] = Object.freeze(['DD/MM/YY', 'MM/DD/YY'] as const);

/**
 * Formats subject to the date_order guard: the DD/MM and MM/DD families only (PLAN.md §8 item 6).
 * Formats starting with YYYY (including YYYYMMDD) never trigger it.
 */
export const DAY_MONTH_ORDER_FORMATS: readonly DateFormat[] = Object.freeze([
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD.MM.YYYY',
  'MM.DD.YYYY',
  'DD/MM/YY',
  'MM/DD/YY',
] as const);

/** POSIX two-digit-year pivot: YY >= 69 -> 19YY (1969-1999); YY <= 68 -> 20YY (2000-2068). */
export const TWO_DIGIT_YEAR_PIVOT = 69;

// ---------------------------------------------------------------------------------------------------
// parse_number (C §2.6). String operations only; no percentages; no exponent/hex/Infinity.
// ---------------------------------------------------------------------------------------------------

export const DECIMAL_SEPARATORS = Object.freeze(['.', ','] as const);
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number];
/** Must differ from the decimal separator. 'none' = ungrouped integers only. */
export const THOUSANDS_SEPARATORS = Object.freeze([',', '.', ' ', 'none'] as const);
export type ThousandsSeparator = (typeof THOUSANDS_SEPARATORS)[number];
/** At most one marker per cell, as prefix or suffix, with optional single space. */
export const CURRENCY_MARKERS = Object.freeze(['$', '€', '£', 'USD', 'EUR', 'GBP'] as const);
export type CurrencyMarker = (typeof CURRENCY_MARKERS)[number];
/** Accepted single leading sign characters: ASCII hyphen-minus and U+2212 MINUS SIGN. */
export const MINUS_SIGNS = Object.freeze(['-', '\u2212'] as const);
/** Thousands groups are exactly this many digits. */
export const THOUSANDS_GROUP_SIZE = 3;
/**
 * Separator conventions the profile measures ("numeric-grammar share per separator convention", spec item 2).
 * Each is counted with every currency marker allowed and parens_negative on (the most permissive grammar).
 */
export const NUMBER_CONVENTIONS: readonly { readonly decimal: DecimalSeparator; readonly thousands: ThousandsSeparator }[] =
  Object.freeze([
    { decimal: '.', thousands: ',' },
    { decimal: '.', thousands: ' ' },
    { decimal: '.', thousands: 'none' },
    { decimal: ',', thousands: '.' },
    { decimal: ',', thousands: ' ' },
    { decimal: ',', thousands: 'none' },
  ] as const);

// ---------------------------------------------------------------------------------------------------
// normalize_case (C §2.6, PLAN.md row 5 and row 26).
// ---------------------------------------------------------------------------------------------------

export const CASE_MODES = Object.freeze(['upper', 'lower', 'title'] as const);
export type CaseMode = (typeof CASE_MODES)[number];
/** Fixed locale for every case mapping; never the runtime default. */
export const CASE_LOCALE = 'en-US';
/** title_on_mixed guard particles (union of both plans, PLAN.md row 26). */
export const TITLE_PARTICLES = Object.freeze(['van', 'der', 'de', 'la', 'von', 'del', 'da'] as const);

// ---------------------------------------------------------------------------------------------------
// trim_whitespace (C §2.6).
// ---------------------------------------------------------------------------------------------------

/** U+00A0 NO-BREAK SPACE (converted to a space before trimming when `nbsp: true`). */
export const NBSP = '\u00a0';
/** Removed when `zero_width: true`: U+200B..U+200D and U+FEFF (escapes keep them visible in source). */
export const ZERO_WIDTH_CHARS = Object.freeze(['\u200b', '\u200c', '\u200d', '\ufeff'] as const);
/**
 * Removed from both ends by trim_whitespace and counted as end padding by the profile: ASCII space, tab, LF,
 * CR, VT, FF. Deliberately not String.prototype.trim(), which also strips NBSP and U+FEFF and would make the
 * `nbsp` / `zero_width` params meaningless at the ends.
 */
export const TRIM_WHITESPACE_CHARS = Object.freeze([' ', '\t', '\n', '\r', '\u000b', '\u000c'] as const);

// ---------------------------------------------------------------------------------------------------
// Categories (C §2.6, §2.8).
// ---------------------------------------------------------------------------------------------------

/** A column with at most this many distinct values is a category candidate (rules and jev). */
export const CATEGORY_MAX_DISTINCT = 60;
/** category_target guard: one `to` absorbing more than this many distinct sources. */
export const CATEGORY_TARGET_MAX_SOURCES = 8;

// ---------------------------------------------------------------------------------------------------
// Instruction-like withholding (C §2.6). Static, case-insensitive, non-global literals (so .test() is
// stateless). No regex is ever built from plan params, file contents or model output.
// Screening runs on the complete original string before any clipping.
// ---------------------------------------------------------------------------------------------------

export const WITHHOLD_PATTERNS: readonly RegExp[] = Object.freeze([
  /ignore (all|the|previous|above)/i,
  /disregard/i,
  /system prompt/i,
  /you are/i,
  /assistant:/i,
  /instruction/i,
  /answer yes/i,
  /respond with/i,
  /act as/i,
  /<\//i,
  /\{\{/i,
  /\[\[/i,
  /BEGIN/i,
]);
/** Any value containing a line break is also withheld. */
export const WITHHOLD_LINE_BREAK = /[\r\n]/;
export const WITHHELD_PLACEHOLDER = '[withheld]';

// ---------------------------------------------------------------------------------------------------
// Profiles: local and outbound (spec item 2).
// ---------------------------------------------------------------------------------------------------

export const PROFILE_TOP_VALUES = 10;
/** One shared allowance per included column for samples, top values and category candidates. */
export const OUTBOUND_VALUES_PER_COLUMN = 8;
export const OUTBOUND_VALUE_MAX_CHARS = 40;
export const OUTBOUND_LABEL_MAX_CHARS = 40;
/** Most frequent collapsed shapes kept per column: local profile / outbound profile. */
export const PROFILE_SHAPES_PER_COLUMN = 20;
export const OUTBOUND_SHAPES_PER_COLUMN = 3;
/**
 * Byte budget (UTF-8 of JSON.stringify) for the outbound profile, leaving room under FUNCTION_BODY_MAX_BYTES for
 * the request envelope. Over budget, the builder lowers the per-column value allowance (8 -> 0), then drops
 * shapes, and records each reduction; it never raises a limit.
 */
export const OUTBOUND_PROFILE_MAX_BYTES = 60_000;
/**
 * Formula-like cell (spreadsheet injection risk; profile count + export warning): first character is one of these,
 * unless the whole cell is a plain signed number such as "-12" or "+3.5".
 */
export const FORMULA_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r'] as const);

// ---------------------------------------------------------------------------------------------------
// Rules planner thresholds (C §2.8). Tuned on dev only, frozen before held-out.
// ---------------------------------------------------------------------------------------------------

export const RULES_NUMERIC_SHARE_MIN = 0.9;
export const RULES_DATE_SHARE_MIN = 0.9;

// ---------------------------------------------------------------------------------------------------
// Plans and review (C §2.4, spec item 6).
// ---------------------------------------------------------------------------------------------------

export const PLAN_VERSION = 1;
export const PLAN_MAX_STEPS = 32;
export const RATIONALE_MAX_CHARS = 2_000;
/** Step ids: 1..64 characters from [A-Za-z0-9_.:-]. */
export const STEP_ID_MAX_CHARS = 64;
/** map_categories bounds: groups per step and `from` values per group. */
export const CATEGORY_GROUPS_MAX = 60;
export const CATEGORY_FROM_MAX = 60;
/**
 * op_version recorded in every apply event (C §2.4): pins the op semantics + grammar/constants version.
 * Bump together with VOCABULARY_VERSION when any op's behaviour changes.
 */
export const OP_VERSION = 1;
export const REVIEW_SAMPLE_ROWS = 5;
export const REVIEW_LARGEST_EDITS = 3;

// ---------------------------------------------------------------------------------------------------
// Edge functions and providers (C §2.9, PLAN.md row 7).
// ---------------------------------------------------------------------------------------------------

/** Request bodies above this are rejected before JSON parse (header and actual length). */
export const FUNCTION_BODY_MAX_BYTES = 65_536;
/** Generative output cap for propose-plan and llm_direct (PLAN.md row 7 overrides C's 2,000). */
export const GENERATIVE_OUTPUT_MAX_TOKENS = 4_096;
export const FUNCTION_TIMEOUT_MS = 30_000;
/** Jev model, pinned in code and echoed in every response. */
export const JEV_MODEL = 'jev-1.13.0';
export const JEV_MAX_PAIRS_PER_REQUEST = 300;
/** Siblings per pair = the rest of the <= 8 disclosed values. */
export const JEV_MAX_SIBLINGS = 6;

// ---------------------------------------------------------------------------------------------------
// Evaluation (C §5.2).
// ---------------------------------------------------------------------------------------------------

export const EVAL_FAMILY_COUNT = 3;
export const EVAL_DEV_SEEDS = Object.freeze([1, 2, 3, 4] as const);
export const EVAL_HELDOUT_SEEDS = Object.freeze([101, 102, 103, 104] as const);
export const EVAL_ROWS_MIN = 300;
export const EVAL_ROWS_MAX = 1_000;
export const MATCHED_SUBSET_ROWS = 200;
export const MATCHED_SUBSET_COLUMNS = 6;
/** Proposed hard cap for one live eval run; worst-case cost is reserved before each call. */
export const EVAL_LIVE_BUDGET_USD = 5;
