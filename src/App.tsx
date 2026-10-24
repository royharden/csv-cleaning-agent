import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppController, applyBlockReason, type PlannerChoice } from './app/controller.ts';
import { supabase } from './lib/supabase.ts';
import { ExportBar } from './ui/ExportBar.tsx';
import { FileDrop } from './ui/FileDrop.tsx';
import { InvariantPanel } from './ui/InvariantPanel.tsx';
import { JournalPanel } from './ui/JournalPanel.tsx';
import { ModeBanner } from './ui/ModeBanner.tsx';
import { OutboundPreview } from './ui/OutboundPreview.tsx';
import { PlanReview } from './ui/PlanReview.tsx';
import { ProfileView } from './ui/ProfileView.tsx';
import { ValidationReport } from './ui/ValidationReport.tsx';
import './ui/styles.css';

const defaultController = new AppController();

export function App({ controller = defaultController }: { readonly controller?: AppController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [planner, setPlanner] = useState<PlannerChoice>('rules');
  useEffect(() => { void controller.initialize(); }, [controller]);
  const session = state.session;
  const blocked = applyBlockReason(session);
  const disabled = state.busy || !state.ready;
  return (
    <main>
      <header className="app-header">
        <p className="eyebrow">Local-first · dry run by default</p>
        <h1>CSV Cleaning Agent</h1>
        <p>Inspect a plan, approve each change, and keep an exact undo journal.</p>
      </header>
      <ModeBanner configured={supabase !== null} />
      {state.error !== undefined && <p role="alert" className="error">{state.error}</p>}
      <p role="status" aria-live="polite">{state.busy ? 'Working locally…' : state.ready ? 'Ready' : 'Restoring local session…'}</p>
      <FileDrop busy={disabled} onFile={(file) => { void controller.loadFile(file); }} onSample={() => { void controller.loadSample(); }} />
      {session !== undefined && <>
        <p className="file-name">{session.filename} · {session.table.rows.length.toLocaleString('en-US')} current records</p>
        <ValidationReport meta={session.meta} acknowledged={session.acknowledged} disabled={disabled}
          onAcknowledge={(value) => { void controller.acknowledge(value); }} />
        <ProfileView profile={session.local} excluded={session.excluded} disabled={disabled}
          onToggleColumn={(id) => { void controller.toggleColumn(id); }} />
        <OutboundPreview outbound={session.outbound} />
        <section className="panel" aria-labelledby="planner-title">
          <h2 id="planner-title">Propose a plan</h2>
          <label htmlFor="planner-choice">Planner</label>{' '}
          <select id="planner-choice" value={planner} disabled={disabled} onChange={(event) => { setPlanner(event.target.value as PlannerChoice); }}>
            <option value="rules">Rules · offline default</option>
            <option value="fixture">LLM · synthetic fixture replay</option>
            <option value="jev" disabled>Jev category replay · not yet available</option>
          </select>{' '}
          <button type="button" disabled={disabled || !session.outbound.fits} onClick={() => { void controller.plan(planner); }}>Generate plan</button>
          <p>Plan source: {session.source}. Exclusions apply before the outbound profile is built. Whole-row deduplication still reads all columns locally.</p>
          {session.notes.length > 0 && <ul>{session.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        </section>
        {session.review !== undefined && <PlanReview review={session.review} disabled={disabled}
          onAction={(action) => { void controller.reviewAction(action); }} />}
        <section className="panel" aria-label="Apply approved plan">
          <button className="primary" type="button" disabled={disabled || blocked !== undefined} aria-describedby="apply-reason"
            onClick={() => { void controller.apply(); }}>Apply recorded approvals</button>
          <p id="apply-reason">{blocked ?? 'Ready to apply the recorded approvals and confirmed guards.'}</p>
        </section>
        <JournalPanel events={session.events} active={session.active} disabled={disabled}
          onUndoLast={() => { void controller.undo('last'); }} onUndoAll={() => { void controller.undo('all'); }}
          onUndoTo={(keepCount) => { void controller.undo(keepCount); }} />
        <InvariantPanel report={session.report} outputHash={session.outputHash} inputHash={session.events[0].input_hash} />
        <ExportBar disabled={disabled} formulaCount={session.local.columns.reduce((count, column) => count + column.formula_like, 0)}
          encoding={session.meta.encoding} onExport={(kind) => { void controller.export(kind); }}
          onImportPlan={(file) => { void controller.importPlan(file); }} onImportRulings={(file) => { void controller.importRulings(file); }} />
      </>}
    </main>
  );
}
