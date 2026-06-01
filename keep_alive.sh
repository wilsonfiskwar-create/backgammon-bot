#!/bin/bash
# =============================================
# НАРДЫ — Tunnel Auto-Keeper
# Keeps the tunnel alive and saves the URL
# =============================================

TUNNEL_LOG="/tmp/nar_tunnel.log"
URL_FILE="/home/hermes/nar/current_url.txt"
SERVER_PID_FILE="/tmp/nar_server.pid"
TUNNEL_PID_FILE="/tmp/nar_tunnel.pid"

cleanup() {
    echo "[$(date)] Shutting down..."
    [ -f "$TUNNEL_PID_FILE" ] && kill $(cat "$TUNNEL_PID_FILE") 2>/dev/null
    exit 0
}
trap cleanup SIGTERM SIGINT

echo "[$(date)] NAR TUNNEL KEEPER STARTED"

while true; do
    # Check if server is running
    if ! curl -s -m 3 http://localhost:3033/ > /dev/null 2>&1; then
        echo "[$(date)] Server is DOWN! Waiting..."
        sleep 5
        continue
    fi

    # Kill old tunnel if any
    [ -f "$TUNNEL_PID_FILE" ] && kill $(cat "$TUNNEL_PID_FILE") 2>/dev/null
    
    # Start new tunnel and capture URL
    > "$TUNNEL_LOG"
    ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
        -R 80:localhost:3033 nokey@localhost.run > "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    echo $TUNNEL_PID > "$TUNNEL_PID_FILE"
    
    echo "[$(date)] Tunnel started (PID: $TUNNEL_PID)"
    
    # Wait for URL
    URL=""
    for i in $(seq 1 30); do
        sleep 2
        URL=$(grep -oP 'https://[a-z0-9]+\.lhr\.life' "$TUNNEL_LOG" 2>/dev/null | tail -1)
        if [ -n "$URL" ]; then
            echo "$URL" > "$URL_FILE"
            echo "[$(date)] TUNNEL URL: $URL"
            break
        fi
    done
    
    if [ -z "$URL" ]; then
        echo "[$(date)] Tunnel failed to get URL, restarting..."
        kill $TUNNEL_PID 2>/dev/null
        sleep 3
        continue
    fi
    
    # Wait for tunnel to die (it will, eventually)
    wait $TUNNEL_PID 2>/dev/null
    echo "[$(date)] Tunnel died! Restarting..."
    sleep 3
done
