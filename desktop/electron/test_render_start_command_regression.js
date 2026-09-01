/**
 * Regression: Render payload commands must be executable shell commands, never
 * package-script descriptions embedded as display annotations.
 * This suite is strictly local and performs no network or provider calls.
 */
const assert = require('assert');
const path = require('path');
const { ProjectDetector } = require('./intelligence/deployment/ProjectDetector');
const RenderDeployAdapter = require('./intelligence/deployment/execution/providers/RenderDeployAdapter');

const workspacePath = path.resolve(__dirname, '../../demo-workspaces/nexus-fullstack-deployment-test');
const backendRoot = 'backend';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

console.log('\nRender start-command regression tests\n');

const detector = new ProjectDetector();
const backend = detector.detectBackend(workspacePath, backendRoot);

test('detects the package start script as executable command plus separate display metadata', () => {
  assert.ok(backend?.detected, 'fixture backend must be detected');
  assert.strictEqual(backend.startCommand, 'npm start');
  assert.strictEqual(backend.startCommandDescription, 'node server.js');
  assert.notStrictEqual(backend.startCommand, 'npm start (node server.js)');
});

test('constructs the exact clean Render payload for the fixture backend', () => {
  const adapter = new RenderDeployAdapter();
  const payload = adapter.prepareServicePayload({
    serviceId: 'nexus-backend-test',
    serviceName: 'nexus-backend-test',
    workspacePath,
    rootDir: backendRoot,
    startCommand: backend.startCommand,
    deploymentRepositoryContext: {
      remoteUrl: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
      projectRoot: 'demo-workspaces/nexus-fullstack-deployment-test',
    },
    executionSource: 'GIT_REMOTE',
    allowMockRepo: true,
  }, 'usr-local-test');

  assert.strictEqual(payload.serviceDetails.buildCommand, 'npm install');
  assert.strictEqual(payload.serviceDetails.startCommand, 'npm start');
  assert.strictEqual(payload.serviceDetails.envSpecificDetails.startCommand, 'npm start');
  assert.ok(!JSON.stringify(payload).includes('npm start (node server.js)'));
});

test('normalizes legacy decorated commands at the Render provider boundary', () => {
  const adapter = new RenderDeployAdapter();
  const payload = adapter.prepareServicePayload({
    serviceId: 'nexus-backend-test',
    workspacePath,
    rootDir: backendRoot,
    buildCommand: 'npm run build (vite build)',
    startCommand: 'npm start (node server.js)',
    deploymentRepositoryContext: {
      remoteUrl: 'https://github.com/umangmalhotrawork-cloud/NexusGitTest.git',
      branch: 'milestone-11-navigation-search',
      projectRoot: 'demo-workspaces/nexus-fullstack-deployment-test',
    },
    executionSource: 'GIT_REMOTE',
    allowMockRepo: true,
  }, 'usr-local-test');

  assert.strictEqual(payload.serviceDetails.buildCommand, 'npm run build');
  assert.strictEqual(payload.serviceDetails.startCommand, 'npm start');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
