# quietfan on Proxmox

For a Check Point 16200 that now runs **Proxmox VE** (Debian kernel, systemd, Python 3).

Gaia install is in [gaia.md](gaia.md). Shared curve and safety notes are in the [root README](../README.md).

## What is different from Gaia

- NCT7904 is **not** bound at boot until you load the module (`modprobe nct7904`).
- The current kernel exports `pwmN` / `pwmN_enable` under `/sys/class/hwmon/hwmon*/`, not Gaia’s `pwmN_input` / `pwmN_mode` on the I2C device.
- CPU temperature comes from **coretemp** `Package id 0` and `Package id 1`. NCT7904 PECI (`temp6`/`temp7`) is only a fallback.
- Persistence is **systemd** + `/etc/modules-load.d/nct7904.conf`.

`pwmN_enable`: **1** = manual, **2** = SmartFan. The daemon writes `1`, then the duty.

## Files

| Repo | On the host |
|------|-------------|
| `proxmox/quietfan` | `/usr/local/sbin/quietfan` |
| `proxmox/quietfan.service` | `/etc/systemd/system/quietfan.service` |
| `proxmox/nct7904.conf` | `/etc/modules-load.d/nct7904.conf` |

The daemon waits up to 90s for `nct7904` `pwm1` so it can start before the module finishes probing.

## Install

```bash
modprobe nct7904
cp proxmox/quietfan /usr/local/sbin/quietfan
cp proxmox/quietfan.service /etc/systemd/system/quietfan.service
cp proxmox/nct7904.conf /etc/modules-load.d/nct7904.conf
chmod 755 /usr/local/sbin/quietfan
systemctl daemon-reload
systemctl enable --now quietfan
systemctl status quietfan --no-pager
```

## Verify

```bash
journalctl -u quietfan -n 20 --no-pager
N=$(for d in /sys/class/hwmon/hwmon*; do grep -qx nct7904 "$d/name" && echo "$d" && break; done)
echo "pwm=$(cat "$N/pwm1") enable=$(cat "$N/pwm1_enable") fan=$(cat "$N/fan1_input")"
grep -H . /sys/class/hwmon/hwmon*/temp1_label
```

Log lines look like:

```text
quietfan: temp=42.0C pwm=25
```

It only prints when PWM **changes**.

## Day-to-day

```bash
systemctl status quietfan
systemctl restart quietfan
journalctl -u quietfan -f
```

Hand control back to SmartFan (loud):

```bash
systemctl stop quietfan
N=$(for d in /sys/class/hwmon/hwmon*; do grep -qx nct7904 "$d/name" && echo "$d" && break; done)
for i in 1 2 3 4; do echo 2 > "$N/pwm${i}_enable"; done
```

## Tuning

Edit the `CURVE` list in `proxmox/quietfan` (or `/usr/local/sbin/quietfan`), then:

```bash
python3 -m py_compile /usr/local/sbin/quietfan
systemctl restart quietfan
```

Raise PWM values if the box runs hot under VM load. Do not go below 20 on this chassis.

## How it works

1. Load / wait for hwmon named `nct7904`.
2. Read the hottest coretemp **Package id** (else NCT7904 PECI).
3. Interpolate the shared curve.
4. Apply 2°C down-hysteresis.
5. Set `pwm1`–`pwm4` enable to `1` and write the duty twice (this chip sometimes ignores the first write).

## Hardware notes

On Proxmox 9 / kernel `7.0.14-17-pve`, `modprobe nct7904` auto-binds SMBus I801 address `0x2e`. Other I2C devices on that bus (SPD EEPROMs, dummy, NIC) are unrelated.

| hwmon name | Use |
|------------|-----|
| `nct7904` | Chassis PWM 1–4 and fan tachs |
| `coretemp` | CPU package temperatures |
| `i350bb` | Intel I350 NIC — **not** used for the curve |

Do **not** unbind `nct7904` or poke raw I2C at `0x2e` while the driver is bound. That oopsed this platform’s kernel on Gaia and is not safer here.
