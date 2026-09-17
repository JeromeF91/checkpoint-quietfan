# quietfan

Temperature-based chassis fan controller for a **Check Point 16200** (QL-25-00) running **Gaia R81**.

It keeps the appliance quiet at idle, then raises PWM as CPU temperature climbs. Gaia has no systemd; this is a SysV `chkconfig` service plus an `/etc/rc.local` fallback so it survives reboot.

This is **not** a Check Point–supported control path. Use it only on hardware you own, and watch temperatures after you change the curve.

## What it does

Check Point 16200 chassis fans are driven by an **NCT7904** super-I/O chip on I2C address `0-002e`. The kernel already binds that chip. The BMC/`ipmitool` OEM fan commands on this platform do not work (they return `0xc1`), and SmartFan at boot tends to run the fans very loud (~PWM 80, ~7000 RPM in sysfs).

`quietfan` takes over those four chassis PWM channels:

- Reads the two **CPU** PECI temperatures (`temp6_input` / `temp7_input` = Gaia `CPU0 Temp` / `CPU1 Temp`)
- Maps the **hottest** of those two onto a PWM curve
- Writes the same PWM to `pwm1`–`pwm4` in **manual** mode
- Sleeps 4 seconds and repeats
- On the way **down**, waits until temperature has dropped 2°C before lowering PWM, so the fans do not hunt
- Never goes below PWM **20** (the measured floor on this chassis)

**PSU fans are separate.** They are not on these PWM channels and this daemon cannot quiet them.

## How it works

### Hardware path (safe)

Only sysfs is used. Do **not** unbind `nct7904`, do **not** talk raw I2C to `0-002e` while the driver is bound, and do **not** `cat` `pwm*_input` after a messy unbind/rebind. That combination has oopsed this kernel (`nct7904_update_device` / `mutex_lock`) and taken `/dev/ipmi0` with it until reboot.

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

Gaia names (`clish -c 'show sysenv temp'`) match those sysfs channels 1:1. `temp6`/`temp7` are labeled `sensor = Intel PECI` by lm-sensors; that is the Xeon package interface, not the front Intel NICs. `temp1`/`temp2` are cooler board diodes (high limit 70°C). The daemon follows CPU, not the board sensors.

The 16200 is dual Xeon Silver 4214. CPU trip in Gaia is 83°C; the curve is already at full PWM by 92°C.

Each loop:

1. Wait up to 90s after start for `pwm1_input` to appear (boot order).
2. `t = max(temp6, temp7)` in °C.
3. Interpolate `t` on the curve below.
4. If the new PWM would be **lower** than the current one and `t` is still within 2°C of the last change, keep the current PWM.
5. Otherwise set `pwmN_mode=0` and `pwmN_input=<pwm>` for N=1..4.

### Default curve

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

Points in between are linearly interpolated. PWM 20 on this box is the same RPM as PWM 25 (~2380); going lower does not help.

### Why not systemd / ipmitool / acsmartfand

| Approach | Result on this 16200 |
|----------|----------------------|
| `systemctl` | Gaia R81 has no systemd. Use `chkconfig` / `/etc/init.d` / `rc.local`. |
| `ipmitool raw` PICMG/SuperMicro | BMC returns `0xc1` (invalid). Custom BMC, not those OEM sets. |
| `acsmartfand` | Daemonizes, can lock a high profile; fans go full blast. |
| Unbind NCT7904 + raw I2C | Kernel oops. Do not do this. |

## Files on the appliance

| Path | Role |
|------|------|
| `/usr/local/sbin/quietfan` | Python 2.7 daemon |
| `/etc/rc.d/init.d/quietfan` | SysV init (`/etc/init.d/quietfan` is the same file) |
| `/var/run/quietfan.pid` | PID file |
| `/var/log/quietfan.log` | stdout/stderr (`python -u` so lines flush) |
| `/etc/rc.local` | Extra `quietfan start` at end of boot |

`chkconfig` enables it on runlevels **2–5** as `S99quietfan`.

## Install

Expert mode on Gaia. Python 2.7 is already there. From this repo:

```bash
cp quietfan /usr/local/sbin/quietfan
cp quietfan.init /etc/rc.d/init.d/quietfan
chmod 755 /usr/local/sbin/quietfan /etc/rc.d/init.d/quietfan
python -m py_compile /usr/local/sbin/quietfan
chkconfig --add quietfan
grep -q quietfan /etc/rc.local || echo '/etc/init.d/quietfan start' >> /etc/rc.local
/etc/init.d/quietfan start
```

Or paste the files by hand:

### 1. Daemon

```bash
cat > /usr/local/sbin/quietfan << 'EOF'
#!/usr/bin/python
import os,time,sys
H='/sys/bus/i2c/devices/0-002e'
C=[(50,25),(58,32),(63,45),(68,60),(73,85),(78,130),(85,200),(92,255)]
def ri(p):
 try: return int(open(p).read())
 except: return None
def wi(p,v):
 try:
  f=open(p,'w'); f.write('%d\n'%v); f.close(); return 1
 except: return 0
def temp():
 vs=[]
 for n in ('temp6_input','temp7_input'):
  v=ri(H+'/'+n)
  if v and v>0: vs.append(v/1000.0)
 return max(vs) if vs else None
def pwm(t):
 if t<=C[0][0]: return C[0][1]
 if t>=C[-1][0]: return C[-1][1]
 for i in range(1,len(C)):
  t0,p0=C[i-1]; t1,p1=C[i]
  if t<=t1: return int(p0+(t-t0)/float(t1-t0)*(p1-p0))
 return C[-1][1]
def setp(p):
 p=max(20,min(255,int(p)))
 for i in range(1,5):
  wi(H+'/pwm%d_mode'%i,0); wi(H+'/pwm%d_input'%i,p)
 return p
for i in range(90):
 if os.path.exists(H+'/pwm1_input'): break
 time.sleep(1)
else:
 sys.stderr.write('quietfan: no hw\n'); sys.exit(1)
cur=None; lt=None
while 1:
 t=temp()
 if t is None:
  time.sleep(4); continue
 tgt=pwm(t)
 if cur is not None and tgt<cur and lt is not None and t>lt-2:
  tgt=cur
 if cur!=tgt:
  setp(tgt); cur=tgt; lt=t
  print 'quietfan: temp=%.1fC pwm=%d'%(t,cur)
 time.sleep(4)
EOF
chmod 755 /usr/local/sbin/quietfan
python -m py_compile /usr/local/sbin/quietfan
```

If you paste this over a narrow serial/Opengear web shell, run `stty cols 200` first, or write the file in small chunks. History expansion will eat `#!/usr/bin/python` unless you use a quoted heredoc (`<< 'EOF'`) or `set +H`.

### 2. Init script

```bash
cat > /etc/rc.d/init.d/quietfan << 'EOF'
#!/bin/sh
# chkconfig: 2345 99 10
# description: NCT7904 quiet fan daemon
PROG=/usr/bin/python
DAEMON=/usr/local/sbin/quietfan
PID=/var/run/quietfan.pid
LOG=/var/log/quietfan.log
start() {
  nohup $PROG -u $DAEMON >>$LOG 2>&1 &
  echo $! > $PID
  echo started
}
stop() {
  if [ -f $PID ]; then kill `cat $PID` 2>/dev/null; rm -f $PID; fi
  echo stopped
}
case "$1" in
start) start ;;
stop) stop ;;
restart) stop; sleep 1; start ;;
*) echo "Usage: $0 {start|stop|restart}"; exit 1 ;;
esac
EOF
chmod 755 /etc/rc.d/init.d/quietfan
chkconfig --add quietfan
chkconfig --list quietfan
```

You want `2:on 3:on 4:on 5:on`. That creates `/etc/rc.d/rc3.d/S99quietfan` and `/etc/rc.d/rc5.d/S99quietfan`.

### 3. rc.local backup

Append once, after the existing `SW_RAID` block, not in the middle of it:

```bash
grep -q quietfan /etc/rc.local || echo '/etc/init.d/quietfan start' >> /etc/rc.local
```

### 4. Start it now

```bash
/etc/init.d/quietfan start
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

## Day-to-day

```bash
/etc/init.d/quietfan stop
/etc/init.d/quietfan start
/etc/init.d/quietfan restart
tail -f /var/log/quietfan.log
```

To give control back to hardware SmartFan (loud):

```bash
/etc/init.d/quietfan stop
for i in 1 2 3 4; do
  echo 1 > /sys/bus/i2c/devices/0-002e/pwm${i}_mode
done
```

## Tuning

Edit the `C=[...]` list in `/usr/local/sbin/quietfan`, then:

```bash
python -m py_compile /usr/local/sbin/quietfan
/etc/init.d/quietfan restart
```

Raise PWM values if the box runs hot under traffic. Lower the low end only after you have watched temps for a while; do not go below 20 on this chassis.

## Safety

- Stay on sysfs PWM. Never `echo nct7904 > unbind`.
- After install, confirm PECI temps stay in a range you accept under load, not only at idle.
- A Gaia upgrade may restore SmartFan and/or wipe `/usr/local` or `rc.local`. Recheck after patches.
- This does not change Check Point’s own thermal policy in Gaia. If the box hits a critical temperature, firmware/SmartFan can still pin the fans.
