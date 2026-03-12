#!/bin/bash
# Redis-Channel Message Sender
# Usage: ./send-msg.sh --target node-parent --text "Hello"

set -e

# Defaults
REDIS_URL="${REDIS_URL:-redis://:Redis@Parent2026!@127.0.0.1:16379}"
SENDER_ID="${SENDER_ID:-node-sub-1}"
SENDER_NAME="${SENDER_NAME:-GWork}"
TARGET=""
TEXT=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -t|--target) TARGET="$2"; shift 2 ;;
    -m|--text) TEXT="$2"; shift 2 ;;
    -r|--redis) REDIS_URL="$2"; shift 2 ;;
    -s|--sender) SENDER_ID="$2"; shift 2 ;;
    -n|--name) SENDER_NAME="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --target <device-id> --text <message>"
      echo ""
      echo "Options:"
      echo "  -t, --target    Target device ID (required)"
      echo "  -m, --text      Message text (required)"
      echo "  -r, --redis     Redis URL (default: from env)"
      echo "  -s, --sender    Sender ID (default: node-sub-1)"
      echo "  -n, --name      Sender name (default: GWork)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Validate
if [ -z "$TARGET" ] || [ -z "$TEXT" ]; then
  echo "Error: --target and --text are required"
  echo "Usage: $0 --target <device-id> --text <message>"
  exit 1
fi

# Send via npm script
cd "$(dirname "$0")"
npm run test:pub -- \
  --redis "$REDIS_URL" \
  --device-id "$TARGET" \
  --text "$TEXT" \
  --sender "$SENDER_ID" \
  --name "$SENDER_NAME"
