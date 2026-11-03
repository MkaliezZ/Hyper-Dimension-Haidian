# Build the pinned Base/Hermes dependency image first, then apply this school adaptation.
ARG UW_BASE_IMAGE=hyper-dimension-base:hermes
FROM ${UW_BASE_IMAGE}
COPY base/src/platform/ /app/src/platform/
COPY base/tools/m0-init.mjs /app/tools/m0-init.mjs
COPY base/deploy/entry.mjs /app/deploy/entry.mjs
COPY base/integrations/nodebb/ /app/integrations/nodebb/
COPY public /uw/public
COPY src /uw/src
COPY compat /uw/compat
COPY data /uw/data
COPY scripts /uw/scripts
COPY deploy /uw/deploy
COPY server.mjs package.json /uw/
ENV HD_BASE_ROOT=/app
ENTRYPOINT ["/usr/bin/tini","--","node","/uw/deploy/entry.mjs"]
