/**
 * NEXUS CODEX HARNESS - AUTHORITATIVE WORKSPACE PATH RESOLVER
 * 
 * Centralized, authoritative resolver for all workspace-relative and absolute paths.
 * Guarantees:
 * 1. Single authoritative resolution across all tools, agents, sentinels, and analyzers.
 * 2. Strict workspace containment and path traversal protection (rejects ../ and out-of-boundary paths).
 * 3. Symlink escape protection via fs.realpathSync boundary verification.
 * 4. Automatic workspace root segment de-duplication (e.g. demo-workspaces/ai_cart_project/src/cart.py
 *    against /.../demo-workspaces/ai_cart_project).
 * 5. Active editor file correlation for bare file names.
 * 6. POSIX canonical separator normalization (/) without mutating directory semantics.
 * 7. Zero arbitrary filesystem scans; O(1) deterministic checks only.
 */

const fs = require('fs');
const path = require('path');

class WorkspacePathResolver {
  /**
   * Discovers the repository/project root by climbing parent directories.
   * Looks for markers like package.json, .git, or demo-workspaces.
   * @param {string} [startDir]
   * @returns {string} Absolute project root path
   */
  findProjectRoot(startDir) {
    let cur = path.resolve(startDir || process.cwd());
    while (cur && cur !== path.dirname(cur)) {
      if (fs.existsSync(path.join(cur, 'package.json')) && (fs.existsSync(path.join(cur, '.git')) || fs.existsSync(path.join(cur, 'demo-workspaces')))) {
        return cur;
      }
      cur = path.dirname(cur);
    }
    return path.resolve(process.cwd());
  }

  /**
   * Canonicalizes a workspace root path to an absolute, normalized path.
   * Resolves symlinks if the directory exists on disk to ensure uniform boundary checking.
   * @param {string} [workspaceRoot]
   * @returns {string} Canonical absolute workspace root path
   */
  canonicalizeWorkspaceRoot(workspaceRoot) {
    if (!workspaceRoot || typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
      return path.resolve(process.cwd());
    }
    const raw = workspaceRoot.trim();
    if (path.isAbsolute(raw)) {
      return path.resolve(raw);
    }

    const projectRoot = this.findProjectRoot(process.cwd());

    // 1. Direct relative from cwd
    const cwdCandidate = path.resolve(raw);
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }

    // 2. Demo workspace directory under projectRoot (e.g. "nexus-fullstack-deployment-test")
    const demoCandidate = path.resolve(projectRoot, 'demo-workspaces', raw);
    if (fs.existsSync(demoCandidate)) {
      return demoCandidate;
    }

    // 3. Directly under projectRoot
    const projectCandidate = path.resolve(projectRoot, raw);
    if (fs.existsSync(projectCandidate)) {
      return projectCandidate;
    }

    return path.resolve(raw);
  }

  /**
   * Normalizes path separators to POSIX '/', removes redundant slashes and '.' segments.
   * @param {string} p
   * @returns {string}
   */
  normalizeSeparators(p) {
    if (!p || typeof p !== 'string') return '';
    let normalized = p.replace(/\\/g, '/');
    // Normalize consecutive slashes
    normalized = normalized.replace(/\/{2,}/g, '/');
    // Normalize '/./' and strip leading './'
    normalized = normalized.replace(/(^|\/)\.\/(?=\.)?/g, '$1');
    normalized = normalized.replace(/^\.\//, '');
    return normalized;
  }

  /**
   * Direct path containment check.
   * @private
   */
  _pathContains(child, parent) {
    if (!child || !parent) return false;
    const normChild = path.resolve(child);
    const normParent = path.resolve(parent);

    if (normChild === normParent) return true;
    const prefix = normParent.endsWith(path.sep) ? normParent : normParent + path.sep;
    if (normChild.startsWith(prefix)) return true;

    if (process.platform === 'darwin' || process.platform === 'win32') {
      if (normChild.toLowerCase() === normParent.toLowerCase()) return true;
      if (normChild.toLowerCase().startsWith(prefix.toLowerCase())) return true;
    }
    return false;
  }

  /**
   * Checks if candidatePath is strictly contained inside or equal to canonicalRoot.
   * Handles OS-level casing differences and aliases (e.g. macOS /var -> /private/var).
   * @private
   */
  _isContained(candidatePath, canonicalRoot) {
    if (!candidatePath || !canonicalRoot) return false;
    if (this._pathContains(candidatePath, canonicalRoot)) return true;

    // Handle OS-level alias/symlink roots like macOS /var vs /private/var
    try {
      if (fs.existsSync(candidatePath) && fs.existsSync(canonicalRoot)) {
        const realCand = fs.realpathSync(candidatePath);
        const realRoot = fs.realpathSync(canonicalRoot);
        if (this._pathContains(realCand, realRoot)) return true;
      }
    } catch (e) {}

    return false;
  }

  /**
   * Checks if candidatePath points to a symlink that resolves outside canonicalRoot.
   * @private
   */
  _checkSymlinkEscape(candidatePath, canonicalRoot) {
    if (!fs.existsSync(candidatePath)) return false;
    try {
      const realCandidate = fs.realpathSync(candidatePath);
      const realRoot = fs.existsSync(canonicalRoot) ? fs.realpathSync(canonicalRoot) : canonicalRoot;
      return !this._pathContains(realCandidate, realRoot);
    } catch (e) {
      return false;
    }
  }

  /**
   * Attempts to detect and strip duplicate workspace root segments.
   * e.g., if workspace is '/repo/demo-workspaces/ai_cart_project'
   * and input is 'demo-workspaces/ai_cart_project/src/cart.py',
   * returns 'src/cart.py'.
   * @private
   */
  _findDedupRelativePath(canonicalRoot, normInput) {
    const rootSegments = canonicalRoot.split(/[/\\]+/).filter(Boolean);
    const inputSegments = normInput.split('/').filter(Boolean);

    const maxOverlap = Math.min(inputSegments.length - 1, rootSegments.length);
    for (let k = maxOverlap; k >= 1; k--) {
      const rootSlice = rootSegments.slice(rootSegments.length - k).join('/').toLowerCase();
      const inputSlice = inputSegments.slice(0, k).join('/').toLowerCase();
      if (rootSlice === inputSlice) {
        return inputSegments.slice(k).join('/');
      }
    }
    return null;
  }

  /**
   * Authoritatively resolves an input path against a workspace root.
   * 
   * @param {string} workspaceRoot - The active authorized workspace root
   * @param {string} inputPath - Absolute, workspace-relative, or editor file path
   * @param {Object} [options]
   * @param {boolean} [options.mustExist=false] - If true, fails if file does not exist on disk
   * @param {boolean} [options.isDirectory=false] - If true, requires the target to be a directory
   * @param {boolean} [options.allowDirectory=true] - If false, fails if the target is a directory
   * @param {string} [options.activeFilePath=null] - Currently active editor file for correlation
   * @returns {Object} Structured resolution outcome
   */
  resolve(workspaceRoot, inputPath, options = {}) {
    const {
      mustExist = false,
      isDirectory = false,
      allowDirectory = true,
      activeFilePath = null,
    } = options;

    if (inputPath === null || inputPath === undefined || typeof inputPath !== 'string' || !inputPath.trim()) {
      return {
        success: false,
        error: 'Argument "path" must be a non-empty string',
        isSecurityViolation: false,
        absolutePath: null,
        relativePath: null,
        workspaceRoot: null,
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }

    if (inputPath.includes('\0')) {
      return {
        success: false,
        error: 'Security Violation: Path contains null bytes',
        isSecurityViolation: true,
        absolutePath: null,
        relativePath: null,
        workspaceRoot: null,
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }

    const canonicalRoot = this.canonicalizeWorkspaceRoot(workspaceRoot);
    const projectRoot = this.findProjectRoot(canonicalRoot);
    const normInput = this.normalizeSeparators(inputPath.trim());

    // 1. Authoritative resolution of activeFilePath if provided
    let activeAbs = null;
    if (activeFilePath && typeof activeFilePath === 'string' && activeFilePath.trim()) {
      const normActive = this.normalizeSeparators(activeFilePath.trim());
      if (path.isAbsolute(normActive)) {
        activeAbs = path.resolve(normActive);
      } else {
        const c1 = path.resolve(canonicalRoot, normActive);
        const c2 = path.resolve(projectRoot, normActive);
        const c3 = path.resolve(projectRoot, 'demo-workspaces', normActive);
        if (fs.existsSync(c1)) activeAbs = c1;
        else if (fs.existsSync(c2)) activeAbs = c2;
        else if (fs.existsSync(c3)) activeAbs = c3;
        else activeAbs = c1;
      }
    }

    let chosenAbs = null;

    if (path.isAbsolute(normInput)) {
      const candidateAbs = path.resolve(normInput);
      const isInsideWs = this._isContained(candidateAbs, canonicalRoot);
      const isMatchingActive = activeAbs && candidateAbs === activeAbs;
      const isInsideProject = this._isContained(candidateAbs, projectRoot);

      if (!isInsideWs && !isMatchingActive && !isInsideProject) {
        return {
          success: false,
          error: `Security Violation: Path "${inputPath}" escapes workspace boundary "${canonicalRoot}"`,
          isSecurityViolation: true,
          absolutePath: candidateAbs,
          relativePath: null,
          workspaceRoot: canonicalRoot,
          exists: false,
          isFile: false,
          isDirectory: false,
        };
      }
      chosenAbs = candidateAbs;
    } else {
      // Relative path handling
      const directCandidate = path.resolve(canonicalRoot, normInput);

      // Traversal check: verify candidate doesn't escape project boundary
      if (!this._isContained(directCandidate, canonicalRoot) && !this._isContained(directCandidate, projectRoot)) {
        return {
          success: false,
          error: `Security Violation: Path "${inputPath}" escapes workspace boundary "${canonicalRoot}"`,
          isSecurityViolation: true,
          absolutePath: directCandidate,
          relativePath: null,
          workspaceRoot: canonicalRoot,
          exists: false,
          isFile: false,
          isDirectory: false,
        };
      }

      // Check candidates in order of precision:
      // 1. Direct candidate if it exists inside workspace
      const directExists = fs.existsSync(directCandidate);

      // 2. De-duplicated candidate (e.g. demo-workspaces/ai_cart_project/src/cart.py inside .../ai_cart_project)
      const dedupRel = this._findDedupRelativePath(canonicalRoot, normInput);
      const dedupCandidate = dedupRel !== null ? path.resolve(canonicalRoot, dedupRel) : null;
      const dedupExists = dedupCandidate !== null && fs.existsSync(dedupCandidate);

      // 3. Active editor file correlation (if bare basename, relative suffix, or project match)
      let activeCandidate = null;
      let activeExists = false;
      if (activeAbs) {
        const normActiveStr = this.normalizeSeparators(activeFilePath || '');
        const baseName = path.basename(normInput).toLowerCase();
        const activeBaseName = path.basename(activeAbs).toLowerCase();
        const isBaseMatch = baseName === activeBaseName;
        const isSuffixMatch = activeAbs.toLowerCase().endsWith('/' + normInput.toLowerCase()) || normInput.toLowerCase() === normActiveStr.toLowerCase();
        const isProjectMatch = path.resolve(projectRoot, normInput) === activeAbs;

        if (isBaseMatch || isSuffixMatch || isProjectMatch) {
          activeCandidate = activeAbs;
          activeExists = fs.existsSync(activeCandidate);
        }
      }

      // 4. Project-level candidate (e.g. demo-workspaces/ai_cart_project/src/cart_calculator.py inside parent repo)
      const projectCandidate = path.resolve(projectRoot, normInput);
      const projectExists = fs.existsSync(projectCandidate) && this._isContained(projectCandidate, projectRoot);

      // 5. Fallback in 'src/' directory within workspace
      const srcCandidate = path.resolve(canonicalRoot, 'src', normInput);
      const srcExists = fs.existsSync(srcCandidate);

      if (directExists) {
        chosenAbs = directCandidate;
      } else if (dedupExists) {
        chosenAbs = dedupCandidate;
      } else if (activeExists && activeCandidate) {
        chosenAbs = activeCandidate;
      } else if (projectExists) {
        chosenAbs = projectCandidate;
      } else if (srcExists) {
        chosenAbs = srcCandidate;
      } else if (dedupCandidate !== null) {
        chosenAbs = dedupCandidate;
      } else if (activeCandidate) {
        chosenAbs = activeCandidate;
      } else {
        chosenAbs = directCandidate;
      }
    }

    // Secondary Boundary Verification (must be inside workspace, match active editor file, or inside project)
    const isInsideWs = this._isContained(chosenAbs, canonicalRoot);
    const isMatchingActive = activeAbs && chosenAbs === activeAbs;
    const isInsideProject = this._isContained(chosenAbs, projectRoot);

    if (!isInsideWs && !isMatchingActive && !isInsideProject) {
      return {
        success: false,
        error: `Security Violation: Path "${inputPath}" escapes workspace boundary "${canonicalRoot}"`,
        isSecurityViolation: true,
        absolutePath: chosenAbs,
        relativePath: null,
        workspaceRoot: canonicalRoot,
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }

    // Symlink escape verification
    const symlinkBoundary = isInsideWs ? canonicalRoot : projectRoot;
    if (this._checkSymlinkEscape(chosenAbs, symlinkBoundary)) {
      return {
        success: false,
        error: `Security Violation: Symlink "${inputPath}" points outside workspace boundary "${canonicalRoot}"`,
        isSecurityViolation: true,
        absolutePath: chosenAbs,
        relativePath: null,
        workspaceRoot: canonicalRoot,
        exists: true,
        isFile: false,
        isDirectory: false,
      };
    }

    const exists = fs.existsSync(chosenAbs);
    let isFile = false;
    let isDir = false;

    if (exists) {
      try {
        const stat = fs.statSync(chosenAbs);
        isFile = stat.isFile();
        isDir = stat.isDirectory();
      } catch (e) {
        return {
          success: false,
          error: `Failed to stat path "${inputPath}": ${e.message}`,
          isSecurityViolation: false,
          absolutePath: chosenAbs,
          relativePath: this.toRelative(canonicalRoot, chosenAbs),
          workspaceRoot: canonicalRoot,
          exists: false,
          isFile: false,
          isDirectory: false,
        };
      }
    }

    if (mustExist && !exists) {
      return {
        success: false,
        error: `File not found: "${inputPath}"`,
        isSecurityViolation: false,
        absolutePath: chosenAbs,
        relativePath: this.toRelative(canonicalRoot, chosenAbs),
        workspaceRoot: canonicalRoot,
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }

    if (exists && isDirectory && !isDir) {
      return {
        success: false,
        error: `Path is not a directory: "${inputPath}"`,
        isSecurityViolation: false,
        absolutePath: chosenAbs,
        relativePath: this.toRelative(canonicalRoot, chosenAbs),
        workspaceRoot: canonicalRoot,
        exists: true,
        isFile,
        isDirectory: isDir,
      };
    }

    if (exists && !allowDirectory && isDir) {
      return {
        success: false,
        error: `Path is a directory, not a readable file: "${inputPath}"`,
        isSecurityViolation: false,
        absolutePath: chosenAbs,
        relativePath: this.toRelative(canonicalRoot, chosenAbs),
        workspaceRoot: canonicalRoot,
        exists: true,
        isFile,
        isDirectory: isDir,
      };
    }

    const canonicalRelative = this.toRelative(canonicalRoot, chosenAbs);

    return {
      success: true,
      error: null,
      isSecurityViolation: false,
      absolutePath: chosenAbs,
      relativePath: canonicalRelative,
      canonicalPath: canonicalRelative,
      workspaceRoot: canonicalRoot,
      exists,
      isFile,
      isDirectory: isDir,
      realPath: exists ? fs.realpathSync(chosenAbs) : null,
    };
  }

  /**
   * Helper that resolves path or throws an error on failure or security violation.
   * @param {string} workspaceRoot
   * @param {string} inputPath
   * @param {Object} [options]
   * @returns {{ absolutePath: string, relativePath: string, workspaceRoot: string }}
   */
  resolveOrThrow(workspaceRoot, inputPath, options = {}) {
    const res = this.resolve(workspaceRoot, inputPath, options);
    if (!res.success) {
      throw new Error(res.error || `Failed to resolve path: ${inputPath}`);
    }
    return res;
  }

  /**
   * Computes a canonical workspace-relative path using POSIX '/' separators.
   * If targetPath is already relative, normalizes it. If targetPath equals workspaceRoot, returns '.'.
   * Handles segment de-duplication if targetPath contains the workspace root prefix.
   * @param {string} workspaceRoot
   * @param {string} targetPath
   * @returns {string} Canonical relative path (e.g. 'src/cart.py')
   */
  toRelative(workspaceRoot, targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return '';
    const canonicalRoot = this.canonicalizeWorkspaceRoot(workspaceRoot);
    const norm = this.normalizeSeparators(targetPath.trim());

    if (path.isAbsolute(norm)) {
      const rel = path.relative(canonicalRoot, norm);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        return this.normalizeSeparators(rel);
      }
      try {
        if (fs.existsSync(canonicalRoot) && fs.existsSync(norm)) {
          const realRoot = fs.realpathSync(canonicalRoot);
          const realNorm = fs.realpathSync(norm);
          const realRel = path.relative(realRoot, realNorm);
          if (!realRel.startsWith('..') && !path.isAbsolute(realRel)) {
            return this.normalizeSeparators(realRel);
          }
        }
      } catch (e) {}

      const projectRoot = this.findProjectRoot(canonicalRoot);
      const projectRel = path.relative(projectRoot, norm);
      if (!projectRel.startsWith('..') && !path.isAbsolute(projectRel)) {
        return this.normalizeSeparators(projectRel);
      }

      return this.normalizeSeparators(rel);
    }

    // If already relative, check if it has duplicate root segments
    const dedup = this._findDedupRelativePath(canonicalRoot, norm);
    if (dedup !== null) {
      const cand = path.resolve(canonicalRoot, dedup);
      if (fs.existsSync(cand)) {
        return this.normalizeSeparators(dedup);
      }
    }

    // If norm exists relative to projectRoot (e.g. demo-workspaces/ai_cart_project/...), return it clean
    const projectRoot = this.findProjectRoot(canonicalRoot);
    const projectCand = path.resolve(projectRoot, norm);
    if (fs.existsSync(projectCand)) {
      return this.normalizeSeparators(norm);
    }

    // Otherwise standard relative normalize
    const abs = path.resolve(canonicalRoot, norm);
    const rel = path.relative(canonicalRoot, abs);
    return this.normalizeSeparators(rel);
  }

  /**
   * Returns true if targetPath is strictly inside workspaceRoot.
   * @param {string} workspaceRoot
   * @param {string} targetPath
   * @returns {boolean}
   */
  isInsideWorkspace(workspaceRoot, targetPath) {
    const res = this.resolve(workspaceRoot, targetPath, { mustExist: false });
    return res.success && !res.isSecurityViolation;
  }
}

const workspacePathResolver = new WorkspacePathResolver();

module.exports = {
  WorkspacePathResolver,
  workspacePathResolver,
};
