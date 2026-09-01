/**
 * NEXUS FAILURE DIAGNOSTICS & LOG CAPTURE E2E VERIFICATION
 */

const assert = require('assert');
const path = require('path');
const {
  DeploymentPlanGenerator,
  DeploymentOrchestrator,
  deploymentFailureDiagnoser,
  FAILURE_CATEGORY,
  STAGE_STATUS,
  ORCHESTRATION_STATUS,
} = require('./intelligence');

console.log('\n======================================================');
console.log('  NEXUS DEPLOYMENT FAILURE DIAGNOSTICS & LOG CAPTURE');
console.log('======================================================\n');

(async () => {
  const demoWorkspace = path.resolve(__dirname, '../../demo-workspaces/nexus-fullstack-deployment-test');
  console.log(`Demo workspace: ${demoWorkspace}`);

  // 1. Generate plan for demo workspace
  const planGenerator = new DeploymentPlanGenerator();
  const plan = planGenerator.generatePlan(demoWorkspace, {
    userSelections: { svc_frontend: 'vercel', svc_backend: 'render' },
  });

  console.log(`Topology services: ${plan.topology.services.map(s => `${s.name} (${s.selectedProvider})`).join(', ')}`);
  assert.strictEqual(plan.topology.services.length, 2);

  // 2. Test Failure Diagnoser on simulated Vercel failure missing VITE_API_URL
  const diag1 = deploymentFailureDiagnoser.diagnoseFailure({
    workspacePath: demoWorkspace,
    stageId: 'svc_frontend',
    providerId: 'vercel',
    serviceName: 'Frontend Web',
    rootDir: 'frontend',
    framework: 'vite',
    error: 'Process exited with code 1',
    logs: [
      'vite build --outDir dist\n',
      'error during build:\n',
      'ReferenceError: VITE_API_URL is not defined in App.jsx\n',
    ],
    plan,
  });

  console.log('\n--- Diagnostic Result 1 (VITE_API_URL missing) ---');
  console.log(`Category: ${diag1.failureCategory}`);
  console.log(`Root Cause: ${diag1.likelyRootCause}`);
  console.log(`Suggested Fix: ${diag1.suggestedFix}`);
  console.log(`Evidence count: ${diag1.evidence.length}`);

  assert.strictEqual(diag1.failureCategory, FAILURE_CATEGORY.ENVIRONMENT_VARIABLE_MISSING);
  assert.ok(diag1.likelyRootCause.includes('VITE_API_URL'));
  assert.strictEqual(diag1.isRetrySafe, true);

  // 3. Test Failure Diagnoser on simulated 401 Unauthorized API error
  const diag2 = deploymentFailureDiagnoser.diagnoseFailure({
    workspacePath: demoWorkspace,
    stageId: 'svc_backend',
    providerId: 'render',
    serviceName: 'Backend Service',
    rootDir: 'backend',
    framework: 'express',
    error: 'Render API Error (HTTP 401): Unauthorized user token',
    logs: ['[RENDER ERROR] API request failed with HTTP 401: Unauthorized\n'],
    plan,
  });

  console.log('\n--- Diagnostic Result 2 (401 Unauthorized) ---');
  console.log(`Category: ${diag2.failureCategory}`);
  console.log(`Root Cause: ${diag2.likelyRootCause}`);
  console.log(`Suggested Fix: ${diag2.suggestedFix}`);

  assert.strictEqual(diag2.failureCategory, FAILURE_CATEGORY.AUTHENTICATION_ERROR);
  assert.ok(diag2.suggestedFix.includes('Deployment Credentials'));

  // 4. Test Failure Diagnoser on output directory mismatch
  const diag3 = deploymentFailureDiagnoser.diagnoseFailure({
    workspacePath: demoWorkspace,
    stageId: 'svc_frontend',
    providerId: 'vercel',
    serviceName: 'Frontend Web',
    rootDir: 'frontend',
    framework: 'vite',
    error: 'Could not find output folder "out"',
    logs: ['Build completed.\n', 'No Output Directory named "out" found.\n'],
    plan,
  });

  console.log('\n--- Diagnostic Result 3 (Output Directory Mismatch) ---');
  console.log(`Category: ${diag3.failureCategory}`);
  console.log(`Suggested Fix: ${diag3.suggestedFix}`);

  assert.strictEqual(diag3.failureCategory, FAILURE_CATEGORY.OUTPUT_DIRECTORY_MISMATCH);

  // 5. Test Failure Diagnoser on Render missing ownerId error
  const diag4 = deploymentFailureDiagnoser.diagnoseFailure({
    workspacePath: demoWorkspace,
    stageId: 'svc_backend',
    providerId: 'render',
    serviceName: 'Backend Service',
    rootDir: 'backend',
    framework: 'express',
    error: 'Render API Error (HTTP 400): {"message":"ownerID is a required field"}',
    logs: ['[RENDER ERROR] API request failed with HTTP 400: {"message":"ownerID is a required field"}\n'],
    plan,
  });

  console.log('\n--- Diagnostic Result 4 (Render ownerID Missing) ---');
  console.log(`Category: ${diag4.failureCategory}`);
  console.log(`Affected Adapter: ${diag4.affectedAdapter}`);
  console.log(`Root Cause: ${diag4.likelyRootCause}`);
  console.log(`Suggested Fix: ${diag4.suggestedFix}`);

  assert.strictEqual(diag4.failureCategory, FAILURE_CATEGORY.PROVIDER_CONFIGURATION_ERROR);
  assert.strictEqual(diag4.affectedAdapter, 'RenderDeployAdapter');
  assert.ok(diag4.likelyRootCause.includes('workspace') || diag4.likelyRootCause.includes('owner'));
  assert.strictEqual(diag4.isRetrySafe, true);

  console.log('\n✓ All diagnostic assertions passed successfully!\n');
})();
