# quietfan

Temperature-based chassis fan controller for Check Point appliances we own. It keeps the chassis fans quiet at idle, then raises PWM as CPU temperature climbs.

This is **not** a Check Point–supported control path. Watch temperatures after you change the curve.

| Appliance | Board | Fan chip | Host OS | Docs | Files |
|-----------|-------|----------|---------|------|-------|
| **16200** | QL-25-00 | NCT7904 (I2C `0-002e`) | Proxmox / Debian | [docs/proxmox.md](docs/proxmox.md) | [`proxmox/`](proxmox/) — Python 3 + systemd, plus a node Summary overlay |
| **16200** | QL-25-00 | NCT7904 | Gaia R81 | [docs/gaia.md](docs/gaia.md) | [`gaia/quietfan`](gaia/quietfan) — Python 2 + SysV |
| **6900** | QM-20-00 | NCT6779 (`nct6775` / `nct6779`) | Gaia R80.40 | [docs/gaia-6900.md](docs/gaia-6900.md) | [`gaia/quietfan-qm20`](gaia/quietfan-qm20) — Python 2 + SysV |
| **6900** | QM-20-00 | NCT6779 | Proxmox / Debian | [docs/proxmox-6900.md](docs/proxmox-6900.md) | [`proxmox/quietfan-qm20`](proxmox/quietfan-qm20) — Python 3 + systemd |

PSU fans are separate on both chassis and are **not** controlled. The 6900 does not even export PSU fan tachs (Gaia only shows PSU Up/Down).

## 16200 curve (NCT7904)

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

Duty never goes below PWM **20**. Idle stays at **25** (the 16200 is still spinning well there).

## 6900 curve (NCT6779)

Same shape, **lower idle**. BIOS SmartFan IV never goes below PWM 130 (~11k RPM). Measured floor: PWM 16 ≈ 1300 RPM (below Gaia’s 1480 RPM alarm), so idle is **20**.

```
PWM
255 |                              *
    |                         *
200 |                    *
    |
130 |               *
    |
 85 |          *
 60 |       *
 45 |     *
 32 |   *
 20 |***
    +----+----+----+----+----+----+---- temp °C
    50   58   63   68   73   78   85   92
```

| CPU temp (°C) | PWM | Approx. chassis RPM (sysfs) |
|---------------|-----|------------------------------|
| ≤ 50          | 20  | ~1740                        |
| 58            | 32  | interpolates                 |
| 63            | 45  | interpolates                 |
| 68            | 60  | interpolates                 |
| 73            | 85  | loud                         |
| 78            | 130 | BIOS’s old idle              |
| 85            | 200 | near full                    |
| ≥ 92          | 255 | full                         |

Points in between are linearly interpolated. On the way down, PWM does not drop until temperature has fallen **2°C**.

At 44°C this 6900 sits on the first point: **PWM 20 / ~1740 RPM**.

## Safety

- Control fans only through the bound hwmon sysfs PWM. Never unbind `nct7904` / `nct6775`, and do not talk raw I2C to the Super I/O while the driver is bound.
- After install, confirm CPU temps under load, not only at idle.
- If the box hits a critical temperature, firmware/SmartFan can still pin the fans.

## BMC / IPMI (16200)

`ipmitool` **cannot set** chassis PWM. OEM/PICMG/SuperMicro/AMI/Dell raw fan-set commands all return `0xc1`. The BMC is a tachometer and PSU sensor, not a fan controller.

Linux `nct7904` on SMBus `0x2e` and the BMC share that bus. While the host talks to the chip (kernel driver **or** userspace SMBus), IPMI `SYS_FAN*` and PSU watts/current/fans freeze on a plausible snapshot. They become live again only after a **reboot with `nct7904` blacklisted**. A live `rmmod` is not enough.

There is no second Linux driver that shares the bus. Programming the NCT7904 SmartFan table in RAM can drop PWM1, but it does not survive reboot and still blinds the BMC. Quietfan remains the way to keep the chassis quiet. Details and numbers: [docs/proxmox.md](docs/proxmox.md).

On the **6900**, IPMI `SYS_FAN1`–`4` exist but show `No Reading` while `nct6775` is bound. There are no PSU watt/fan SDRs. See [docs/gaia-6900.md](docs/gaia-6900.md).
