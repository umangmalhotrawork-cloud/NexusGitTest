/**
 * NEXUS DEPLOYMENT SUITE — MASTER AUTOMATED TEST RUNNER
 */

const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

const testSuites = [
  { name: 'TypeScript Compilation', cmd: 'npx tsc --noEmit' },
  { name: '1. Deployment Plan Generator', cmd: 'node desktop/electron/test_deployment_plan.js' },
  { name: '2. Deployment Inspector Panel', cmd: 'node desktop/electron/test_deployment_inspector.js' },
  { name: '3. Deployment Advisor', cmd: 'node desktop/electron/test_deployment_advisor.js' },
  { name: '4. Deployment UI Contract & Credentials Modal', cmd: 'node desktop/electron/test_deployment_ui_contract.js' },
  { name: '5. Deployment Multi-Stage Orchestrator', cmd: 'node desktop/electron/test_deployment_orchestration.js' },
  { name: '6. Deployment Orchestration State Machine Regression', cmd: 'node desktop/electron/test_deployment_orchestration_state_machine.js' },
  { name: '7. Deployment Execution Adapters', cmd: 'node desktop/electron/test_deployment_execution.js' },
  { name: '8. Render Start Command Regression', cmd: 'node desktop/electron/test_render_start_command_regression.js' },
  { name: '9. Deployment Credential Store & SafeStorage Vault', cmd: 'node desktop/electron/test_deployment_credentials.js' },
  { name: '10. Deployment Config Engine & Generators', cmd: 'node desktop/electron/test_deployment_config_generators.js' },
  { name: '11. Electron Restart Selection Persistence E2E', cmd: 'node desktop/electron/test_deployment_restart_persistence_e2e.js' },
  { name: '12. Failure Diagnostics & Log Capture E2E', cmd: 'node desktop/electron/test_failure_diagnostics_e2e.js' },
  { name: '13. Remote Repository Preflight', cmd: 'node desktop/electron/test_remote_repository_preflight.js' },
  { name: '14. Workspace Boundary & Context Isolation', cmd: 'node desktop/electron/test_workspace_boundary_deployment.js' },
  { name: '15. Repository Selection Persistence & Refresh E2E', cmd: 'node desktop/electron/test_repository_selection_persistence_e2e.js' },
  { name: '16. Render Execution Context Propagation', cmd: 'node desktop/electron/test_render_execution_context_propagation.js' },
  { name: '17. Stale Lock & Orchestration Lifecycle Management', cmd: 'node desktop/electron/test_deployment_stale_lock_lifecycle.js' },
];

console.log('\n======================================================');
console.log('   NEXUS COMPLETE DEPLOYMENT TEST RUNNER');
console.log('======================================================\n');

let totalPassed = 0;
let totalFailed = 0;

for (const suite of testSuites) {
  try {
    process.stdout.write(`Running: ${suite.name}... `);
    const out = execSync(suite.cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('✓ PASSED');
    totalPassed++;
  } catch (err) {
    console.log('✗ FAILED');
    console.error(err.stdout || err.stderr || err.message);
    totalFailed++;
  }
}

console.log('\n======================================================');
console.log(`SUMMARY: ${totalPassed} / ${testSuites.length} suites passed (${totalFailed} failed)`);
console.log('======================================================\n');

if (totalFailed > 0) {
  process.exit(1);
}
