# Run the Idea A daily trend job

Use one scheduler for each deployment. A host scheduler can send a POST at **06:00 Asia/Bangkok** to `/api/ideas/idea-a/jobs/daily-trend`. On a UTC-only host, schedule it at 23:00 UTC daily. Disable the in-process scheduler when a host scheduler is active.

Set `IDEA_A_JOB_TOKEN` in the API and host scheduler environments as a random URL-safe secret. Point `MARACT_JOB_URL` to the full operator endpoint on your deployed HTTPS host. The host scheduler can run this command with those variables injected by its secret store.

```sh
: "${IDEA_A_JOB_TOKEN:?Set the job token in the scheduler secret store}"
: "${MARACT_JOB_URL:?Set the full operator endpoint}"
printf 'X-Job-Token: %s\n' "$IDEA_A_JOB_TOKEN" |
  curl --fail --silent --show-error --max-time 10 --request POST --header @- "$MARACT_JOB_URL"
```

HTTP 202 confirms the attempt was accepted and returns its `attempt_id` and `state`. An overlapping request returns the active attempt. Read `GET /api/ideas/idea-a/jobs/daily-trend/latest` for the attempted job and latest usable publication. The operator token stays on the server and the scheduler host.

Leave `IDEA_A_DEMO_TRIGGER_ENABLED` off on deployments with public traffic. Set it to `true` for the walkthrough to allow same-origin requests to `POST /api/ideas/idea-a/jobs/daily-trend/demo`. The demo trigger accepts up to three distinct attempts per Bangkok date in one API process. Set `IDEA_A_DEMO_DAILY_LIMIT` to change the limit. In-flight duplicates reuse an attempt and do not consume another slot. A process restart resets this demo-only limit.

If a reverse proxy fronts the demo, preserve the browser-facing host and scheme in the API request so the origin check can match them.
