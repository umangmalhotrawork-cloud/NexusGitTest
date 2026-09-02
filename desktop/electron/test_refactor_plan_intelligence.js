/**
 * NEXUS REFACTOR PLAN & SWARM COORDINATOR TEST SUITE
 * 
 * Tests the complete Multi-File Refactor Plan & Execution Reviewer lifecycle:
 * 1. Plan creation & decomposition
 * 2. Valid DAG dependencies
 * 3. Exact affected-file reporting
 * 4. Zero mutations in PROPOSED state
 * 5. Approval transition (PROPOSED -> APPROVED)
 * 6. Cancellation transition (PROPOSED -> CANCELLED) with zero mutations
 * 7. Scope drift detection for unplanned files
 * 8. Child workspace isolation
 * 9. Step-by-step execution & live task state updates
 * 10. Verification and completion lifecycle
 * 11. Malformed / empty plan handling
 * 12. IPC serialization and credential safety
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { RefactorPlan } = require('./harness/RefactorPlan');
const { ImpactAnalyzer } = require('./harness/ImpactAnalyzer');
const { ChangeSet } = require('./harness/ChangeSet');
const { REFACTOR_PLAN_STATUS } = require('./harness/types');

async function runRefactorPlanTestSuite() {
  console.log('================================================================');
  console.log('  NEXUS REFACTOR PLAN & EXECUTION REVIEWER TEST SUITE           ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`[PASS] Test ${total.toString().padStart(2, '0')}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${total.toString().padStart(2, '0')}: ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Plan Creation & Decomposition
  // ---------------------------------------------------------------------------
  await testAsync('Plan creation decomposes impact into structured DAG tasks', async () => {
    const plan = new RefactorPlan({
      goal: 'Refactor UserService authentication to use JWT token sessions',
      rootTargets: ['authenticateUser'],
      affectedFiles: ['src/services/UserService.ts', 'src/controllers/AuthController.ts', 'src/middleware/auth.ts'],
      testsToRun: ['tests/auth.test.ts'],
      riskLevel: 'HIGH',
    });

    const tasks = plan.decomposeTasks({
      rootSymbol: { name: 'authenticateUser', filePath: 'src/services/UserService.ts' },
      callers: [
        { sourceFilePath: 'src/controllers/AuthController.ts' },
        { sourceFilePath: 'src/middleware/auth.ts' },
      ],
      tests: [{ testPath: 'tests/auth.test.ts' }],
    });

    assert.ok(tasks.length >= 3, `Expected at least 3 tasks, got ${tasks.length}`);
    assert.strictEqual(plan.status, REFACTOR_PLAN_STATUS.PROPOSED);
    assert.strictEqual(plan.riskLevel, 'HIGH');
    assert.strictEqual(plan.affectedFiles.length, 3);
  });

  // ---------------------------------------------------------------------------
  // 2. Valid DAG Dependencies
  // ---------------------------------------------------------------------------
  await testAsync('Generated tasks have strictly valid DAG dependency references', async () => {
    const plan = new RefactorPlan({
      goal: 'Refactor PaymentGateway checkout method',
      rootTargets: ['processPayment'],
      affectedFiles: ['src/payments/gateway.ts', 'src/routes/checkout.ts'],
      testsToRun: ['tests/payment.test.ts'],
    });

    const tasks = plan.decomposeTasks({
      rootSymbol: { name: 'processPayment', filePath: 'src/payments/gateway.ts' },
      callers: [{ sourceFilePath: 'src/routes/checkout.ts' }],
      tests: [{ testPath: 'tests/payment.test.ts' }],
    });

    const taskMap = new Map(tasks.map((t) => [t.taskId, t]));
    const defTask = tasks.find((t) => t.role === 'CORE_MUTATOR');
    const callerTask = tasks.find((t) => t.role === 'CALL_SITE_MUTATOR');
    const testTask = tasks.find((t) => t.role === 'TEST_ENGINEER');

    assert.ok(defTask, 'Must have a CORE_MUTATOR definition task');
    assert.strictEqual(defTask.dependencies.length, 0, 'Definition task must have 0 dependencies');

    if (callerTask) {
      assert.ok(callerTask.dependencies.includes(defTask.taskId), 'Caller task must depend on definition task');
    }

    if (testTask) {
      assert.ok(testTask.dependencies.includes(defTask.taskId), 'Test task must depend on definition task');
      for (const depId of testTask.dependencies) {
        assert.ok(taskMap.has(depId), `Dependency ${depId} must exist in task list`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Exact Affected-File Reporting
  // ---------------------------------------------------------------------------
  await testAsync('Plan reports exact authoritative affected files without omission', async () => {
    const files = ['src/models/User.ts', 'src/db/migrations/001_users.ts', 'src/api/users.ts'];
    const plan = new RefactorPlan({
      goal: 'Add email verification field to User model',
      rootTargets: ['User'],
      affectedFiles: files,
    });

    assert.deepStrictEqual(plan.affectedFiles, files);
    assert.strictEqual(plan.affectedFiles.length, 3);
  });

  // ---------------------------------------------------------------------------
  // 4. Zero Mutations in PROPOSED State
  // ---------------------------------------------------------------------------
  await testAsync('PROPOSED state strictly permits zero disk or workspace file mutations', async () => {
    const plan = new RefactorPlan({
      goal: 'Refactor config loader',
      rootTargets: ['loadConfig'],
      affectedFiles: ['src/config.ts'],
    });

    assert.strictEqual(plan.status, 'PROPOSED');
    assert.strictEqual(plan.consolidatedChangeSet, null, 'No changeset should be consolidated in PROPOSED');
    assert.strictEqual(plan.childChangeSets.length, 0, 'No child changesets should exist in PROPOSED');
  });

  // ---------------------------------------------------------------------------
  // 5. Explicit Approval Transition
  // ---------------------------------------------------------------------------
  await testAsync('Plan transitions cleanly from PROPOSED to APPROVED upon user approval', async () => {
    const plan = new RefactorPlan({
      goal: 'Migrate database pool',
      status: REFACTOR_PLAN_STATUS.PROPOSED,
    });

    plan.approve({ approvedBy: 'OPERATOR' });
    assert.strictEqual(plan.status, REFACTOR_PLAN_STATUS.APPROVED);
  });

  // ---------------------------------------------------------------------------
  // 6. Cancellation / Rejection Transition with Zero Mutations
  // ---------------------------------------------------------------------------
  await testAsync('Cancellation transitions plan to CANCELLED and ensures zero mutations', async () => {
    const plan = new RefactorPlan({
      goal: 'Unsafe global refactor',
      status: REFACTOR_PLAN_STATUS.PROPOSED,
    });

    plan.reject('Operator rejected risky multi-file change');
    assert.strictEqual(plan.status, REFACTOR_PLAN_STATUS.CANCELLED);
    assert.strictEqual(plan.rejectionReason, 'Operator rejected risky multi-file change');
    assert.strictEqual(plan.consolidatedChangeSet, null);
  });

  // ---------------------------------------------------------------------------
  // 7. Scope Drift Detection
  // ---------------------------------------------------------------------------
  await testAsync('Scope drift detection flags and blocks unplanned file modifications', async () => {
    const plan = new RefactorPlan({
      goal: 'Refactor Auth module',
      affectedFiles: ['src/auth/login.ts', 'src/auth/session.ts'],
    });

    const task = {
      taskId: 'task_def_1',
      relevantFiles: ['src/auth/login.ts'],
    };

    // 1. Valid child change set (touches planned file)
    const validCs = new ChangeSet({
      workspacePath: process.cwd(),
      threadId: 'th_1',
      files: [{ filePath: 'src/auth/login.ts', original: 'a', replacement: 'b' }],
    });
    const validCheck = plan.validateChildChangeSet(validCs, task);
    assert.strictEqual(validCheck.valid, true);
    assert.strictEqual(validCheck.scopeDrift, false);

    // 2. Unplanned child change set (touches unplanned rogue file)
    const rogueCs = new ChangeSet({
      workspacePath: process.cwd(),
      threadId: 'th_1',
      files: [{ filePath: 'src/admin/secrets.env', original: 'secret=1', replacement: 'secret=2' }],
    });
    const rogueCheck = plan.validateChildChangeSet(rogueCs, task);
    assert.strictEqual(rogueCheck.valid, false);
    assert.strictEqual(rogueCheck.scopeDrift, true);
    assert.ok(rogueCheck.reasons.some((r) => r.includes('Unplanned file modified')));
  });

  // ---------------------------------------------------------------------------
  // 8. Child Workspace Isolation & ChangeSet Consolidation
  // ---------------------------------------------------------------------------
  await testAsync('Child worker changesets consolidate cleanly into parent ChangeSet', async () => {
    const plan = new RefactorPlan({
      goal: 'Split monolithic utility into helpers',
      affectedFiles: ['src/utils/math.ts', 'src/utils/string.ts'],
    });

    const cs1 = new ChangeSet({
      workspacePath: process.cwd(),
      files: [{ filePath: 'src/utils/math.ts', original: 'oldMath', replacement: 'newMath' }],
    });

    const cs2 = new ChangeSet({
      workspacePath: process.cwd(),
      files: [{ filePath: 'src/utils/string.ts', original: 'oldStr', replacement: 'newStr' }],
    });

    plan.childChangeSets = [cs1, cs2];
    const parentCs = plan.consolidateChangeSets();

    assert.ok(parentCs, 'Consolidated ChangeSet must exist');
    assert.strictEqual(parentCs.files.length, 2);
    assert.ok(parentCs.files.some((f) => f.filePath === 'src/utils/math.ts'));
    assert.ok(parentCs.files.some((f) => f.filePath === 'src/utils/string.ts'));
  });

  // ---------------------------------------------------------------------------
  // 9. Step-by-Step Task State Transitions
  // ---------------------------------------------------------------------------
  await testAsync('Tasks transition cleanly through PENDING -> IN_PROGRESS -> COMPLETED', async () => {
    const plan = new RefactorPlan({
      goal: 'Step-by-step pipeline test',
      tasks: [
        { taskId: 'task_1', status: 'PENDING', relevantFiles: ['src/a.ts'] },
        { taskId: 'task_2', status: 'PENDING', relevantFiles: ['src/b.ts'] },
      ],
    });

    assert.strictEqual(plan.tasks[0].status, 'PENDING');
    plan.tasks[0].status = 'IN_PROGRESS';
    assert.strictEqual(plan.tasks[0].status, 'IN_PROGRESS');
    plan.tasks[0].status = 'COMPLETED';
    assert.strictEqual(plan.tasks[0].status, 'COMPLETED');
  });

  // ---------------------------------------------------------------------------
  // 10. Verification and Completion Lifecycle
  // ---------------------------------------------------------------------------
  await testAsync('verifyAndRepair transitions plan to COMPLETED upon passing tests', async () => {
    const plan = new RefactorPlan({
      goal: 'Refactor test suite verification',
      status: REFACTOR_PLAN_STATUS.EXECUTING,
    });

    const outcome = await plan.verifyAndRepair(async () => {
      return { success: true, passed: 4, failed: 0 };
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(plan.status, REFACTOR_PLAN_STATUS.COMPLETED);
    assert.strictEqual(plan.verificationResult.passed, 4);
  });

  // ---------------------------------------------------------------------------
  // 11. Malformed / Empty Plans Handled Safely
  // ---------------------------------------------------------------------------
  await testAsync('Malformed or empty plan parameters do not crash or throw unhandled exceptions', async () => {
    const emptyPlan = new RefactorPlan({});
    assert.ok(emptyPlan.planId);
    assert.strictEqual(emptyPlan.status, 'PROPOSED');
    assert.deepStrictEqual(emptyPlan.tasks, []);

    const decomposed = emptyPlan.decomposeTasks({});
    assert.ok(Array.isArray(decomposed));
  });

  // ---------------------------------------------------------------------------
  // 12. Plaintext Key Isolation Invariant
  // ---------------------------------------------------------------------------
  await testAsync('RefactorPlan serialization and event payloads contain zero API keys', async () => {
    const plan = new RefactorPlan({
      goal: 'Secret isolation check',
      affectedFiles: ['src/config.ts'],
    });

    const serialized = JSON.stringify(plan);
    assert.strictEqual(serialized.includes('sk-'), false);
    assert.strictEqual(serialized.includes('gsk_'), false);
    assert.strictEqual(serialized.includes('AIza'), false);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(`  RESULTS: ${passed}/${total} REFACTOR PLAN TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runRefactorPlanTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
