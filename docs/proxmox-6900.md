# quietfan on a Check Point 6900 running Proxmox

For a **Check Point 6900** (QM-20-00) that now runs **Proxmox VE** (Debian kernel, systemd, Python 3).

The Super I/O is an **NCT6779**. Load it with `nct6775.ko`; sysfs `name` is `nct6779`.

Gaia 6900 is in [gaia-6900.md](gaia-6900.md). The 16200 Proxmox port (NCT7904) is in [proxmox.md](proxmox.md). Curve: [root README](../README.md) (idle **PWM 20**).

## What is different from 6900 Gaia

- NCT6779 is **not** bound at boot until `modprobe nct6775`.
- Sysfs is `/sys/class/hwmon/hwmon*/` with `pwmN` / `pwmN_enable` (same names Gaia already used on this chip).
- CPU temperature comes from **coretemp** `Package id 0` (i9-9900KF). NCT6779 `PECI Agent 0` / `CPUTIN` are fallback.
- Persistence is **systemd** + `/etc/modules-load.d/nct6775.conf`.

`pwmN_enable`: **1** = manual, **5** = SmartFan IV. The daemon writes `1` on PWM1–4 every loop. **PWM5** has no tach; leave it alone.

BIOS SmartFan IV idles at PWM 130 / ~11k RPM. Quietfan idle is PWM 20 / ~1740 RPM. Do not go below 20 (PWM 16 dropped under Gaia’s 1480 RPM floor).

## Files

| Repo | On the host |
|------|-------------|
| `proxmox/quietfan-qm20` | `/usr/local/sbin/quietfan` |
| `proxmox/quietfan-qm20.service` | `/etc/systemd/system/quietfan.service` |
| `proxmox/nct6775.conf` | `/etc/modules-load.d/nct6775.conf` |

## Install

```bash
modprobe nct6775
cp proxmox/quietfan-qm20 /usr/local/sbin/quietfan
cp proxmox/quietfan-qm20.service /etc/systemd/system/quietfan.service
cp proxmox/nct6775.conf /etc/modules-load.d/nct6775.conf
chmod 755 /usr/local/sbin/quietfan
python3 -m py_compile /usr/local/sbin/quietfan
systemctl daemon-reload
systemctl enable --now quietfan
systemctl status quietfan --no-pager
```

Do **not** run `proxmox/install-ui.sh` on this box; that script loads `nct7904` for the 16200.

## Verify

```bash
journalctl -u quietfan -n 20 --no-pager
N=$(for d in /sys/class/hwmon/hwmon*; do grep -qx nct6779 "$d/name" && echo "$d" && break; done)
echo "pwm=$(cat "$N/pwm1") enable=$(cat "$N/pwm1_enable") fan=$(cat "$N/fan1_input")"
```

Log:

```text
quietfan: temp=29.0C pwm=20
```

## Hand control back to SmartFan (loud)

```bash
systemctl stop quietfan
N=$(for d in /sys/class/hwmon/hwmon*; do grep -qx nct6779 "$d/name" && echo "$d" && break; done)
for i in 1 2 3 4; do echo 5 > "$N/pwm${i}_enable"; done
```
