#!/bin/bash
# Install the Proxmox node Summary overlay on a Check Point 6900.
# Does not replace the NCT6779 PWM daemon and does not load nct7904.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

modprobe nct6775
modprobe drivetemp || true

install -d /usr/local/share/quietfan
install -m 644 "$ROOT/quietfan-status.js" /usr/local/share/quietfan/quietfan-status.js
install -m 644 "$ROOT/QuietfanStatus.pm" /usr/local/share/quietfan/QuietfanStatus.pm
install -m 755 "$ROOT/quietfan-ui-apply" /usr/local/sbin/quietfan-ui-apply
install -m 644 "$ROOT/99quietfan-ui" /etc/apt/apt.conf.d/99quietfan-ui
install -m 644 "$ROOT/drivetemp.conf" /etc/modules-load.d/drivetemp.conf

python3 -m py_compile /usr/local/sbin/quietfan-ui-apply

/usr/local/sbin/quietfan-ui-apply

echo "quietfan UI overlay installed. Hard-refresh the Proxmox UI (Ctrl+F5)."
