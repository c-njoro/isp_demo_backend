#!/bin/bash
USERNAME="$1"
NAS_IP="$2"
SESSION_ID="$3"

echo "$(date) - Called with: $USERNAME $NAS_IP $SESSION_ID" >> /tmp/activate_debug.log

curl -s -X POST "http://app:5000/api/internal/radius-activate" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: sk_radius_7f3Kx9mQpL2vNhWdRjYt8BnCeA4uZsXo" \
  -d "{\"username\":\"$USERNAME\",\"nasIp\":\"$NAS_IP\",\"sessionId\":\"$SESSION_ID\"}" \
  --max-time 2 \
  >> /tmp/activate_debug.log 2>&1 &

exit 0
