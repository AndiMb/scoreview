#!/bin/sh
# Wraps the extracted MuseScore 4 AppImage binary with:
#  - xvfb-run, because mscore4portable needs an X server even for pure CLI
#    conversion (headless-CLI-without-X was never fully supported upstream).
#  - timeout, as a hard guard against MuseScore hanging on unusual input -
#    the caller must be able to observe a failed job instead of an
#    indefinitely stuck container.
#
# All arguments are passed straight through to `mscore4portable`, e.g.:
#   docker run --rm -v <hostdir>:/data scoreview-musescore-cli \
#     /data/test1.mscz -o /data/test1.musicxml -o /data/test1.spos
set -eu

exec timeout --signal=KILL "${MSCORE_TIMEOUT_SECONDS}" \
    xvfb-run -a -s "-screen 0 640x480x24 -ac +extension GLX +render -noreset" \
    /opt/musescore/bin/mscore4portable "$@"
