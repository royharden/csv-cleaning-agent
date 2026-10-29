// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createReviewState, decide } from '../../src/core/review/state.ts';
import { parseBytes } from '../../src/core/csv/parse.ts';
import type { Table } from '../../src/core/table.ts';
import { PlanReview } from '../../src/ui/PlanReview.tsx';
import { ValidationReport } from '../../src/ui/ValidationReport.tsx';

afterEach(cleanup);
const table: Table = { cols: [{ id: 'c0', name: 'amount' }], rows: [[' 123 '], [' 456 ']], rid: [0, 1] };
const scope = { outboundColumnIds: ['c0'] as const, excludedColumnIds: [] };
const trim = { id: 'trim', op: 'trim_whitespace', columns: ['c0'], params: { ends: true, collapse_inner: false, nbsp: false, zero_width: false } };
const number = { id: 'numbers', op: 'parse_number', columns: ['c0'], params: { decimal: '.', thousands: 'none', currency: [], parens_negative: false } };
const loadReview = () => createReviewState(table, { version: 1, steps: [trim, number] }, scope);

describe('PlanReview keyboard and explicit decisions', () => {
  it('navigates j/k and refuses later approval until earlier decisions are complete', async () => {
    const onAction = vi.fn();
    render(<PlanReview review={await loadReview()} disabled={false} onAction={onAction}/>);
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByText('Selected step 2 of 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'approve', index: 0 }));
  });

  it('r opens a reason form; typing shortcuts never approves or navigates; cancellation records nothing', async () => {
    const onAction = vi.fn();
    render(<PlanReview review={await loadReview()} disabled={false} onAction={onAction}/>);
    fireEvent.keyDown(window, { key: 'r' });
    const reason = screen.getByLabelText('Reason for rejecting');
    expect((screen.getByRole('button', { name: 'Save rejection' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reason, { target: { value: 'Keep the source spacing' } });
    fireEvent.keyDown(reason, { key: 'a' });
    fireEvent.keyDown(reason, { key: 'j' });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText('Selected step 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rejection' }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: '  Keep the source spacing  ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Reject proposal' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'reject', index: 0, reason: 'Keep the source spacing' });
  });

  it('e opens an explicit edit form and submits saved data for revalidation; invalid JSON stays local', async () => {
    const onAction = vi.fn();
    render(<PlanReview review={await loadReview()} disabled={false} onAction={onAction}/>);
    fireEvent.keyDown(window, { key: 'e' });
    const form = screen.getByRole('form', { name: 'Edit proposal' });
    const editor = within(form).getByLabelText('Proposal JSON');
    fireEvent.change(editor, { target: { value: '{invalid' } });
    fireEvent.submit(form);
    expect(screen.getByRole('alert').textContent).toContain('valid JSON');
    expect(onAction).not.toHaveBeenCalled();
    const edited = { ...trim, params: { ...trim.params, collapse_inner: true } };
    fireEvent.change(editor, { target: { value: JSON.stringify(edited) } });
    fireEvent.submit(form);
    expect(onAction).toHaveBeenCalledWith({ type: 'edit', index: 0, step: edited });
  });

  it('c confirms only the next visible guard; browser shortcuts and repeat keys do nothing', async () => {
    const guarded: Table = { cols: [{ id: 'c0', name: 'date' }], rows: [['01/02/23']], rid: [0] };
    const review = await createReviewState(guarded, { version: 1, steps: [{ id: 'date', op: 'standardize_date', columns: ['c0'], params: { from_format: 'DD/MM/YY' } }] }, scope);
    const onAction = vi.fn();
    render(<PlanReview review={review} disabled={false} onAction={onAction}/>);
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'a', repeat: true });
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'c' });
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith({ type: 'confirm', index: 0, guard: review.cards[0].guards[0].guard });
  });

  it('shows a stale approval after rejecting trim and recalculates number preview against untrimmed input', async () => {
    let review = await loadReview();
    review = await decide(review, { type: 'approve', index: 0, decidedAt: '2026-10-24T12:00:00.000Z' });
    review = await decide(review, { type: 'approve', index: 1, decidedAt: '2026-10-24T12:01:00.000Z' });
    review = await decide(review, { type: 'reject', index: 0, reason: 'Keep spacing' });
    render(<PlanReview review={review} disabled={false} onAction={vi.fn()}/>);
    expect(screen.getByText('Review again')).toBeTruthy();
    expect(screen.getByText('An earlier decision changed this preview. Review it and record a fresh approval.')).toBeTruthy();
    const second = screen.getByRole('article', { name: 'Step 2' });
    expect(within(second).getByText('Left unparsed').nextElementSibling?.textContent).toBe('2');
    expect(within(second).queryByText('Approval recorded')).toBeNull();
  });

  it('renders an empty plan clearly and leaves disabled review inert', async () => {
    const review = await createReviewState(table, { version: 1, steps: [] }, scope);
    const onAction = vi.fn();
    const { rerender } = render(<PlanReview review={review} disabled={false} onAction={onAction}/>);
    expect(screen.getByText('No changes proposed. Your table stays as imported.')).toBeTruthy();
    rerender(<PlanReview review={await loadReview()} disabled onAction={onAction}/>);
    for (const key of ['j', 'k', 'a', 'r', 'e', 'c']) fireEvent.keyDown(window, { key });
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('validation acknowledgement', () => {
  it('reports mixed endings and ragged rows; acknowledgement changes only on user input', () => {
    const parsed = parseBytes(new TextEncoder().encode('name,amount\r\nA,1\r\nB\n'));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const onAcknowledge = vi.fn();
    render(<ValidationReport meta={parsed.meta} acknowledged={false} disabled={false} onAcknowledge={onAcknowledge}/>);
    expect(screen.getByText(/1 rows have a different number of fields/)).toBeTruthy();
    expect(screen.getByText(/1 records use other line endings/)).toBeTruthy();
    expect(onAcknowledge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAcknowledge).toHaveBeenCalledWith(true);
  });
});
