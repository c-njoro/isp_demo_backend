#!/bin/bash
USERNAME="$1"
NAS_IP="$2"
SESSION_ID="$3"
NAS_PORT="$4"
SECRET="sk_radius_7f3Kx9mQpL2vNhWdRjYt8BnCeA4uZsXo"

LOGFILE="/tmp/disconnect_debug.log"

{
    echo "$(date) - Calling kick-hotspot webhook: USERNAME=$USERNAME NAS_IP=$NAS_IP SESSION_ID=$SESSION_ID"
    
    RESPONSE=$(curl -s -X POST "http://app:5000/api/internal/kick-hotspot" \
      -H "Content-Type: application/json" \
      -H "X-Internal-Secret: $SECRET" \
      -d "{\"username\":\"$USERNAME\",\"nasIp\":\"$NAS_IP\",\"sessionId\":\"$SESSION_ID\"}" \
      --max-time 5 2>&1)
    
    echo "$(date) - Backend response: $RESPONSE"
} >> "$LOGFILE" 2>&1

