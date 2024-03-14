FROM bitnami/mysql:8.0.34

ARG LAGOON_VERSION
ENV LAGOON_VERSION=$LAGOON_VERSION

ENV ALLOW_EMPTY_PASSWORD=yes \
    MYSQL_USER=api \
    MYSQL_DATABASE=infrastructure \
    MYSQL_AUTHENTICATION_PLUGIN=mysql_native_password \
    MYSQL_SQL_MODE=NO_ENGINE_SUBSTITUTION \
    DB_VOLUME_DIR=/var/lib/mysql

RUN sed -i 's/export MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"/export MYSQL_PASSWORD="${MARIADB_PASSWORD:-api}"/g' /opt/bitnami/scripts/mysql-env.sh
