#!/usr/bin/env bash
# Sourced by agent-run/scripts/test.sh after its isolated test setup.
# Compression uses the normal launch path and preserves the selected scope and agent.
COMPRESS_CONFIG="$TMP_DIR/compress-config"
cp -R "$EXAMPLE/agent-config" "$COMPRESS_CONFIG"
node "$MCP_ROOT/dist/agent-brain.js" init --configdir "$COMPRESS_CONFIG" --cwd "$PROJECT" >"$TMP_DIR/compress-init.out"
node - "$COMPRESS_CONFIG" "$MCP_ROOT/dist/agent-brain.js" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.argv[2], 'agent-run.defaults.jsonc');
const config = require('jsonc-parser').parse(fs.readFileSync(file, 'utf8'));
config.mcp = {servers: {'agent-brain': {transport: 'stdio', command: process.execPath, args: [process.argv[3], 'mcp', '--configdir', process.argv[2], '--cwd', process.cwd()]}}};
fs.writeFileSync(file, JSON.stringify(config));
EOF
# A configured but unavailable brain must stop all four agents before launch.
for agent in codex claude gemini grok; do
	if (cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/brain-blocked-$agent.args" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" "$agent" >"$TMP_DIR/brain-blocked-$agent.out" 2>&1); then
		fail "$agent started without brain"
	fi
	assert_contains "$TMP_DIR/brain-blocked-$agent.out" "Cannot start agent: agent-brain MCP check failed"
	assert_no_file "$TMP_DIR/brain-blocked-$agent.args"
done
chmod 700 "$COMPRESS_CONFIG/runtime"
node "$MCP_ROOT/dist/agent-brain.js" serve --configdir "$COMPRESS_CONFIG" >"$TMP_DIR/brain-service.out" 2>&1 &
BRAIN_TEST_PID=$!
for attempt in $(seq 1 100); do
	if grep -Fq 'agent-brain listening on ' "$TMP_DIR/brain-service.out"; then break; fi
	sleep 0.1
done
assert_contains "$TMP_DIR/brain-service.out" 'agent-brain listening on '
# Updating existing profiles refreshes brain guidance for both instruction formats.
node "$BIN" --configdir "$COMPRESS_CONFIG" update "$PROJECT" >"$TMP_DIR/brain-update.out"
for instructions in "$COMPRESS_CONFIG/starter/basic-project/live/memories/codex-home/AGENTS.md" "$COMPRESS_CONFIG/starter/basic-project/live/CLAUDE.md"; do
	assert_contains "$instructions" "For ordinary questions, explanations, and conversation, answer directly without brain lookups"
	assert_contains "$instructions" "Reuse context and skills already loaded in the conversation"
	assert_contains "$instructions" "A request to do work does not by itself authorize creating a saved task"
	assert_not_contains "$instructions" "then list_skills and load applicable skills"
done
node "$BIN" compress --help >"$TMP_DIR/compress-help.out"
assert_contains "$TMP_DIR/compress-help.out" "--dry-run"
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-codex.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress)
assert_contains "$TMP_DIR/compress-codex.out" "Run brain knowledge consolidation in project scope only"
assert_contains "$TMP_DIR/compress-codex.out" "Apply the consolidation"
assert_contains "$TMP_DIR/compress-codex.out" "This workflow does not authorize Git or remote writes."
assert_contains "$TMP_DIR/compress-codex.out" "workspace-write"
# Exercise inherited user defaults without changing the packaged source or other tests.
node - "$COMPRESS_CONFIG" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('jsonc-parser');
const file = path.join(process.argv[2], 'agent-run.defaults.jsonc');
const config = parse(fs.readFileSync(file, 'utf8'));
config.agent.default = 'claude';
fs.writeFileSync(file, JSON.stringify(config));
EOF
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-claude.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress --scope=global --dry-run)
assert_contains "$TMP_DIR/compress-claude.out" "--append-system-prompt-file"
assert_contains "$TMP_DIR/compress-claude.out" "Run brain knowledge consolidation in global scope only"
assert_contains "$TMP_DIR/compress-claude.out" "Dry run: inspect and propose changes only"
assert_not_contains "$TMP_DIR/compress-claude.out" "Apply the consolidation"
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-override.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress --agent codex --dry-run)
assert_contains "$TMP_DIR/compress-override.out" "workspace-write"
node - "$COMPRESS_CONFIG" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('jsonc-parser');
const file = path.join(process.argv[2], 'starter/basic-project/agent-run.jsonc');
const config = parse(fs.readFileSync(file, 'utf8'));
config.agent = {...config.agent, default: 'grok'};
fs.writeFileSync(file, JSON.stringify(config));
EOF
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-profile.out" AGENT_RUN_ENV_CAPTURE="$TMP_DIR/compress-profile-env.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress --dry-run)
assert_contains "$TMP_DIR/compress-profile-env.out" "GROK_HOME="
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-gemini.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress --agent gemini --dry-run)
assert_contains "$TMP_DIR/compress-gemini.out" "-i"
assert_contains "$TMP_DIR/compress-gemini.out" "Dry run: inspect and propose changes only"
mkdir -p "$TMP_DIR/compress-outside"
(cd "$TMP_DIR/compress-outside" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/compress-default.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" --configdir "$COMPRESS_CONFIG" compress --dry-run)
assert_contains "$TMP_DIR/compress-default.out" "Run brain knowledge consolidation in default scope only"
if (cd "$PROJECT" && node "$BIN" --configdir "$COMPRESS_CONFIG" compress --scope default >"$TMP_DIR/compress-invalid.out" 2>&1); then
	fail "compression accepted unavailable scope"
fi
assert_contains "$TMP_DIR/compress-invalid.out" "not available"
if node "$BIN" compress --agent 'codex;echo unwanted' >"$TMP_DIR/compress-agent.out" 2>&1; then
	fail "compression accepted an invalid agent"
fi
assert_contains "$TMP_DIR/compress-agent.out" "--agent must be"

# Brain Git commands use a local remote and need neither confirmation nor a message.
BRAIN_SYNC_ROOT="$TMP_DIR/brain-sync-config"
BRAIN_SYNC_REMOTE="$TMP_DIR/brain-sync-remote.git"
BRAIN_BIN="$MCP_ROOT/dist/agent-brain.js"
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" init >/dev/null
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" sync init >/dev/null
git init --bare --initial-branch=main "$BRAIN_SYNC_REMOTE" >/dev/null
git -C "$BRAIN_SYNC_ROOT" config user.name "Test User"
git -C "$BRAIN_SYNC_ROOT" config user.email "test@example.test"
git -C "$BRAIN_SYNC_ROOT" config commit.gpgsign false
git -C "$BRAIN_SYNC_ROOT" config core.hooksPath "$TMP_DIR/no-hooks"
git -C "$BRAIN_SYNC_ROOT" remote add origin "$BRAIN_SYNC_REMOTE"
git -C "$BRAIN_SYNC_ROOT" config branch.main.remote origin
git -C "$BRAIN_SYNC_ROOT" config branch.main.merge refs/heads/main
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" save >"$TMP_DIR/brain-save.out"
assert_contains "$TMP_DIR/brain-save.out" "Saved"
assert_contains "$TMP_DIR/brain-save.out" "Push completed"
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" sync status >"$TMP_DIR/brain-status.out"
assert_contains "$TMP_DIR/brain-status.out" '"status"'
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" sync >"$TMP_DIR/brain-sync.out"
assert_contains "$TMP_DIR/brain-sync.out" "No local brain changes"
assert_contains "$TMP_DIR/brain-sync.out" "Pulled remote changes"
assert_contains "$TMP_DIR/brain-sync.out" "Push completed"
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" pull >/dev/null
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" push >/dev/null
node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" sync --confirmed push >/dev/null
if node "$BRAIN_BIN" --configdir "$BRAIN_SYNC_ROOT" save unexpected >"$TMP_DIR/brain-extra.out" 2>&1; then
	fail "brain save accepted unexpected arguments"
fi
assert_contains "$TMP_DIR/brain-extra.out" "Unexpected arguments"

node --test "$MCP_ROOT/scripts/test-brain.cjs" "$ROOT/scripts/test-windows-guards.cjs" "$ROOT/scripts/test-updater.cjs"

echo "All tests passed"
