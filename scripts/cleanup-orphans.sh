#!/bin/bash
# Deletes orphan user messages (no assistant reply) from the active session.
# Only works when session is idle. Run manually after testing.

PORT="${OPENCODE_PORT:-16666}"
SESSION="${OPENCODE_SESSION_ID}"

if [ -z "$SESSION" ]; then
  echo "Error: OPENCODE_SESSION_ID not set"
  exit 1
fi

STATUS=$(curl -s "http://127.0.0.1:${PORT}/session/status" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$SESSION',{}).get('type','unknown'))")
if [ "$STATUS" = "busy" ]; then
  echo "Session is busy. Wait for idle before running cleanup."
  exit 1
fi

echo "Finding orphan messages..."
ORPHANS=$(curl -s --max-time 30 "http://127.0.0.1:${PORT}/session/${SESSION}/message" | python3 -c "
import json, sys
msgs = json.load(sys.stdin)
user_msgs = [m for m in msgs if m.get('info',{}).get('role') == 'user']
assistant_msgs = [m for m in msgs if m.get('info',{}).get('role') == 'assistant']
parent_ids = set(m.get('info',{}).get('parentID') for m in assistant_msgs)
orphans = [m['info']['id'] for m in user_msgs if m['info']['id'] not in parent_ids]
for o in orphans:
    print(o)
")

COUNT=$(echo "$ORPHANS" | grep -c .)
echo "Found $COUNT orphan(s)"

if [ "$COUNT" -eq 0 ]; then
  echo "Nothing to clean."
  exit 0
fi

echo "$ORPHANS" | while read -r MSG_ID; do
  echo "Deleting $MSG_ID..."
  curl -s -X DELETE "http://127.0.0.1:${PORT}/session/${SESSION}/message/${MSG_ID}" > /dev/null
done

echo "Done. Deleted $COUNT orphan message(s)."
