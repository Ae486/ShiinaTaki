FROM ghcr.io/whiteguo233/openbiliclaw-backend@sha256:89e6d66f7fa1d3a3acfd1052b801d1177e1dd9ccbc19398c6da6da3eb1baebdf

# Reuse the verified 0.3.205 dependency image; do not resolve/install packages.
COPY .worktrees/openbili-recommendations/src /opt/taki-openbili/src
COPY integrations/openbili-deployment/bootstrap.py /opt/taki-openbili/bootstrap.py
COPY integrations/openbili-deployment/verify.py /opt/taki-openbili/verify.py
COPY integrations/openbili-deployment/source-manifest.json /opt/taki-openbili/source-manifest.json

ENV PYTHONPATH=/opt/taki-openbili/src \
    PYTHONDONTWRITEBYTECODE=1 \
    OPENBILICLAW_PROJECT_ROOT=/app/runtime \
    OPENBILICLAW_NETWORK_MODE=direct

RUN python -c "import importlib.metadata as m; assert m.version('openbiliclaw') == '0.3.205'"
LABEL org.opencontainers.image.title="Taki OpenBili native recommendation peek" \
      org.opencontainers.image.version="0.3.205-taki-peek-20261018" \
      io.taki.native.base-revision="a49af31248b5e88639593d04406828a8ea7f3138"

# Liveness only. Native /health may probe embeddings and HTTP 200 does not
# establish profile or recommendation readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8420/api/ping', timeout=4)"
CMD ["python", "/opt/taki-openbili/bootstrap.py"]
