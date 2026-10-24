/**
 * Column-reference resolution for plan steps (C §2.4 "Column identity", §2.8 validator; PLAN.md M2 AC6). Pure.
 *
 * Contract: a step references columns ONLY by ColumnId ("c0".."c59") taken from the outbound profile. Each
 * reference is classified, in this order:
 *   - not a string                                  -> bad_columns
 *   - not a ColumnId but equal to a display name     -> label_as_column (labels are display only; the message
 *                                                      says when the label is ambiguous, i.e. shared by 2+ columns)
 *   - not a ColumnId, or a ColumnId not in the table -> unknown_column
 *   - excluded by the user                           -> excluded_column
 *   - not in the outbound column list                -> not_outbound (the planner could not have seen it)
 *   - listed twice in the same step                  -> duplicate_column
 * A ColumnId always wins over a header that happens to look like one (identity is the id, never the name).
 * Plan import (M3 plan/io.ts) re-resolves (original_name, ordinal) to ColumnIds BEFORE calling the validator.
 */

import { columnIndexOf, isColumnId, type ColumnId, type Table } from '../table.ts';
import type { Problem } from './registry.ts';

export interface ColumnScope {
  readonly table: Table;
  /** Columns included in the outbound profile (all non-excluded columns for local planners). */
  readonly outboundColumnIds: readonly ColumnId[];
  readonly excludedColumnIds: readonly ColumnId[];
}

export interface ResolvedColumns {
  /** Valid references in the order given. */
  readonly ids: ColumnId[];
  readonly problems: Problem[];
}

export function resolveColumnRefs(refs: readonly unknown[], scope: ColumnScope): ResolvedColumns {
  const excluded = new Set(scope.excludedColumnIds);
  const outbound = new Set(scope.outboundColumnIds);
  const seen = new Set<string>();
  const ids: ColumnId[] = [];
  const problems: Problem[] = [];

  refs.forEach((ref, position) => {
    if (typeof ref !== 'string') {
      problems.push({ code: 'bad_columns', message: `columns[${position}] is not a string` });
      return;
    }
    const quoted = JSON.stringify(ref);
    if (!isColumnId(ref) || columnIndexOf(scope.table, ref) < 0) {
      const named = scope.table.cols.filter((col) => col.name === ref);
      if (!isColumnId(ref) && named.length > 0) {
        const ambiguity = named.length > 1 ? ` (ambiguous: ${named.length} columns share that header)` : '';
        problems.push({
          code: 'label_as_column',
          message: `column ${quoted} is a display label, not a column id${ambiguity}; use ${named.map((c) => c.id).join(' or ')}`,
        });
      } else {
        problems.push({ code: 'unknown_column', message: `unknown column ${quoted}` });
      }
      return;
    }
    if (excluded.has(ref)) {
      problems.push({ code: 'excluded_column', message: `column ${ref} is excluded from planning` });
      return;
    }
    if (!outbound.has(ref)) {
      problems.push({ code: 'not_outbound', message: `column ${ref} is not in the outbound profile` });
      return;
    }
    if (seen.has(ref)) {
      problems.push({ code: 'duplicate_column', message: `column ${ref} is listed twice` });
      return;
    }
    seen.add(ref);
    ids.push(ref);
  });

  return { ids, problems };
}
