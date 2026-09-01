/**
 * NEXUS DEPLOYMENT — REPOSITORY SELECTION PERSISTENCE & REFRESH E2E TEST SUITE
 *
 * Verifies that explicit Git repository selection persists properly,
 * overrides parent Git detection, updates executionSource to GIT_REMOTE,
 * performs remote preflight against the target repository, and refreshes the plan.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { RemoteRepositoryPreflight, REPOSITORY_SOURCE, EXECUTION_SOURCE } = require('./intelligence/deployment/preflight/RemoteRepositoryPreflight');
const { DeploymentSelectionStore } = require('./intelligence/deployment/persistence/DeploymentSelectionStore');
const { DeploymentPlanGenerator } = require('./intelligence/deployment/planning/DeploymentPlanGenerator');
const { DeploymentInspector } = require('./intelligence/deployment/DeploymentInspector');

function runAsyncTest(name, fn) {
  return fn()
    .then(() => {
      console.log(`  ✓ ${name}`);
      return true;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      if (err.stack) {
        console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      }
      return false;
    });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  REPOSITORY SELECTION PERSISTENCE & REFRESH E2E TEST');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-repo-persist-'));
  const parentRepo = path.join(tmpBase, 'NexusParent');
  const parentGit = path.join(parentRepo, '.git');
  fs.mkdirSync(parentGit, { recursive: true });
  fs.writeFileSync(
    path.join(parentGit, 'config'),
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/umangmalhotrawork-cloud/Nexus.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n'
  );
  fs.writeFileSync(path.join(parentGit, 'HEAD'), 'ref: refs/heads/main\n');

  const nestedWs = path.join(parentRepo, 'demo-workspaces', 'nexus-fullstack-deployment-test');
  const frontendDir = path.join(nestedWs, 'frontend');
  const backendDir = path.join(nestedWs, 'backend');
  fs.mkdirSync(path.join(frontendDir, 'src'), { recursive: true });
  fs.mkdirSync(backendDir, { recursive: true });
  fs.writeFileSync(path.join(frontendDir, 'package.json'), JSON.stringify({ name: 'fe', scripts: { build: 'vite build', start: 'vite preview' }, dependencies: { react: '^18.0.0' } }));
  fs.writeFileSync(path.join(frontendDir, 'index.html'), '<html><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(frontendDir, 'src', 'App.jsx'), 'export default function App() { return <div>App</div>; }');
  fs.writeFileSync(path.join(backendDir, 'package.json'), JSON.stringify({ name: 'be', scripts: { start: 'node server.js' }, dependencies: { express: '^4.18.0' } }));
  fs.writeFileSync(path.join(backendDir, 'server.js'), 'const express = require("express"); const app = express(); app.listen(5000);');

  const customStoreFile = path.join(tmpBase, 'test_selections_store.json');

  // TEST 1: Initial unconfigured state
  const t1 = await runAsyncTest('Test 1: Unconfigured nested workspace defaults to UNCONFIGURED and PARENT_GIT', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const preflight = new RemoteRepositoryPreflight();
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });

    const plan = generator.generatePlan(nestedWs);
    assert.strictEqual(plan.executionSource, 'UNCONFIGURED');
    assert.strictEqual(plan.deploymentRepositoryContext.repositorySource, 'PARENT_GIT');
    assert.strictEqual(plan.overallStatus, 'BLOCKED');
    assert.strictEqual(plan.remotePreflight.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
  });
  if (t1) passed++; else failed++;

  // TEST 2: Apply explicit repository selection saves to store with correct casing
  const t2 = await runAsyncTest('Test 2: SelectionStore preserves casing for repositoryUrl, branch, rootDir, and executionSource', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const saved = store.saveWorkspaceSelections(nestedWs, {
      svc_frontend: 'vercel',
      svc_backend: 'render',
      executionSource: 'GIT_REMOTE',
      repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
      rootDir: 'demo-workspaces/nexus-fullstack-deployment-test',
    });

    assert.ok(saved, 'Must return saved record');
    assert.strictEqual(saved.selections.executionSource, 'GIT_REMOTE');
    assert.strictEqual(saved.selections.repository, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(saved.selections.branch, 'milestone-11-navigation-search');
    assert.strictEqual(saved.selections.rootDir, 'demo-workspaces/nexus-fullstack-deployment-test');
    assert.strictEqual(saved.selections.svc_frontend, 'vercel');
    assert.strictEqual(saved.selections.svc_backend, 'render');
  });
  if (t2) passed++; else failed++;

  // TEST 3: Fresh DeploymentPlanGenerator loads persisted selection
  const t3 = await runAsyncTest('Test 3: Fresh DeploymentPlanGenerator loads persisted repository selection from store', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const mockExec = (cmd) => {
      if (cmd.includes('ls-tree') || cmd.includes('rev-parse')) {
        return '040000 tree 5df680a126acbe0a7667dce4ae038f93c1a0304a\tdemo-workspaces/nexus-fullstack-deployment-test/frontend\n';
      }
      return '';
    };
    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });

    const plan = generator.generatePlan(nestedWs);
    assert.strictEqual(plan.executionSource, 'GIT_REMOTE');
    assert.strictEqual(plan.deploymentRepositoryContext.repositorySource, 'EXPLICIT_PROVIDER_REPOSITORY');
    assert.strictEqual(plan.deploymentRepositoryContext.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(plan.deploymentRepositoryContext.branch, 'milestone-11-navigation-search');
    assert.strictEqual(plan.deploymentRepositoryContext.projectRoot, 'demo-workspaces/nexus-fullstack-deployment-test');
  });
  if (t3) passed++; else failed++;

  // TEST 4: EXPLICIT_PROVIDER_REPOSITORY overrides PARENT_GIT
  const t4 = await runAsyncTest('Test 4: EXPLICIT_PROVIDER_REPOSITORY overrides PARENT_GIT detection entirely', async () => {
    const preflight = new RemoteRepositoryPreflight();
    const ctx = preflight.resolveDeploymentRepositoryContext(nestedWs, {
      repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
      rootDir: 'demo-workspaces/nexus-fullstack-deployment-test',
    });

    assert.strictEqual(ctx.repositorySource, 'EXPLICIT_PROVIDER_REPOSITORY');
    assert.strictEqual(ctx.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(ctx.isNestedInParentRepo, false);
    assert.strictEqual(ctx.parentGitRoot, null);
  });
  if (t4) passed++; else failed++;

  // TEST 5: resolveServiceRootDir constructs exact repository root path
  const t5 = await runAsyncTest('Test 5: resolveServiceRootDir resolves relative service path inside explicit rootDir', async () => {
    const preflight = new RemoteRepositoryPreflight();
    const fePath = preflight.resolveServiceRootDir(nestedWs, { rootDir: 'frontend' }, { rootDir: 'demo-workspaces/nexus-fullstack-deployment-test' });
    const bePath = preflight.resolveServiceRootDir(nestedWs, { rootDir: 'backend' }, { rootDir: 'demo-workspaces/nexus-fullstack-deployment-test' });

    assert.strictEqual(fePath, 'demo-workspaces/nexus-fullstack-deployment-test/frontend');
    assert.strictEqual(bePath, 'demo-workspaces/nexus-fullstack-deployment-test/backend');
  });
  if (t5) passed++; else failed++;

  // TEST 6: Remote preflight passes when directory exists in target remote branch
  const t6 = await runAsyncTest('Test 6: Remote preflight passes when directory exists in target remote branch', async () => {
    const mockExec = (cmd) => {
      if (cmd.includes('ls-tree')) {
        return '040000 tree abc123\tdemo-workspaces/nexus-fullstack-deployment-test/frontend\n';
      }
      return '';
    };
    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const res = preflight.verifyService({
      workspacePath: nestedWs,
      serviceTarget: { rootDir: 'frontend', selectedProvider: 'render' },
      options: {
        repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
        branch: 'milestone-11-navigation-search',
        rootDir: 'demo-workspaces/nexus-fullstack-deployment-test',
        executionSource: 'GIT_REMOTE',
      },
    });

    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.repository, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(res.branch, 'milestone-11-navigation-search');
    assert.strictEqual(res.requestedRootDir, 'demo-workspaces/nexus-fullstack-deployment-test/frontend');
  });
  if (t6) passed++; else failed++;

  // TEST 7: Deployment Plan reaches READY status when preflight passes
  const t7 = await runAsyncTest('Test 7: Deployment Plan reaches READY status with all providers executable and preflight passing', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const mockExec = (cmd) => {
      if (cmd.includes('ls-tree') || cmd.includes('rev-parse')) {
        return '040000 tree 5df680a126acbe0a7667dce4ae038f93c1a0304a\tdemo-workspaces/nexus-fullstack-deployment-test/backend\n';
      }
      return '';
    };
    const preflight = new RemoteRepositoryPreflight({ execFn: mockExec });
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });

    const plan = generator.generatePlan(nestedWs);
    assert.strictEqual(plan.overallStatus, 'READY');
    assert.strictEqual(plan.executionSource, 'GIT_REMOTE');
    assert.strictEqual(plan.blockers.length, 0);
  });
  if (t7) passed++; else failed++;

  // TEST 8: Provider selections are preserved alongside repository context
  const t8 = await runAsyncTest('Test 8: User provider selections (Vercel + Render) remain preserved', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const preflight = new RemoteRepositoryPreflight({ execFn: () => '040000 tree abc123\tdir\n' });
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });

    const plan = generator.generatePlan(nestedWs);
    assert.ok(plan.topology.services.length >= 2, 'Must have at least 2 services detected');
    assert.strictEqual(plan.executionSource, 'GIT_REMOTE');
    assert.strictEqual(plan.deploymentRepositoryContext.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    
    // Stored user selections contain our provider choices
    const stored = store.getWorkspaceSelections(nestedWs);
    assert.strictEqual(stored.selections.svc_frontend, 'vercel');
    assert.strictEqual(stored.selections.svc_backend, 'render');
  });
  if (t8) passed++; else failed++;

  // TEST 9: DeploymentInspector inspectWorkspace loads persisted selections
  const t9 = await runAsyncTest('Test 9: DeploymentInspector loads persisted selections and attaches EXPLICIT_PROVIDER_REPOSITORY', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    const inspector = new DeploymentInspector({ selectionStore: store });

    const report = await inspector.inspectWorkspace(nestedWs);
    assert.ok(report.deploymentRepositoryContext);
    assert.strictEqual(report.deploymentRepositoryContext.repositorySource, 'EXPLICIT_PROVIDER_REPOSITORY');
    assert.strictEqual(report.deploymentRepositoryContext.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(report.deploymentRepositoryContext.branch, 'milestone-11-navigation-search');
  });
  if (t9) passed++; else failed++;

  // Clean up
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch (_) {}

  console.log(`\n======================================================`);
  console.log(`Repository Selection Persistence Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test suite runner failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
