# MuseScore sidecar image: MuseScore 4 behind a small HTTP API.
#
# Pinned MuseScore Studio version - update deliberately, never track "latest".
# Chosen because it is well past the 4.0.0/4.0.1 .spos/.mpos export
# regression (musescore/MuseScore#16710, fixed by PR #17464).
ARG MUSESCORE_VERSION=4.7.4
ARG MUSESCORE_BUILD=4.7.4.260706075
ARG MUSESCORE_APPIMAGE_URL=https://github.com/musescore/MuseScore/releases/download/v${MUSESCORE_VERSION}/MuseScore-Studio-${MUSESCORE_BUILD}-x86_64.AppImage

FROM ubuntu:22.04
ARG MUSESCORE_APPIMAGE_URL

# `musescore` (the distro package) is installed only to pull in its full set
# of runtime shared libraries (audio/GL/font stack) via apt dependency
# resolution, then removed again - the actual binary we run is the
# extracted AppImage. This mirrors a pattern validated by the community for
# headless MuseScore 4 in Docker; hand-listing the transitive .so
# dependencies of the AppImage binary is error-prone and version-fragile.
# Deliberately NOT running `apt-get autoremove` afterwards - that would
# pull out exactly the shared libraries (Qt, glib, ...) we kept the
# `apt-get remove` around for.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-suggests \
        xvfb wget libopengl0 musescore ca-certificates libpipewire-0.3-0 \
        python3 python3-flask gunicorn && \
    wget -O /tmp/musescore.AppImage "${MUSESCORE_APPIMAGE_URL}" && \
    chmod +x /tmp/musescore.AppImage && \
    cd /opt && /tmp/musescore.AppImage --appimage-extract && \
    mv squashfs-root musescore && \
    apt-get remove -y wget musescore && \
    rm -rf /tmp/musescore.AppImage /var/lib/apt/lists/*

WORKDIR /data
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The HTTP API wraps the same xvfb-run+timeout+mscore invocation as
# entrypoint.sh (see scoreview_sidecar/musescore.py). entrypoint.sh is kept
# in the image for manual one-off CLI debugging (docker run --entrypoint
# /usr/local/bin/entrypoint.sh ...) but is no longer the container's
# default command.
#
# scoreview_sidecar is a package of four modules - config / musescore /
# jobs / app (see scoreview_sidecar/__init__.py). wsgi.py is the entry
# point for gunicorn.
COPY scoreview_sidecar /opt/scoreview-sidecar/scoreview_sidecar
COPY wsgi.py /opt/scoreview-sidecar/wsgi.py

# Die gepinnte Version zur Bauzeit ins Image schreiben, statt sie
# zur Laufzeit aus `mscore4portable --version` zu lesen. Grund: dieser Aufruf
# braucht einen X-Server (xvfb) und schreibt Qt-Rauschen dazwischen - er ist
# damit langsam UND unzuverlaessig zu parsen. Die ARGs oben sind ohnehin die
# Wahrheit darueber, was im Image steckt.
ARG MUSESCORE_VERSION
ARG MUSESCORE_BUILD
ENV SCOREVIEW_MUSESCORE_VERSION="${MUSESCORE_VERSION} (${MUSESCORE_BUILD})"

# Minipartitur fuer den Selbsttest (`GET /selftest`). Kopie von
# sidecar/testdata/repeat-test.mscz - die einzige selbst erstellte und
# damit committbare Testpartitur (siehe sidecar/testdata/README.md). Sie
# deckt Wiederholung und Volta ab, also genau die Struktur, an der ein
# Formatwechsel in `--score-media` zuerst auffiele (docs/architecture.md
# M7).
COPY selftest-score.mscz /opt/scoreview-sidecar/selftest-score.mscz

# Overridable per `docker run -e`; scoreview_sidecar/musescore.py enforces
# this as a hard wall-clock guard so a hung MuseScore process cannot hang a
# conversion job indefinitely.
#
# Measured ~5.4s per rendered page (+1s startup) - see docs/limits.md. A
# too-small timeout would abort the orchestral scores (30+ pages) this app
# targets. Kept in sync with config.py's own fallback default on purpose -
# this ENV wins over that fallback, so the two must not drift apart.
ENV MSCORE_TIMEOUT_SECONDS=600

# Wie viele MuseScore-Prozesse gleichzeitig laufen duerfen. Ohne Grenze
# wuerde jedes /convert sofort einen eigenen Prozess samt Xvfb starten.
# Wartende Auftraege bleiben schlicht auf "pending", die PHP-Seite pollt
# ohnehin.
ENV SCOREVIEW_MAX_CONCURRENT=2

# Haertung: der Konvertierungsprozess (mscore4portable, eine grosse
# C++/Qt-Codebasis auf beliebigen, nicht vertrauenswuerdigen
# .mscz-Uploads) laeuft nicht als root.
# HOME wird explizit gesetzt, weil das AppImage/Qt sonst versucht, unter
# root's Home-Verzeichnis Konfiguration/Cache abzulegen, worauf der
# scoreview-Nutzer keinen Zugriff hat.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin scoreview && \
    chown -R scoreview:scoreview /data
ENV HOME=/home/scoreview
USER scoreview

EXPOSE 8765
WORKDIR /opt/scoreview-sidecar

# gunicorn statt Flasks Entwicklungsserver. Werkzeug warnt beim Start
# selbst davor, und zu Recht: kein Worker-Management, kein definiertes
# Verhalten unter Last, kein Neustart nach dem Absturz eines Threads.
#
# GENAU EIN WORKER, und das ist keine Sparsamkeit, sondern Voraussetzung:
# die Job-Registry liegt im Speicher des Prozesses (scoreview_sidecar/jobs.py).
# Mit mehreren Workern traefe eine Statusabfrage frueher oder spaeter einen
# Prozess, der den Job nie gesehen hat - sporadisch und schwer erklaerbar.
# Die Zahl gleichzeitiger KONVERTIERUNGEN regelt stattdessen
# SCOREVIEW_MAX_CONCURRENT, unabhaengig von den HTTP-Threads.
#
# --timeout grosszuegig: /selftest laesst eine echte Konvertierung laufen
# (~6s gemessen) und /soundfont schiebt rund 40 MB durch die Leitung.
ENTRYPOINT ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --timeout 300 --graceful-timeout 30 --access-logfile - --bind 0.0.0.0:${PORT:-8765} wsgi:app"]
