#!/bin/bash
# Start tunnel and save URL to file
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3033 nokey@localhost.run 2>&1 | \
  while read line; do
    echo "$line"
    url=$(echo "$line" | grep -oP 'https://[a-z0-9]+\.lhr\.life' | head -1)
    if [ -n "$url" ]; then
      echo "$url" > /home/hermes/nar/current_url.txt
      echo "TUNNEL URL: $url" >&2
    fi
  done
