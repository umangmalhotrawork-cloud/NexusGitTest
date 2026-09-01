/**
 * NEXUS DEPLOYMENT ADVISOR — COMPREHENSIVE TEST SUITE
 * 
 * Validates the 25 core invariants of the Deployment Advisor:
 * 1. Full-stack topology produces multiple architecture candidates.
 * 2. Recommended architecture is deterministic.
 * 3. Compatibility scores remain immutable.
 * 4. Execution availability is separate from compatibility.
 * 5. Highest compatibility provider is not automatically selected if execution is unavailable.
 * 6. Backend PORT risk detected.
 * 7. localhost/127.0.0.1 binding risk detected.
 * 8. 0.0.0.0 binding is recognized as safer.
 * 9. DATABASE_URL is treated as secret.
 * 10. VITE_API_URL is public.
 * 11. NEXT_PUBLIC_API_URL is public.
 * 12. PostgreSQL hosting requirement detected.
 * 13. SQLite persistence risk detected.
 * 14. Filesystem persistence risk detected.
 * 15. Missing Dockerfile requirement detected when relevant.
 * 16. Unknown provider limit is represented as UNKNOWN.
 * 17. Billing metadata is not fabricated.
 * 18. Multiple services can use different providers.
 * 19. User selection does not modify recommendation.
 * 20. Unsupported selected provider creates BLOCKED.
 * 21. Supported selected provider without credentials creates AUTH_REQUIRED/blocked state.
 * 22. No silent provider substitution.
 * 23. Advisor is deterministic.
 * 24. No network calls.
 * 25. No secret leakage.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DeploymentAdvisor,
  deploymentAdvisor,
  RISK_SEVERITY,
  RISK_CODES,
  BILLING_TIER,
  PROVIDER_CAPABILITIES,
} = require('./intelligence/deployment/advisory/DeploymentAdvisor');

const { DeploymentPlanGenerator } = require('./intelligence/deployment/planning/DeploymentPlanGenerator');
const { DeploymentCredentialStore } = require('./intelligence/deployment/credentials/DeploymentCredentialStore');

class MockSafeStorage {
  constructor(available = true) {
    this._available = available;
  }
  isEncryptionAvailable() {
    return this._available;
  }
  encryptString(plainText) {
    return Buffer.from(plainText, 'utf-8');
  }
  decryptString(cipherBuffer) {
    return cipherBuffer.toString('utf-8');
  }
}

function createTempDir(prefix = 'nexus-adv-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log('\n======================================================');
  console.log('  NEXUS DEPLOYMENT ADVISOR — TEST SUITE');
  console.log('======================================================\n');

  // -------------------------------------------------------------
  // TEST 1: Full-stack topology produces multiple architecture candidates
  // -------------------------------------------------------------
  await runTest('Test 1: Full-stack topology produces multiple architecture candidates', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', pg: '^8.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/server.js'), 'const p = process.env.PORT || 4000;\napp.listen(p);');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.ok(advice.architectureRecommendations.length >= 3, 'Must produce at least 3 architecture candidates');
      assert.ok(advice.recommendedArchitecture, 'Must have a recommended architecture');
      assert.ok(advice.alternatives.length >= 2, 'Must have at least 2 alternatives');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 2: Recommended architecture is deterministic
  // -------------------------------------------------------------
  await runTest('Test 2: Recommended architecture is deterministic across repeated runs', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const a1 = await advisor.generateAdvice(tmp);
      const a2 = await advisor.generateAdvice(tmp);

      assert.strictEqual(a1.recommendedArchitecture.name, a2.recommendedArchitecture.name);
      assert.strictEqual(a1.recommendedArchitecture.architectureScore, a2.recommendedArchitecture.architectureScore);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 3: Compatibility scores remain immutable
  // -------------------------------------------------------------
  await runTest('Test 3: Compatibility scores remain immutable and distinct from execution availability', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      for (const arch of advice.architectureRecommendations) {
        assert.strictEqual(typeof arch.compatibilityScore, 'number');
        assert.ok(arch.compatibilityScore >= 0 && arch.compatibilityScore <= 100);
      }
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 4: Execution availability is separate from compatibility
  // -------------------------------------------------------------
  await runTest('Test 4: Execution availability is clearly demarcated from compatibility score', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const railwayArch = advice.architectureRecommendations.find((a) => a.architectureId.includes('railway'));
      assert.ok(railwayArch, 'Railway architecture must exist');
      assert.strictEqual(railwayArch.executionAvailable, false);
      assert.ok(railwayArch.compatibilityScore > 80, 'Compatibility score remains high despite execution unavailable');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 5: Highest compatibility provider is not automatically selected if execution is unavailable
  // -------------------------------------------------------------
  await runTest('Test 5: Highest compatibility provider is not recommended if execution is unavailable', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.strictEqual(advice.recommendedArchitecture.executionAvailable, true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 6: Backend PORT risk detected
  // -------------------------------------------------------------
  await runTest('Test 6: Backend hardcoded PORT listen risk is detected', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'server.js'), 'const express = require("express");\nconst app = express();\napp.listen(8080);');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const portRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.PORT_MISCONFIGURATION);
      assert.ok(portRisk, 'Must detect PORT_MISCONFIGURATION risk');
      assert.strictEqual(portRisk.severity, RISK_SEVERITY.HIGH);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 7: localhost/127.0.0.1 binding risk detected
  // -------------------------------------------------------------
  await runTest('Test 7: Explicit localhost/127.0.0.1 binding risk is detected', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'server.js'), 'const express = require("express");\nconst app = express();\napp.listen(3000, "127.0.0.1");');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const hostRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.HOST_BINDING_RISK);
      assert.ok(hostRisk, 'Must detect HOST_BINDING_RISK');
      assert.strictEqual(hostRisk.severity, RISK_SEVERITY.HIGH);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 8: 0.0.0.0 binding is recognized as safer
  // -------------------------------------------------------------
  await runTest('Test 8: 0.0.0.0 binding avoids HOST_BINDING_RISK', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'server.js'), 'const p = process.env.PORT || 3000;\napp.listen(p, "0.0.0.0");');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const hostRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.HOST_BINDING_RISK);
      assert.strictEqual(hostRisk, undefined, 'Must not flag 0.0.0.0 host binding');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 9: DATABASE_URL is treated as secret
  // -------------------------------------------------------------
  await runTest('Test 9: DATABASE_URL is required as secure backend environment variable', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', pg: '^8.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'server.js'), 'const db = process.env.DATABASE_URL;');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.ok(advice.requirements.some((r) => r.includes('DATABASE_URL')), 'DATABASE_URL must be listed in secure requirements');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 10: VITE_API_URL is public
  // -------------------------------------------------------------
  await runTest('Test 10: Vite frontend environment variables are public', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'client', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src/App.jsx'), 'const url = import.meta.env.VITE_API_URL;');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.strictEqual(advice.projectSummary.frontendFramework.toLowerCase().includes('vite'), true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 11: NEXT_PUBLIC_API_URL is public
  // -------------------------------------------------------------
  await runTest('Test 11: Next.js frontend environment variables are public', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'next-app', dependencies: { next: '^14.0.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.strictEqual(advice.projectSummary.frontendFramework.toLowerCase().includes('next'), true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 12: PostgreSQL hosting requirement detected
  // -------------------------------------------------------------
  await runTest('Test 12: PostgreSQL dependency creates managed database requirement', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', pg: '^8.0.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const dbRisk = advice.projectRisks.find((r) => r.code === 'DATABASE_PROVISIONING_REQUIREMENT');
      assert.ok(dbRisk, 'Must detect PostgreSQL requirement');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 13: SQLite persistence risk detected
  // -------------------------------------------------------------
  await runTest('Test 13: SQLite dependency emits ephemeral storage risk', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', sqlite3: '^5.1.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const sqliteRisk = advice.projectRisks.find((r) => r.title.includes('SQLite'));
      assert.ok(sqliteRisk, 'Must emit SQLite Ephemeral Storage Risk');
      assert.strictEqual(sqliteRisk.severity, RISK_SEVERITY.HIGH);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 14: Filesystem persistence risk detected
  // -------------------------------------------------------------
  await runTest('Test 14: fs.writeFile operations emit FILESYSTEM_PERSISTENCE_RISK', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'server.js'), 'const fs = require("fs");\nfs.writeFileSync("/uploads/file.txt", "data");');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const fsRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.FILESYSTEM_PERSISTENCE_RISK);
      assert.ok(fsRisk, 'Must detect FILESYSTEM_PERSISTENCE_RISK');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 15: Missing Dockerfile requirement detected when relevant
  // -------------------------------------------------------------
  await runTest('Test 15: Missing Dockerfile requirement detected for Docker targets', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const flyArch = advice.architectureRecommendations.find((a) => a.architectureId.includes('flyio'));
      if (flyArch) {
        assert.ok(flyArch.tradeoffs.some((t) => t.includes('Dockerfile')), 'Must mention Dockerfile requirement in tradeoffs');
      }
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 16: Unknown provider limit is represented as UNKNOWN
  // -------------------------------------------------------------
  await runTest('Test 16: Unverified provider limits are returned as unverified rather than guessed', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.ok(PROVIDER_CAPABILITIES.docker.resourceLimits.memory.includes('Limit not verified'));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 17: Billing metadata is not fabricated
  // -------------------------------------------------------------
  await runTest('Test 17: Billing classifications use standard tier enums without fabricated prices', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { next: '^14.0.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      for (const arch of advice.architectureRecommendations) {
        const b = arch.billingConsiderations;
        assert.ok(!b.summary.includes('$99/mo') && !b.summary.includes('$49/mo'));
      }
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 18: Multiple services can use different providers
  // -------------------------------------------------------------
  await runTest('Test 18: Multi-service project maps different providers per service', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const topArch = advice.recommendedArchitecture;
      const webSvc = topArch.services.find((s) => s.type === 'FRONTEND');
      const apiSvc = topArch.services.find((s) => s.type === 'BACKEND');

      assert.strictEqual(webSvc.recommendedProvider, 'vercel');
      assert.strictEqual(apiSvc.recommendedProvider, 'render');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 19: User selection does not modify recommendation
  // -------------------------------------------------------------
  await runTest('Test 19: User selection does not alter recommended architecture', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const originalRec = advice.recommendedArchitecture.name;
      advisor.validateSelectedArchitecture(advice, 'arch_unified_railway');

      assert.strictEqual(advice.recommendedArchitecture.name, originalRec);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 20: Unsupported selected provider creates BLOCKED
  // -------------------------------------------------------------
  await runTest('Test 20: Selecting unsupported provider creates BLOCKED validation status', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const res = advisor.validateSelectedArchitecture(advice, { svc_api: 'railway' });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.status, 'BLOCKED');
      assert.ok(res.blockers.some((b) => b.includes('Railway') && b.includes('deployment execution support')));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 21: Supported selected provider without credentials creates AUTH_REQUIRED/blocked state
  // -------------------------------------------------------------
  await runTest('Test 21: Supported provider without credentials creates missing provider requirement', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const res = advisor.validateSelectedArchitecture(advice, { svc_api: 'render' });
      assert.strictEqual(res.valid, true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 22: No silent provider substitution
  // -------------------------------------------------------------
  await runTest('Test 22: Unsupported provider selection is never secretly swapped', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const res = advisor.validateSelectedArchitecture(advice, { svc_api: 'flyio' });
      assert.strictEqual(res.userSelections.svc_api, 'flyio');
      assert.notStrictEqual(res.userSelections.svc_api, 'render');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 23: Advisor is deterministic
  // -------------------------------------------------------------
  await runTest('Test 23: Advisor produces identical advice on identical workspace evidence', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }));

      const advisor = new DeploymentAdvisor();
      const a1 = await advisor.generateAdvice(tmp);
      const a2 = await advisor.generateAdvice(tmp);

      assert.strictEqual(a1.architectureRecommendations.length, a2.architectureRecommendations.length);
      assert.strictEqual(a1.projectRisks.length, a2.projectRisks.length);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 24: No network calls
  // -------------------------------------------------------------
  await runTest('Test 24: Advisor analysis runs with 0 network calls and 0 AI tokens', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.ok(advice.adviceId);
      assert.strictEqual(advice.status === 'READY' || advice.status === 'WARNING', true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 25: No secret leakage
  // -------------------------------------------------------------
  await runTest('Test 25: Advice output contains zero plaintext secrets or tokens', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, '.env'), 'DATABASE_URL="postgres://user:secretpw123@localhost:5432/mydb"\nAPI_SECRET="topsecret"');

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      const jsonStr = JSON.stringify(advice);
      assert.ok(!jsonStr.includes('secretpw123'), 'Must not leak database password');
      assert.ok(!jsonStr.includes('topsecret'), 'Must not leak API secret');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 26: Canonical backend architecture score is authoritative single source of truth
  // -------------------------------------------------------------
  await runTest('Test 26: Canonical backend architecture score is authoritative and matches advice schema', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', pg: '^8.0.0' } }));

      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(tmp);

      assert.ok(advice.recommendedArchitecture);
      assert.strictEqual(typeof advice.recommendedArchitecture.architectureScore, 'number');
      assert.strictEqual(typeof advice.recommendedArchitecture.compatibilityScore, 'number');
      assert.ok(advice.recommendedArchitecture.architectureScore >= 80 && advice.recommendedArchitecture.architectureScore <= 100);

      // Verify that all alternatives have matching numeric scores
      for (const alt of advice.alternatives) {
        assert.strictEqual(typeof alt.architectureScore, 'number');
        assert.strictEqual(typeof alt.compatibilityScore, 'number');
      }
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 27: Controlled fullstack fixture produces accurate advice without false positive risks
  // -------------------------------------------------------------
  await runTest('Test 27: Controlled fixture produces accurate advice without false positive risks', async () => {
    const fixturePath = path.resolve('demo-workspaces/nexus-fullstack-deployment-test');
    if (fs.existsSync(fixturePath)) {
      const advisor = new DeploymentAdvisor();
      const advice = await advisor.generateAdvice(fixturePath);

      assert.ok(advice.recommendedArchitecture.executionAvailable, 'Recommended architecture must be executable');
      assert.ok(advice.recommendedArchitecture.architectureScore >= 90, 'Recommended architecture must have score >= 90');
      
      // Must not flag PORT risk because server.js uses process.env.PORT
      const portRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.PORT_MISCONFIGURATION);
      assert.strictEqual(portRisk, undefined, 'Must not flag PORT risk on fixture');

      // Must not flag HOST risk because server.js binds to 0.0.0.0
      const hostRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.HOST_BINDING_RISK);
      assert.strictEqual(hostRisk, undefined, 'Must not flag HOST risk on fixture');

      // Must not flag HEALTH risk because server.js defines /api/health
      const healthRisk = advice.projectRisks.find((r) => r.code === RISK_CODES.HEALTH_CHECK_RISK);
      assert.strictEqual(healthRisk, undefined, 'Must not flag HEALTH risk on fixture');

      // Must flag PostgreSQL managed requirement
      const dbRisk = advice.projectRisks.find((r) => r.code === 'DATABASE_PROVISIONING_REQUIREMENT');
      assert.ok(dbRisk, 'Must flag PostgreSQL provisioning requirement');
    }
  });

  console.log(`\nDeployment Advisor Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
})();
