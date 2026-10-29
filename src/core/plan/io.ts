import { z } from 'zod';
import { isColumnId, type ColumnId, type Table } from '../table.ts';
import type { Plan } from '../transformkit/registry.ts';
import { validatePlan, type Rejection, type ValidationResult } from '../transformkit/validator.ts';

const ReferenceSchema = z.object({ id: z.string().refine(isColumnId), original_name: z.string(), ordinal: z.number().int().nonnegative() }).strict();
const ExportSchema = z.object({ version: z.literal(1), columns: z.array(ReferenceSchema).max(60), steps: z.array(z.unknown()) }).strict();
export type ColumnReference = z.infer<typeof ReferenceSchema>;
export interface ImportedPlan {
  readonly plan: Plan;
  readonly validation: ValidationResult;
  readonly resolution_rejections: readonly { index: number; step_id?: string; code: 'missing_column' | 'ambiguous_column'; reason: string }[];
  /** Explicitly empty: an import never carries approval authority to a new file. */
  readonly approvals: readonly never[];
}

export function referenceManifest(original: Table): ColumnReference[] {
  const occurrences = new Map<string, number>();
  return original.cols.map((col) => {
    const ordinal = occurrences.get(col.name) ?? 0;
    occurrences.set(col.name, ordinal + 1);
    return { id: col.id, original_name: col.name, ordinal };
  });
}
export function exportPlan(plan: Plan, original: Table): string {
  return JSON.stringify(ExportSchema.parse({ version: 1, columns: referenceManifest(original), steps: plan.steps }), null, 2);
}

export function importPlan(text: string, target: Table, excludedColumnIds: readonly ColumnId[] = []): ImportedPlan {
  const source = ExportSchema.parse(JSON.parse(text));
  const ids = new Set<string>(); const ordinals = new Map<string, Set<number>>();
  for (const ref of source.columns) {
    if (ids.has(ref.id)) throw new Error(`duplicate manifest id ${ref.id}`);
    ids.add(ref.id);
    const set = ordinals.get(ref.original_name) ?? new Set<number>();
    if (set.has(ref.ordinal)) throw new Error(`duplicate manifest ordinal for ${JSON.stringify(ref.original_name)}`);
    set.add(ref.ordinal); ordinals.set(ref.original_name, set);
  }
  for (const [name, values] of ordinals) {
    if (![...values].every((ordinal) => ordinal < values.size)) throw new Error(`non-contiguous manifest ordinals for ${JSON.stringify(name)}`);
  }
  const targetRefs = referenceManifest(target);
  const resolutions = new Map<string, string>();
  const failures = new Map<string, { code: 'missing_column' | 'ambiguous_column'; reason: string }>();
  for (const ref of source.columns) {
    const from = source.columns.filter((c) => c.original_name === ref.original_name);
    const to = targetRefs.filter((c) => c.original_name === ref.original_name);
    if (to.length === 0) failures.set(ref.id, { code: 'missing_column', reason: `missing_column: target has no exact header ${JSON.stringify(ref.original_name)}` });
    else if ((from.length > 1 || to.length > 1) && from.length !== to.length)
      failures.set(ref.id, { code: 'ambiguous_column', reason: `ambiguous_column: header ${JSON.stringify(ref.original_name)} occurs ${from.length} times in source and ${to.length} in target` });
    else resolutions.set(ref.id, to.find((c) => c.ordinal === ref.ordinal)!.id);
  }
  const resolutionRejections: ImportedPlan['resolution_rejections'][number][] = [];
  const rawSteps: unknown[] = [];
  const originalIndices: number[] = [];
  source.steps.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { rawSteps.push(raw); originalIndices.push(index); return; }
    const record = raw as Record<string, unknown>;
    const stepId = typeof record.id === 'string' ? record.id : undefined;
    let failed = false;
    if (Array.isArray(record.columns)) for (const id of record.columns) {
      const failure = typeof id === 'string' ? failures.get(id) : undefined;
      if (failure !== undefined || typeof id !== 'string' || !resolutions.has(id)) {
        resolutionRejections.push({ index, ...(stepId === undefined ? {} : { step_id: stepId }),
          ...(failure ?? { code: 'missing_column' as const, reason: `missing_column: no original-header reference for ${String(id)}` }) });
        failed = true;
      }
    }
    if (failed) {
      // Preserve original positions, duplicate-id detection and the 32-card limit through validation.
      rawSteps.push({ ...record, columns: ['unresolved-import-column'] }); originalIndices.push(index); return;
    }
    rawSteps.push({ ...record, ...(Array.isArray(record.columns) ? { columns: record.columns.map((id: string) => resolutions.get(id)) } : {}) });
    originalIndices.push(index);
  });
  // Keep dependent cards using tentative accepted predecessors; review revalidates against approved steps only.
  const checked = validatePlan({ version: 1, steps: rawSteps }, { table: target,
    outboundColumnIds: target.cols.map((c) => c.id).filter((id) => !excludedColumnIds.includes(id)), excludedColumnIds });
  const validation: ValidationResult = { ...checked,
    accepted: checked.accepted.map((item) => ({ ...item, index: originalIndices[item.index] })),
    rejected: checked.rejected.map((item): Rejection => ({ ...item, index: originalIndices[item.index] })) };
  return { plan: { version: 1, steps: validation.accepted.map((item) => item.step) }, validation,
    resolution_rejections: resolutionRejections, approvals: [] };
}
