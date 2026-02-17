#!/bin/bash
#
# Pure AT command LTE connection for EM7430 (no MBIM/QMI required)
# For use when /dev/cdc-wdm0 is not available
#

set -e

LOG="/var/log/at_lte_connect.log"
TTY_PORT="/dev/ttyUSB2"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a $LOG
}

# AT command function
send_at() {
    local cmd="$1"
    local desc="$2"
    local timeout=${3:-3}

    log "[AT] $desc: $cmd"
    stty -F $TTY_PORT 115200 raw -echo 2>/dev/null
    echo -e "${cmd}\r" > $TTY_PORT
    sleep $timeout
    local response=$(timeout $timeout cat < $TTY_PORT 2>/dev/null || true)
    echo "$response" | tee -a $LOG
    echo "$response"
}

log "=== AT-only LTE connection start ==="

# Clean up processes
log "Cleaning up interfering processes..."
pkill -9 mbimcli 2>/dev/null || true
pkill -9 qmicli 2>/dev/null || true
sleep 2

# Enter extended mode
send_at 'AT!ENTERCND="A710"' "Enter extended mode" 2

# Configure modem
send_at 'AT!SELRAT=00' "Set RAT to auto (not LTE-only to allow 3G fallback)" 2
send_at 'AT!BAND=00' "Set band to auto" 2
send_at 'AT!IMPREF="GENERIC"' "Set profile to GENERIC" 2
send_at 'AT+CGDCONT=1,"IP","soracom.io"' "Set PDP context for SORACOM" 2

# Enable radio BEFORE reset
send_at 'AT+CFUN=1' "Enable radio (critical: before reset!)" 3

# Auto network selection
send_at 'AT+COPS=0' "Auto network selection" 3

# Activate PDP context (may fail before reset - OK)
send_at 'AT!SCACT=1,1' "Activate PDP context" 2

# Reset modem
log "Resetting modem..."
send_at 'AT!RESET' "Reset modem" 2
sleep 15  # Wait for modem reboot

# Re-initialize serial port after reset
log "Re-initializing serial port after reset..."
stty -F $TTY_PORT 115200 raw -echo 2>/dev/null
sleep 2

# Check modem status
log "Checking modem status..."
gstatus=$(send_at 'AT!GSTATUS?' "Get modem status" 5)

if echo "$gstatus" | grep -q "ONLINE"; then
    log "[SUCCESS] Modem is ONLINE"
else
    log "[WARNING] Modem may not be ONLINE yet"
    echo "$gstatus"
fi

# Get IP and DNS from AT+CGCONTRDP
log "Getting IP configuration..."
rdp_output=$(send_at 'AT+CGCONTRDP=1' "Get PDP context details" 5)

# Extract IP (4th field)
IP_ADDR=$(echo "$rdp_output" | grep "+CGCONTRDP:" | head -1 | awk -F',' '{print $4}' | tr -d '"' | sed 's/[^0-9.]//g')

# Extract DNS (6th and 7th fields)
DNS1=$(echo "$rdp_output" | grep "+CGCONTRDP:" | head -1 | awk -F',' '{print $6}' | tr -d '"' | sed 's/[^0-9.]//g')
DNS2=$(echo "$rdp_output" | grep "+CGCONTRDP:" | head -1 | awk -F',' '{print $7}' | tr -d '"' | sed 's/[^0-9.]//g')

log "Extracted - IP: $IP_ADDR, DNS1: $DNS1, DNS2: $DNS2"

if [ -z "$IP_ADDR" ]; then
    log "[ERROR] Failed to obtain IP address"
    exit 1
fi

# Configure wwan0 interface (if it exists)
IFACE="wwan0"
if ! ip link show $IFACE >/dev/null 2>&1; then
    log "[ERROR] Interface $IFACE does not exist"
    log "Available interfaces: $(ip link show | grep '^[0-9]' | awk '{print $2}' | tr -d ':')"
    exit 1
fi

log "Configuring $IFACE interface..."

# Bring interface down for configuration
ip link set $IFACE down 2>/dev/null || true
sleep 1

# Clear old addresses
ip addr flush dev $IFACE 2>/dev/null || true

# Add IP address (/32 point-to-point)
ip addr add ${IP_ADDR}/32 dev $IFACE
log "IP address ${IP_ADDR}/32 added to $IFACE"

# Set MTU for LTE
ip link set dev $IFACE mtu 1428

# Bring interface up
ip link set $IFACE up
log "Interface $IFACE brought up"

sleep 2

# Estimate gateway (SORACOM typically uses /30 subnets)
# For 10.x.x.x IPs, gateway is usually IP & 0xFFFFFFFC | 0x1
IFS='.' read -r -a ip_parts <<< "$IP_ADDR"
gw_last_octet=$(( (${ip_parts[3]} & 0xFC) + 1 ))
GATEWAY="${ip_parts[0]}.${ip_parts[1]}.${ip_parts[2]}.${gw_last_octet}"
log "Estimated gateway: $GATEWAY"

# Add default route via wwan0 (point-to-point, no gateway needed)
# Check if WiFi is connected
if ip route | grep -q "default.*wlan0"; then
    log "WiFi detected - adding LTE as backup route (metric 400)"
    ip route add default dev $IFACE metric 400 2>/dev/null || log "Route already exists"
else
    log "No WiFi - adding LTE as primary route (metric 200)"
    ip route del default 2>/dev/null || true
    ip route add default dev $IFACE metric 200
fi

# Configure DNS
log "Configuring DNS..."
if [ -n "$DNS1" ] && [ "$DNS1" != "0.0.0.0" ]; then
    echo "nameserver $DNS1" > /etc/resolv.conf
    log "Primary DNS: $DNS1"
fi

if [ -n "$DNS2" ] && [ "$DNS2" != "0.0.0.0" ]; then
    echo "nameserver $DNS2" >> /etc/resolv.conf
    log "Secondary DNS: $DNS2"
else
    # Fallback to Google DNS
    echo "nameserver 8.8.8.8" >> /etc/resolv.conf
    log "Fallback DNS: 8.8.8.8"
fi

# Test connectivity
log "Testing LTE connectivity..."
if ping -c 2 -W 5 8.8.8.8 >/dev/null 2>&1; then
    log "[SUCCESS] LTE connectivity confirmed (ping 8.8.8.8 successful)"
else
    log "[WARNING] Ping test failed, but connection may still work"
fi

log "=== AT-only LTE connection complete ==="
log "Interface: $IFACE"
log "IP: $IP_ADDR/32"
log "DNS: $DNS1, $DNS2"
log "Route: $(ip route show default)"

exit 0
