# quietfan on Gaia R81

For a Check Point 16200 still running **Gaia R81** (Python 2.7, SysV `chkconfig`, no systemd).

Proxmox install is in [proxmox.md](proxmox.md). Shared curve and safety notes are in the [root README](../README.md).

## What it does

The NCT7904 at I2C `0-002e` is already bound. BMC/`ipmitool` OEM fan commands return `0xc1`. Boot SmartFan tends to run ~PWM 80 / ~7000 RPM.

The daemon:

- Reads CPU PECI temps (`temp6_input` / `temp7_input` = Gaia `CPU0 Temp` / `CPU1 Temp`)
- Maps the hottest onto the shared PWM curve
- Writes `pwmN_mode=0` and `pwmN_input` for channels 1–4
- Loops every 4s with 2°C down-hysteresis

**PSU fans are separate.**

## Hardware path (safe)

Only sysfs. Do **not** unbind `nct7904`, do **not** talk raw I2C to `0-002e` while the driver is bound, and do **not** `cat` `pwm*_input` after a messy unbind/rebind. That combination has oopsed this kernel (`nct7904_update_device` / `mutex_lock`) and taken `/dev/ipmi0` with it until reboot.

```text
/sys/bus/i2c/devices/0-002e/
  temp1_input                System Temp 1 (board / NCT7904 local diode)
  temp2_input                System Temp 2 (board remote diode)
  temp6_input, temp7_input   CPU0 / CPU1 via Intel PECI (millidegrees C)
  temp8_input, temp9_input   unused PECI agents (read 0)
  pwmN_mode                  0 = manual, 1 = SmartFan
  pwmN_input                 duty 0–255
  fanN_input                 RPM (sysfs; roughly 2× what ipmitool shows)
```

Gaia names (`clish -c 'show sysenv temp'`) match those sysfs channels 1:1. `temp6`/`temp7` are Intel PECI (Xeon packages), not the front NICs. `temp1`/`temp2` are cooler board diodes (limit 70°C). The daemon follows CPU.

Dual Xeon Silver 4214. Gaia CPU trip is 83°C; the curve is at full PWM by 92°C.

Each loop:

1. Wait up to 90s for `pwm1_input` (boot order).
2. `t = max(temp6, temp7)` in °C.
3. Interpolate the curve.
4. If the new PWM would be lower and `t` is still within 2°C of the last change, keep the current PWM.
5. Set `pwmN_mode=0` and `pwmN_input=<pwm>` for N=1..4.

## Why not systemd / ipmitool / acsmartfand

| Approach | Result on this 16200 |
|----------|----------------------|
| `systemctl` | Gaia R81 has no systemd. Use `chkconfig` / `/etc/init.d` / `rc.local`. |
| `ipmitool raw` PICMG/SuperMicro | BMC returns `0xc1`. |
| `acsmartfand` | Can lock a high profile; fans go full blast. |
| Unbind NCT7904 + raw I2C | Kernel oops. |

## Files on the appliance

| Path | Role |
|------|------|
| `/usr/local/sbin/quietfan` | Python 2.7 daemon (`gaia/quietfan`) |
| `/etc/rc.d/init.d/quietfan` | SysV init (`gaia/quietfan.init`) |
| `/var/run/quietfan.pid` | PID file |
| `/var/log/quietfan.log` | stdout/stderr (`python -u` so lines flush) |
| `/etc/rc.local` | Extra `quietfan start` at end of boot |

`chkconfig` enables it on runlevels **2–5** as `S99quietfan`.

## Install

Expert mode. Python 2.7 is already there.

```bash
cp gaia/quietfan /usr/local/sbin/quietfan
cp gaia/quietfan.init /etc/rc.d/init.d/quietfan
chmod 755 /usr/local/sbin/quietfan /etc/rc.d/init.d/quietfan
python -m py_compile /usr/local/sbin/quietfan
chkconfig --add quietfan
chkconfig --list quietfan
grep -q quietfan /etc/rc.local || echo '/etc/init.d/quietfan start' >> /etc/rc.local
/etc/init.d/quietfan start
```

You want `2:on 3:on 4:on 5:on`. Append the `rc.local` line **after** the existing `SW_RAID` block, not inside it.

If you paste over a narrow serial/Opengear web shell, run `stty cols 200` first. History expansion will eat `#!/usr/bin/python` unless you use a quoted heredoc (`<< 'EOF'`) or `set +H`. The repo files avoid that.

## Verify

```bash
ps -ef | grep quietfan | grep -v grep
cat /sys/bus/i2c/devices/0-002e/pwm1_input
cat /sys/bus/i2c/devices/0-002e/temp6_input
cat /sys/bus/i2c/devices/0-002e/fan1_input
tail /var/log/quietfan.log
```

`temp6_input` is millidegrees (58250 = 58.25°C). Log lines look like:

```text
quietfan: temp=58.2C pwm=32
```

It only prints when PWM **changes**. Start the daemon with `python -u` (the init script does) or the log stays buffered.

## Day-to-day

```bash
/etc/init.d/quietfan stop
/etc/init.d/quietfan start
/etc/init.d/quietfan restart
tail -f /var/log/quietfan.log
```

Hand control back to SmartFan (loud):

```bash
/etc/init.d/quietfan stop
for i in 1 2 3 4; do
  echo 1 > /sys/bus/i2c/devices/0-002e/pwm${i}_mode
done
```

## Tuning

Edit the `C=[...]` list in `gaia/quietfan` (or `/usr/local/sbin/quietfan`), then:

```bash
python -m py_compile /usr/local/sbin/quietfan
/etc/init.d/quietfan restart
```

Raise PWM values if the box runs hot under traffic. Do not go below 20 on this chassis.

A Gaia upgrade may restore SmartFan and/or wipe `/usr/local` or `rc.local`. Recheck after patches.
