# Deployment operations

The canonical Docker/Convex structure and operational steps live in [deployments/README.md](../deployments/README.md).

Dirrio deploys four application processes: Bun API, Bun worker, static web, and static admin. An nginx proxy fronts the API. Convex and private R2 remain external managed services. Docker builds use Bun 1.3.14 and the committed lockfile; browser configuration is public build-time data and server credentials are mounted at runtime.

Follow the runbook for validation, HTTPS ingress, SMTP login, R2 CORS, webhook configuration, administrator bootstrap, monitoring and coordinated rollback. No production deployment or paid provider request occurs as part of creating these files.
