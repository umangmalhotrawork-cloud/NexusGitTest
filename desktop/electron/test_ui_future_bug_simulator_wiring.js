/**
 * VERIFICATION TEST: Future Bug Simulator UI Wiring & Navigation
 * Verifies keybindings, settings defaults, CodexSidebar entries, ActivityRail entries,
 * CommandPalette commands, and IDE navigation state machine.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { DEFAULT_KEYBINDINGS } = require('./settingsManager');

console.log('================================================================');
console.log('FUTURE BUG SIMULATOR UI WIRING TEST');
console.log('================================================================\n');

// 1. Check DEFAULT_KEYBINDINGS contains workbench.action.futureBugSimulator
console.log('[CHECK 1] Verifying DEFAULT_KEYBINDINGS table...');
const simKeybinding = DEFAULT_KEYBINDINGS.find((k) => k.commandId === 'workbench.action.futureBugSimulator');
assert(simKeybinding, 'workbench.action.futureBugSimulator must exist in DEFAULT_KEYBINDINGS');
assert.strictEqual(simKeybinding.defaultShortcut, 'Cmd+8');
console.log('✓ CHECK 1 PASSED: Default keybinding for Future Bug Simulator registered with Cmd+8');

// 2. Check CodexSidebar.tsx source code contains Future Bug Simulator item with ⌘8
console.log('\n[CHECK 2] Verifying CodexSidebar.tsx navigation items...');
const codexSidebarPath = path.join(__dirname, '..', 'renderer', 'components', 'CodexSidebar.tsx');
const codexSidebarSrc = fs.readFileSync(codexSidebarPath, 'utf8');
assert(codexSidebarSrc.includes('onSelectItem("simulator")'), 'CodexSidebar must contain onSelectItem("simulator")');
assert(codexSidebarSrc.includes('Future Bug Simulator'), 'CodexSidebar must display "Future Bug Simulator"');
assert(codexSidebarSrc.includes('⌘8'), 'CodexSidebar must display shortcut badge ⌘8');
console.log('✓ CHECK 2 PASSED: CodexSidebar visibly renders Future Bug Simulator with ⌘8 badge');

// 3. Check ActivityRail.tsx source code contains simulator item with ⌘8
console.log('\n[CHECK 3] Verifying ActivityRail.tsx navigation item...');
const railPath = path.join(__dirname, '..', 'renderer', 'components', 'ActivityRail.tsx');
const railSrc = fs.readFileSync(railPath, 'utf8');
assert(railSrc.includes('onSelectItem("simulator")'), 'ActivityRail must handle onSelectItem("simulator")');
assert(railSrc.includes('⌘8'), 'ActivityRail must show ⌘8 tooltip');
console.log('✓ CHECK 3 PASSED: ActivityRail includes Future Bug Simulator with ⌘8 tooltip');

// 4. Check IDEApp.tsx keyboard shortcut and dispatch handling
console.log('\n[CHECK 4] Verifying IDEApp.tsx keydown and dispatch handlers...');
const ideAppPath = path.join(__dirname, '..', 'renderer', 'IDEApp.tsx');
const ideAppSrc = fs.readFileSync(ideAppPath, 'utf8');
assert(ideAppSrc.includes('case "workbench.action.futureBugSimulator":'), 'IDEApp must handle workbench.action.futureBugSimulator');
assert(ideAppSrc.includes('key === "8"'), 'IDEApp handleKeyDown must intercept Cmd+8');
assert(ideAppSrc.includes('<FutureBugSimulatorPanel'), 'IDEApp must mount FutureBugSimulatorPanel');
assert(ideAppSrc.includes('activeActivityItem === "simulator"'), 'IDEApp must conditionally render FutureBugSimulatorPanel on simulator item');
console.log('✓ CHECK 4 PASSED: IDEApp routes Cmd+8, action dispatch, and activeActivityItem === "simulator" to FutureBugSimulatorPanel');

// 5. Check CommandPalette.tsx contains Future Bug Simulator
console.log('\n[CHECK 5] Verifying CommandPalette.tsx command...');
const cmdPalettePath = path.join(__dirname, '..', 'renderer', 'components', 'CommandPalette.tsx');
const cmdPaletteSrc = fs.readFileSync(cmdPalettePath, 'utf8');
assert(cmdPaletteSrc.includes('view-future-bug-simulator'), 'CommandPalette must contain view-future-bug-simulator command');
assert(cmdPaletteSrc.includes('onOpenFutureBugSimulator'), 'CommandPalette must support onOpenFutureBugSimulator prop');
console.log('✓ CHECK 5 PASSED: CommandPalette includes "View: Open Future Bug Simulator"');

// 6. Check FutureBugSimulatorPanel layout overflow wrapping safeguards
console.log('\n[CHECK 6] Verifying FutureBugSimulatorPanel.tsx wrapping and overflow safeguards...');
const panelPath = path.join(__dirname, '..', 'renderer', 'components', 'FutureBugSimulatorPanel.tsx');
const panelSrc = fs.readFileSync(panelPath, 'utf8');
assert(panelSrc.includes('[overflow-wrap:anywhere]') || panelSrc.includes('break-words'), 'Must use overflow-wrap / break-words');
assert(panelSrc.includes('min-w-0'), 'Must include min-w-0 on flex containers');
assert(panelSrc.includes('max-w-full'), 'Must include max-w-full to prevent expansion');
assert(panelSrc.includes('break-all'), 'Must break long paths and tokens at any point if necessary');
assert(panelSrc.includes('overflow-x-hidden'), 'Must avoid horizontal scrolling');
console.log('✓ CHECK 6 PASSED: FutureBugSimulatorPanel contains comprehensive text-wrapping and overflow safeguards');

console.log('\n================================================================');
console.log('ALL FUTURE BUG SIMULATOR UI WIRING CHECKS PASSED CLEANLY!');
console.log('================================================================\n');
