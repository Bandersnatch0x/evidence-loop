# ADR 0002: Docker container isolation

## Status

Accepted and implemented on 2026-07-23.

## Context

The default `PythonSubprocessRunner` uses Python isolation flags, execution timeouts, output limits, and AST restrictions, but it does not provide kernel-level network, memory, CPU, or PID isolation. It remains useful for controlled local demos and CI environments without Docker, but it must not execute untrusted public submissions.

The evaluated alternatives were:

- Docker with `--network=none`
- Firecracker microVMs
- Deno permissions
- Browser Workers

## Decision

Use an opt-in `DockerPythonRunner` for Python submissions that require stronger isolation. The service continues to default to `PYTHON_RUNNER=subprocess`; operators must explicitly set `PYTHON_RUNNER=docker`. Docker startup failures are fatal in Docker mode and never trigger a silent subprocess fallback.

The implementation invokes the Docker CLI directly rather than adding a Docker SDK dependency. It starts a configurable warm pool (default size: 2), launches one isolated Python process per submission with `docker exec -i`, queues work while all slots are busy, replaces unhealthy slots, and force-removes all managed containers during shutdown.

Pool containers use the following controls:

```text
docker run --rm -d \
  --network=none \
  --memory=128m --memory-swap=128m \
  --cpus=0.5 \
  --read-only \
  --tmpfs /tmp:noexec,nosuid,size=100m \
  --security-opt=no-new-privileges \
  --cap-drop=ALL \
  --pids-limit=64 \
  --user=65532:65532 \
  <image> python -I -S -u -c <idle-loop>
```

Each evaluation reuses the existing scoring harness:

```text
docker exec -i <container-id> python -I -S -u -c <evaluation-harness>
```

The reference image is defined in `docker/python-runner/Dockerfile`. The default remains `python:3.12-slim` so Docker mode can also run without a local image build; deployments can pin `DOCKER_RUNNER_IMAGE` to a reviewed image digest.

## Verification

- Unit tests assert every required Docker hardening argument.
- Fake-executor tests verify warm-slot reuse, queueing, unhealthy-slot removal, pool replenishment, and shutdown cleanup.
- A network probe attempts outbound TCP to `1.1.1.1:80` from a pool container and passes only when the connection fails.
- The real-container integration test runs automatically when the Docker daemon and configured image are already available. Set `RUN_DOCKER_INTEGRATION=1` to require it and fail when Docker cannot execute the test.
- `GET /api/health` reports `runner: docker` or `runner: python-subprocess`, exposing the active mode to deployment checks.

## Consequences

### Benefits

- External network access is denied by a dedicated network namespace with `--network=none`.
- cgroups limit memory and CPU; the PID limit constrains process fan-out.
- A read-only root filesystem, restricted tmpfs, non-root UID, dropped capabilities, and `no-new-privileges` reduce the writable and privileged attack surface.
- Pooling avoids a new container start for each submission while retaining a fresh Python process per run.
- Failed, timed-out, over-limit, or malformed executions cause the affected container to be removed and replaced.

### Costs and residual risk

- Docker containers share the host kernel and provide weaker isolation than microVMs.
- The Docker daemon is privileged infrastructure and requires separate access control, patching, monitoring, and host hardening.
- `--network=none` blocks external and host network access but does not remove the container's private loopback interface.
- Pool scheduling is in-process only; there is no cross-instance quota, tenant isolation, or distributed queue.
- Cold-start and queue latency depend on the host and image and are not assigned an unmeasured performance guarantee in this ADR.

## Production path

Before public deployment, add authentication and authorization, submission-level audit logs, signed and scanned image governance, daemon isolation, host patching, operational quotas, and a production database. Re-evaluate Firecracker or another microVM runtime if submissions include higher-risk code or regulated data.

## Related decisions

- ADR 0001: evidence-first scoring
- ADR 0003: demo compliance boundaries
