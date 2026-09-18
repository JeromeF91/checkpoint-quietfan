# quietfan

Temperature-based chassis fan controller for a **Check Point 16200** (QL-25-00).

It keeps the four chassis fans quiet at idle, then raises PWM as CPU temperature climbs. PSU fans are separate and are not controlled.

This is **not** a Check Point–supported control path. Use it only on hardware you own, and watch temperatures after you change the curve.

## Pick your OS

| Host OS | Docs | Files |
|---------|------|-------|
| **Proxmox / Debian** | [docs/proxmox.md](docs/proxmox.md) | [`proxmox/`](proxmox/) — Python 3 + systemd |
| **Gaia R81** | [docs/gaia.md](docs/gaia.md) | [`gaia/`](gaia/) — Python 2 + SysV `chkconfig` |

The PWM curve is the same on both. Sysfs names, how the NCT7904 is bound, and how CPU temperature is read are **not**.

## Shared curve

| CPU temp (°C) | PWM | Approx. chassis RPM (sysfs) |
|---------------|-----|------------------------------|
| ≤ 50          | 25  | ~2350                        |
| 58            | 32  | ~2800                        |
| 63            | 45  | ~3800–4200                   |
| 68            | 60  | ~5100+                       |
| 73            | 85  | loud                         |
| 78            | 130 | very loud                    |
| 85            | 200 | near full                    |
| ≥ 92          | 255 | full                         |

Points in between are linearly interpolated. On the way down, PWM does not drop until temperature has fallen **2°C**. Duty never goes below PWM **20** (the measured floor on this chassis).

## Safety (both)

- Control fans only through NCT7904 sysfs PWM. Never `echo nct7904 > unbind`, and do not talk raw I2C to `0x2e` while the driver is bound.
- After install, confirm CPU temps under load, not only at idle.
- If the box hits a critical temperature, firmware/SmartFan can still pin the fans.
