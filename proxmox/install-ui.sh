#!/bin/bash
# Install quietfan plus the Proxmox node Summary overlay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

modprobe nct7904
modprobe drivetemp || true

install -d /usr/local/share/quietfan
install -m 755 "$ROOT/quietfan" /usr/local/sbin/quietfan
install -m 644 "$ROOT/quietfan.service" /etc/systemd/system/quietfan.service
install -m 644 "$ROOT/nct7904.conf" /etc/modules-load.d/nct7904.conf
install -m 644 "$ROOT/drivetemp.conf" /etc/modules-load.d/drivetemp.conf
install -m 644 "$ROOT/quietfan-status.js" /usr/local/share/quietfan/quietfan-status.js
install -m 644 "$ROOT/QuietfanStatus.pm" /usr/local/share/quietfan/QuietfanStatus.pm
install -m 755 "$ROOT/quietfan-ui-apply" /usr/local/sbin/quietfan-ui-apply
install -m 644 "$ROOT/99quietfan-ui" /etc/apt/apt.conf.d/99quietfan-ui

python3 -m py_compile /usr/local/sbin/quietfan
python3 -m py_compile /usr/local/sbin/quietfan-ui-apply

systemctl daemon-reload
systemctl enable --now quietfan
systemctl restart quietfan

/usr/local/sbin/quietfan-ui-apply

echo "quietfan UI overlay installed. Hard-refresh the Proxmox UI (Ctrl+F5)."
