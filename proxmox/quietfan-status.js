(function () {
    var ok = typeof Ext !== 'undefined';
    ok = ok && Ext.override;
    ok = ok && PVE && PVE.node;
    ok = ok && PVE.node.StatusView;
    if (!ok) {
        return;
    }

    function parseStatus(value) {
        if (!value) {
            return {};
        }
        if (typeof value === 'object') {
            return value;
        }
        try {
            return JSON.parse(value) || {};
        } catch (e) {
            return {};
        }
    }

    function fmtHz(mhz) {
        if (mhz == null) {
            return 'n/a';
        }
        if (mhz >= 1000) {
            return (mhz / 1000).toFixed(2) + ' GHz';
        }
        return Math.round(mhz) + ' MHz';
    }

    function fmtCpuSpeed(status) {
        var mhz = status.cpu_mhz;
        if (!mhz || mhz.avg == null) {
            return 'n/a';
        }
        var a = fmtHz(mhz.avg) + ' avg  (';
        return a + fmtHz(mhz.min) + '-' + fmtHz(mhz.max) + ')';
    }

    function fmtCpuTemp(status) {
        var t = status.cpu_temp_c || {};
        var pkgs = t.packages || [];
        if (pkgs.length) {
            return pkgs.map(function (p) {
                var n = Number(p.c).toFixed(0);
                return 'CPU' + p.id + ' ' + n + ' C';
            }).join('   ');
        }
        if (t.hot != null) {
            return Number(t.hot).toFixed(0) + ' C';
        }
        return 'n/a';
    }

    function fmtChassis(status) {
        var t = status.chassis_temp_c || {};
        var temps = (t.temps || []).slice();
        temps.sort(function (a, b) {
            var ia = String(a.id);
            var ib = String(b.id);
            if (ia === 'SYSTIN') {
                return -1;
            }
            if (ib === 'SYSTIN') {
                return 1;
            }
            return ia.localeCompare(ib);
        });
        if (temps.length) {
            return temps.map(function (x) {
                var n = Number(x.c).toFixed(0);
                var id = x.id;
                if (typeof id === 'number') {
                    return 'Sys' + id + ' ' + n + ' C';
                }
                return id + ' ' + n + ' C';
            }).join('   ');
        }
        if (t.hot != null) {
            return Number(t.hot).toFixed(0) + ' C';
        }
        return 'n/a';
    }

    function fmtDisks(status) {
        var disks = status.disks || [];
        if (!disks.length) {
            return 'n/a';
        }
        return disks.map(function (d) {
            var temp = 'n/a';
            if (d.temp_c != null) {
                temp = Number(d.temp_c).toFixed(0) + ' C';
            }
            return d.name + ' ' + temp;
        }).join('   ');
    }

    function fmtFans(status) {
        var fans = status.fans || [];
        var parts = fans.map(function (f) {
            return 'Fan' + f.id + ' ' + f.rpm + ' RPM';
        });
        if (status.pwm != null) {
            parts.push('PWM ' + status.pwm);
        }
        if (!parts.length) {
            return 'n/a';
        }
        return parts.join('   ');
    }

    function row(id, icon, title, fmt, extra) {
        var cfg = {
            itemId: id,
            colspan: 2,
            printBar: false,
            iconCls: icon,
            title: gettext(title),
            textField: 'quietfan',
            renderer: function (value) {
                return fmt(parseStatus(value));
            },
            value: '',
        };
        if (extra) {
            Ext.apply(cfg, extra);
        }
        return cfg;
    }

    Ext.override(PVE.node.StatusView, {
        height: 500,
        initComponent: function () {
            var extra = [
                {
                    xtype: 'box',
                    colspan: 2,
                    padding: '0 0 12 0',
                },
                row(
                    'quietfanCpuSpeed',
                    'fa fa-fw fa-tachometer',
                    'CPU speed',
                    fmtCpuSpeed
                ),
                row(
                    'quietfanCpuTemp',
                    'fa fa-fw fa-thermometer-half',
                    'CPU temperature',
                    fmtCpuTemp
                ),
                row(
                    'quietfanChassisTemp',
                    'fa fa-fw fa-building-o',
                    'Chassis temperature',
                    fmtChassis
                ),
                row(
                    'quietfanDiskTemp',
                    'fa fa-fw fa-hdd-o',
                    'Disk temperature',
                    fmtDisks
                ),
                row(
                    'quietfanFans',
                    'fa fa-fw fa-snowflake-o',
                    'Fan speed',
                    fmtFans
                ),
            ];
            if (Ext.isArray(this.items)) {
                this.items.push.apply(this.items, extra);
            }
            this.callParent();
        },
    });
})();
