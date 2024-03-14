FROM bitnami/mysql:8.0.34

ARG LAGOON_VERSION
ENV LAGOON_VERSION=$LAGOON_VERSION

ENV ALLOW_EMPTY_PASSWORD=yes \
    MYSQL_USER=keycloak \
    MYSQL_DATABASE=keycloak \
    MYSQL_AUTHENTICATION_PLUGIN=mysql_native_password \
    DB_VOLUME_DIR=/var/lib/mysql

    RUN sed -i 's/export MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"/export MYSQL_PASSWORD="${MARIADB_PASSWORD:-keycloak}"/g' /opt/bitnami/scripts/mysql-env.sh
