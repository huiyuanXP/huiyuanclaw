#!/bin/bash
echo "Starting RemoteLab services..."
if launchctl list | grep -q 'com.ttyd.claude'; then
  launchctl unload ~/Library/LaunchAgents/com.ttyd.claude.plist 2>/dev/null || true
  echo "Unloaded legacy shared ttyd service"
fi
if [ -f ~/Library/LaunchAgents/com.chatserver.claude.plist ]; then
  launchctl load ~/Library/LaunchAgents/com.chatserver.claude.plist 2>/dev/null || echo "chat-server already loaded"
fi
launchctl load ~/Library/LaunchAgents/com.authproxy.claude.plist 2>/dev/null || echo "auth-proxy already loaded"
if [ -f ~/Library/LaunchAgents/com.cloudflared.tunnel.plist ]; then
  launchctl load ~/Library/LaunchAgents/com.cloudflared.tunnel.plist 2>/dev/null || echo "cloudflared already loaded"
fi
echo "Services started!"
echo ""
echo "Check status with:"
echo "  launchctl list | grep -E 'chatserver|authproxy|cloudflared'"
