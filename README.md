# Plant AI Companion

Responsive React + TypeScript application for plant discovery and care. The default demo uses browser-local example data. A separate Supabase account backend is available when explicitly configured; an anonymous/local demo session is never represented as a cloud account.

## Local demo

Requirements: Node.js 20.19+ or 22.12+, npm.

```sh
npm install
npm run dev
npm test
npm run build
```

Demo data and demo preferences stay in this browser's local storage. Signing into Supabase does not import or synchronize this local collection. Signed-in users load and update their owner-scoped plant garden, care events, tasks, Plant Doctor episodes/follow-ups, growth observations, and private monitoring photos in Supabase; saved identification discoveries remain browser-local and are not silently uploaded.

## Supabase local development

Install the Supabase CLI and Docker Desktop, then start the local stack from the repository root:

```sh
supabase start
supabase db reset
supabase status
```

`db reset` applies the versioned SQL migrations and `supabase/seed.sql`. The seed contains public taxonomy/reference examples only; it does not create an impersonated demo user or any owned plants. Create two distinct test users using the local Auth signup endpoint or application settings and confirm their emails if email confirmation is enabled.

Copy `.env.example` to `.env.local`, then set the local API URL and **publishable** key printed by `supabase status`:

```dotenv
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
```

Restart Vite after changing environment variables. The publishable key is intended for browser use; it is not an authorization bypass. Authenticated database and storage access is enforced by RLS. Never use a service-role or secret key in any `VITE_` variable.

To return to the isolated browser demo, set `VITE_DEMO_MODE=true`. In cloud mode, Profile & Settings supports registration, sign-in, session restoration, sign-out, account preference persistence, account data export, and server-verified account deletion. Local demo plants remain separate from the signed-in account.

## Schema and authorization

- `supabase/migrations/202610240001_initial_schema.sql` is the original deployed scaffold; keep it in migration history.
- `supabase/migrations/202610240002_account_data_model.sql` migrates the scaffold into profiles, taxa, individual plant instances, independent discoveries, placements, pots, photos, care events/tasks, growth checks, issue episodes/follow-ups, and AI inference/reference records.
- `supabase/migrations/202610240003_plant_identification.sql` stores accepted external taxonomy IDs and match metadata on discoveries, and adds a private, service-role-only request ledger with atomic per-user, shared-daily, and concurrency limits.
- `supabase/migrations/202610240004_personalized_care_engine.sql` adds bounded care observations, task states, sourced species interval guidance, and transactional RPCs for recording care checks and completing planned care tasks.
- `supabase/migrations/202610240005_plant_monitoring.sql` and `202610240006_monitoring_photo_links.sql` add structured Plant Doctor and Growth Check records, independent issue episodes, confirmations, follow-ups, and owner-linked private photos.
- `supabase/migrations/202610240007_contextual_plant_assistant.sql` adds owner-scoped assistant conversations/messages, private usage accounting, and an atomic per-user rate-limit reservation.
- All user-owned records have UUID identifiers, an explicit `owner_id`, ownership-aware foreign keys, indexes, constraints, and RLS. Shared taxonomy and knowledge-source rows are authenticated read-only.
- `plant_instances` are individual owned plants. A discovery is independent and becomes an owned plant only after an explicit `createPlantFromDiscovery` call.
- `plant-photos` is private. Photo upload validates supported MIME type and an 8 MB maximum in the client, the bucket enforces size/type, storage RLS scopes object paths to the signed-in user's UUID, and signed photo URLs expire after 15 minutes.
- `archivePlant` is reversible and retains history/photos. `deletePlant` is permanent and removes owned photos before deleting the row. Storage and Postgres do not share a transaction: a storage cleanup failure is returned as an error and leaves the plant row intact.
- `ai_inferences` and source links are owner-readable but not writable by browser clients. Trusted inference creation belongs in a server-side function using server credentials.
- `exportUserData` exports authenticated account rows visible to that session. It does not export private image bytes; photos are represented by private storage metadata.

### Account deletion

Deleting an Auth user needs Supabase server privileges and cannot safely be performed from the browser. Deploy `supabase/functions/delete-account` and set its allowed web origins:

```sh
supabase secrets set APP_ALLOWED_ORIGINS=https://your-app.example
supabase functions deploy delete-account
```

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into the Edge Function environment. The UI requires the account password again, and the function verifies the caller's JWT and requires its `auth_time` to be within the last 15 minutes. It ignores user-supplied account identifiers, removes only objects under the caller's UUID in the private `plant-photos` bucket, and only then deletes that authenticated user (which cascades the database rows). A storage failure prevents Auth deletion. The service-role secret stays server-side.

## Plant identification

The Scan flow uses a provider interface. Local demo mode selects a mock adapter with fixed sample candidates, no score, and a persistent **DEMO RESULT · NOT IDENTIFIED FROM YOUR PHOTO** label. It never presents sample data as an analysis of the selected photo. Live mode calls the authenticated `identify-plant` Supabase Edge Function; the Pl@ntNet key is read only by that function and must never be placed in a `VITE_` variable or committed file.

### Provider setup

1. Create a Pl@ntNet API account and generate a private key from [API key settings](https://my.plantnet.org/settings/api-key).
2. Apply the migration and deploy the function:

   ```sh
   supabase db push
   supabase secrets set PLANTNET_API_KEY="<private-key>"
   supabase secrets set APP_ALLOWED_ORIGINS="https://your-app.example"
   supabase functions deploy identify-plant
   ```

   `SUPABASE_URL`, the publishable/anonymous key, and the service-role key are Supabase Edge Function environment values. The service-role key is used only server-side for the protected usage ledger and is never returned to the browser.
3. Configure optional server secrets as needed:

   ```sh
   supabase secrets set PLANTNET_PROJECT="all"
   supabase secrets set PLANTNET_APP_DAILY_LIMIT="450"
   supabase secrets set PLANTNET_USER_PER_MINUTE="5"
   supabase secrets set PLANTNET_USER_PER_DAY="20"
   supabase secrets set PLANTNET_MAX_CONCURRENT="20"
   supabase secrets set PLANTNET_TIMEOUT_MS="20000"
   supabase secrets set PLANTNET_MINIMUM_MATCH_SCORE="0.15"
   supabase secrets set PLANTNET_AMBIGUOUS_SCORE_GAP="0.08"
   ```

   The project defaults to `all`; use a project ID available to the configured Pl@ntNet API account. The minimum-score and candidate-gap values are application review heuristics, not model calibration or accuracy guarantees. They determine when the UI asks for more review; the original provider scores remain unchanged.

   `PLANTNET_ESTIMATED_COST_EUR` is optional. Set it only to the per-identification cost that applies to the account's actual agreement; otherwise the ledger records `NULL` rather than inventing a cost. For local function serving, put the same server-only settings in an ignored env file and run `supabase functions serve identify-plant --env-file supabase/.env.local`.

### Request and response contract

`POST /functions/v1/identify-plant` requires a valid Supabase bearer session and `multipart/form-data`. Repeat `images` and `organs` fields in matching order. One to five photos must depict the same plant. `organs` accepts `flower`, `fruit`, `leaf`, `habit`, `bark`, or `other`.

The client accepts JPEG and PNG; it validates image signatures, limits original files to 20 MB, and compresses/resizes large images in the browser. The endpoint independently checks MIME type, file signatures, 8 MB per image, 20 MB combined, and the one-to-five photo limit before forwarding them. Files are sent as multipart uploads to Pl@ntNet; this app does not store uploaded bytes, filenames, or image hashes.

Successful responses are normalized to this contract (example values are intentionally omitted):

```json
{
  "contractVersion": "1",
  "provider": "Pl@ntNet",
  "providerApiVersion": "v2",
  "providerVersion": null,
  "elapsedMs": 0,
  "resultMode": "live",
  "decision": "ambiguous",
  "candidates": [
    {
      "scientificName": "provider-supplied scientific name",
      "authorship": null,
      "commonNames": [],
      "matchScore": null,
      "taxonomy": {
        "family": null,
        "genus": null,
        "species": "provider-supplied scientific name",
        "externalIds": { "gbif": null, "powo": null }
      }
    }
  ]
}
```

`providerApiVersion` identifies the Pl@ntNet API version; `providerVersion` is populated only when the provider response supplies a version value. `matchScore` is the provider's relative ranking score, not a probability, calibrated confidence, or general AI certainty. It is `null` if the provider did not provide a valid score. Candidates preserve the provider score and available GBIF/POWO identifiers. Users can select an alternative or correct common/scientific names; corrected scientific names do not retain external IDs from a different provider candidate. Saved discoveries retain their source, accepted external IDs, provider version, score, and correction flag in browser-local storage; cloud discovery screens are still separate and are not silently synchronized.

Errors return `{ "code": "...", "message": "..." }` with appropriate HTTP status: invalid uploads (400), missing/invalid session (401), non-plant/no-candidate results (422), app/provider rate limit (429), missing credentials (503), provider failure (502), and timeout (504). The UI provides an explicit retry action. The endpoint does not automatically retry the provider's POST because a network failure may happen after Pl@ntNet has processed and counted the request.

The request ledger contains owner ID, provider, image count, request status, elapsed milliseconds, provider-reported version (when supplied), configured estimated cost, and a short error code; it contains no image data or names. The integration records the API version separately; it does not infer an unreported model version. Defaults cap the shared application key at 450 requests in a rolling 24 hours (below the public free allowance), 20 per user per day, five per user per minute, and 20 in-flight provider requests. Tune limits to the account plan. If a request worker crashes, its pending concurrency reservation expires from concurrency checks after two minutes.

### Pl@ntNet terms and quotas checked

Official Pl@ntNet API documentation says the service accepts one to five images of the same plant, returns candidate species with scores, and requires a Pl@ntNet account/private API key. Its FAQ recommends JPEG quality around 90%, a 1280-pixel maximum edge, identifies non-plant images with a 404 response, and notes species-level performance varies with species and input quality. The API terms describe free usage up to 500 identification queries per day, a 20-simultaneous-request ceiling, and powered-by attribution for free use; the live result includes Pl@ntNet attribution and links.

The official [pricing page](https://my.plantnet.org/pricing) currently lists a €0 free tier up to 500 identifications/day and a Pro plan with annual and volume-based charges. The separate [terms page](https://my.plantnet.org/terms_of_use) also publishes annual-volume and per-thousand prices that do not exactly match the pricing-page presentation. Confirm the current signed contract, applicable commercial-use rules, and attribution requirements with Pl@ntNet before production/commercial use; the application does not infer or promise a plan or price.

Sources: [Getting started](https://my.plantnet.org/doc/getting-started/introduction), [input FAQ](https://my.plantnet.org/doc/getting-started/faq), [pricing](https://my.plantnet.org/pricing), [terms of use](https://my.plantnet.org/terms_of_use), and the official [multipart request example](https://github.com/plantnet/my.plantnet/blob/master/examples/post/js/run.js).

## Authorization integration test

The test uses two **separate, pre-created** local Auth users and the publishable key; it never uses a service-role key. It checks profile, plant, discovery, care-event, private-photo, and contextual-assistant plant isolation, and removes the test records afterward.

Set the following environment variables in the shell (not a frontend `.env` file), then run:

```powershell
$env:SUPABASE_TEST_URL = "http://127.0.0.1:54321"
$env:SUPABASE_TEST_PUBLISHABLE_KEY = "<local publishable key>"
$env:SUPABASE_TEST_USER_A_EMAIL = "<first test user>"
$env:SUPABASE_TEST_USER_A_PASSWORD = "<first test password>"
$env:SUPABASE_TEST_USER_B_EMAIL = "<second test user>"
$env:SUPABASE_TEST_USER_B_PASSWORD = "<second test password>"
npm run test:authorization
```

The standard `npm test` suite is credential-free. The authorization integration test needs a running Supabase stack and two provisioned accounts; without those, runtime isolation cannot honestly be claimed as verified.

## Remaining integration work

## Personalized care scheduling

The care engine is deterministic and runs in the client while the app is open. It schedules bounded soil checks (3–21 days by default), asks for soil moisture and plant condition before suggesting Water, Skip and recheck, or Inspect further, and records a watering event only after explicit confirmation. Recent soil observations, a missed check-in, and bounded environment adjustments can move a later check. Wet soil prompts a short recheck and never a Water recommendation. The visible “Why?” list explains the applied rules.

Species-specific bounds are used only when an authenticated `care_guidance` row includes a sourced HTTPS reference. No species ranges are pre-filled or invented. Without verified guidance, the general conservative interval applies. Feeding, pruning, repotting, and seasonal review tasks are reminders to inspect and use judgement; completing one does not automatically apply a treatment.

Signed-in users' garden, care observations/events, and tasks load from Supabase. Soil-check decisions and planned task completion use transactional database functions; other task state, environment edits, and plant updates use owner-scoped repository operations. Anonymous demo tasks remain in browser-local storage. Scheduling is client-side: there is no server scheduler, service worker, or background notification delivery. Notification and quiet-hour settings are preferences only; browser notifications cannot be relied on while the app is closed.

The live identification provider requires Supabase function deployment and a server-side Pl@ntNet key. Saved discoveries remain browser-local; adding a discovery to My plants is a separate explicit action. Plant Doctor and Growth Check can use a server-side vision provider when configured; notification delivery and photo byte export are not configured. Identification is not guaranteed to be correct at species level.

## Plant Doctor and Growth Check

The checklist and clearly labelled demo flows work without an AI provider. Live analysis requires signed-in Supabase access, the latest migrations, deployed `plant-doctor` and `growth-check` functions, and a server-side vision API key. The functions call an OpenAI-compatible vision chat-completions endpoint; neither API keys nor image bytes are sent to the browser provider directly.

Configure the provider only as Supabase function secrets:

```sh
supabase secrets set VISION_API_KEY="<server-side provider key>"
supabase secrets set VISION_API_URL="https://api.openai.com/v1/chat/completions"
supabase secrets set VISION_MODEL="gpt-4o-mini"
supabase functions deploy plant-doctor
supabase functions deploy growth-check
```

`VISION_API_URL` and `VISION_MODEL` are optional; the defaults above are used when omitted. `PLANT_DOCTOR_API_KEY` and `GROWTH_CHECK_API_KEY` may be set to separate keys for either function. The URL must implement the OpenAI-compatible Chat Completions API with JSON-object output and image input. Provider requests have a 25-second timeout, are schema-validated server-side and client-side, and return a clear service error instead of a fabricated assessment if unavailable. Issue/growth records and photos are stored only under the signed-in owner. Plant Doctor reports observations separately from possible causes and does not treat visual appearance as proof. Growth Check never measures precise biological growth from an uncalibrated photo.

Local demo records and their compressed photo data remain in this browser's local storage. Demo results explicitly say that images were not analyzed; they are examples, not successful AI requests.

## Contextual plant assistant

The Plant assistant is available from the Plant assistant navigation item. Signed-in requests go to the authenticated `plant-assistant` Edge Function. The function resolves owned-plant IDs using the verified caller's owner ID, and only sends the selected plant's accepted species, environment, care plan/events, observations, and recent growth/issue history to the configured model. Saved discoveries and general species questions do not include private plant records. Locally saved discoveries provide only their selected identity details; those details are treated as user input, not verified account records.

The provider adapter accepts an OpenAI-compatible Chat Completions endpoint. Set these server-side Supabase secrets and deploy the migration and function:

```sh
supabase secrets set AI_API_KEY="<server-side provider key>"
supabase secrets set AI_API_URL="https://api.openai.com/v1/chat/completions"
supabase secrets set AI_MODEL="gpt-4o-mini"
supabase secrets set APP_ALLOWED_ORIGINS="https://your-app.example"
supabase db push
supabase functions deploy plant-assistant
```

`AI_API_URL` defaults to the endpoint above; `AI_API_KEY` may also be supplied as `OPENAI_API_KEY`. The key and endpoint configuration remain server-side. Text-only questions use no image input; an attached JPEG, PNG, or WEBP photo is compressed client-side and included only in that request for visual understanding. The provider call times out after 25 seconds, the browser request after 32 seconds, and all model JSON is validated before it is returned. Per-user requests are limited to 5/minute and 50/day, with provider/model, token counts when supplied, latency, and outcome recorded privately.

Conversation persistence is enabled for signed-in accounts and the interface provides history loading and deletion. Conversation contents and per-user usage metadata are included in account data export. Conversation APIs and records are owner-checked; the model cannot trigger plant, care, or other application mutations. Replies separate curated references, user-reported/account data, image observations, and AI inferences. Potential health causes are not diagnoses, and toxicity/exposure guidance is not gated by a subscription. If authentication, configuration, or the AI provider is unavailable, the page displays a clearly labelled fallback and keeps the unsent message available for retry; signed-out messages are not transmitted or persisted.

## Demo release checklist and five-minute walkthrough

This repository currently has no deployed demo URL. For a local, offline-safe demonstration:

1. Use Node.js 20.19+ or 22.12+, install with `npm ci`, and leave `VITE_DEMO_MODE=true` (the `.env.example` default).
2. Run `npm run dev` and open `http://localhost:5173`.
3. Keep the app in **Local demo** mode. Do not enter a production credential into a frontend `VITE_` variable.

Suggested five-minute script:

| Time | Demo action | Callout |
|---|---|---|
| 0:00–0:30 | Open Today and My plants. | The guest garden is example data stored in this browser. |
| 0:30–1:30 | Open Scan, choose a plant photo, and preview the demo result. | The result is explicitly labelled **DEMO RESULT · NOT IDENTIFIED FROM YOUR PHOTO**; no image analysis or match score is claimed. |
| 1:30–2:00 | Save the discovery, then point out **Add to My plants** as a separate action. | Saving a discovery does not create an owned plant. |
| 2:00–2:45 | Add it, edit its room/light/pot/drainage, and save. | This is a local demo record, not a cloud account. |
| 2:45–3:30 | Open Check soil, select the observed soil/condition, and confirm Water only if appropriate. | A watering event is logged only after explicit confirmation; the timeline and next-check date then update. |
| 3:30–4:15 | Submit a Plant Doctor checklist and save a dated follow-up. | It organizes user observations and safe checks, not a definitive diagnosis. |
| 4:15–4:45 | Save a Growth Check photo/note and confirm or correct the observation. | Checklist mode records a baseline; it does not claim that the image was analyzed or measure growth. |
| 4:45–5:00 | Refresh and revisit the plant, Doctor, and Growth Check history. | Local demo records persist in this browser. Live AI, cross-account isolation, and deployed services are not represented by this demo. |

### Recovery plan for failed AI or provider requests

1. Do not repeat a request continuously or present a timeout/error as an analysis.
2. Keep the user's text and photo locally available; retry once after checking sign-in and connectivity.
3. For plant identification, switch to the clearly labelled sample demo or continue without an identification. Never imply that the demo identified the uploaded image.
4. For Plant Doctor or Growth Check, use Checklist mode; report that no AI image analysis was performed. For the assistant, use the displayed fallback and record observations manually; signed-out notes are session-only.
5. If the demo depends on live services, stop the live portion and explain that credentials/provider availability are unverified. Do not paste credentials into the browser or source files.

## Release status and verification

No separate PRD document or deployed application URL was present in the workspace at this audit. The status below is based on the user-provided MVP journeys, README, source, tests, and a local browser walkthrough—not a production sign-off.

| Feature or acceptance area | Status | Evidence / limitation |
|---|---|---|
| Guest access and local example garden | Working | Local browser walkthrough; example data is deliberately not an account. |
| Photo upload and unambiguous sample identification | Demo-only | Local sample output states it did not analyze the photo. |
| Save discovery separately from adding an owned plant | Working | Browser walkthrough and `AppDataContext` unit tests. |
| Environment editing, soil check, confirmed watering, timeline, next check | Working | Browser walkthrough; watering requires dry-soil/usual-condition confirmation. |
| Plant Doctor checklist and issue follow-up | Working | Browser walkthrough and journey tests; not a diagnosis. |
| Growth photo, dated baseline, user confirmation, history | Working | Browser walkthrough and journey tests; no calibrated measurement. |
| Refresh persistence in local demo | Working | Verified for the created plant, care event, issue follow-up, and growth photo/confirmation. |
| Mobile and desktop layout | Incomplete | Plant profile had no horizontal overflow at 390×844 or 1440×900. Other routes, keyboard-only navigation, and assistive technology were not exhaustively checked. |
| Accessibility | Incomplete | Keyboard focus and visible button names were spot-checked; no automated WCAG audit or assistive-technology testing was run. |
| Real Pl@ntNet identification | Blocked | Function/API key and deployed Supabase were not configured or available for this audit. |
| Live Plant Doctor, Growth Check, and contextual assistant | Blocked | Vision/AI provider credentials and deployed functions were unavailable. Failure, schema, timeout, ambiguity, and invalid-image handling have credential-free unit coverage, not live-provider verification. |
| Signed-in cloud persistence, migrations, RLS, two-user isolation | Blocked | Supabase/Deno CLI, Supabase URL/key, and two test accounts were unavailable; SQL was not applied or exercised. |
| Hosted/deployed version and deployed browser session | Blocked | No deployment URL or deployment credentials were provided. |
| Assistant for guests | Demo-only | Signed-out input stays in page-session memory and is neither sent to AI nor persisted; there is no guest AI answer. |

Local checks run on 2026-11-03: `npm run lint` passed (this script runs TypeScript `tsc -b --pretty`; no separate ESLint script is configured); `npm test` passed (75 tests); `npm run build` passed; `npm audit` reported zero vulnerabilities. The standalone validation plan passed all 13 assertions: build, 75 tests, and 11 route HTTP probes. Two setup attempts initially failed because `npm ci` could not replace the native CSS package while the local Vite QA server was running; after stopping the server, setup and the complete plan passed.

A local browser walkthrough uploaded an image, verified the explicitly labelled demo result, saved a discovery separately from adding an owned plant, added and edited the plant, confirmed a watering event after soil/condition input, saved a Plant Doctor checklist follow-up, and saved/corrected a Growth Check baseline. After reloading, the edited plant, watering timeline, Doctor follow-up, Growth photo, and correction were still present in local demo storage. This does not verify cloud persistence. The browser check was local only, not a deployed test.

The two-user authorization integration test, Supabase migrations/RLS, and Edge Functions could not be executed: no Supabase CLI/Deno, project credentials, or two test accounts were available. No deployed URL or deployment credentials were supplied. Live provider responses, hosted auth, and deployed browser journeys are unverified. A separate automated accessibility audit was not run.

Invalid MIME/signature/size uploads, ambiguous candidate review, missing provider credentials, network/provider failures, and provider timeouts have deterministic unit coverage. Live responses, actual pricing/quota behavior, hosted auth, RLS, and actual external-service outages remain unverified.

### External services and cost considerations

| Service | Use and credential | Cost / operational consideration |
|---|---|---|
| Supabase Auth, Postgres, Storage, Edge Functions | Required only for account-backed hosting; browser receives only the project URL and publishable key. Server functions use Supabase-injected credentials. | Supabase plan limits/pricing may apply to database, storage, bandwidth, and function use; check the current project plan and usage dashboard. |
| Pl@ntNet | Live identification only; `PLANTNET_API_KEY` is a server-side secret. | Quotas and prices depend on the current API plan/terms. Confirm the applicable account terms before a public/commercial demo; do not infer costs from a demo response. |
| OpenAI-compatible vision/chat provider | Live Doctor/Growth uses `VISION_API_KEY`; assistant uses `AI_API_KEY` (or `OPENAI_API_KEY`), plus optional model/endpoint settings—all server-side secrets. | Provider bills and limits vary by vendor/model, token volume, image input, and account plan. Review the selected provider's current pricing and set usage limits before enabling live traffic. |
| Unsplash-hosted example images and Google Fonts | External image/font URLs used by the local UI; no provider API key is configured by this app. | Requires network access and is subject to those services' availability and terms; local app behavior must not depend on these being a live AI result. |

Never put `PLANTNET_API_KEY`, `VISION_API_KEY`, `AI_API_KEY`, `OPENAI_API_KEY`, or Supabase service-role/secret keys in `VITE_` variables, static frontend files, browser storage, or commits. The browser sends photos only when a user explicitly starts an applicable live request; local demo images are not sent for analysis.

### Static frontend deployment

Build with `npm ci` and `npm run build`, then deploy `dist/` to a static host configured to serve `index.html` for SPA routes. For account-backed use, set `VITE_DEMO_MODE=false`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` in the hosting build environment; apply reviewed migrations with `supabase db push`, set the server-side secrets listed above, configure `APP_ALLOWED_ORIGINS`, and deploy the required Edge Functions. Do not switch a public app to live mode until a separate deployment run has verified migrations, auth, provider calls, rate limits, two-account authorization, and the hosted browser journeys. Those deployment steps were not executed as part of this local audit.
