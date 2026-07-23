FROM python:3.12-slim

RUN groupadd --gid 65532 runner \
    && useradd --uid 65532 --gid 65532 --no-create-home \
      --home-dir /tmp --shell /usr/sbin/nologin runner

USER 65532:65532
WORKDIR /tmp
