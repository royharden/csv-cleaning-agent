/**
 * Closed-vocabulary params schemas for the eight ops (C §2.6, PLAN.md M2 AC1). Pure data + zod.
 *
 * Contract:
 *  - Every params schema is a zod object with `.strict()`: unknown keys (including `human_edited`) are rejected,
 *    never stripped. Refinements add the cross-field rules (thousands != decimal, unique tokens, ...).
 *  - Column references are NOT params: they live in `PlanStep.columns` (ColumnIds). map_categories therefore has
 *    params `{groups}` and exactly one column in `columns` (C §2.6 lists `column` inside params; this module
 *    keeps one place for column identity).
 *  - The step envelope `{id, op, columns, params, rationale?}` is validated key by key in validator.ts so each
 *    problem gets its own reason; `PLAN_STEP_KEYS` is the closed key list it uses.
 *  - `zodIssuesToProblems` turns zod issues into the validator's reason strings.
 */

import { z, type ZodIssue } from 'zod';
import {
  CASE_MODES,
  CATEGORY_FROM_MAX,
  CATEGORY_GROUPS_MAX,
  CURRENCY_MARKERS,
  DATE_FORMATS,
  DECIMAL_SEPARATORS,
  NULL_TOKENS,
  THOUSANDS_SEPARATORS,
} from '../constants.ts';
import type { Problem } from './registry.ts';

function noDuplicates(values: readonly string[], ctx: z.RefinementCtx, what: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what} ${JSON.stringify(value)} is listed twice` });
      return;
    }
    seen.add(value);
  }
}

export const RenameHeadersParams = z.object({}).strict();

export const TrimWhitespaceParams = z
  .object({
    ends: z.literal(true),
    collapse_inner: z.boolean(),
    nbsp: z.boolean(),
    zero_width: z.boolean(),
  })
  .strict();

export const NullTokensParams = z
  .object({
    tokens: z.array(z.enum(NULL_TOKENS)).min(1).max(NULL_TOKENS.length),
  })
  .strict()
  .superRefine((value, ctx) => noDuplicates(value.tokens, ctx, 'token'));

export const NormalizeCaseParams = z
  .object({
    mode: z.enum(CASE_MODES),
  })
  .strict();

export const ParseNumberParams = z
  .object({
    decimal: z.enum(DECIMAL_SEPARATORS),
    thousands: z.enum(THOUSANDS_SEPARATORS),
    currency: z.array(z.enum(CURRENCY_MARKERS)).max(CURRENCY_MARKERS.length),
    parens_negative: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.thousands === value.decimal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thousands'],
        message: `thousands separator must differ from the decimal separator (${JSON.stringify(value.decimal)})`,
      });
    }
    noDuplicates(value.currency, ctx, 'currency marker');
  });

export const StandardizeDateParams = z
  .object({
    from_format: z.enum(DATE_FORMATS),
  })
  .strict();

export const CategoryGroup = z
  .object({
    from: z.array(z.string().min(1)).min(1).max(CATEGORY_FROM_MAX),
    to: z.string().min(1),
  })
  .strict();

export const MapCategoriesParams = z
  .object({
    groups: z.array(CategoryGroup).min(1).max(CATEGORY_GROUPS_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Simultaneous exact lookup: a source value may belong to one group only.
    const owner = new Map<string, number>();
    value.groups.forEach((group, g) => {
      noDuplicates(group.from, ctx, `group ${g} source`);
      for (const source of group.from) {
        const previous = owner.get(source);
        if (previous !== undefined && previous !== g) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['groups', g, 'from'],
            message: `source ${JSON.stringify(source)} is in groups ${previous} and ${g}`,
          });
        }
        owner.set(source, g);
      }
    });
  });

export const DropDuplicateRowsParams = z.object({}).strict();

export type RenameHeadersParamsT = z.infer<typeof RenameHeadersParams>;
export type TrimWhitespaceParamsT = z.infer<typeof TrimWhitespaceParams>;
export type NullTokensParamsT = z.infer<typeof NullTokensParams>;
export type NormalizeCaseParamsT = z.infer<typeof NormalizeCaseParams>;
export type ParseNumberParamsT = z.infer<typeof ParseNumberParams>;
export type StandardizeDateParamsT = z.infer<typeof StandardizeDateParams>;
export type MapCategoriesParamsT = z.infer<typeof MapCategoriesParams>;
export type DropDuplicateRowsParamsT = z.infer<typeof DropDuplicateRowsParams>;

/** The closed set of step-envelope keys. Anything else (e.g. `human_edited`, `confidence`) is an extra key. */
export const PLAN_STEP_KEYS = Object.freeze(['id', 'op', 'columns', 'params', 'rationale'] as const);
export const PLAN_STEP_REQUIRED_KEYS = Object.freeze(['id', 'op', 'columns', 'params'] as const);
/** The closed set of plan-envelope keys. */
export const PLAN_KEYS = Object.freeze(['version', 'steps'] as const);

/** Step ids: 1..STEP_ID_MAX_CHARS characters from this class (checked with the length in validator.ts). */
export const STEP_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function issuePath(issue: ZodIssue): string {
  return issue.path.length === 0 ? 'params' : `params.${issue.path.join('.')}`;
}

/** zod issues -> validator problems (`extra_keys` for unknown keys, `params` for everything else). */
export function zodIssuesToProblems(issues: readonly ZodIssue[]): Problem[] {
  return issues.map((issue): Problem => {
    if (issue.code === 'unrecognized_keys') {
      return { code: 'extra_keys', message: `extra key(s) in ${issuePath(issue)}: ${issue.keys.join(', ')}` };
    }
    return { code: 'params', message: `${issuePath(issue)}: ${issue.message}` };
  });
}
