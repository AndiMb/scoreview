# MuseScore sidecar image: MuseScore 4 behind a small HTTP API - and, as a
# second renderer, the scoreview-engine the app runs on its local path.
#
# Built from the REPOSITORY ROOT, because the engine renderer is the app's own
# converter (scoreview/converter), not a copy of it:
#
#   docker build -f sidecar/Dockerfile -t scoreview-musescore-cli .
#
# sidecar/Dockerfile.dockerignore keeps the context down to what is copied.
#
# Pinned MuseScore Studio version - update deliberately, never track "latest".
# Chosen because it is well past the 4.0.0/4.0.1 .spos/.mpos export
# regression (musescore/MuseScore#16710, fixed by PR #17464).
#
# Die beiden Zeilen MUSESCORE_VERSION/MUSESCORE_BUILD liest CI per
# `grep '^ARG MUSESCORE_VERSION='` (Abgleich mit der Engine-Version) und
# hebt der Engine-Release-Bot per sed - Form "ARG NAME=wert" beibehalten.
ARG MUSESCORE_VERSION=4.7.6
ARG MUSESCORE_BUILD=4.7.6.261022093
ARG MUSESCORE_APPIMAGE_URL=https://github.com/musescore/MuseScore/releases/download/v${MUSESCORE_VERSION}/MuseScore-Studio-${MUSESCORE_BUILD}-x86_64.AppImage
# SHA256 genau dieses AppImages. Ohne ihn lieferte ein ausgetauschtes
# Release-Asset (oder ein Umweg ueber einen manipulierten Spiegel) fremden
# Code, der danach auf jede hochgeladene Partitur losgelassen wird. Beim
# Heben von VERSION/BUILD MUSS er mitgehoben werden, sonst bricht der Build
# an `sha256sum -c` ab - gewollt, lieber laut als mit ungeprueftem Binary.
# Neu ermitteln, eine der beiden Arten (sie muessen uebereinstimmen):
#   gh api repos/musescore/MuseScore/releases/tags/v<VERSION> \
#     --jq '.assets[] | select(.name|endswith("x86_64.AppImage")) | .digest'
#   curl -fsSL -o ms.AppImage "<MUSESCORE_APPIMAGE_URL>" && sha256sum ms.AppImage
ARG MUSESCORE_APPIMAGE_SHA256=5fcbd1f292270eca5c3867d56b767c31a173a155216a415f5caee22553f8e7a6

# The converter stage: Node and `npm ci` against the converter's lockfile, so
# the engine in the image is byte for byte the one the app's release ships
# (integrity hashes in package-lock.json). Node comes from the official image
# - the same nodejs.org build, made for glibc 2.28 and up, so it runs on the
# Ubuntu below. Pinned by digest for the reason given there. Node 22: the
# first line with the stable permission model (`--permission`, 22.13), which
# locks each run in (scoreview_sidecar/engine.py). Find the digest with
#   docker buildx imagetools inspect node:22-bookworm-slim   (line "Digest:")
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS converter
WORKDIR /opt/scoreview-converter
COPY scoreview/converter/package.json scoreview/converter/package-lock.json ./
# With @librescore/fonts: the app's release leaves the CJK fonts out because
# of the App Store's 30 MiB limit, an image has no such limit - so here
# Chinese, Japanese and Korean lyrics come out as text, not boxes.
RUN npm ci --omit=dev --no-audit --no-fund
COPY scoreview/converter/convert.mjs ./
# The whole directory, not file by file: a module added to converter/lib
# would otherwise be missing from the image and only show at the first run.
# The tests next to the modules stay out (Dockerfile.dockerignore).
COPY scoreview/converter/lib ./lib/
# The five self-test scores of `convert.mjs --selftest` - selftest-score.mscz
# among them is also the MuseScore renderer's (config.SELFTEST_SCORE).
COPY scoreview/converter/*.mscz ./

# Basis-Image per Digest statt nur per Tag: `ubuntu:22.04` wird laufend neu
# gebaut, derselbe Dockerfile ergaebe sonst von Build zu Build ein anderes
# Image, ohne dass sich im Repo etwas geaendert haette. Der Digest ist der
# des Multi-Arch-Index, nicht eines einzelnen Plattform-Manifests.
# Der Preis: Sicherheitsupdates der Basis kommen nur noch mit einem
# bewussten Heben. Neu ermitteln mit
#   docker buildx imagetools inspect ubuntu:22.04   (Zeile "Digest:")
# und das Tag davor stehen lassen - es ist nur Lesehilfe, massgeblich ist
# der Digest.
FROM ubuntu:22.04@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02
ARG MUSESCORE_APPIMAGE_URL
ARG MUSESCORE_APPIMAGE_SHA256

# `musescore` (the distro package) is installed only to pull in its full set
# of runtime shared libraries (audio/GL/font stack) via apt dependency
# resolution, then removed again - the actual binary we run is the
# extracted AppImage. This mirrors a pattern validated by the community for
# headless MuseScore 4 in Docker; hand-listing the transitive .so
# dependencies of the AppImage binary is error-prone and version-fragile.
# Deliberately NOT running `apt-get autoremove` afterwards - that would
# pull out exactly the shared libraries (Qt, glib, ...) we kept the
# `apt-get remove` around for.
#
# The chmod after extracting: the 4.7.6 AppImage stores its directories as
# 0700, so the extracted tree belongs to root alone, and the unprivileged
# user the container runs as (see USER below) got exit 126 for
# mscore4portable. Read and traverse for everyone, write stays with root.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-suggests \
        xvfb wget libopengl0 musescore ca-certificates libpipewire-0.3-0 \
        python3 python3-flask gunicorn && \
    wget -O /tmp/musescore.AppImage "${MUSESCORE_APPIMAGE_URL}" && \
    echo "${MUSESCORE_APPIMAGE_SHA256}  /tmp/musescore.AppImage" | sha256sum -c - && \
    chmod +x /tmp/musescore.AppImage && \
    cd /opt && /tmp/musescore.AppImage --appimage-extract && \
    mv squashfs-root musescore && \
    chmod -R a+rX musescore && \
    apt-get remove -y wget musescore && \
    rm -rf /tmp/musescore.AppImage /var/lib/apt/lists/*

WORKDIR /data
COPY sidecar/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The HTTP API wraps the same xvfb-run+timeout+mscore invocation as
# entrypoint.sh (see scoreview_sidecar/musescore.py). entrypoint.sh is kept
# in the image for manual one-off CLI debugging (docker run --entrypoint
# /usr/local/bin/entrypoint.sh ...) but is no longer the container's
# default command.
#
# scoreview_sidecar is a package of six modules - config / errors /
# musescore / engine / jobs / app (see scoreview_sidecar/__init__.py). wsgi.py is the entry
# point for gunicorn.
COPY sidecar/scoreview_sidecar /opt/scoreview-sidecar/scoreview_sidecar
COPY sidecar/wsgi.py /opt/scoreview-sidecar/wsgi.py

# The engine renderer: Node and the converter from the stage above. Read only
# for the scoreview user - nothing in a run writes into it (the permission
# flags in engine.py allow writing only into the job's output directory).
COPY --from=converter /usr/local/bin/node /usr/local/bin/node
COPY --from=converter /opt/scoreview-converter /opt/scoreview-converter

# Die gepinnte Version zur Bauzeit ins Image schreiben, statt sie
# zur Laufzeit aus `mscore4portable --version` zu lesen. Grund: dieser Aufruf
# braucht einen X-Server (xvfb) und schreibt Qt-Rauschen dazwischen - er ist
# damit langsam UND unzuverlaessig zu parsen. Die ARGs oben sind ohnehin die
# Wahrheit darueber, was im Image steckt.
ARG MUSESCORE_VERSION
ARG MUSESCORE_BUILD
ENV SCOREVIEW_MUSESCORE_VERSION="${MUSESCORE_VERSION} (${MUSESCORE_BUILD})"

# Overridable per `docker run -e`; scoreview_sidecar/musescore.py enforces
# this as a hard wall-clock guard so a hung MuseScore process cannot hang a
# conversion job indefinitely.
#
# Measured ~6s per rendered page (+2s startup) - see docs/limits.md. A
# too-small timeout would abort the orchestral scores (30+ pages) this app
# targets. Kept in sync with config.py's own fallback default on purpose -
# this ENV wins over that fallback, so the two must not drift apart.
ENV MSCORE_TIMEOUT_SECONDS=600

# Wie viele MuseScore-Prozesse gleichzeitig laufen duerfen. Ohne Grenze
# wuerde jedes /convert sofort einen eigenen Prozess samt Xvfb starten.
# Wartende Auftraege bleiben schlicht auf "pending", die PHP-Seite pollt
# ohnehin - bis zu SCOREVIEW_MAX_QUEUED (Default 30, siehe config.py),
# darueber lehnt /convert mit 503 ab.
ENV SCOREVIEW_MAX_CONCURRENT=2

# Which renderer a request without its own choice gets (see config.py). The
# app names one with every job (its setting `sidecar_renderer`), so this only
# matters for older apps and manual calls.
ENV SCOREVIEW_SIDECAR_RENDERER=engine

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
# (~8 s gemessen) und /soundfont schiebt rund 40 MB durch die Leitung.
ENTRYPOINT ["sh", "-c", "exec gunicorn --workers 1 --threads 8 --timeout 300 --graceful-timeout 30 --access-logfile - --bind 0.0.0.0:${PORT:-8765} wsgi:app"]
