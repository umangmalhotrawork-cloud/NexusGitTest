/**
 * NEXUS INTELLIGENCE LAYER — REMOTE REPOSITORY PREFLIGHT (Phase 4D)
 * 
 * Deterministic Git remote preflight validator for cloud deployment providers (Render, Vercel).
 * 
 * STRICT INVARIANTS:
 * - 0 LLM/AI tokens used. 100% deterministic local Git inspection.
 * - Distinguishes host IDE repository from nested project workspaces.
 * - Never silently inherits parent enclosing repository for nested disposable fixtures.
 * - Emits structured blocker with code 'DEPLOYMENT_SOURCE_UNCONFIGURED' when deployment source is not established.
 * - Emits structured blocker with code 'PROVIDER_REPOSITORY_CONTENT_MISSING' when remote content differs from local workspace.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPOSITORY_SOURCE = Object.freeze({
  WORKSPACE_GIT: 'WORKSPACE_GIT',
  PARENT_GIT: 'PARENT_GIT',
  EXPLICIT_PROVIDER_REPOSITORY: 'EXPLICIT_PROVIDER_REPOSITORY',
  NONE: 'NONE',
});

const EXECUTION_SOURCE = Object.freeze({
  GIT_REMOTE: 'GIT_REMOTE',
  LOCAL_WORKSPACE: 'LOCAL_WORKSPACE',
  UNCONFIGURED: 'UNCONFIGURED',
});

class RemoteRepositoryPreflight {
  constructor(options = {}) {
    this.execFn = options.execFn || null; // For unit testing dependency injection
  }

  /**
   * Reads remote URL and HEAD branch from a given .git directory/file
   * @param {string} gitPath
   * @returns {{ repoUrl: string|null, branch: string, gitDir: string }}
   */
  readGitDirInfo(gitPath) {
    let gitDir = gitPath;
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, 'utf8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/i);
        if (match && match[1]) {
          gitDir = path.resolve(path.dirname(gitPath), match[1].trim());
        }
      }
    } catch (_) {}

    let repoUrl = null;
    let branch = 'main';

    // 1. Read config to find remote origin URL
    const configPath = path.join(gitDir, 'config');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const originMatch = configContent.match(/\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\r\n]+)/is)
          || configContent.match(/\[remote\s+"[^"]+"\][^\[]*?url\s*=\s*([^\r\n]+)/is);

        if (originMatch && originMatch[1]) {
          let rawUrl = originMatch[1].trim();
          if (rawUrl.startsWith('git@')) {
            const parts = rawUrl.replace(/^git@/, '').split(':');
            if (parts.length === 2) {
              rawUrl = `https://${parts[0]}/${parts[1]}`;
            }
          }
          repoUrl = rawUrl;
        }
      } catch (_) {}
    }

    // 2. Read HEAD to find active branch
    const headPath = path.join(gitDir, 'HEAD');
    if (fs.existsSync(headPath)) {
      try {
        const headContent = fs.readFileSync(headPath, 'utf8').trim();
        const branchMatch = headContent.match(/^ref:\s*refs\/heads\/(.+)$/i);
        if (branchMatch && branchMatch[1]) {
          branch = branchMatch[1].trim();
        }
      } catch (_) {}
    }

    return { repoUrl, branch, gitDir };
  }

  /**
   * Resolves explicit deployment repository context for a workspace,
   * distinguishing own git from enclosing/parent git repository.
   * @param {string} workspacePath
   * @param {Object} [options]
   * @returns {Object} deploymentRepositoryContext
   */
  resolveDeploymentRepositoryContext(workspacePath, options = {}) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return {
        workspacePath: '',
        projectRoot: '',
        gitRoot: null,
        remoteUrl: null,
        branch: null,
        repositorySource: REPOSITORY_SOURCE.NONE,
        confidence: 'NONE',
        hasOwnGit: false,
        isNestedInParentRepo: false,
        parentGitRoot: null,
        parentRepoName: null,
        parentRemoteUrl: null,
        parentBranch: null,
      };
    }

    const normWorkspace = path.resolve(workspacePath);

    // 1. Check for explicit repository declaration in options
    const explicitRepo = options.repository || options.repo || options.repositoryUrl || options.selectedRepo || null;
    if (explicitRepo && typeof explicitRepo === 'string' && explicitRepo.trim()) {
      const explicitBranch = options.branch || options.selectedBranch || 'main';
      const projectRoot = options.projectRoot || options.rootDir || '.';
      return {
        workspacePath: normWorkspace,
        projectRoot,
        gitRoot: null,
        remoteUrl: explicitRepo.trim(),
        branch: explicitBranch,
        repositorySource: REPOSITORY_SOURCE.EXPLICIT_PROVIDER_REPOSITORY,
        confidence: 'HIGH',
        hasOwnGit: false,
        isNestedInParentRepo: false,
        parentGitRoot: null,
        parentRepoName: null,
        parentRemoteUrl: null,
        parentBranch: null,
      };
    }

    // 2. Check if the workspace itself has a .git directory or worktree file
    const ownGitCandidate = path.join(normWorkspace, '.git');
    if (fs.existsSync(ownGitCandidate)) {
      const gitInfo = this.readGitDirInfo(ownGitCandidate);
      return {
        workspacePath: normWorkspace,
        projectRoot: normWorkspace,
        gitRoot: normWorkspace,
        remoteUrl: gitInfo.repoUrl,
        branch: gitInfo.branch,
        repositorySource: REPOSITORY_SOURCE.WORKSPACE_GIT,
        confidence: 'HIGH',
        hasOwnGit: true,
        isNestedInParentRepo: false,
        parentGitRoot: null,
        parentRepoName: null,
        parentRemoteUrl: null,
        parentBranch: null,
      };
    }

    // 3. Workspace has no own .git -> inspect parent hierarchy for enclosing Git repo (e.g. host IDE)
    let current = path.dirname(normWorkspace);
    let parentGitPath = null;
    let parentGitRootDir = null;

    while (current && current !== path.dirname(current)) {
      const candidate = path.join(current, '.git');
      if (fs.existsSync(candidate)) {
        parentGitPath = candidate;
        parentGitRootDir = current;
        break;
      }
      current = path.dirname(current);
    }

    if (parentGitPath && parentGitRootDir) {
      const parentGitInfo = this.readGitDirInfo(parentGitPath);
      const parentRepoName = path.basename(parentGitRootDir);
      return {
        workspacePath: normWorkspace,
        projectRoot: normWorkspace,
        gitRoot: null, // Workspace has no git root of its own
        remoteUrl: null, // Do not silently inherit parent repo
        branch: null,
        repositorySource: REPOSITORY_SOURCE.PARENT_GIT,
        confidence: 'LOW',
        hasOwnGit: false,
        isNestedInParentRepo: true,
        parentGitRoot: parentGitRootDir,
        parentRepoName,
        parentRemoteUrl: parentGitInfo.repoUrl,
        parentBranch: parentGitInfo.branch,
      };
    }

    // 4. No Git repository found anywhere
    return {
      workspacePath: normWorkspace,
      projectRoot: normWorkspace,
      gitRoot: null,
      remoteUrl: null,
      branch: null,
      repositorySource: REPOSITORY_SOURCE.NONE,
      confidence: 'NONE',
      hasOwnGit: false,
      isNestedInParentRepo: false,
      parentGitRoot: null,
      parentRepoName: null,
      parentRemoteUrl: null,
      parentBranch: null,
    };
  }

  /**
   * Resolves remote repository URL, active branch, and repository root for workspace
   * Note: By default, this does NOT inherit parent repositories for deployment safety.
   * @param {string} workspacePath
   * @param {Object} [options]
   * @returns {{ repoUrl: string, branch: string, gitRoot: string, gitDir?: string, repositorySource: string }|null}
   */
  resolveGitMetadata(workspacePath, options = {}) {
    const repoContext = this.resolveDeploymentRepositoryContext(workspacePath, options);

    if (repoContext.repositorySource === REPOSITORY_SOURCE.EXPLICIT_PROVIDER_REPOSITORY) {
      return {
        repoUrl: repoContext.remoteUrl,
        branch: repoContext.branch,
        gitRoot: null,
        repositorySource: repoContext.repositorySource,
      };
    }

    if (repoContext.repositorySource === REPOSITORY_SOURCE.WORKSPACE_GIT) {
      return {
        repoUrl: repoContext.remoteUrl,
        branch: repoContext.branch,
        gitRoot: repoContext.gitRoot,
        gitDir: path.join(repoContext.gitRoot, '.git'),
        repositorySource: repoContext.repositorySource,
      };
    }

    // If caller explicitly allows parent repo (e.g. host IDE internal inspection)
    if (options.allowParentRepo && repoContext.repositorySource === REPOSITORY_SOURCE.PARENT_GIT) {
      return {
        repoUrl: repoContext.parentRemoteUrl,
        branch: repoContext.parentBranch,
        gitRoot: repoContext.parentGitRoot,
        gitDir: path.join(repoContext.parentGitRoot, '.git'),
        repositorySource: repoContext.repositorySource,
      };
    }

    return null;
  }

  /**
   * Resolves service target directory relative to the project root
   * @param {string} workspacePath
   * @param {Object} serviceTarget
   * @param {Object|string} [options]
   * @returns {string} e.g. "backend", "frontend", or "demo-workspaces/nexus-fullstack-deployment-test/frontend"
   */
  resolveServiceRootDir(workspacePath, serviceTarget = {}, options = {}) {
    let explicitRoot = null;
    if (typeof options === 'string') {
      explicitRoot = options;
    } else if (options && typeof options === 'object') {
      explicitRoot = options.rootDir || options.projectRoot || options.selectedRootDir || null;
    }

    const svcRoot = serviceTarget.rootDir && serviceTarget.rootDir !== '.' && serviceTarget.rootDir !== './'
      ? serviceTarget.rootDir.replace(/^\.\//, '').replace(/\\/g, '/')
      : '';

    if (explicitRoot && explicitRoot !== '.' && explicitRoot !== './') {
      const cleanExplicit = explicitRoot.replace(/^\.\//, '').replace(/\\/g, '/');
      if (svcRoot) {
        if (cleanExplicit.endsWith(svcRoot)) {
          return cleanExplicit;
        }
        return `${cleanExplicit}/${svcRoot}`;
      }
      return cleanExplicit;
    }

    return svcRoot || '.';
  }

  /**
   * Validates whether the service exists in the remote Git tracking branch
   * @param {Object} params
   * @param {string} params.workspacePath
   * @param {Object} params.serviceTarget
   * @param {Object} [params.options]
   * @returns {{ valid: boolean, code?: string, repository?: string, branch?: string, requestedRootDir?: string, reason?: string, suggestedFix?: string, message?: string, skipped?: boolean, suggestedActions?: string[] }}
   */
  verifyService(params = {}) {
    const { workspacePath, serviceTarget = {}, options = {} } = params;

    if (options.allowMockRepo || options.skipRemotePreflight) {
      return { valid: true, skipped: true, reason: 'Mock repository or preflight skip configured for testing.' };
    }

    if (options.executionSource === EXECUTION_SOURCE.LOCAL_WORKSPACE) {
      return { valid: true, skipped: true, reason: 'Local workspace execution mode active (remote repository preflight bypassed).' };
    }

    const repoContext = this.resolveDeploymentRepositoryContext(workspacePath, options);

    // 1. Nested workspace without own git repo and no explicit deployment repo selected
    if (repoContext.repositorySource === REPOSITORY_SOURCE.PARENT_GIT && !options.allowParentRepo) {
      const parentName = repoContext.parentRepoName || 'enclosing Git repository';
      return {
        valid: false,
        code: 'DEPLOYMENT_SOURCE_UNCONFIGURED',
        repositorySource: REPOSITORY_SOURCE.PARENT_GIT,
        parentRepoName: repoContext.parentRepoName,
        parentRemoteUrl: repoContext.parentRemoteUrl,
        reason: `Deployment source has not been explicitly established. Local workspace is nested inside parent repository '${parentName}' which will not be used automatically for deployment.`,
        suggestedFix: 'Choose [Use Local Workspace] for direct local deployment, or [Select Git Repository] to link a deployment repository.',
        message: `Deployment source has not been explicitly established. Local workspace is nested in parent repository '${parentName}' which will not be used automatically.`,
        suggestedActions: ['USE_LOCAL_WORKSPACE', 'SELECT_GIT_REPOSITORY'],
      };
    }

    // 2. Workspace without any git repository (standalone local directory)
    if (repoContext.repositorySource === REPOSITORY_SOURCE.NONE) {
      return {
        valid: true,
        skipped: true,
        reason: 'No Git repository remote origin detected for workspace.',
      };
    }

    // 3. Workspace has its own Git repo or explicit repository declaration
    const repoUrl = repoContext.remoteUrl;
    const effectiveBranch = options.branch || repoContext.branch || 'main';
    const requestedRootDir = this.resolveServiceRootDir(workspacePath, serviceTarget, {
      ...options,
      rootDir: options.rootDir || repoContext.projectRoot,
    });
    // Resolve execution working directory for Git inspection
    let execCwd = repoContext.gitRoot || (workspacePath ? path.resolve(workspacePath) : process.cwd());
    let curr = execCwd;
    while (curr && curr !== path.dirname(curr)) {
      if (fs.existsSync(path.join(curr, '.git'))) {
        execCwd = curr;
        break;
      }
      curr = path.dirname(curr);
    }

    // If custom exec function provided (testing) or default child_process
    const runCmd = (cmd) => {
      if (typeof this.execFn === 'function') {
        return this.execFn(cmd, { gitRoot: execCwd, repoUrl, branch: effectiveBranch, rootDir: requestedRootDir });
      }
      if (typeof options.execFn === 'function') {
        return options.execFn(cmd, { gitRoot: execCwd, repoUrl, branch: effectiveBranch, rootDir: requestedRootDir });
      }

      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      };
      return execSync(cmd, { cwd: execCwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    };

    try {
      // 1. Verify if the target rootDir exists in origin/<branch>
      if (requestedRootDir === '.') {
        // Root directory: verify remote tracking branch ref exists
        try {
          runCmd(`git rev-parse --verify origin/${effectiveBranch}`);
        } catch (_) {
          return {
            valid: false,
            code: 'PROVIDER_REPOSITORY_CONTENT_MISSING',
            repository: repoUrl,
            branch: effectiveBranch,
            requestedRootDir,
            reason: `Remote branch '${effectiveBranch}' does not exist on remote repository '${repoUrl}'.`,
            suggestedFix: `Push your local branch '${effectiveBranch}' to remote repository '${repoUrl}', or select an existing remote branch.`,
            message: `Local workspace differs from remote repository: Remote branch '${effectiveBranch}' does not exist on repository '${repoUrl}'.`,
          };
        }
      } else {
        let treeOutput = '';
        try {
          treeOutput = runCmd(`git ls-tree origin/${effectiveBranch} -- "${requestedRootDir}"`).trim();
        } catch (err) {
          // If branch ref doesn't exist remotely
          return {
            valid: false,
            code: 'PROVIDER_REPOSITORY_CONTENT_MISSING',
            repository: repoUrl,
            branch: effectiveBranch,
            requestedRootDir,
            reason: `Remote branch '${effectiveBranch}' does not exist on remote repository '${repoUrl}'.`,
            suggestedFix: `Push your local branch '${effectiveBranch}' to remote repository '${repoUrl}', or switch to a branch that exists on the remote.`,
            message: `Local workspace differs from remote repository: Remote branch '${effectiveBranch}' not found on repository '${repoUrl}'.`,
          };
        }

        if (!treeOutput) {
          // Check if it exists in local HEAD (committed but unpushed vs untracked)
          let headOutput = '';
          try {
            headOutput = runCmd(`git ls-tree HEAD -- "${requestedRootDir}"`).trim();
          } catch (_) {}

          const isCommittedLocally = Boolean(headOutput);

          // Get list of uncommitted/untracked files in requestedRootDir if any
          const uncommittedFiles = [];
          try {
            const statusOutput = runCmd(`git status --porcelain -- "${requestedRootDir}"`).trim();
            if (statusOutput) {
              const lines = statusOutput.split('\n');
              for (const l of lines) {
                const trimmed = l.trim();
                if (trimmed) {
                  const parts = trimmed.split(/\s+/);
                  const st = parts[0];
                  const filePath = parts.slice(1).join(' ');
                  uncommittedFiles.push({ path: filePath, status: st });
                }
              }
            }
          } catch (_) {}

          let reason;
          if (isCommittedLocally) {
            reason = `The directory '${requestedRootDir}' is committed locally in HEAD, but has not been pushed to remote branch '${effectiveBranch}' on repository '${repoUrl}'.`;
          } else {
            reason = `The directory '${requestedRootDir}' exists locally in your workspace as untracked/uncommitted files and does not exist in remote branch '${effectiveBranch}' on repository '${repoUrl}'.`;
          }

          const suggestedFix = isCommittedLocally
            ? `Push your local commit(s) on branch '${effectiveBranch}' to remote repository '${repoUrl}'.`
            : `Commit and push the project files in '${requestedRootDir}' to branch '${effectiveBranch}', or select a repository/branch/rootDir that actually contains the project.`;
          const message = `Local workspace differs from remote repository: Directory '${requestedRootDir}' does not exist in remote branch '${effectiveBranch}' on repository '${repoUrl}'. ${suggestedFix}`;

          return {
            valid: false,
            code: 'PROVIDER_REPOSITORY_CONTENT_MISSING',
            repository: repoUrl,
            branch: effectiveBranch,
            requestedRootDir,
            isCommittedLocally,
            uncommittedFiles,
            reason,
            suggestedFix,
            message,
          };
        }
      }

      return {
        valid: true,
        repository: repoUrl,
        branch: effectiveBranch,
        requestedRootDir,
      };
    } catch (err) {
      return {
        valid: false,
        code: 'PROVIDER_REPOSITORY_CONTENT_MISSING',
        repository: repoUrl,
        branch: effectiveBranch,
        requestedRootDir,
        reason: `Git preflight inspection failed: ${err.message}`,
        suggestedFix: `Ensure git is configured and remote branch '${effectiveBranch}' is accessible.`,
        message: `Local workspace differs from remote repository: ${err.message}`,
      };
    }
  }
}

const remoteRepositoryPreflight = new RemoteRepositoryPreflight();

module.exports = {
  REPOSITORY_SOURCE,
  EXECUTION_SOURCE,
  RemoteRepositoryPreflight,
  remoteRepositoryPreflight,
};
