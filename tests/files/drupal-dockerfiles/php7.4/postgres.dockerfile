ARG UPSTREAM_REPO
ARG UPSTREAM_TAG
FROM ${UPSTREAM_REPO:-testlagoon}/postgres-11-drupal:${UPSTREAM_TAG:-latest}