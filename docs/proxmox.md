# quietfan on Proxmox

For a Check Point 16200 that now runs **Proxmox VE** (Debian kernel, systemd, Python 3).

Gaia install is in [gaia.md](gaia.md). Shared curve and safety notes are in the [root README](../README.md).

## What is different from Gaia

- NCT7904 is **not** bound at boot until you load the module (`modprobe nct7904`).
- The current kernel exports `pwmN` / `pwmN_enable` under `/sys/class/hwmon/hwmon*/`, not Gaia’s `pwmN_input` / `pwmN_mode` on the I2C device.
- CPU temperature comes from **coretemp** `Package id 0` and `Package id 1`. NCT7904 PECI (`temp6`/`temp7`) is only a fallback.
- Persistence is **systemd** + `/etc/modules-load.d/nct7904.conf`.

`pwmN_enable`: **1** = manual, **2** = SmartFan. The daemon writes `1`, then the duty.

On this chassis **PWM1 is what actually sets fan RPM**. PWM2–4 can sit at 25 while PWM1 stays at SmartFan (~80) and all four fans run ~7500 RPM. After bind, PWM1 often ignores the first write; the daemon re-reads it and retries.

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

## BMC / IPMI (tried on this 16200)

The ASPEED BMC talks IPMI over KCS (`ipmi_si`, `/dev/ipmi0`). `ipmitool mc info` reports Device ID 32, firmware 6.27, IPMI 2.0, and only **Sensor Device** extra support. Manufacturer/product IDs are empty (`0` / `0x0202`).

### Setting fans via IPMI does not work

These all returned `rsp=0xc1` (invalid command), both on Gaia and on Proxmox, including after `nct7904` was blacklisted so the BMC owned the bus:

| Command | What it is |
|---------|------------|
| `raw 0x2c 0x00 0x00` | PICMG properties |
| `raw 0x2c 0x16 0x00 0x00` | Advantech get fan level |
| `raw 0x3a 0x01` | AMI / ASRock duty |
| `raw 0x30 0x45 0x00` | SuperMicro fan mode |
| `raw 0x30 0x70 0x66 0x00 0x00` | SuperMicro PWM |
| `raw 0x30 0x30 0x00` | Dell fan |
| `dcmi power reading` | DCMI watts |

Standard sensor reads work (`raw 0x04 0x2d 0x20` for SYS_FAN1, `ipmitool sdr type Fan`, `ipmitool chassis status`). There is no IPMI 2.0 “set fan PWM” without an OEM hook, and this firmware does not implement one.

### Two independent tachs

PWM (quietfan) and IPMI RPM are not the same path. Quietfan writes NCT7904 PWM. The BMC counts tach pulses on its own (or via the same monitor chip on a sideband). `SYS_FAN*` can disagree with sysfs `fan*_input` for a long time, then freeze.

| Who owns `0x2e` | Chassis sysfs | IPMI `SYS_FAN*` | IPMI PSU Pin / Iout / fans |
|-----------------|---------------|-----------------|----------------------------|
| Linux `nct7904` + quietfan | Live (PWM 25 → ~2400 RPM) | Stuck (e.g. 6480 or 7560, or garbage 34425) | Stuck on a plausible snapshot |
| Live `rmmod nct7904` | (sysfs gone) | Still stuck | Still stuck |
| Reboot with `nct7904` **blacklisted** | (sysfs gone; BMC/SmartFan ~7000 RPM) | Live, matches the loud curve | Live, updates under CPU load |

To hand the bus back to the BMC across reboot:

```bash
systemctl disable --now quietfan
echo blacklist nct7904 > /etc/modprobe.d/blacklist-nct7904.conf
rm -f /etc/modules-load.d/nct7904.conf
systemctl reboot
```

A live unload is **not** enough. After that reboot, 16 integer workers (~56 s) moved PSU input **160 W → 200 W** (88+72 → 112+88), PSU fans 5610/4590 → 6630/5865, with a **~30–60 s** SDR lag. The same load with `nct7904` bound (or after a live `rmmod`) left every PSU field byte-identical (88 W / 5.36 A / 5610 RPM).

`ipmitool sdr type Fan` mixes chassis and PSU. When quietfan is running, trust sysfs for chassis RPM. Do not trust IPMI `SYS_FAN*` or `PSU*_Pin` until you have rebooted with the module blacklisted. A wall PDU is the only live wattmeter while quietfan is in use.

### Chip SmartFan table (RAM)

The NCT7904 runs **SMART FAN IV** in hardware: four temp points and four duties per temp source in bank 3 (`0x30–0x4F`), plus a critical-temp latch (`CTFS` `0x20–0x23`). The Linux driver only exposes `pwmN` / `pwmN_enable`. It does **not** export that table.

BIOS table found on this box (bank 3, all four temp sources similar): **50/70/75/80 °C → PWM 65/110/180/240**. Chip power-on defaults in the datasheet are even louder (25/35/45/55 °C → 140/170/200/230).

With `nct7904.ko` **unloaded**, SMBus byte data to `0x2e` can rewrite the RAM table. A quieter copy of the quietfan curve (50/63/73/85 °C → PWM 25/45/85/200, CTFS 92 °C) made **PWM1 slew 71 → 25** over ~28 s. PWM2–4 stayed at 80 (PWM1 is the channel that sets RPM). No EEPROM was written.

That is **not better than quietfan**:

- RAM only — reboot reloads the BIOS table
- Host SMBus to `0x2e` froze IPMI the same as loading the kernel driver
- Four points, chip temps, no coretemp / hysteresis

Do not write the config EEPROM at I2C `0xA0` without a dump/backup. Do not `unbind` + `/dev/i2c-0` while the driver had been bound.

### Practical split

| Goal | Use |
|------|-----|
| Quiet chassis after reboot | `nct7904` + quietfan |
| Live IPMI PSU watts / `SYS_FAN*` | Blacklist `nct7904`, reboot, live with ~7000 RPM |
| Real power while quietfan runs | PDU on the wall cords |
