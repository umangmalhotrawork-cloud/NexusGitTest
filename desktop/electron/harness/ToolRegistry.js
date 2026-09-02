/**
 * NEXUS CODEX HARNESS - TOOL REGISTRY
 * Central registry and execution dispatcher for provider-neutral tools.
 * Enforces input validation, execution context isolation, and secret redaction.
 */

const secretFilter = require('../../security/secretFilter');

class ToolRegistry {
  constructor() {
    this.tools = new Map(); // toolName -> Tool Definition
  }

  /**
   * Registers a tool definition.
   * @param {Object} tool
   * @param {string} tool.name
   * @param {string} tool.description
   * @param {Object} [tool.inputSchema]
   * @param {Function} tool.execute
   * @param {boolean|Function} [tool.requiresApproval]
   */
  register(tool) {
    if (!tool || typeof tool !== 'object') {
      throw new Error('[HARNESS-TOOLREGISTRY] Invalid tool definition: must be an object');
    }
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('[HARNESS-TOOLREGISTRY] Invalid tool: name is required');
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`[HARNESS-TOOLREGISTRY] Tool "${tool.name}" must provide an execute function`);
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      requiresApproval: tool.requiresApproval || false,
      execute: tool.execute,
    });
  }

  /**
   * Retrieves a tool by name.
   * @param {string} toolName
   * @returns {Object|null}
   */
  get(toolName) {
    return this.tools.get(toolName) || null;
  }

  /**
   * Alias for get(toolName).
   * @param {string} toolName
   * @returns {Object|null}
   */
  getTool(toolName) {
    return this.get(toolName);
  }

  /**
   * Checks if a tool is registered.

   * @param {string} toolName
   * @returns {boolean}
   */
  has(toolName) {
    return this.tools.has(toolName);
  }

  /**
   * Lists all registered tools with their schema declarations.
   * @returns {Array<Object>}
   */
  list() {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiresApproval: typeof t.requiresApproval === 'function' ? 'conditional' : Boolean(t.requiresApproval),
    }));
  }

  /**
   * Validates tool input arguments against the registered JSON schema before execution.
   * @param {Object} schema - Tool inputSchema
   * @param {Object} args - Supplied tool arguments
   * @param {string} toolName - Tool name
   * @returns {{ valid: boolean, error?: string, errors?: Array<string> }}
   */
  validateInputSchema(schema, args = {}, toolName = '') {
    if (!schema || typeof schema !== 'object') {
      return { valid: true };
    }

    if (schema.type === 'object' && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      const errorMsg = `tool call validation failed; parameters for tool \`${toolName}\` did not match schema: errors: [parameters must be an object]`;
      return { valid: false, error: errorMsg, errors: ['parameters must be an object'] };
    }

    const errors = [];
    const missing = [];

    // 1. Enforce required properties
    if (Array.isArray(schema.required)) {
      for (const reqProp of schema.required) {
        const val = args ? args[reqProp] : undefined;
        if (
          val === undefined ||
          val === null ||
          (typeof val === 'string' && !val.trim()) ||
          (Array.isArray(val) && val.length === 0)
        ) {
          missing.push(`'${reqProp}'`);
        }
      }
    }

    if (missing.length > 0) {
      errors.push(`missing properties: ${missing.join(', ')}`);
    }

    // 2. Validate property types if defined
    if (schema.properties && typeof schema.properties === 'object' && args && typeof args === 'object') {
      for (const [propName, propDef] of Object.entries(schema.properties)) {
        if (propName in args && args[propName] !== undefined && args[propName] !== null) {
          const val = args[propName];
          const expectedType = propDef?.type;
          if (expectedType === 'string' && typeof val !== 'string') {
            errors.push(`'${propName}' must be a string`);
          } else if (expectedType === 'boolean' && typeof val !== 'boolean') {
            errors.push(`'${propName}' must be a boolean`);
          } else if (expectedType === 'integer' && !Number.isInteger(val)) {
            errors.push(`'${propName}' must be an integer`);
          } else if (expectedType === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
            errors.push(`'${propName}' must be a number`);
          } else if (expectedType === 'array' && !Array.isArray(val)) {
            errors.push(`'${propName}' must be an array`);
          } else if (expectedType === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
            errors.push(`'${propName}' must be an object`);
          }
        }
      }
    }

    if (errors.length > 0) {
      const errorMsg = `tool call validation failed; parameters for tool \`${toolName}\` did not match schema: errors: [${errors.join('; ')}]`;
      return {
        valid: false,
        error: errorMsg,
        errors,
      };
    }

    return { valid: true };
  }

  /**
   * Executes a tool through the registry with contextual validation and secret filtering.
   * @param {string} toolName
   * @param {Object} args
   * @param {Object} context
   * @returns {Promise<Object>} Normalized tool result
   */
  async execute(toolName, args = {}, context = {}) {
    const callId = context.callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (!this.has(toolName)) {
      const errorMsg = `Tool "${toolName}" is not registered in ToolRegistry`;
      return {
        type: 'tool_result',
        callId,
        toolName,
        success: false,
        result: null,
        error: errorMsg,
      };
    }

    const tool = this.get(toolName);

    // Validate parameters against inputSchema BEFORE execution
    const validation = this.validateInputSchema(tool.inputSchema, args, toolName);
    if (!validation.valid) {
      return {
        type: 'tool_result',
        callId,
        toolName,
        success: false,
        result: null,
        error: validation.error,
        validationErrors: validation.errors,
      };
    }

    // Sanitize input arguments before execution (guaranteeing zero sensitive leaks in args)
    const sanitizedArgs = secretFilter.sanitizeObject(args || {});

    // Ensure safe execution context
    const execContext = {
      ...context,
      callId,
      workspacePath: context.workspacePath || process.cwd(),
      threadId: context.threadId || 'default_thread',
      turnId: context.turnId || 'default_turn',
      approvalMode: context.approvalMode || 'strict',
    };

    // Remove any accidental raw API keys from context
    delete execContext.apiKey;
    delete execContext.authHeader;

    try {
      const rawResult = await tool.execute(sanitizedArgs, execContext);

      // Check if tool returned a policy rejection or error object
      if (rawResult && rawResult.success === false) {
        const resultPayload = rawResult.result ? { ...rawResult.result } : { ...rawResult };
        delete resultPayload.success;
        delete resultPayload.error;
        return {
          type: 'tool_result',
          callId,
          toolName,
          success: false,
          result: secretFilter.sanitizeObject(resultPayload),
          error: secretFilter.sanitizeString(rawResult.error || 'Tool execution failed'),
          requiresApproval: rawResult.requiresApproval || false,
          policyDecision: rawResult.policyDecision || null,
          changeSet: rawResult.changeSet || rawResult.result?.changeSet || null,
        };
      }

      const sanitizedResult = secretFilter.sanitizeObject(rawResult !== undefined ? rawResult : {});

      return {
        type: 'tool_result',
        callId,
        toolName,
        success: true,
        result: sanitizedResult,
        error: null,
      };
    } catch (err) {
      console.warn(`[HARNESS-TOOLREGISTRY] Error executing tool "${toolName}":`, err.message);
      const safeError = secretFilter.sanitizeString(err.message || 'Unknown tool execution error');

      return {
        type: 'tool_result',
        callId,
        toolName,
        success: false,
        result: null,
        error: safeError,
      };
    }
  }

  /**
   * Clears registered tools (primarily for test isolation).
   */
  clear() {
    this.tools.clear();
  }
}

const toolRegistry = new ToolRegistry();

module.exports = {
  ToolRegistry,
  toolRegistry,
};
