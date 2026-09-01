const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

const testSuites = [
  { name: 'TypeScript Compilation', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { name: '1. Deployment Plan Generator', cmd: 'node', args: ['desktop/electron/test_deployment_plan.js'] },
  { name: '2. Deployment Inspector Panel', cmd: 'node', args: ['desktop/electron/test_deployment_inspector.js'] },
  { name: '3. Deployment Advisor', cmd: 'node', args: ['desktop/electron/test_deployment_advisor.js'] },
  { name: '4. Deployment UI Contract & Credentials Modal', cmd: 'node', args: ['desktop/electron/test_deployment_ui_contract.js'] },
  { name: '5. Deployment Multi-Stage Orchestrator', cmd: 'node', args: ['desktop/electron/test_deployment_orchestration.js'] },
  { name: '6. Deployment Execution Adapters', cmd: 'node', args: ['desktop/electron/test_deployment_execution.js'] },
  { name: '7. Deployment Credential Store & SafeStorage Vault', cmd: 'node', args: ['desktop/electron/test_deployment_credentials.js'] },
  { name: '8. Deployment Config Engine & Generators', cmd: 'node', args: ['desktop/electron/test_deployment_config_generators.js'] },
  { name: '9. Electron Restart Selection Persistence E2E', cmd: 'node', args: ['desktop/electron/test_deployment_restart_persistence_e2e.js'] },
  { name: '10. Failure Diagnostics & Log Capture E2E', cmd: 'node', args: ['desktop/electron/test_failure_diagnostics_e2e.js'] },
  { name: '11. Remote Repository Preflight & Fail-Closed Guard', cmd: 'node', args: ['desktop/electron/test_remote_repository_preflight.js'] },
];

console.log('\n======================================================');
console.log('   NEXUS COMPLETE DEPLOYMENT TEST RUNNER (PARALLEL/FAST)');
console.log('======================================================\n');

async function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn(suite.cmd, suite.args, { cwd: rootDir });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ ${suite.name}`);
        resolve({ suite, passed: true });
      } else {
        console.error(`✗ ${suite.name} (exit code ${code})`);
        console.error(output);
        resolve({ suite, passed: false });
      }
    });
  });
}

(async () => {
  const results = [];
  for (const suite of testSuites) {
    const r = await runSuite(suite);
    results.push(r);
  }
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n======================================================');
  console.log(`SUMMARY: ${passed} / ${testSuites.length} suites passed (${failed} failed)`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
})();
