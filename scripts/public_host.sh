#!/usr/bin/env sh
set -eu

IP=""

# macOS (route + ipconfig)
if command -v ipconfig >/dev/null 2>&1 && command -v route >/dev/null 2>&1; then
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [ -n "${IFACE:-}" ]; then
    IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
  fi
fi

# Linux (classique + WSL)
if [ -z "${IP:-}" ] && command -v ip >/dev/null 2>&1; then
  IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
fi

# Fallback simple
if [ -z "${IP:-}" ]; then
  if command -v hostname >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
fi

# Dernier recours
IP="${IP:-127.0.0.1}"

# Message humain lisible (stderr) + sortie IP brute (stdout)
printf '[detect_public_host] PUBLIC_HOST=%s\n' "$IP" >&2
printf '%s\n' "$IP"