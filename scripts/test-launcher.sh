#!/usr/bin/env bash
set -euo pipefail
MCP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(node -p 'require("node:path").dirname(require.resolve("@technomoron/agent-run/package.json"))')"
TMP_DIR="$(mktemp -d)"
BRAIN_TEST_PID=''
export HOME="$TMP_DIR/home"
export USERPROFILE="$HOME"
export CODEX_HOME="$HOME/.codex"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export GEMINI_CLI_HOME="$HOME"
export GROK_HOME="$HOME/.grok"
mkdir -p "$HOME"
trap 'if [ -n "$BRAIN_TEST_PID" ]; then kill "$BRAIN_TEST_PID" 2>/dev/null || true; wait "$BRAIN_TEST_PID" 2>/dev/null || true; fi; rm -rf "$TMP_DIR"' EXIT
fail() { echo "FAIL $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || { cat "$1" >&2; fail "expected '$2' in $1"; }; }
assert_not_contains() { ! grep -Fq -- "$2" "$1" || fail "unexpected '$2' in $1"; }
assert_no_file() { [ ! -f "$1" ] || fail "unexpected file: $1"; }
EXAMPLE="$TMP_DIR/basic-config"
cp -R "$ROOT/examples/basic-config" "$EXAMPLE"
PROJECT="$EXAMPLE/project"
BIN="$ROOT/dist/agent-run.js"
FAKE_TOOL_BIN="$TMP_DIR/fake-tool-bin"
mkdir -p "$FAKE_TOOL_BIN"
cat >"$FAKE_TOOL_BIN/codex" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'CODEX_HOME=%s\nPWD=%s\nAGENT_RUN_REAL_PATH=%s\nPATH=%s\n' \
		"${CODEX_HOME-<unset>}" "$PWD" "${AGENT_RUN_REAL_PATH-<unset>}" "$PATH" >"$AGENT_RUN_ENV_CAPTURE"
	printf 'AGENT_PROJECT_MEMORY_DIR=%s\n' "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >>"$AGENT_RUN_ENV_CAPTURE"
fi
if [ -n "${AGENT_RUN_NESTED_GUARD_CAPTURE:-}" ]; then
	git --version >"$AGENT_RUN_NESTED_GUARD_CAPTURE"
fi
SH
cat >"$FAKE_TOOL_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'CLAUDE_CONFIG_DIR=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${CLAUDE_CONFIG_DIR-<unset>}" "$PWD" "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
if [ -n "${AGENT_RUN_CREATE_LOCAL_SETTINGS:-}" ]; then
	mkdir -p .claude
	printf '{"permissions":{"allow":["Bash(pnpm test)"]}}\n' >.claude/settings.local.json
fi
SH
cat >"$FAKE_TOOL_BIN/gemini" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'GEMINI_CLI_HOME=%s\nGEMINI_CLI_SYSTEM_SETTINGS_PATH=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${GEMINI_CLI_HOME-<unset>}" "${GEMINI_CLI_SYSTEM_SETTINGS_PATH-<unset>}" "$PWD" \
		"${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
SH
cat >"$FAKE_TOOL_BIN/grok" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'GROK_HOME=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${GROK_HOME-<unset>}" "$PWD" "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
SH
chmod +x "$FAKE_TOOL_BIN/codex" "$FAKE_TOOL_BIN/claude" "$FAKE_TOOL_BIN/gemini" "$FAKE_TOOL_BIN/grok"
cat >"$FAKE_TOOL_BIN/codex.cmd" <<'BAT'
@echo off
bash "%~dp0codex" %*
BAT
cat >"$FAKE_TOOL_BIN/claude.cmd" <<'BAT'
@echo off
bash "%~dp0claude" %*
BAT
cat >"$FAKE_TOOL_BIN/gemini.cmd" <<'BAT'
@echo off
bash "%~dp0gemini" %*
BAT
cat >"$FAKE_TOOL_BIN/grok.cmd" <<'BAT'
@echo off
bash "%~dp0grok" %*
BAT

source "$MCP_ROOT/scripts/test-agent-run.sh"
