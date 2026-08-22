# MuseScore CLI sidecar image (Phase 1 spike: CLI only, no HTTP API yet).
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
        python3 python3-flask && \
    wget -O /tmp/musescore.AppImage "${MUSESCORE_APPIMAGE_URL}" && \
    chmod +x /tmp/musescore.AppImage && \
    cd /opt && /tmp/musescore.AppImage --appimage-extract && \
    mv squashfs-root musescore && \
    apt-get remove -y wget musescore && \
    rm -rf /tmp/musescore.AppImage /var/lib/apt/lists/*

WORKDIR /data
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Phase 3: HTTP API wraps the same spike-validated xvfb-run+timeout+mscore
# invocation. entrypoint.sh is kept in the image for manual one-off CLI
# debugging (docker run --entrypoint /usr/local/bin/entrypoint.sh ...) but
# is no longer the container's default command.
COPY server.py /opt/scoreview-sidecar/server.py

# Overridable per `docker run -e`; server.py enforces this as a hard
# wall-clock guard so a hung MuseScore process (Risiko 6) cannot hang a
# conversion job indefinitely.
ENV MSCORE_TIMEOUT_SECONDS=120

EXPOSE 8765
ENTRYPOINT ["python3", "/opt/scoreview-sidecar/server.py"]
