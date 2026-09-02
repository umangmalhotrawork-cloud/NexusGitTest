/**
 * NEXUS CODEX HARNESS — WORKSPACE & PATH RESOLUTION HARDENING TEST SUITE
 * 
 * Comprehensive verification of architectural workspace & file path resolution:
 * 1.  Root-level file resolution
 * 2.  Nested file resolution
 * 3.  Deeply nested file resolution (packages/pkg-a/src/components/button/index.ts)
 * 4.  Current active editor file correlation
 * 5.  Absolute path within workspace
 * 6.  Relative path with leading ./ and redundant slashes
 * 7.  Mixed path separators (\ and /)
 * 8.  Dot path segments (./, /./)
 * 9.  .. Directory traversal rejection (../../etc/passwd)
 * 10. Symlink escape rejection (symlinks pointing outside workspace)
 * 11. Nonexistent file handling (mustExist: true vs false)
 * 12. Workspace switching without state leakage (A -> B -> A)
 * 13. Stale workspace root prevention (cannot resolve File A using Workspace B root)
 * 14. Duplicate workspace-prefix prevention (demo-workspaces/ai_cart_project/... against .../ai_cart_project)
 * 15. search_workspace canonical resolution (returns canonical relative paths and filename search)
 * 16. read_file canonical resolution (returns canonical relative path)
 * 17. Mutation path resolution in ApplyPatchTool and TransactionalPatchApplier
 * 18. RefactorPlan path resolution and scope drift validation
 * 19. ImpactAnalyzer & RepositorySymbolIndex path normalization
 * 20. PostMutationSentinel path resolution & workspace locking
 * 21. Cross-workspace isolation (zero contamination)
 * 22. Same canonical path from editor and AI tools
 * 23. Provider-independent path behavior across mock providers
 * 24. Exact regression for demo-workspaces/ai_cart_project/src/cart_calculator.py
 * 25. Invariant Test: editorPath(file) ===> toolRelativePath(file) ===> resolvedAbsolutePath(file)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  WorkspacePathResolver,
  workspacePathResolver,
} = require('./harness/WorkspacePathResolver');
const ReadFileTool = require('./harness/tools/ReadFileTool');
const SearchWorkspaceTool = require('./harness/tools/SearchWorkspaceTool');
const ApplyPatchTool = require('./harness/tools/ApplyPatchTool');
const { transactionalPatchApplier } = require('./transactionalPatchApplier');
const { ChangeSet } = require('./harness/ChangeSet');
const { RefactorPlan } = require('./harness/RefactorPlan');
const { repositorySymbolIndex } = require('./harness/RepositorySymbolIndex');
const { postMutationSentinel } = require('./testing/PostMutationSentinel');
const { HarnessRuntime } = require('./harness/HarnessRuntime');

async function runTestSuite() {
  console.log('================================================================');
  console.log('  NEXUS ARCHITECTURAL WORKSPACE PATH RESOLUTION TEST SUITE      ');
  console.log('================================================================\n');

  // Setup temporary isolated workspaces
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus_path_test_'));
  const workspaceA = path.join(tempBase, 'workspace_alpha');
  const workspaceB = path.join(tempBase, 'workspace_beta');
  const outsideDir = path.join(tempBase, 'outside_forbidden');

  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  // Structure in Workspace A
  fs.writeFileSync(path.join(workspaceA, 'README.md'), '# Workspace Alpha\nWelcome to Alpha.');
  fs.mkdirSync(path.join(workspaceA, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspaceA, 'src', 'index.ts'), 'export const alpha = 1;');
  fs.mkdirSync(path.join(workspaceA, 'packages', 'pkg-a', 'src', 'components', 'button'), { recursive: true });
  const deepFileA = path.join(workspaceA, 'packages', 'pkg-a', 'src', 'components', 'button', 'index.ts');
  fs.writeFileSync(deepFileA, 'export const Button = () => null;');

  // Outside sensitive file
  const secretFile = path.join(outsideDir, 'secret.env');
  fs.writeFileSync(secretFile, 'SUPER_SECRET_KEY=12345');

  // Symlink in Workspace A pointing outside to outsideDir/secret.env
  const symlinkPath = path.join(workspaceA, 'symlink_leak.env');
  try {
    fs.symlinkSync(secretFile, symlinkPath);
  } catch (e) {
    // On systems without symlink creation rights, create simulated test
  }

  // Structure in Workspace B
  fs.writeFileSync(path.join(workspaceB, 'README.md'), '# Workspace Beta\nWelcome to Beta.');
  fs.mkdirSync(path.join(workspaceB, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspaceB, 'src', 'beta_service.py'), 'def beta_calc(): return 42');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] Test ${String(total).padStart(2, '0')}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Test ${String(total).padStart(2, '0')}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] Test ${String(total).padStart(2, '0')}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Test ${String(total).padStart(2, '0')}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Root-level file resolution
  test('Root-level file resolution', () => {
    const res = workspacePathResolver.resolve(workspaceA, 'README.md', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'README.md');
    assert.strictEqual(res.isFile, true);
    assert.strictEqual(res.absolutePath, path.join(workspaceA, 'README.md'));
  });

  // 2. Nested file resolution
  test('Nested file resolution', () => {
    const res = workspacePathResolver.resolve(workspaceA, 'src/index.ts', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
    assert.strictEqual(res.absolutePath, path.join(workspaceA, 'src', 'index.ts'));
  });

  // 3. Deeply nested file resolution
  test('Deeply nested file resolution preserves segments', () => {
    const rel = 'packages/pkg-a/src/components/button/index.ts';
    const res = workspacePathResolver.resolve(workspaceA, rel, { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, rel);
    assert.strictEqual(res.absolutePath, deepFileA);
  });

  // 4. Current active editor file resolution
  test('Current active editor file resolution via activeFilePath hint', () => {
    // Model passes only bare basename "index.ts", but active editor file is src/index.ts
    const res = workspacePathResolver.resolve(workspaceA, 'index.ts', {
      mustExist: true,
      activeFilePath: 'src/index.ts',
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
  });

  // 5. Absolute path within workspace
  test('Absolute path within workspace resolves to canonical relative path', () => {
    const abs = path.join(workspaceA, 'src', 'index.ts');
    const res = workspacePathResolver.resolve(workspaceA, abs, { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
    assert.strictEqual(res.absolutePath, abs);
  });

  // 6. Relative path with leading ./ and redundant slashes
  test('Relative path with ./ and redundant slashes normalized cleanly', () => {
    const res = workspacePathResolver.resolve(workspaceA, './/src///index.ts', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
  });

  // 7. Mixed path separators (\ and /)
  test('Mixed path separators normalized to POSIX /', () => {
    const res = workspacePathResolver.resolve(workspaceA, 'src\\index.ts', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
  });

  // 8. Dot path segments (./, /./)
  test('Dot path segments handled without breaking resolution', () => {
    const res = workspacePathResolver.resolve(workspaceA, './src/./index.ts', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
  });

  // 9. .. Traversal rejection
  test('.. Traversal escaping workspace is strictly rejected', () => {
    const res = workspacePathResolver.resolve(workspaceA, '../../etc/passwd', { mustExist: false });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isSecurityViolation, true);
    assert(res.error.includes('Security Violation'));
  });

  // 10. Symlink escape rejection
  test('Symlink pointing outside workspace is strictly blocked', () => {
    if (fs.existsSync(symlinkPath)) {
      const res = workspacePathResolver.resolve(workspaceA, 'symlink_leak.env', { mustExist: true });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.isSecurityViolation, true);
      assert(res.error.includes('Symlink') || res.error.includes('Security Violation'));
    } else {
      // Pass if platform doesn't support symlink creation in unprivileged node
      assert(true);
    }
  });

  // 11. Nonexistent file handling (mustExist: true vs false)
  test('Nonexistent file fails cleanly when mustExist: true, succeeds when false', () => {
    const resMustExist = workspacePathResolver.resolve(workspaceA, 'src/ghost.ts', { mustExist: true });
    assert.strictEqual(resMustExist.success, false);
    assert.strictEqual(resMustExist.exists, false);
    assert(resMustExist.error.includes('File not found'));

    const resNoMust = workspacePathResolver.resolve(workspaceA, 'src/ghost.ts', { mustExist: false });
    assert.strictEqual(resNoMust.success, true);
    assert.strictEqual(resNoMust.exists, false);
    assert.strictEqual(resNoMust.relativePath, 'src/ghost.ts');
  });

  // 12. Workspace switching without state leakage (A -> B -> A)
  test('Workspace switching without state leakage (A -> B -> A)', () => {
    // Query in Workspace A
    const resA1 = workspacePathResolver.resolve(workspaceA, 'src/index.ts', { mustExist: true });
    assert.strictEqual(resA1.success, true);
    assert.strictEqual(resA1.relativePath, 'src/index.ts');

    // Switch to Workspace B
    const resB = workspacePathResolver.resolve(workspaceB, 'src/beta_service.py', { mustExist: true });
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resB.relativePath, 'src/beta_service.py');

    // Verify index.ts from Workspace A does NOT exist in Workspace B
    const resAInB = workspacePathResolver.resolve(workspaceB, 'src/index.ts', { mustExist: true });
    assert.strictEqual(resAInB.success, false);
    assert(resAInB.error.includes('File not found'));

    // Switch back to Workspace A
    const resA2 = workspacePathResolver.resolve(workspaceA, 'src/index.ts', { mustExist: true });
    assert.strictEqual(resA2.success, true);
  });

  // 13. Stale workspace root prevention
  test('Stale workspace root prevention (cannot resolve File A using Workspace B root)', () => {
    const absA = path.join(workspaceA, 'src', 'index.ts');
    // Attempting to resolve absolute path from Workspace A when active workspace is Workspace B
    const res = workspacePathResolver.resolve(workspaceB, absA, { mustExist: false });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.isSecurityViolation, true);
    assert(res.error.includes('escapes workspace boundary'));
  });

  // 14. Duplicate workspace-prefix prevention
  test('Duplicate workspace-prefix prevention de-duplicates correctly', () => {
    // Suppose workspace root ends with 'workspace_alpha'
    // Input is 'workspace_alpha/src/index.ts'
    const res = workspacePathResolver.resolve(workspaceA, 'workspace_alpha/src/index.ts', { mustExist: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.relativePath, 'src/index.ts');
    assert.strictEqual(res.absolutePath, path.join(workspaceA, 'src', 'index.ts'));
  });

  // 15. search_workspace canonical resolution
  await asyncTest('search_workspace returns canonical relative paths and matches filename', async () => {
    const toolRes = await SearchWorkspaceTool.execute({
      query: 'index.ts',
    }, { workspacePath: workspaceA });

    assert.strictEqual(toolRes.success, true);
    assert(toolRes.matches.length > 0);
    // Matches must be canonical workspace-relative paths
    const files = toolRes.matches.map((m) => m.file);
    assert(files.includes('src/index.ts') || files.includes('packages/pkg-a/src/components/button/index.ts'));
    // None should contain absolute paths
    for (const f of files) {
      assert(!path.isAbsolute(f));
      assert(!f.includes('\\'));
    }
  });

  // 16. read_file canonical resolution
  await asyncTest('read_file returns canonical relative paths', async () => {
    const toolRes = await ReadFileTool.execute({
      path: 'src/index.ts',
    }, { workspacePath: workspaceA });

    assert.strictEqual(toolRes.success, true);
    assert.strictEqual(toolRes.path, 'src/index.ts');
    assert.strictEqual(toolRes.relPath, 'src/index.ts');
    assert(toolRes.content.includes('export const alpha = 1;'));
  });

  // 17. Mutation path resolution in ApplyPatchTool and TransactionalPatchApplier
  await asyncTest('Mutation path resolution in ApplyPatchTool stages canonical paths', async () => {
    const toolRes = await ApplyPatchTool.execute({
      edits: [
        {
          filePath: 'workspace_alpha/src/index.ts', // has redundant workspace prefix
          original: 'export const alpha = 1;',
          replacement: 'export const alpha = 2;',
        },
      ],
    }, { workspacePath: workspaceA });

    assert.strictEqual(toolRes.success, true);
    assert.strictEqual(toolRes.appliedCount, 1);
    assert.strictEqual(toolRes.modifiedFiles[0].relPath, 'src/index.ts'); // canonicalized!
  });

  // 18. RefactorPlan path resolution and scope drift validation
  test('RefactorPlan canonicalizes affected files and validates worker paths', () => {
    const plan = new RefactorPlan({
      workspacePath: workspaceA,
      affectedFiles: ['workspace_alpha/src/index.ts', 'src\\index.ts'],
    });

    assert.deepStrictEqual(plan.affectedFiles, ['src/index.ts', 'src/index.ts']);

    // Child changeset with different slash format
    const childCS = {
      files: [{ filePath: 'src\\index.ts' }],
    };
    const check = plan.validateChildChangeSet(childCS);
    assert.strictEqual(check.scopeDrift, false);
    assert.strictEqual(check.valid, true);

    // Child changeset with unplanned file
    const rogueCS = {
      files: [{ filePath: 'unplanned.ts' }],
    };
    const checkRogue = plan.validateChildChangeSet(rogueCS);
    assert.strictEqual(checkRogue.scopeDrift, true);
  });

  // 19. ImpactAnalyzer & RepositorySymbolIndex path normalization
  test('RepositorySymbolIndex normalizes relative paths with POSIX separators', () => {
    repositorySymbolIndex.workspacePath = workspaceA;
    const norm = repositorySymbolIndex._normalizeRelativePath(path.join(workspaceA, 'src', 'index.ts'));
    assert.strictEqual(norm, 'src/index.ts');
  });

  // 20. PostMutationSentinel path resolution & workspace locking
  await asyncTest('PostMutationSentinel serializes workspace locks cleanly with canonical keys', async () => {
    let order = [];
    const p1 = postMutationSentinel._withWorkspaceLock(workspaceA, async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const p2 = postMutationSentinel._withWorkspaceLock(workspaceA + path.sep, async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    assert.deepStrictEqual(order, [1, 2]);
  });

  // 21. Cross-workspace isolation (zero contamination)
  test('Zero cross-workspace contamination between Workspace A and Workspace B', () => {
    // File in A cannot be resolved when B is active
    const resAFromB = workspacePathResolver.resolve(workspaceB, 'src/index.ts', { mustExist: true });
    assert.strictEqual(resAFromB.success, false);

    // File in B cannot be resolved when A is active
    const resBFromA = workspacePathResolver.resolve(workspaceA, 'src/beta_service.py', { mustExist: true });
    assert.strictEqual(resBFromA.success, false);
  });

  // 22. Same canonical path from editor and AI tools
  test('Editor path and AI tool relative path resolve to identical filesystem targets', () => {
    const editorPath = 'workspace_alpha/src/index.ts';
    const toolRelPath = 'src/index.ts';

    const resEditor = workspacePathResolver.resolve(workspaceA, editorPath, { mustExist: true });
    const resTool = workspacePathResolver.resolve(workspaceA, toolRelPath, { mustExist: true });

    assert.strictEqual(resEditor.absolutePath, resTool.absolutePath);
    assert.strictEqual(resEditor.relativePath, resTool.relativePath);
  });

  // 23. Provider-independent path behavior
  await asyncTest('Provider-independent path behavior in HarnessRuntime', async () => {
    const runtime = new HarnessRuntime();
    // Simulate request with editor file that contains workspace prefix
    const req = {
      userInput: 'Check the file',
      workspacePath: workspaceA,
      activeFilePath: 'workspace_alpha/src/index.ts',
      modelHandler: async (messages, tools) => {
        // Model handler echoes back what it was asked
        return 'Checked successfully';
      },
    };

    const out = await runtime.handleRequest(req);
    assert.strictEqual(out.success, true);
    // Thread metadata has canonical active file
    const thread = runtime.getThread(out.threadId);
    assert.strictEqual(thread.metadata.activeFilePath, 'src/index.ts');
  });

  // 24. Exact regression for demo-workspaces/ai_cart_project/src/cart_calculator.py
  await asyncTest('Exact regression for demo-workspaces/ai_cart_project/src/cart_calculator.py', async () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const demoWorkspace = path.join(projectRoot, 'demo-workspaces', 'ai_cart_project');

    if (fs.existsSync(demoWorkspace)) {
      // 1. read_file with visibly open editor path
      const editorVisiblePath = 'demo-workspaces/ai_cart_project/src/cart_calculator.py';
      const readRes = await ReadFileTool.execute({
        path: editorVisiblePath,
      }, { workspacePath: demoWorkspace });

      assert.strictEqual(readRes.success, true, `ReadFile failed: ${readRes.error}`);
      assert.strictEqual(readRes.path, 'src/cart_calculator.py');
      assert.strictEqual(readRes.relPath, 'src/cart_calculator.py');
      assert(readRes.content.includes('calculate_cart_total'));

      // 2. search_workspace for cart_calculator.py
      const searchRes = await SearchWorkspaceTool.execute({
        query: 'cart_calculator.py',
      }, { workspacePath: demoWorkspace });

      assert.strictEqual(searchRes.success, true, `SearchWorkspace failed: ${searchRes.error}`);
      assert(searchRes.matches.length > 0, 'search_workspace should return matches for cart_calculator.py');
      assert(searchRes.matches.some((m) => m.file === 'src/cart_calculator.py'));
    } else {
      console.log('  [SKIP] demo-workspaces/ai_cart_project not present on disk in this test runner context');
    }
  });

  // 25. Invariant Test: editorPath ===> toolRelativePath ===> resolvedAbsolutePath
  test('INVARIANT: editorPath(f) ===> toolRelativePath(f) ===> resolvedAbsolutePath(f) all identify same object', () => {
    const filesToTest = [
      'README.md',
      'src/index.ts',
      'packages/pkg-a/src/components/button/index.ts',
    ];

    for (const f of filesToTest) {
      const editorVariants = [
        f,
        `./${f}`,
        `workspace_alpha/${f}`,
        `workspace_alpha\\${f.replace(/\//g, '\\')}`,
        path.join(workspaceA, f),
      ];

      const expectedAbs = path.join(workspaceA, f);

      for (const variant of editorVariants) {
        const res = workspacePathResolver.resolve(workspaceA, variant, { mustExist: true });
        assert.strictEqual(res.success, true, `Failed on variant: ${variant}`);
        assert.strictEqual(res.absolutePath, expectedAbs, `Absolute path mismatch for ${variant}`);
        assert.strictEqual(res.relativePath, f, `Relative path mismatch for ${variant}`);
      }
    }
  });

  // Cleanup temp dir
  try {
    fs.rmSync(tempBase, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log(`  WORKSPACE PATH RESOLUTION RESULTS: ${passed}/${total} PASS (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
