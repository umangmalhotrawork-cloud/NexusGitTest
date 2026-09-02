/**
 * NEXUS CODEX HARNESS TOOL - SEARCH WORKSPACE
 * Performs indexed and regular expression searches across workspace files using SearchManager.
 */

const path = require('path');
const { workspacePathResolver } = require('../WorkspacePathResolver');
const searchManager = require('../../searchManager');
const secretFilter = require('../../../security/secretFilter');

const MAX_SEARCH_RESULTS_RETURNED = 50;

const SearchWorkspaceTool = {
  name: 'search_workspace',
  description: 'Searches for text or regex patterns across files in the active workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text string or regex pattern to search for',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether query should be treated as a regular expression',
      },
      isCaseSensitive: {
        type: 'boolean',
        description: 'Whether search should be case-sensitive',
      },
      path: {
        type: 'string',
        description: 'Optional subfolder path within workspace to limit the search scope',
      },
      includeGlobs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to include (e.g. ["*.ts", "src/**"])',
      },
      excludeGlobs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to exclude (e.g. ["*.test.js", "dist/**"])',
      },
    },
    required: ['query'],
  },
  requiresApproval: false,

  async execute(args = {}, context = {}) {
    const query = args.query || '';
    if (!query || typeof query !== 'string' || !query.trim()) {
      return {
        success: false,
        error: 'Argument "query" must be a non-empty string',
      };
    }

    const workspaceRoot = workspacePathResolver.canonicalizeWorkspaceRoot(context.workspacePath);
    let targetDir = workspaceRoot;

    if (args.path && typeof args.path === 'string' && args.path.trim()) {
      const resolution = workspacePathResolver.resolve(workspaceRoot, args.path.trim(), {
        isDirectory: true,
        allowDirectory: true,
        mustExist: false,
      });
      if (!resolution.success) {
        return {
          success: false,
          error: resolution.error,
        };
      }
      targetDir = resolution.absolutePath;
    }

    try {
      const searchRes = await searchManager.runSearch({
        workspacePath: targetDir,
        rootWorkspacePath: workspaceRoot,
        query: query.trim(),
        isRegex: Boolean(args.isRegex),
        isCaseSensitive: Boolean(args.isCaseSensitive),
        includeGlobs: args.includeGlobs || [],
        excludeGlobs: args.excludeGlobs || [],
        maxResults: 1000,
        maxMatchesPerFile: 10,
      });

      if (!searchRes || !searchRes.success) {
        return {
          success: false,
          error: searchRes?.error || 'Workspace search failed',
        };
      }

      const rawResults = Array.isArray(searchRes.results) ? [...searchRes.results] : [];

      // If activeFilePath is provided, check if it matches the search query
      if (context.activeFilePath && typeof context.activeFilePath === 'string') {
        const activeRes = workspacePathResolver.resolve(workspaceRoot, context.activeFilePath, {
          activeFilePath: context.activeFilePath,
          mustExist: true,
          allowDirectory: false,
        });

        if (activeRes.success && activeRes.exists && activeRes.isFile) {
          const alreadyFound = rawResults.some((r) => {
            const p = r.fullPath || r.file || r.filePath;
            return p && (p === activeRes.absolutePath || path.resolve(p) === activeRes.absolutePath);
          });

          if (!alreadyFound) {
            const activeBase = path.basename(activeRes.absolutePath).toLowerCase();
            const activeRel = (activeRes.relativePath || '').toLowerCase();
            const qLower = query.trim().toLowerCase();

            const isNameMatch = activeBase.includes(qLower) || activeRel.includes(qLower);
            let isContentMatch = false;
            let matchingSnippet = '';
            let matchLine = 1;

            if (isNameMatch) {
              matchingSnippet = `[Active Editor File] ${path.basename(activeRes.absolutePath)}`;
            } else {
              try {
                const fs = require('fs');
                const content = fs.readFileSync(activeRes.absolutePath, 'utf8');
                const lines = content.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].toLowerCase().includes(qLower)) {
                    isContentMatch = true;
                    matchLine = i + 1;
                    matchingSnippet = lines[i].trim();
                    break;
                  }
                }
              } catch (e) {}
            }

            if (isNameMatch || isContentMatch) {
              rawResults.unshift({
                file: activeRes.relativePath,
                filePath: activeRes.absolutePath,
                fullPath: activeRes.absolutePath,
                line: matchLine,
                column: 1,
                text: matchingSnippet,
                matchId: `${activeRes.absolutePath}:${matchLine}:1:0`,
              });
            }
          }
        }
      }

      // Sort: Exact filename matches first, then file-level matches, then content matches
      const queryLower = query.toLowerCase();
      rawResults.sort((a, b) => {
        const aRel = workspacePathResolver.toRelative(workspaceRoot, a.fullPath || a.file || a.filePath || '').toLowerCase();
        const bRel = workspacePathResolver.toRelative(workspaceRoot, b.fullPath || b.file || b.filePath || '').toLowerCase();
        const aBase = path.basename(aRel);
        const bBase = path.basename(bRel);

        const aExact = aBase === queryLower || aRel === queryLower;
        const bExact = bBase === queryLower || bRel === queryLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aFileMatch = a.matchId && a.matchId.endsWith(':1:1:0');
        const bFileMatch = b.matchId && b.matchId.endsWith(':1:1:0');
        if (aFileMatch && !bFileMatch) return -1;
        if (!aFileMatch && bFileMatch) return 1;

        return 0;
      });

      const matches = rawResults.slice(0, MAX_SEARCH_RESULTS_RETURNED).map((m) => ({
        file: workspacePathResolver.toRelative(workspaceRoot, m.fullPath || m.file || m.filePath),
        line: m.line,
        column: m.column,
        snippet: secretFilter.sanitizeString(m.text || ''),
      }));

      return {
        success: true,
        query: secretFilter.sanitizeString(query),
        totalMatches: searchRes.totalMatches ? (searchRes.totalMatches + (rawResults.length > (searchRes.results?.length || 0) ? 1 : 0)) : matches.length,
        totalFiles: Math.max(searchRes.totalFiles || 0, new Set(matches.map((m) => m.file)).size),
        matches,
        truncated: rawResults.length > MAX_SEARCH_RESULTS_RETURNED,
      };
    } catch (err) {
      return {
        success: false,
        error: `Search execution error: ${err.message}`,
      };
    }
  },
};

module.exports = SearchWorkspaceTool;
