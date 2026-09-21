package PVE::API2::QuietfanStatus;

use strict;
use warnings;

sub get_status {
    my $path = '/run/quietfan-status.json';
    if (open my $fh, '<', $path) {
        local $/;
        my $raw = <$fh>;
        close $fh;
        if (defined $raw) {
            $raw =~ s/^\s+|\s+$//g;
            return $raw if $raw ne '';
        }
    }
    return '{}';
}

1;
