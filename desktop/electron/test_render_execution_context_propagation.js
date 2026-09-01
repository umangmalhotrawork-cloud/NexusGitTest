/**
 * NEXUS DEPLOYMENT — RENDER EXECUTION CONTEXT PROPAGATION TEST SUITE
 *
 * Verifies that explicit Git repository selection (NexusGitTest.git) propagates
 * from DeploymentPlan through DeploymentOrchestrator into RenderDeployAdapter,
 * constructing a valid Render service payload without calling local Git discovery
 * or falling back to the parent Nexus repository.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RenderDeployAdapter = require('./intelligence/deployment/execution/providers/RenderDeployAdapter');
const { DeploymentOrchestrator } = require('./intelligence/deployment/orchestration/DeploymentOrchestrator');
const { DeploymentPlanGenerator } = require('./intelligence/deployment/planning/DeploymentPlanGenerator');
const { DeploymentSelectionStore } = require('./intelligence/deployment/persistence/DeploymentSelectionStore');
const { RemoteRepositoryPreflight } = require('./intelligence/deployment/preflight/RemoteRepositoryPreflight');

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
  console.log('   RENDER EXECUTION CONTEXT PROPAGATION TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-render-ctx-'));
  const parentRepo = path.join(tmpBase, 'NexusParent');
  const parentGit = path.join(parentRepo, '.git');
  fs.mkdirSync(parentGit, { recursive: true });
  fs.writeFileSync(
    path.join(parentGit, 'config'),
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/umangmalhotrawork-cloud/Nexus.git\n'
  );
  fs.writeFileSync(path.join(parentGit, 'HEAD'), 'ref: refs/heads/main\n');

  const nestedWs = path.join(parentRepo, 'demo-workspaces', 'nexus-fullstack-deployment-test');
  const backendDir = path.join(nestedWs, 'backend');
  fs.mkdirSync(backendDir, { recursive: true });
  fs.writeFileSync(path.join(backendDir, 'package.json'), JSON.stringify({ name: 'be', scripts: { start: 'node server.js' }, dependencies: { express: '^4.18.0' } }));
  fs.writeFileSync(path.join(backendDir, 'server.js'), 'const express = require("express");');

  const customStoreFile = path.join(tmpBase, 'test_store.json');

  // TEST 1: RenderDeployAdapter directly accepts deploymentRepositoryContext
  const t1 = await runAsyncTest('Test 1: RenderDeployAdapter prepares payload from explicit deploymentRepositoryContext', async () => {
    const adapter = new RenderDeployAdapter();
    const payload = adapter.prepareServicePayload(
      {
        serviceId: 'svc_backend',
        serviceName: 'nexus-backend-test',
        rootDir: 'backend',
        workspacePath: nestedWs,
        deploymentRepositoryContext: {
          repositorySource: 'EXPLICIT_PROVIDER_REPOSITORY',
          remoteUrl: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
          branch: 'milestone-11-navigation-search',
          projectRoot: 'demo-workspaces/nexus-fullstack-deployment-test',
        },
        executionSource: 'GIT_REMOTE',
        allowMockRepo: true,
      },
      'usr-test-owner-1'
    );

    assert.strictEqual(payload.repo, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(payload.branch, 'milestone-11-navigation-search');
    assert.strictEqual(payload.rootDir, 'demo-workspaces/nexus-fullstack-deployment-test/backend');
    assert.strictEqual(payload.ownerId, 'usr-test-owner-1');
    assert.strictEqual(payload.type, 'web_service');
  });
  if (t1) passed++; else failed++;

  // TEST 2: Local Git discovery is bypassed when explicit repo exists
  const t2 = await runAsyncTest('Test 2: resolveGitMetadata returns explicit repo without accessing local .git', async () => {
    const adapter = new RenderDeployAdapter();
    const meta = adapter.resolveGitMetadata(nestedWs, {
      repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
    });

    assert.ok(meta);
    assert.strictEqual(meta.repoUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(meta.branch, 'milestone-11-navigation-search');
    assert.strictEqual(meta.repositorySource, 'EXPLICIT_PROVIDER_REPOSITORY');
  });
  if (t2) passed++; else failed++;

  // TEST 3: End-to-end plan -> orchestrator -> RenderDeployAdapter payload propagation
  const t3 = await runAsyncTest('Test 3: DeploymentOrchestrator passes plan deploymentRepositoryContext to Render payload', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    store.saveWorkspaceSelections(nestedWs, {
      svc_backend: 'render',
      executionSource: 'GIT_REMOTE',
      repository: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
      rootDir: 'demo-workspaces/nexus-fullstack-deployment-test',
    });

    let submittedPayload = null;
    const mockFetch = async (url, opts = {}) => {
      if (url.includes('/owners')) {
        const owners = [{ id: 'usr-render-owner-99', name: 'Test Team', type: 'team' }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(owners),
          json: async () => owners,
        };
      }
      if (url.includes('/services')) {
        if (opts.method === 'POST') {
          submittedPayload = JSON.parse(opts.body);
          const svc = { service: { id: 'srv-render-backend-1', serviceDetails: { url: 'https://nexus-backend-test.onrender.com' } } };
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify(svc),
            json: async () => svc,
          };
        }
      }
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: () => '040000 tree abc123\tdemo-workspaces/nexus-fullstack-deployment-test/backend\n' });
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });
    const plan = generator.generatePlan(nestedWs);

    assert.strictEqual(plan.executionSource, 'GIT_REMOTE');
    assert.strictEqual(plan.deploymentRepositoryContext.remoteUrl, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');

    const orchestrator = new DeploymentOrchestrator({
      credentialStore: {
        getAuthStatus: () => ({ isConnected: true }),
        getCredential: () => ({ apiKey: 'rnd_valid_key' }),
      },
      remoteRepositoryPreflight: preflight,
    });

    const logs = [];
    const res = await orchestrator.startOrchestration(
      plan,
      { fetchFn: mockFetch, resolveRealOwners: true },
      (type, data) => {
        if (data && data.chunk) logs.push(data.chunk);
      }
    );

    if (res.status !== 'SUCCESS') {
      console.log('Test 3 failed with error:', res.error, 'logs:', logs);
    }

    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(submittedPayload, 'Must submit payload to Render API');
    assert.strictEqual(submittedPayload.repo, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
    assert.strictEqual(submittedPayload.branch, 'milestone-11-navigation-search');
    assert.strictEqual(submittedPayload.rootDir, 'demo-workspaces/nexus-fullstack-deployment-test/backend');
    assert.strictEqual(submittedPayload.ownerId, 'usr-render-owner-99');
  });
  if (t3) passed++; else failed++;

  // TEST 4: Existing service update/deploy uses explicit repository
  const t4 = await runAsyncTest('Test 4: Existing service update/deploy patches rootDir with explicit repository context', async () => {
    const store = new DeploymentSelectionStore({ storePath: customStoreFile });
    let patchPayload = null;

    const mockFetch = async (url, opts = {}) => {
      if (url.includes('/owners')) {
        const owners = [{ id: 'usr-render-owner-99', name: 'Test Team', type: 'team' }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(owners),
          json: async () => owners,
        };
      }
      if (url.endsWith('/services') && opts.method === 'POST') {
        // Return 400 already in use
        return {
          ok: false,
          status: 400,
          text: async () => 'Service name already in use',
          json: async () => ({ message: 'Service name already in use' }),
        };
      }
      if (url.includes('/services?limit=50')) {
        const svcs = [{ id: 'srv-existing-123', name: 'be' }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(svcs),
          json: async () => svcs,
        };
      }
      if (url.includes('/services/srv-existing-123') && opts.method === 'PATCH') {
        patchPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'srv-existing-123' }),
          json: async () => ({ id: 'srv-existing-123' }),
        };
      }
      if (url.includes('/deploys') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'dep-123' }),
          json: async () => ({ id: 'dep-123' }),
        };
      }
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    };

    const preflight = new RemoteRepositoryPreflight({ execFn: () => '040000 tree abc123\tdemo-workspaces/nexus-fullstack-deployment-test/backend\n' });
    const generator = new DeploymentPlanGenerator({ selectionStore: store, remoteRepositoryPreflight: preflight });
    const plan = generator.generatePlan(nestedWs);

    const orchestrator = new DeploymentOrchestrator({
      credentialStore: {
        getAuthStatus: () => ({ isConnected: true }),
        getCredential: () => ({ apiKey: 'rnd_valid_key' }),
      },
      remoteRepositoryPreflight: preflight,
    });

    const res = await orchestrator.startOrchestration(
      plan,
      { fetchFn: mockFetch, resolveRealOwners: true },
      () => {}
    );

    assert.strictEqual(res.status, 'SUCCESS');
    assert.ok(patchPayload, 'Must patch existing service');
    assert.strictEqual(patchPayload.rootDir, 'demo-workspaces/nexus-fullstack-deployment-test/backend');
    assert.strictEqual(patchPayload.branch, 'milestone-11-navigation-search');
  });
  if (t4) passed++; else failed++;

  // TEST 5: Parent Nexus repository is never used as deployment source
  const t5 = await runAsyncTest('Test 5: Parent Nexus.git repository is never submitted as Render repo', async () => {
    const adapter = new RenderDeployAdapter();
    const payload = adapter.prepareServicePayload(
      {
        serviceId: 'svc_backend',
        workspacePath: nestedWs,
        deploymentRepositoryContext: {
          repositorySource: 'EXPLICIT_PROVIDER_REPOSITORY',
          remoteUrl: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
          branch: 'milestone-11-navigation-search',
          projectRoot: 'demo-workspaces/nexus-fullstack-deployment-test',
        },
        executionSource: 'GIT_REMOTE',
        allowMockRepo: true,
      },
      'usr-test-owner-1'
    );

    assert.notStrictEqual(payload.repo, 'https://github.com/umangmalhotrawork-cloud/Nexus.git');
    assert.strictEqual(payload.repo, 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git');
  });
  if (t5) passed++; else failed++;

  // TEST 6: Unconfigured nested workspace fails closed before API call
  const t6 = await runAsyncTest('Test 6: Unconfigured nested workspace fails closed without explicit repo', async () => {
    const adapter = new RenderDeployAdapter();
    let threw = false;
    try {
      adapter.prepareServicePayload(
        {
          serviceId: 'svc_backend',
          workspacePath: nestedWs,
          allowMockRepo: false,
        },
        'usr-test-owner-1'
      );
    } catch (err) {
      threw = true;
      assert(err.message.includes('RENDER_REPOSITORY_REQUIRED'));
    }
    assert.strictEqual(threw, true);
  });
  if (t6) passed++; else failed++;

  // Clean up
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch (_) {}

  console.log(`\n======================================================`);
  console.log(`Render Context Propagation Results: ${passed} passed, ${failed} failed`);
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
