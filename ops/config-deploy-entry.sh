#!/bin/sh
# Installed root-owned and referenced by the restricted GitHub Actions SSH key.
exec sudo -n /usr/local/bin/node /opt/agent-mcp/current/node_modules/@technomoron/agent-brain/ops/config-deploy-root.cjs "${SSH_ORIGINAL_COMMAND:-}"
