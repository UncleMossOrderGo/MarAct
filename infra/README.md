# GCP demo deployment

MarAct serves the React build and FastAPI from one Cloud Run container. Cloud SQL for PostgreSQL stores catalog, buyers, orders, and Copilot quotas. The release builds a container from a passing `main` commit and deploys the same image digest to the migration job and service.

## One-time setup

1. Confirm Billing and deploy permissions on project `gen-lang-client-0226626879`. Choose a region available to the project. `asia-southeast1` is a suggested starting point.
2. Enable Cloud Run, Artifact Registry, Cloud SQL Admin, Secret Manager, IAM, IAM Credentials, and Security Token Service APIs. Create a Docker repository and a Cloud SQL PostgreSQL instance, database, and database user for the demo. Choose PostgreSQL 17 to match local Compose. Configure the Cloud Run Unix socket connector with the instance connection name.
3. Create a deploy service account for GitHub and a separate runtime service account. Give the deploy identity Artifact Registry Writer on the repository, Cloud Run Admin for deployments, and Service Account User on the runtime identity. Give the runtime identity Cloud SQL Client and Secret Accessor on the specific secrets below. Configure GitHub OIDC Workload Identity Federation with trust restricted to the repository ID, `refs/heads/main`, and the authorized deployer's GitHub `actor_id`. Bind the federated principal to the deploy service account. See the [Google GitHub Actions auth guide](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation).
4. Create GitHub environment `gcp-demo` and restrict deployments to `main`. Use its protection rules where available to keep deployment approval with the project owner. Set environment variables for the following values.

| GitHub environment variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `gen-lang-client-0226626879` |
| `GCP_REGION` | Cloud Run region |
| `GCP_ARTIFACT_REPOSITORY` | Docker repository name in that region |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Runtime service account email |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | GitHub deploy service account email |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full WIF provider resource name |
| `GCP_CLOUD_SQL_CONNECTION` | `project:region:instance` |
| `GCP_DATABASE_SECRET_REF` | `maract-database-url:1` using the actual version |
| `GCP_OPENAI_SECRET_REF` | `maract-openai-api-key:1` using the actual version |
| `OPENAI_MODEL` | Model ID enabled for the API key, for example `gpt-6-luna` if available |

Store `DATABASE_URL` and `OPENAI_API_KEY` in Secret Manager. The database URL uses the cloud database credentials, with URL-encoded credentials if needed, and the Unix socket directory. Example format `postgresql://USER:PASSWORD@/maract?host=/cloudsql/PROJECT:REGION:INSTANCE`. See the [Cloud Run to Cloud SQL connection guide](https://docs.cloud.google.com/sql/docs/postgres/connect-run).

Reuse the OpenAI key in the local `.env` by piping just the secret value into a new Secret Manager version. From Bash at the repository root, after logging into `gcloud` and creating the `maract-openai-api-key` secret, run the following.

```bash
set -o pipefail
uv run --locked --no-dev python -c 'from dotenv import dotenv_values; import sys; key = dotenv_values(".env").get("OPENAI_API_KEY"); key or sys.exit("OPENAI_API_KEY is missing"); sys.stdout.write(key)' \
  | gcloud secrets versions add maract-openai-api-key --project=gen-lang-client-0226626879 --data-file=-
```

Cloud Run injects `PORT`. The workflow sets `API_HOST=0.0.0.0` and `MARACT_PUBLIC_DEMO=1`. The Docker build excludes `.env` files. Public Copilot allows signed-in buyers up to 30 external turns per day, with a 200-turn overall daily cap and a six-turn limit per minute per address observed by the service. The environment variables `MARACT_AI_BUYER_PER_DAY`, `MARACT_AI_GLOBAL_PER_DAY`, and `MARACT_AI_IP_PER_MINUTE` control those defaults. A trend turn can fetch sources for multiple fruits. The quotas count turns.

## Release

1. From GitHub Actions, run **Deploy GCP demo** on `main` with a full SHA whose push **Checks** run passed. Select `seed_demo` for the first demo load, or when intentionally loading fixtures. Seed data uses stable keys and is independent of migrations.
2. The workflow pushes the image, executes the migration job, deploys a tagged candidate, and checks health, database readiness, the marketplace page, and the lots API. On later releases, it shifts service traffic only after checks pass. The initial service becomes reachable once its database readiness startup probe passes.
3. Open the service URL, try a guest catalog query, then sign in and check one model response and a trend citation with the actual deployment credentials.

Use Cloud Run’s revisions view or `gcloud run services update-traffic maract --to-revisions PREVIOUS_REVISION=100 --region REGION --project gen-lang-client-0226626879` to roll service traffic back. Migrations stay applied, so preserve schema compatibility with the previous revision. See the [Cloud Run rollout and rollback guide](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).
