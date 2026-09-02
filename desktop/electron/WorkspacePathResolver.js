/**
 * NEXUS CODEX HARNESS - AUTHORITATIVE WORKSPACE PATH RESOLVER FACADE
 * Re-exports the authoritative WorkspacePathResolver from harness.
 */

const {
  WorkspacePathResolver,
  workspacePathResolver,
} = require('./harness/WorkspacePathResolver');

module.exports = {
  WorkspacePathResolver,
  workspacePathResolver,
};
