// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createReviewState, decide } from '../../src/core/review/state.ts';
import type { Table } from '../../src/core/table.ts';
import { StepCard, type StepCardProps } from '../../src/ui/StepCard.tsx';

afterEach(cleanup);
const base: Table = { cols: [{ id: 'c0', name: 'City' }], rows: [['abcdef'], ['UVWXYA'], ['qwerty'], ['zzzzzz'], ['mmmmmm'], ['nnnnnn'], ['UVWXYZ']], rid: [0, 1, 2, 3, 4, 5, 6] };
const scope = { outboundColumnIds: ['c0'] as const, excludedColumnIds: [] };
async function categoryReview() {
  return createReviewState(base, { version: 1, steps: [{ id: 'categories', op: 'map_categories', columns: ['c0'], params: { groups: [{ from: ['abcdef', 'UVWXYA', 'qwerty', 'zzzzzz', 'mmmmmm', 'nnnnnn'], to: 'UVWXYZ' }] }, rationale: '<script>window.pwned = true</script><img src=x onerror=alert(1)>' }] }, scope);
}
function props(card: StepCardProps['card']): StepCardProps {
  return { card, selected: true, approvalBlocked: false, disabled: false, onSelect: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onEdit: vi.fn(), onConfirm: vi.fn() };
}

describe('StepCard review evidence', () => {
  it('shows full-file counts, five deterministic rows and three exact largest edits, including equal-length rewrites', async () => {
    const review = await categoryReview();
    const { container } = render(<StepCard {...props(review.cards[0])}/>);
    const samples = screen.getByRole('table');
    expect(within(samples).getAllByRole('row')).toHaveLength(6); // header + 5 changed source rows
    expect(screen.getByText('Changed cells').nextElementSibling?.textContent).toBe('6');
    expect(screen.getByText('Left unparsed').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('Dropped rows').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('Changed headers').nextElementSibling?.textContent).toBe('0');
    const largest = container.querySelector('.largest-edits');
    expect(largest?.children).toHaveLength(3);
    expect(largest?.firstElementChild?.textContent).toContain('distance 6');
    expect(largest?.firstElementChild?.textContent).toContain('abcdef');
    expect(largest?.textContent).not.toContain('UVWXYA'); // one substitution must rank below six substitutions
  });

  it('renders rationale as inert escaped text', async () => {
    const review = await categoryReview();
    const { container } = render(<StepCard {...props(review.cards[0])}/>);
    expect(screen.getByText('<script>window.pwned = true</script><img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('requires explicit confirmation of each guard before enabling approval', async () => {
    const table: Table = { cols: [{ id: 'c0', name: 'Country' }], rows: [['NA'], ['US'], ['GB']], rid: [0, 1, 2] };
    let review = await createReviewState(table, { version: 1, steps: [{ id: 'null-country', op: 'null_tokens', columns: ['c0'], params: { tokens: ['NA'] } }] }, scope);
    const handlers = props(review.cards[0]);
    const { rerender } = render(<StepCard {...handlers}/>);
    expect((screen.getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm null_shape_majority' }));
    expect(handlers.onConfirm).toHaveBeenCalledWith('null_shape_majority');
    expect(handlers.onApprove).not.toHaveBeenCalled();
    review = await decide(review, { type: 'confirm', index: 0, guard: 'null_shape_majority' });
    rerender(<StepCard {...handlers} card={review.cards[0]}/>);
    expect((screen.getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    expect(handlers.onApprove).toHaveBeenCalledOnce();
  });

  it('shows recorded approval fingerprints and blocks approval behind an unresolved earlier step', async () => {
    const review = await createReviewState(base, { version: 1, steps: [{ id: 'headers', op: 'rename_headers', columns: ['c0'], params: {} }] }, scope);
    const approved = await decide(review, { type: 'approve', index: 0, decidedAt: '2026-10-24T12:00:00.000Z' });
    const { rerender } = render(<StepCard {...props(approved.cards[0])}/>);
    expect(screen.getByText('Approval recorded')).toBeTruthy();
    expect(screen.getByText(approved.cards[0].decision.approval?.predecessor_hash ?? '')).toBeTruthy();
    rerender(<StepCard {...props(review.cards[0])} approvalBlocked/>);
    expect((screen.getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Decide earlier pending steps before approving this one.')).toBeTruthy();
  });
});
