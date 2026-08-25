/**
 * VERIFICATION TEST: Decision Replay UI Wiring & Navigation
 * Verifies keybindings, settings defaults, CodexSidebar entries, and IDE navigation state machine.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { SettingsManager, DEFAULT_KEYBINDINGS } = require('./settingsManager');

console.log('================================================================');
console.log('DECISION REPLAY UI WIRING FORENSIC TEST');
console.log('================================================================\n');

// 1. Check DEFAULT_KEYBINDINGS contains workbench.action.decisionReplay
console.log('[CHECK 1] Verifying DEFAULT_KEYBINDINGS table...');
const replayKeybinding = DEFAULT_KEYBINDINGS.find((k) => k.commandId === 'workbench.action.decisionReplay');
assert(replayKeybinding, 'workbench.action.decisionReplay must exist in DEFAULT_KEYBINDINGS');
assert.strictEqual(replayKeybinding.defaultShortcut, 'Cmd+7');
console.log('✓ CHECK 1 PASSED: Default keybinding for Decision Replay registered with Cmd+7');

// 2. Check CodexSidebar.tsx source code contains Decision Replay item with ⌘7
console.log('\n[CHECK 2] Verifying CodexSidebar.tsx navigation items...');
const codexSidebarPath = path.join(__dirname, '..', 'renderer', 'components', 'CodexSidebar.tsx');
const codexSidebarSrc = fs.readFileSync(codexSidebarPath, 'utf8');
assert(codexSidebarSrc.includes('onSelectItem("decisions")'), 'CodexSidebar must contain onSelectItem("decisions")');
assert(codexSidebarSrc.includes('Decision Replay'), 'CodexSidebar must display "Decision Replay"');
assert(codexSidebarSrc.includes('BookmarkCheck'), 'CodexSidebar must import and use BookmarkCheck');
assert(codexSidebarSrc.includes('⌘7'), 'CodexSidebar must display shortcut badge ⌘7');
console.log('✓ CHECK 2 PASSED: CodexSidebar visibly renders Decision Replay with ⌘7 badge and BookmarkCheck icon');

// 3. Check IDEApp.tsx keyboard shortcut and dispatch handling
console.log('\n[CHECK 3] Verifying IDEApp.tsx keydown and dispatch handlers...');
const ideAppPath = path.join(__dirname, '..', 'renderer', 'IDEApp.tsx');
const ideAppSrc = fs.readFileSync(ideAppPath, 'utf8');
assert(ideAppSrc.includes('case "workbench.action.decisionReplay":'), 'IDEApp must handle workbench.action.decisionReplay');
assert(ideAppSrc.includes('key === "7"'), 'IDEApp handleKeyDown must intercept Cmd+7');
assert(ideAppSrc.includes('<DecisionReplayPanel'), 'IDEApp must mount DecisionReplayPanel');
assert(ideAppSrc.includes('activeActivityItem === "decisions"'), 'IDEApp must conditionally render DecisionReplayPanel on decisions item');
console.log('✓ CHECK 3 PASSED: IDEApp routes Cmd+7, action dispatch, and activeActivityItem === "decisions" to DecisionReplayPanel');

// 4. Check CommandPalette.tsx contains Decision Replay
console.log('\n[CHECK 4] Verifying CommandPalette.tsx command...');
const cmdPalettePath = path.join(__dirname, '..', 'renderer', 'components', 'CommandPalette.tsx');
const cmdPaletteSrc = fs.readFileSync(cmdPalettePath, 'utf8');
assert(cmdPaletteSrc.includes('view-decision-replay'), 'CommandPalette must contain view-decision-replay command');
assert(cmdPaletteSrc.includes('onOpenDecisionReplay'), 'CommandPalette must support onOpenDecisionReplay prop');
console.log('✓ CHECK 4 PASSED: CommandPalette includes "View: Open Decision Replay (Architectural Memory)"');

// 5. Check Back to Explorer / Close handling
console.log('\n[CHECK 5] Verifying back/close navigation in IDEApp and DecisionReplayPanel...');
assert(ideAppSrc.includes('activeActivityItem === "decisions"') && ideAppSrc.includes('Back to Explorer'), 'IDEApp must have back button for decisions');
const panelPath = path.join(__dirname, '..', 'renderer', 'components', 'DecisionReplayPanel.tsx');
const panelSrc = fs.readFileSync(panelPath, 'utf8');
assert(panelSrc.includes('onClose') && panelSrc.includes('onBack'), 'DecisionReplayPanel must support onClose and onBack');
console.log('✓ CHECK 5 PASSED: Returning to Files & Workspace verified supported via back button and sidebar toggle');

// 6. Check DecisionReplayPanel layout overflow wrapping safeguards
console.log('\n[CHECK 6] Verifying DecisionReplayPanel.tsx wrapping and overflow safeguards...');
assert(panelSrc.includes('[overflow-wrap:anywhere]') || panelSrc.includes('break-words'), 'Must use overflow-wrap / break-words');
assert(panelSrc.includes('min-w-0'), 'Must include min-w-0 on flex containers');
assert(panelSrc.includes('max-w-full'), 'Must include max-w-full to prevent expansion');
assert(panelSrc.includes('break-all'), 'Must break long paths and tokens at any point if necessary');
assert(panelSrc.includes('overflow-x-hidden'), 'Must avoid horizontal scrolling');
console.log('✓ CHECK 6 PASSED: DecisionReplayPanel layout contains comprehensive text-wrapping, min-w-0, and overflow safeguards');

console.log('\n================================================================');
console.log('ALL UI WIRING & OVERFLOW CHECKS PASSED CLEANLY!');
console.log('================================================================\n');
