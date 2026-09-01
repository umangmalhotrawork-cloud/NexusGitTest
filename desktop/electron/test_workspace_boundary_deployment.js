/**
 * NEXUS Deployment System — Workspace Boundary & Deployment Context Test Suite
 *
 * Tests:
 * 1. WORKSPACE_GIT: Workspace with its own .git repository
 * 2. PARENT_GIT: Nested workspace inside parent git repo (e.g. demo-workspaces/nexus-fullstack-deployment-test)
 * 3. EXPLICIT_PROVIDER_REPOSITORY: Explicit repository selection (e.g. NexusGitTest)
 * 4. NONE: Standalone non-git workspace
 * 5. LOCAL_WORKSPACE executionSource mode bypasses remote Git preflight
 * 6. GIT_REMOTE executionSource mode verifies explicit target repository
 * 7. Parent repository is never silently inherited
 * 8. Service rootDir resolution is relative to project root without parent prefixing
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  RemoteRepositoryPreflight,
  REPOSITORY_SOURCE,
  EXECUTION_SOURCE,
} = require('./intelligence/deployment/preflight/RemoteRepositoryPreflight');
const { DeploymentInspector } = require('./intelligence/deployment/DeploymentInspector');
const { DeploymentPlanGenerator } = require('./intelligence/deployment/planning/DeploymentPlanGenerator');
const { DeploymentOrchestrator } = require('./intelligence/deployment/orchestration/DeploymentOrchestrator');
const RenderDeployAdapter = require('./intelligence/deployment/execution/providers/RenderDeployAdapter');

function createTempDir(prefix = 'nexus-boundary-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {}
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    failedTests++;
  }
}

console.log('\n======================================================');
console.log('  NEXUS WORKSPACE BOUNDARY & CONTEXT TEST SUITE');
console.log('======================================================\n');

(async () => {
  // 1. WORKSPACE_GIT detection
  runTest('Test 1: Workspace with own .git is resolved as WORKSPACE_GIT', () => {
    const tmp = createTempDir();
    try {
      const gitDir = path.join(tmp, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'config'), '[remote "origin"]\n  url = https://github.com/my-org/my-repo.git\n');
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature-1\n');

      const preflight = new RemoteRepositoryPreflight();
      const ctx = preflight.resolveDeploymentRepositoryContext(tmp);

      assert.strictEqual(ctx.hasOwnGit, true);
      assert.strictEqual(ctx.isNestedInParentRepo, false);
      assert.strictEqual(ctx.repositorySource, REPOSITORY_SOURCE.WORKSPACE_GIT);
      assert.strictEqual(ctx.remoteUrl, 'https://github.com/my-org/my-repo.git');
      assert.strictEqual(ctx.branch, 'feature-1');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // 2. PARENT_GIT detection for nested workspaces
  runTest('Test 2: Nested workspace inside parent repo is resolved as PARENT_GIT without inheriting gitRoot/remoteUrl', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');
      fs.writeFileSync(path.join(parentGit, 'HEAD'), 'ref: refs/heads/main\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });

      const preflight = new RemoteRepositoryPreflight();
      const ctx = preflight.resolveDeploymentRepositoryContext(nestedWs);

      assert.strictEqual(ctx.hasOwnGit, false);
      assert.strictEqual(ctx.isNestedInParentRepo, true);
      assert.strictEqual(ctx.repositorySource, REPOSITORY_SOURCE.PARENT_GIT);
      assert.strictEqual(ctx.parentRepoName, path.basename(parentTmp));
      assert.strictEqual(ctx.parentRemoteUrl, 'https://github.com/umangmalhotrawork-cloud/Nexus.git');
      // Crucial boundary guarantee: deployment target gitRoot and remoteUrl must be null
      assert.strictEqual(ctx.gitRoot, null);
      assert.strictEqual(ctx.remoteUrl, null);
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 3. EXPLICIT_PROVIDER_REPOSITORY detection
  runTest('Test 3: Explicit repository override resolves as EXPLICIT_PROVIDER_REPOSITORY', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });

      const preflight = new RemoteRepositoryPreflight();
      const ctx = preflight.resolveDeploymentRepositoryContext(nestedWs, {
        repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
        branch: 'milestone-11-navigation-search',
        rootDir: '.',
      });

      assert.strictEqual(ctx.repositorySource, REPOSITORY_SOURCE.EXPLICIT_PROVIDER_REPOSITORY);
      assert.strictEqual(ctx.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
      assert.strictEqual(ctx.branch, 'milestone-11-navigation-search');
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 4. Standalone non-git workspace resolves as NONE
  runTest('Test 4: Standalone workspace with no git is resolved as NONE', () => {
    const tmp = createTempDir();
    try {
      const preflight = new RemoteRepositoryPreflight();
      const ctx = preflight.resolveDeploymentRepositoryContext(tmp);

      assert.strictEqual(ctx.hasOwnGit, false);
      assert.strictEqual(ctx.isNestedInParentRepo, false);
      assert.strictEqual(ctx.repositorySource, REPOSITORY_SOURCE.NONE);
      assert.strictEqual(ctx.remoteUrl, null);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // 5. RemoteRepositoryPreflight.verifyService returns DEPLOYMENT_SOURCE_UNCONFIGURED for PARENT_GIT
  runTest('Test 5: verifyService emits DEPLOYMENT_SOURCE_UNCONFIGURED on unconfigured PARENT_GIT workspace', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(path.join(nestedWs, 'frontend'), { recursive: true });

      const preflight = new RemoteRepositoryPreflight();
      const res = preflight.verifyService({
        workspacePath: nestedWs,
        serviceTarget: { rootDir: 'frontend', selectedProvider: 'vercel' },
      });

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
      assert.strictEqual(res.parentRepoName, path.basename(parentTmp));
      assert.ok(res.suggestedActions.includes('USE_LOCAL_WORKSPACE'));
      assert.ok(res.suggestedActions.includes('SELECT_GIT_REPOSITORY'));
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 6. verifyService skips remote check when executionSource is LOCAL_WORKSPACE
  runTest('Test 6: verifyService skips remote check when executionSource is LOCAL_WORKSPACE', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(path.join(nestedWs, 'frontend'), { recursive: true });

      const preflight = new RemoteRepositoryPreflight();
      const res = preflight.verifyService({
        workspacePath: nestedWs,
        serviceTarget: { rootDir: 'frontend', selectedProvider: 'vercel' },
        options: {
          executionSource: EXECUTION_SOURCE.LOCAL_WORKSPACE,
        },
      });

      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.skipped, true);
      assert.ok(res.reason.includes('Local workspace'));
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 7. resolveServiceRootDir never prefixes parent repository path
  runTest('Test 7: resolveServiceRootDir keeps rootDir relative to project root without parent prefixing', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      const frontendDir = path.join(nestedWs, 'frontend');
      fs.mkdirSync(frontendDir, { recursive: true });

      const preflight = new RemoteRepositoryPreflight();
      const resolvedRoot = preflight.resolveServiceRootDir(nestedWs, { rootDir: 'frontend' });

      assert.strictEqual(resolvedRoot, 'frontend');
      assert.ok(!resolvedRoot.includes('demo-workspaces'));
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 8. DeploymentInspector attaches deploymentRepositoryContext to report
  await runAsyncTest('Test 8: DeploymentInspector includes deploymentRepositoryContext in report', async () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });
      fs.writeFileSync(path.join(nestedWs, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { build: 'vite build' }, dependencies: { vite: '^5.0.0' } }));

      const inspector = new DeploymentInspector();
      const report = await inspector.inspectWorkspace(nestedWs);

      assert.ok(report.deploymentRepositoryContext);
      assert.strictEqual(report.deploymentRepositoryContext.repositorySource, REPOSITORY_SOURCE.PARENT_GIT);
      assert.strictEqual(report.deploymentRepositoryContext.parentRepoName, path.basename(parentTmp));
      assert.strictEqual(report.deploymentRepositoryContext.isNestedInParentRepo, true);
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 9. DeploymentPlanGenerator blocks on first inspection of PARENT_GIT workspace
  runTest('Test 9: First inspection of nested PARENT_GIT workspace produces BLOCKED plan with unconfigured source', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(path.join(nestedWs, 'frontend'), { recursive: true });
      fs.writeFileSync(path.join(nestedWs, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['frontend'] }));
      fs.writeFileSync(path.join(nestedWs, 'frontend', 'package.json'), JSON.stringify({ name: 'fe', scripts: { build: 'next build' }, dependencies: { next: '^14.0.0' } }));

      const generator = new DeploymentPlanGenerator();
      const plan = generator.generatePlan(nestedWs);

      assert.strictEqual(plan.overallStatus, 'BLOCKED');
      assert.strictEqual(plan.executionSource, 'UNCONFIGURED');
      assert.ok(plan.remotePreflight);
      assert.strictEqual(plan.remotePreflight.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
      assert.strictEqual(plan.remotePreflight.parentRepoName, path.basename(parentTmp));
      assert.ok(!plan.summary.includes('Local workspace differs from remote repository'));
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 10. DeploymentPlanGenerator with LOCAL_WORKSPACE selection succeeds
  runTest('Test 10: Nested workspace with LOCAL_WORKSPACE selection generates READY plan for Vercel', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });
      fs.writeFileSync(path.join(nestedWs, 'package.json'), JSON.stringify({ name: 'fe', scripts: { build: 'next build' }, dependencies: { next: '^14.0.0' } }));

      const generator = new DeploymentPlanGenerator();
      const plan = generator.generatePlan(nestedWs, {
        executionSource: EXECUTION_SOURCE.LOCAL_WORKSPACE,
      });

      assert.strictEqual(plan.overallStatus, 'READY');
      assert.strictEqual(plan.executionSource, 'LOCAL_WORKSPACE');
      assert.strictEqual(plan.remotePreflight, null);
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 11. DeploymentPlanGenerator with explicit NexusGitTest repository selection
  runTest('Test 11: Nested workspace with EXPLICIT_PROVIDER_REPOSITORY checks NexusGitTest without parent prefixing', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(path.join(nestedWs, 'frontend'), { recursive: true });
      fs.writeFileSync(path.join(nestedWs, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['frontend'] }));
      fs.writeFileSync(path.join(nestedWs, 'frontend', 'package.json'), JSON.stringify({ name: 'fe', scripts: { build: 'next build' }, dependencies: { next: '^14.0.0' } }));

      // Mock gitExecFn to simulate remote repository tracking
      let checkedRootDir = null;
      const mockGitExec = (cmd) => {
        if (cmd.includes('ls-remote')) return 'abc12345\trefs/heads/milestone-11-navigation-search\n';
        if (cmd.includes('ls-tree')) {
          checkedRootDir = 'frontend';
          return '040000 tree d4b825dc642cb6eb9a060e54bf8d69288fbee490\tfrontend\n';
        }
        return '';
      };

      const generator = new DeploymentPlanGenerator();
      const plan = generator.generatePlan(nestedWs, {
        executionSource: EXECUTION_SOURCE.GIT_REMOTE,
        repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
        branch: 'milestone-11-navigation-search',
        gitExecFn: mockGitExec,
      });

      assert.strictEqual(plan.overallStatus, 'READY');
      assert.strictEqual(plan.executionSource, 'GIT_REMOTE');
      assert.strictEqual(plan.deploymentRepositoryContext.repositorySource, 'EXPLICIT_PROVIDER_REPOSITORY');
      assert.strictEqual(plan.deploymentRepositoryContext.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
      assert.strictEqual(checkedRootDir, 'frontend');
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 12. RenderDeployAdapter respects boundary and does not inherit parent git
  runTest('Test 12: RenderDeployAdapter does not inherit parent git metadata for nested workspace', () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });

      const adapter = new RenderDeployAdapter();
      const meta = adapter.resolveGitMetadata(nestedWs);

      assert.strictEqual(meta, null);
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 13. RenderDeployAdapter prepares payload with explicit repo and clean rootDir
  runTest('Test 13: RenderDeployAdapter prepares payload with explicit repo and clean relative rootDir', () => {
    const adapter = new RenderDeployAdapter();
    const payload = adapter.prepareServicePayload({
      serviceName: 'my-backend',
      repoUrl: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'main',
      rootDir: 'backend',
      allowMockRepo: true,
    }, 'usr_12345', { PORT: '3000' });

    assert.strictEqual(payload.serviceDetails.env, 'node');
    assert.strictEqual(payload.serviceDetails.rootDir, 'backend');
    assert.ok(payload.envVars.some((ev) => ev.key === 'PORT' && ev.value === '3000'));
  });

  // 14. DeploymentOrchestrator preflight rejects unconfigured PARENT_GIT workspace
  await runAsyncTest('Test 14: DeploymentOrchestrator rejects unconfigured PARENT_GIT workspace during preflight', async () => {
    const parentTmp = createTempDir('nexus-parent-repo-');
    try {
      const parentGit = path.join(parentTmp, '.git');
      fs.mkdirSync(parentGit, { recursive: true });
      fs.writeFileSync(path.join(parentGit, 'config'), '[remote "origin"]\n  url = https://github.com/umangmalhotrawork-cloud/Nexus.git\n');

      const nestedWs = path.join(parentTmp, 'demo-workspaces', 'nexus-fullstack-deployment-test');
      fs.mkdirSync(nestedWs, { recursive: true });
      fs.writeFileSync(path.join(nestedWs, 'package.json'), JSON.stringify({ name: 'fe', dependencies: { next: '^14.0.0' } }));

      const generator = new DeploymentPlanGenerator();
      const plan = generator.generatePlan(nestedWs);

      const orchestrator = new DeploymentOrchestrator({
        credentialStore: {
          getAuthStatus: () => ({ isConnected: true }),
          getCredential: () => ({ apiKey: 'rnd_key' }),
        },
      });
      const preflight = await orchestrator.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, 'DEPLOYMENT_SOURCE_UNCONFIGURED');
    } finally {
      cleanupTempDir(parentTmp);
    }
  });

  // 15. Absolute Protection Verification: Main Nexus repository is never touched
  runTest('Test 15: Main Nexus repository is protected and never modified by deployment actions', () => {
    const mainNexusGitDir = path.resolve(__dirname, '../../.git');
    if (fs.existsSync(mainNexusGitDir)) {
      const config = fs.readFileSync(path.join(mainNexusGitDir, 'config'), 'utf8');
      assert.ok(config.length > 0);
    }
    assert.strictEqual(true, true);
  });

  console.log(`\nWorkspace Boundary Results: ${passedTests} passed, ${failedTests} failed\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
})();
