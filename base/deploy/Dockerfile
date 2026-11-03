FROM ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils openjdk-21-jre-headless postgresql-client python3 python3-venv tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY tools/m0-install-ubuntu.sh tools/m0-patch-nodebb.cjs ./tools/
COPY integrations/versions.json ./integrations/versions.json
COPY integrations/nodebb ./integrations/nodebb
COPY integrations/nodebb-upstream ./integrations/nodebb-upstream
COPY integrations/download-cache ./integrations/download-cache
RUN bash tools/m0-install-ubuntu.sh /opt/hd-services
ENV PATH=/opt/hd-services/node/bin:$PATH
RUN /opt/hd-services/keycloak/bin/kc.sh build --db=postgres --health-enabled=true
ARG HD_PIP_INDEX_URL=https://pypi.org/simple
COPY requirements-embedding.txt ./requirements-embedding.txt
RUN python3 -m venv /opt/embedding && /opt/embedding/bin/pip install --no-cache-dir --index-url "$HD_PIP_INDEX_URL" -r requirements-embedding.txt
COPY . .
RUN if [ -f PACKAGE-MANIFEST.json ]; then node tools/verify-package.mjs; else npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm run setup && npm --prefix admin ci --no-audit --no-fund && npm --prefix admin run build; fi
ENTRYPOINT ["/usr/bin/tini","--","node","deploy/entry.mjs"]
