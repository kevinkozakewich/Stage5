import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateDispatchOnlySchema, DISPATCH_TOOL_NAMES } from '../../harness/lib/coordinatorSchema.js';
import { planNextGoldenDispatch, invalidateDependentResults } from '../../harness/lib/goldenCoordinator.js';
import { executeDispatch } from '../../harness/lib/dispatchRunner.js';
import { checkSubstanceGate, recordSubstanceDecision, hashSubstanceReport } from '../../harness/lib/substanceGate.js';

const assignment = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = JSON.parse(readFileSync(join(assignment, 'harness/fixtures/golden.json'), 'utf8'));
const passFixture = fixtures['golden-pass'];

function temporaryRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), 'stage5-coordinator-contract-'));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  return runDir;
}
function result(workflow, ref, output) {
  return { workflow, ref, output, agent: 'contract-test', model: 'mock:contract-test', input_tokens: 0, output_tokens: 0, cost_usd: 0 };
}
function cleanContext() {
  return {
    requirements: structuredClone(passFixture.requirements),
    triggerSql: passFixture.trigger_sql,
    lastReview: structuredClone(passFixture.review_pass),
    adversarialResult: null,
    g4Passed: false,
    reportBody: null,
    reviewAttempt: 0,
  };
}
const overturned = {
  challenge: 'OVERTURNED', original_verdict: 'PASS', confidence: 'high',
  findings: [{type:'missing_element',label:'BEGIN TRY / BEGIN CATCH',evidence:'The challenged trigger omits the TRY/CATCH wrapper.'}],
  recommended_verdict: 'FAIL', notes: 'Repair the missing exception wrapper before accepting this artifact.',
};
const upheld = {
  challenge: 'UPHELD', original_verdict: 'PASS', confidence: 'high', findings: [],
  recommended_verdict: 'PASS', notes: 'Independent fixture review confirms the contract.',
};

describe('C4 — dispatch-only coordinator schema', () => {
  it('declares exactly the six launch tools', () => {
    const schema = validateDispatchOnlySchema();
    assert.equal(schema.pass, true, schema.findings.join('; '));
    assert.deepEqual(schema.tools.sort(), [...DISPATCH_TOOL_NAMES].sort());
  });
  it('rejects a real-work tool at the dispatch boundary', (t) => {
    const context = cleanContext();
    const dispatched = executeDispatch({tool:'read_file', fixture:passFixture, context, runDir:temporaryRun(t), agentResult:result('W1','requirements.json',passFixture.requirements)});
    assert.equal(dispatched.validationError?.guardrail, 'DISPATCH');
    assert.equal(dispatched.validationError?.code, 'VALIDATION_ERROR');
  });
});

describe('C1 — actual overturn requires remediation and independent re-review', () => {
  it('preserves original verdict and challenge evidence for the targeted repair', () => {
    const state = {status:'running',remediateCycles:0};
    const context = cleanContext();
    context.adversarialResult = structuredClone(overturned);
    context.g4Passed = true;
    context.reportBody = 'Stale report';
    assert.equal(planNextGoldenDispatch(state,context),'launch_remediator');
    assert.equal(context.lastReview.verdict,'PASS');
    assert.deepEqual(context.challenges,overturned.findings);
    assert.deepEqual(context.adversarialHistory,[overturned]);
    assert.equal(context.artifact_focus,'trigger.sql');
    assert.equal(context.target_step,'W4');
    assert.equal(context.g4Passed,false);
    assert.equal(context.reportBody,null);
  });
  it('re-enters W3 then W5 after accepting a repaired trigger', (t) => {
    const state = {status:'running',remediateCycles:0};
    const context = cleanContext();
    context.adversarialResult = structuredClone(overturned);
    const runDir = temporaryRun(t);
    const tool = planNextGoldenDispatch(state,context);
    const repair = executeDispatch({tool,fixture:passFixture,context,runDir});
    assert.equal(repair.validationError,null);
    assert.equal(context.lastReview,null);
    assert.equal(context.adversarialResult,null);
    assert.equal(context.g4Passed,false);
    assert.deepEqual(context.challenges,overturned.findings);
    assert.equal(planNextGoldenDispatch(state,context),'launch_trigger_review');
    const review = executeDispatch({tool:'launch_trigger_review',fixture:passFixture,context,runDir});
    assert.equal(review.validationError,null);
    assert.equal(planNextGoldenDispatch(state,context),'launch_adversarial_reviewer');
  });
  it('cannot reach report after an overturn exhausts the repair budget', () => {
    const context = cleanContext();
    context.adversarialResult = structuredClone(overturned);
    const state = {status:'running',remediateCycles:2};
    assert.equal(planNextGoldenDispatch(state,context),null);
    assert.equal(state.status,'failure');
    assert.equal(state.failureOriginStep,'W5');
  });
  it('invalidates all dependent approvals on a revised review', () => {
    const context = cleanContext();
    context.adversarialResult = structuredClone(upheld);
    context.g4Passed = true;
    context.reportBody = 'Stale report';
    invalidateDependentResults(context,'W3');
    assert.equal(context.lastReview.verdict,'PASS');
    assert.equal(context.adversarialResult,null);
    assert.equal(context.g4Passed,false);
    assert.equal(context.reportBody,null);
  });
});

describe('C2 — actual append-only substance decisions, never flag approval', () => {
  it('blocks both absent records and the former Continue flag', (t) => {
    const overrides = join(temporaryRun(t),'decisions.jsonl');
    assert.equal(checkSubstanceGate(overrides,'test-correlation',false).blocked,true);
    assert.equal(checkSubstanceGate(overrides,'test-correlation',true).blocked,true);
  });
  it('requires identity and retains the unchanged report with each decision', (t) => {
    const runDir = temporaryRun(t);
    const overrides = join(runDir,'decisions.jsonl');
    const reportPath = join(runDir,'report.md');
    const report = '# Contract test only\n\nOriginal report retained verbatim.\n';
    writeFileSync(reportPath,report);
    assert.throws(() => recordSubstanceDecision({overridesPath:overrides,correlationId:'case',decision:'Continue',reviewer:'',reportPath}));
    recordSubstanceDecision({overridesPath:overrides,correlationId:'case',decision:'Continue',reviewer:'Synthetic contract-test reviewer',reportPath});
    const original = readFileSync(overrides,'utf8');
    assert.equal(checkSubstanceGate(overrides,'case',{reportHash:hashSubstanceReport(report)}).blocked,false);
    assert.equal(checkSubstanceGate(overrides,'case',{reportHash:hashSubstanceReport(report+'changed')}).blocked,true);
    recordSubstanceDecision({overridesPath:overrides,correlationId:'case',decision:'Reject',reviewer:'Synthetic contract-test reviewer',reportPath});
    assert.ok(readFileSync(overrides,'utf8').startsWith(original));
    assert.equal(checkSubstanceGate(overrides,'case',{reportHash:hashSubstanceReport(report)}).blocked,true);
    const rows = readFileSync(overrides,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,2);
    assert.ok(rows.every(row => row.report === report));
  });
});

describe('C3 — delegation validates actual outputs before the coordinator sees them', () => {
  it('returns a structured G1 error without adopting malformed requirements', (t) => {
    const context = {};
    const dispatched = executeDispatch({tool:'launch_spec_parser',fixture:{},context,runDir:temporaryRun(t),agentResult:result('W1','requirements.json',{table:'Orders'})});
    assert.equal(dispatched.validationError?.code,'VALIDATION_ERROR');
    assert.equal(dispatched.validationError?.guardrail,'G1');
    assert.ok(dispatched.validationError.findings.length);
    assert.equal(context.requirements,undefined);
  });
  it('runs G2 on SQL even when a fixture claims the guardrail passes', (t) => {
    const context = {};
    const dispatched = executeDispatch({tool:'launch_trigger_codegen',fixture:{guardrails:{G2:true}},context,runDir:temporaryRun(t),agentResult:result('W2','trigger.sql','INSERT INTO DownstreamMigrationQueue SELECT * FROM inserted;')});
    assert.equal(dispatched.validationError?.guardrail,'G2');
    assert.equal(context.triggerSql,undefined);
  });
  it('rejects a verdict-only review and retains the earlier valid review', (t) => {
    const context = cleanContext();
    const previousReview = structuredClone(context.lastReview);
    const dispatched = executeDispatch({tool:'launch_trigger_review',fixture:{},context,runDir:temporaryRun(t),agentResult:result('W3','review.json',{verdict:'PASS'})});
    assert.equal(dispatched.validationError?.guardrail,'W3');
    assert.deepEqual(context.lastReview,previousReview);
  });
  it('rejects a schema-inconsistent PASS before G4', (t) => {
    const context = cleanContext();
    const fixture = fixtures['golden-g4-fail'];
    const dispatched = executeDispatch({tool:'launch_trigger_review',fixture,context,runDir:temporaryRun(t)});
    assert.equal(dispatched.validationError?.guardrail,'W3');
  });
  it('does not let forbidden_patterns.clean bypass a real G4 failure', (t) => {
    const context = cleanContext();
    context.triggerSql = 'INSERT INTO DownstreamMigrationQueue SELECT * FROM inserted;';
    const dispatched = executeDispatch({tool:'launch_adversarial_reviewer',fixture:{},context,runDir:temporaryRun(t),agentResult:result('W5','adversarial.json',upheld)});
    assert.equal(dispatched.validationError?.guardrail,'G4');
    assert.equal(context.g4Passed,false);
  });
  it('rejects model-authored headings instead of contradicting harness headings', (t) => {
    const context = cleanContext();
    const dispatched = executeDispatch({tool:'launch_delivery_report_writer',fixture:{},context,runDir:temporaryRun(t),agentResult:result('W6','report-body.md','## PASS — trigger.sql\nAn invented heading.')});
    assert.equal(dispatched.validationError?.guardrail,'W6');
    assert.equal(context.reportBody,null);
  });
});
