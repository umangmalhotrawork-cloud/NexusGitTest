/**
 * NEXUS DEPLOYMENT — REMOTE REPOSITORY PREFLIGHT TEST SUITE (Phase 4D)
 * 
 * Verifies that deployments fail-closed and block cloud resource creation when
 * the selected service/rootDir does not exist in the remote Git repository branch.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { RemoteRepositoryPreflight } = require('./intelligence/deployment/preflight/RemoteRepositoryPreflight');
const { DeploymentPlanGenerator } = require('./intelligence/deployment/planning/DeploymentPlanGenerator');
const { DeploymentOrchestrator } = require('./intelligence/deployment/orchestration/DeploymentOrchestrator');
const RenderDeployAdapter = require('./intelligence/deployment/execution/providers/RenderDeployAdapter');
const VercelDeployAdapter = require('./intelligence/deployment/execution/providers/VercelDeployAdapter');
const { deploymentFailureDiagnoser } = require('./intelligence/deployment/diagnostics/DeploymentFailureDiagnoser');

async function runTests() {
  console.log('======================================================');
  console.log('   NEXUS REMOTE REPOSITORY PREFLIGHT TESTS (Phase 4D) ');
  console.log('======================================================\n');

  let passed = 0;

  // TEST 1: Remote rootDir exists -> Preflight passes
  {
    const mockExec = (cmd) => {
      if (cmd.includes('ls-tree') || cmd.includes('ls-remote')) {
        return '040000 tree 8f6003f69e02dc016a78010f8f8bf271d3431525\tbackend\n';
      }
      return '';
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git', branch: 'main' },
    });

    assert.strictEqual(res.valid, true, 'Test 1 Failed: Valid remote path should pass preflight');
    console.log('✓ Test 1: Remote rootDir exists -> preflight passes');
    passed++;
  }

  // TEST 2: Remote rootDir missing -> Returns PROVIDER_REPOSITORY_CONTENT_MISSING blocker
  {
    const mockExec = (cmd) => {
      // Simulate empty output (not in remote branch) and empty in HEAD (untracked)
      return '';
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git', branch: 'main' },
    });

    assert.strictEqual(res.valid, false, 'Test 2 Failed: Missing remote path must fail preflight');
    assert.strictEqual(res.code, 'PROVIDER_REPOSITORY_CONTENT_MISSING', 'Test 2 Failed: Error code must be PROVIDER_REPOSITORY_CONTENT_MISSING');
    assert(res.reason && res.reason.includes('untracked/uncommitted'), 'Test 2 Failed: Must explain local untracked reason');
    assert(res.suggestedFix && res.suggestedFix.includes('Commit and push'), 'Test 2 Failed: Must provide suggested fix');
    assert(res.message && res.message.includes('Local workspace differs from remote repository'), 'Test 2 Failed: Message must state workspace differs from remote');
    console.log('✓ Test 2: Remote rootDir missing -> returns PROVIDER_REPOSITORY_CONTENT_MISSING');
    passed++;
  }

  // TEST 3: Wrong or non-existent remote branch -> Deployment blocked
  {
    const mockExec = (cmd) => {
      throw new Error("fatal: Not a valid object name origin/non-existent-branch");
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git', branch: 'non-existent-branch' },
    });

    assert.strictEqual(res.valid, false, 'Test 3 Failed: Non-existent branch must fail preflight');
    assert.strictEqual(res.code, 'PROVIDER_REPOSITORY_CONTENT_MISSING');
    assert(res.reason && res.reason.includes('does not exist'), 'Test 3 Failed: Must explain branch does not exist');
    console.log('✓ Test 3: Wrong remote branch -> deployment blocked');
    passed++;
  }

  // TEST 4: Real fixture inspection -> Detects nested workspace as DEPLOYMENT_SOURCE_UNCONFIGURED
  {
    const preflight = new RemoteRepositoryPreflight();
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
    });

    assert.strictEqual(res.valid, false, 'Test 4 Failed: Nested workspace must fail preflight without explicit configuration');
    assert.strictEqual(res.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
    assert.strictEqual(res.parentRepoName, 'Nexus');
    console.log('✓ Test 4: Real nested fixture -> detected as DEPLOYMENT_SOURCE_UNCONFIGURED with parent repo Nexus');
    passed++;
  }

  // TEST 5: DeploymentPlanGenerator marks plan BLOCKED and attaches remotePreflight
  {
    const planGen = new DeploymentPlanGenerator();
    const plan = planGen.generatePlan(path.resolve('demo-workspaces/nexus-fullstack-deployment-test'), {
      userSelections: { svc_frontend: 'vercel', svc_backend: 'render' },
    });

    assert.strictEqual(plan.overallStatus, 'BLOCKED', 'Test 5 Failed: Plan must be marked BLOCKED');
    assert(plan.remotePreflight && !plan.remotePreflight.valid, 'Test 5 Failed: Plan must include remotePreflight payload');
    assert.strictEqual(plan.remotePreflight.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
    console.log('✓ Test 5: DeploymentPlanGenerator marks plan BLOCKED with DEPLOYMENT_SOURCE_UNCONFIGURED payload');
    passed++;
  }

  // TEST 6: RenderDeployAdapter throws RENDER_REPOSITORY_REQUIRED without explicit repo
  {
    const adapter = new RenderDeployAdapter();
    let threw = false;
    try {
      adapter.prepareServicePayload(
        {
          workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
          rootDir: 'backend',
          allowMockRepo: false,
        },
        'usr-test-123'
      );
    } catch (err) {
      threw = true;
      assert(err.message.includes('RENDER_REPOSITORY_REQUIRED') || err.message.includes('PROVIDER_REPOSITORY_CONTENT_MISSING'), `Test 6 Failed: Error must include RENDER_REPOSITORY_REQUIRED but got: ${err.message}`);
    }
    assert.strictEqual(threw, true, 'Test 6 Failed: RenderDeployAdapter must throw before payload creation');
    console.log('✓ Test 6: RenderDeployAdapter throws before payload creation without explicit repo');
    passed++;
  }

  // TEST 7: DeploymentOrchestrator fails preflight and halts before database or cloud provisioning
  {
    let dbProvisionCalled = false;
    let apiCallMade = false;

    const mockDbAdapter = {
      provisionDatabase: async () => {
        dbProvisionCalled = true;
        return { status: 'SUCCESS' };
      },
    };

    const mockFetch = async () => {
      apiCallMade = true;
      return { ok: true, json: async () => ({}) };
    };

    const mockCredentialStore = {
      getAuthStatus: () => ({ isConnected: true }),
      getCredential: () => ({ apiKey: 'mock-key' }),
    };

    const orchestrator = new DeploymentOrchestrator({
      credentialStore: mockCredentialStore,
      databaseAdapter: mockDbAdapter,
    });

    const planGen = new DeploymentPlanGenerator();
    const plan = planGen.generatePlan(path.resolve('demo-workspaces/nexus-fullstack-deployment-test'), {
      userSelections: { svc_frontend: 'vercel', svc_backend: 'render' },
    });

    const events = [];
    const result = await orchestrator.startOrchestration(
      plan,
      { fetchFn: mockFetch },
      (eventType, data) => events.push({ eventType, data })
    );

    assert.strictEqual(result.status, 'FAILED', 'Test 7 Failed: Orchestration status must be FAILED');
    assert.strictEqual(result.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED', 'Test 7 Failed: Code must be DEPLOYMENT_SOURCE_UNCONFIGURED');
    assert.strictEqual(dbProvisionCalled, false, 'Test 7 Failed: Database provisioning must NOT be called when preflight fails');
    assert.strictEqual(apiCallMade, false, 'Test 7 Failed: Cloud API calls must NOT be made when preflight fails');
    console.log('✓ Test 7: DeploymentOrchestrator blocks orchestration before DB or cloud provisioning');
    passed++;
  }

  // TEST 8: DeploymentFailureDiagnoser classifies PROVIDER_REPOSITORY_CONTENT_MISSING with HIGH confidence
  {
    const diag = deploymentFailureDiagnoser.diagnoseFailure({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      providerId: 'render',
      error: 'PROVIDER_REPOSITORY_CONTENT_MISSING: Local workspace differs from remote repository (demo-workspaces/nexus-fullstack-deployment-test/backend not found in remote branch).',
      logs: ['Local workspace differs from remote repository: Directory demo-workspaces/nexus-fullstack-deployment-test/backend does not exist in remote branch milestone-11-navigation-search.'],
    });

    assert.strictEqual(diag.failureCategory, 'PROVIDER_CONFIGURATION_ERROR', 'Test 8 Failed: Category must be PROVIDER_CONFIGURATION_ERROR');
    assert.strictEqual(diag.confidence, 'HIGH', 'Test 8 Failed: Confidence must be HIGH');
    assert(diag.likelyRootCause.includes('remote Git repository'), 'Test 8 Failed: Root cause must mention remote Git repository');
    assert(diag.suggestedFix.includes('Commit and push'), 'Test 8 Failed: Suggested fix must provide actionable guidance');
    console.log('✓ Test 8: DeploymentFailureDiagnoser correctly classifies remote content mismatch with HIGH confidence');
    passed++;
  }

  // TEST 9: allowMockRepo bypass works for isolated synthetic unit tests
  {
    const preflight = new RemoteRepositoryPreflight();
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { allowMockRepo: true },
    });

    assert.strictEqual(res.valid, true, 'Test 9 Failed: allowMockRepo should bypass remote check');
    assert.strictEqual(res.skipped, true);
    console.log('✓ Test 9: allowMockRepo option safely bypasses remote check in isolated mocks');
    passed++;
  }

  // TEST 10: Returns isCommittedLocally and uncommittedFiles array
  {
    const mockExec = (cmd) => {
      if (cmd.includes('ls-tree') && cmd.includes('origin')) {
        return ''; // Missing remotely
      }
      if (cmd.includes('ls-tree') && cmd.includes('HEAD')) {
        return '040000 tree abc123def\tbackend\n'; // Committed in local HEAD
      }
      if (cmd.includes('status --porcelain')) {
        return ' M backend/server.js\n?? backend/new-file.js\n';
      }
      if (cmd.includes('ls-remote')) {
        return 'abc123def\trefs/heads/main\n';
      }
      return '';
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git', branch: 'main' },
    });

    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.isCommittedLocally, true, 'Must detect local commit');
    assert(Array.isArray(res.uncommittedFiles), 'Must provide uncommittedFiles array');
    assert.strictEqual(res.uncommittedFiles.length, 2);
    assert(res.suggestedFix.includes('Push your local commit'), 'Suggested fix should recommend pushing local commit');
    console.log('✓ Test 10: Detects isCommittedLocally: true and extracts uncommittedFiles array');
    passed++;
  }

  // TEST 11: Untracked files suggest committing and pushing
  {
    const mockExec = (cmd) => {
      if (cmd.includes('ls-remote')) return 'abc123def\trefs/heads/main\n';
      if (cmd.includes('ls-tree origin')) return '';
      if (cmd.includes('ls-tree HEAD')) return '';
      if (cmd.includes('status --porcelain')) return '?? backend/server.js\n';
      return '';
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: path.resolve('demo-workspaces/nexus-fullstack-deployment-test'),
      serviceTarget: { rootDir: 'backend', selectedProvider: 'render' },
      options: { repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git', branch: 'main' },
    });

    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.isCommittedLocally, false);
    assert(res.suggestedFix.includes('Commit and push'), 'Suggested fix should recommend committing and pushing');
    console.log('✓ Test 11: Untracked local files correctly suggest committing and pushing');
    passed++;
  }

  console.log(`\n======================================================`);
  console.log(`SUMMARY: ${passed} / 11 tests passed (0 failed)`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test runner failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
