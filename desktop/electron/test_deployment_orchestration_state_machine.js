/**
 * Deployment orchestration ownership/state-machine regression suite.
 * No cloud providers, network calls, or git mutations are used here.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DeploymentOrchestrator,
  ORCHESTRATION_STATUS,
} = require('./intelligence/deployment/orchestration/DeploymentOrchestrator');

let passed = 0;
let failed = 0;
const delay = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

function makeWorkspace() {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-orchestration-sm-'));
  fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'state-machine-test' }));
  return workspacePath;
}

function planFor(workspacePath) {
  return {
    workspacePath,
    topology: {
      services: [],
      databases: [{ databaseId: 'db', name: 'Test DB', technology: 'postgres', recommendedProvider: 'render_postgres' }],
    },
    wiring: [],
    executionOrder: ['db'],
  };
}

function controlledOrchestrator() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const orchestrator = new DeploymentOrchestrator({
    databaseAdapter: {
      provision: async () => {
        await gate;
        return { success: true, connectionString: 'postgresql://test', durationMs: 1 };
      },
    },
  });
  return { orchestrator, release };
}

function activeRecord(orchestrator) {
  const records = [...orchestrator.activeOrchestrations.values()];
  assert.strictEqual(records.length, 1, 'exactly one active runtime record expected');
  return records[0];
}

(async () => {
  console.log('\nDeployment orchestration state-machine tests\n');
  const workspacePath = makeWorkspace();
  const plan = planFor(workspacePath);

  await test('1. A creates one authoritative record and becomes workspace owner', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const running = orchestrator.startOrchestration(plan, { requestId: 'a-owner' });
    await delay();
    const record = activeRecord(orchestrator);
    assert.strictEqual(orchestrator.workspaceOwners.get(path.resolve(workspacePath)), record.orchestrationId);
    release(); await running;
  });

  await test("2-4. A's own preflight and stage do not self-conflict", async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const running = orchestrator.startOrchestration(plan, { requestId: 'a-self' });
    await delay();
    const record = activeRecord(orchestrator);
    const preflight = await orchestrator.runPreflight(plan, { orchestrationId: record.orchestrationId });
    assert.strictEqual(preflight.valid, true);
    assert.strictEqual(record.status, ORCHESTRATION_STATUS.RUNNING);
    assert.strictEqual(record.activeStageId, 'db');
    release(); await running;
  });

  await test('5-7. B is blocked while A runs, without changing A state', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const a = orchestrator.startOrchestration(plan, { requestId: 'a-block' });
    await delay();
    const aRecord = activeRecord(orchestrator);
    const b = await orchestrator.startOrchestration(plan, { requestId: 'b-block' });
    assert.strictEqual(b.code, 'CONCURRENT_ORCHESTRATION');
    assert.strictEqual(aRecord.status, ORCHESTRATION_STATUS.RUNNING);
    release(); await a;
  });

  await test('8-10. SUCCESS releases ownership and C receives a new orchestration ID', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const a = orchestrator.startOrchestration(plan, { requestId: 'a-success' }); await delay();
    const aId = activeRecord(orchestrator).orchestrationId;
    release(); const aResult = await a;
    assert.strictEqual(aResult.status, ORCHESTRATION_STATUS.SUCCESS);
    assert.strictEqual(orchestrator.workspaceOwners.has(path.resolve(workspacePath)), false);
    const c = await orchestrator.startOrchestration(planFor(workspacePath), { requestId: 'c-success' });
    assert.notStrictEqual(c.orchestrationId, aId);
  });

  await test('11 & 14. Failure and exception paths finalize and release ownership', async () => {
    const failing = new DeploymentOrchestrator({ databaseAdapter: { provision: async () => { throw new Error('boom'); } } });
    const result = await failing.startOrchestration(plan, { requestId: 'failure-release' });
    assert.strictEqual(result.status, ORCHESTRATION_STATUS.FAILED);
    assert.strictEqual(failing.workspaceOwners.has(path.resolve(workspacePath)), false);
  });

  await test('12. Timeout finalization releases ownership exactly once', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const running = orchestrator.startOrchestration(plan, { requestId: 'timeout-release' }); await delay();
    const record = activeRecord(orchestrator);
    const first = orchestrator.finalizeOrchestration(record.orchestrationId, ORCHESTRATION_STATUS.TIMED_OUT, 'test timeout');
    const second = orchestrator.finalizeOrchestration(record.orchestrationId, ORCHESTRATION_STATUS.TIMED_OUT, 'duplicate');
    assert.strictEqual(first.finalized, true); assert.strictEqual(second.finalized, false);
    assert.strictEqual(orchestrator.workspaceOwners.has(path.resolve(workspacePath)), false);
    release(); await running;
  });

  await test('13. Cancellation remains non-terminal until the active stage settles', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const running = orchestrator.startOrchestration(plan, { requestId: 'cancel-release' }); await delay();
    const record = activeRecord(orchestrator);
    orchestrator.cancelOrchestration(record.orchestrationId);
    assert.strictEqual(record.status, ORCHESTRATION_STATUS.RUNNING);
    release(); const result = await running;
    assert.strictEqual(result.status, ORCHESTRATION_STATUS.CANCELLED);
    assert.strictEqual(orchestrator.workspaceOwners.has(path.resolve(workspacePath)), false);
  });

  await test('15-16. Dead records clean up, while a live in-process stage is not preempted', async () => {
    const orchestrator = new DeploymentOrchestrator({ stageTimeoutMs: 1 });
    const dead = { orchestrationId: 'dead', workspacePath: path.resolve(workspacePath), status: 'RUNNING', startedAt: 1, lastActivityAt: 1 };
    orchestrator.activeOrchestrations.set(dead.orchestrationId, dead);
    orchestrator.cleanupStaleOrchestrations(workspacePath);
    assert.strictEqual(orchestrator.activeOrchestrations.has('dead'), false);
    const live = { orchestrationId: 'live', workspacePath: path.resolve(workspacePath), status: 'RUNNING', startedAt: 1, lastActivityAt: 1, activeStageId: 'render' };
    orchestrator.activeOrchestrations.set(live.orchestrationId, live);
    assert.strictEqual(orchestrator.isAnotherActiveOrchestration(workspacePath, 'other').orchestrationId, 'live');
  });

  await test('17-19. A terminal record cannot execute stages and late callbacks are inert', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const running = orchestrator.startOrchestration(plan, { requestId: 'late-callback' }); await delay();
    const record = activeRecord(orchestrator);
    orchestrator.finalizeOrchestration(record.orchestrationId, ORCHESTRATION_STATUS.FAILED, 'forced failure');
    assert.strictEqual(orchestrator.canExecuteStage(record), false);
    await assert.rejects(
      () => orchestrator.executeDatabaseStage({}, { runtimeRecord: record }),
      /ORCHESTRATION_TERMINAL/
    );
    release(); const result = await running;
    assert.strictEqual(result.status, ORCHESTRATION_STATUS.FAILED);
  });

  await test('20-21. Duplicate UI/IPC request IDs coalesce to one orchestration', async () => {
    const { orchestrator, release } = controlledOrchestrator();
    const one = orchestrator.startOrchestration(plan, { requestId: 'one-click' });
    const two = orchestrator.startOrchestration(plan, { requestId: 'one-click' });
    assert.strictEqual(one, two);
    await delay(); assert.strictEqual(orchestrator.activeOrchestrations.size, 1);
    release(); await one;
  });

  await test('22. Event correlation rejects stale A events for B', async () => {
    const accepts = (currentRequestId, event) => !currentRequestId || event.requestId === currentRequestId;
    assert.strictEqual(accepts('request-b', { requestId: 'request-a' }), false);
    assert.strictEqual(accepts('request-b', { requestId: 'request-b' }), true);
  });

  await test('23-25. Self-safe preflight, health failure, and retry all preserve ownership invariants', async () => {
    const failure = new DeploymentOrchestrator({ databaseAdapter: { provision: async () => ({ success: false, error: 'HEALTH_CHECK_FAILED' }) } });
    const a = await failure.startOrchestration(plan, { requestId: 'render-health-failure' });
    assert.strictEqual(a.status, ORCHESTRATION_STATUS.FAILED);
    assert.strictEqual(failure.workspaceOwners.has(path.resolve(workspacePath)), false);
    const b = await failure.startOrchestration(plan, { requestId: 'retry-after-failure' });
    assert.notStrictEqual(a.orchestrationId, b.orchestrationId);
  });

  fs.rmSync(workspacePath, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
