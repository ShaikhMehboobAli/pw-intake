# DECISIONS

## 0. The biggest assumption: there was no repo

The brief says a starter Expo codebase and a mock server would be provided. I didn't receive them (the link in
the brief was still "TBD"), so the **first commit recreates a plausible starting point**: a naive one-screen
excavator form and an Express mock API with a chaos layer. Everything after that commit is the actual exercise.
If you send the real starter repo, the outbox (`src/outbox/`) is written to drop in with minimal changes. It
only needs a `Transport` that matches your real API.

## 1. Diagnosis: how dealers lose submissions

Against the `bad` profile (latency, 503s, hangs, connection resets, and **responses dropped after the server
saved the data**), the baseline `submit()` fails in several ways:

| # | Failure | Effect |
|---|---------|--------|
| 1 | The form is cleared and "Submitted!" is shown *before* the request finishes | The dealer thinks it worked and their input is gone |
| 2 | `.catch(e => console.log(e))` | Failures are silent |
| 3 | Nothing is stored on the device | Killing or backgrounding the app loses in-flight work |
| 4 | No timeout | A hung request spins forever |
| 5 | Photos are referenced by image-picker **cache** URIs | The OS can purge them before a later retry |
| 6 | No idempotency | When a dealer re-enters and resends after a "failure" that the server actually saved, it creates a duplicate appraisal |

Item 6 is why "just add retries" isn't enough. `badConnection.integration.test.ts` shows it: with server
idempotency disabled, 15 submissions produced 16–18 server records.

## 2. What I prioritised and why

1. **Never lose a submission** (the reported bug). Durable local outbox, written *before* the UI says "saved".
2. **Never duplicate one.** Retries are only safe with an idempotency key, so this was done first, together with
   the outbox.
3. **Prove it on a bad connection**, not just in unit tests. The integration test runs the real outbox and HTTP
   transport against the real mock server on the `bad` profile, with 3 fixed seeds.
4. **Tell the dealer the truth.** An outbox tab shows waiting / sending / sent / needs attention, an offline
   banner, and retry/discard.
5. **Prepare for the second category without guessing at it.** I made fields config-driven, but did not invent
   the second category's fields.

## 3. Design

```
IntakeScreen ──validate(CategoryDef)──▶ outbox.enqueue()  ──resolves only after──▶ AsyncStorage + photos copied to documentDirectory
                                             │
                     single-flight drain ◀───┘  triggers: enqueue, timer (backoff), NetInfo reconnect, AppState → active, app launch
                             │
                      HttpTransport  ── POST /submissions, Idempotency-Key: <item.id>, AbortController timeout
                             │
          2xx → sent (delete local photos) │ 5xx/408/429/network/timeout → pending + backoff │ other 4xx → failed (dealer decides)
```

- **The outbox is plain TypeScript with injected storage, transport and photo store.** It's fully testable
  without a device, and none of the logic depends on Expo. `src/outbox/index.ts` is the only Expo-specific wiring.
- **`item.id` is a client UUID and is also the Idempotency-Key.** The same key goes on every attempt, including
  after an app restart.
- **Items stuck in `sending` are reset to `pending` on load.** The app died without an answer; the idempotency
  key makes resending safe.
- **Only one request is in flight at a time.** On weak wifi, parallel photo uploads just compete for bandwidth
  and all time out together.
- **After a retryable failure the whole queue pauses** until that item's backoff expires. Otherwise every
  queued item would wait out its own 60 s timeout on a dead link.
- **Backoff uses equal jitter** (2 s base, 5 min cap). It honours `Retry-After` when that's longer. The fixed
  half prevents hot loops; the random half stops a lot full of phones retrying in lockstep.
- **Retryable errors retry forever; only a 4xx stops.** Giving up silently would recreate the bug. A permanent
  rejection stays visible until the dealer acts.
- **If the local save fails, enqueue rolls back and rejects**, so the form keeps the dealer's entries.
- **Storage writes are serialised**, so an older snapshot can never overwrite a newer one.
- **A corrupt stored queue is backed up under a new key, not discarded.**

## 4. Assumptions

- The real backend can support an `Idempotency-Key` header (or an equivalent client-generated id). I added it
  to the mock. **This is the assumption I'd most want confirmed.** Without it, no client-side fix can rule out
  duplicates.
- Any 4xx other than 408/429 means "this payload will never be accepted", and the dealer should see it.
  5xx, timeouts and network errors are transient.
- Submissions are independent, so ordering is best-effort (oldest first) and not a hard guarantee.
- The dealer will open the app again at some point. Expo Go can't do reliable background uploads (see §5), so
  sending resumes on launch, on foreground and on reconnect.
- At least 1 photo per excavator, max 20. Image quality is 0.6 to keep uploads small on bad links. The actual
  numbers are product decisions.
- Keeping the last 20 sent items as on-device history is enough.
- The dealer's phone and the mock server are on the same LAN as the Expo dev server (see README for overrides).

## 5. Considered and rejected

| Option | Why not (for now) |
|--------|-------------------|
| Background upload (`expo-background-task`, `File.createUploadTask` background sessions) | The brief requires Expo Go, and background execution there is limited and unreliable. Foreground + reconnect + launch triggers are honest about what works. **First thing I'd add in a dev build.** |
| Resumable or per-photo chunked uploads (tus, S3 multipart) | The right fix for large photo sets on slow links, but it needs backend support. Out of scope for 3 h. |
| SQLite (`expo-sqlite`) instead of AsyncStorage | Works in Expo Go and would scale better. But the queue is small, photos live on disk rather than in the KV store, and the `KeyValueStore` interface makes swapping cheap later. |
| React Query / redux-offline persistence | Hides the exact semantics that matter here (when is it durable? what's retryable? which key?). A ~250-line explicit outbox is easier to review and test. |
| Parallel sends | See §3: worse on a bad link. |
| Give up after N attempts | Recreates silent data loss. |
| Expo Router (suggested in the scaffold's AGENTS.md) | Two screens don't justify the migration and the risk in a timeboxed fix. Easy to adopt later. |
| Guessing the second category's fields | It would be wrong. Instead, a test category in the tests proves the form, validation and payload are generic. |

## 6. What I'd do next

1. Confirm idempotency semantics with the backend: key TTL, and behaviour when the same key arrives with a
   different body.
2. Dev build with background upload sessions, so items send while the app is closed.
3. Per-photo uploads with progress, plus a final "commit" call. A dropped connection then costs one photo, not
   the whole set.
4. A progress-based timeout instead of a fixed 60 s one. A legitimately slow 20-photo upload can exceed it,
   and today that restarts from zero.
5. Before sending, check that local photo files still exist, so an item with missing photos fails with a clear
   message instead of retrying forever.
6. Telemetry: attempts per submission, time-to-sent, and permanent-failure reasons.
7. Removing and reordering photos in the form, and saving a draft as the dealer types.
8. E2E on a real device with network link conditioner / Android emulator network throttling (Maestro).

## 7. Things I think are wrong but didn't touch

- The mock server replays by key without checking that the body matches. A real implementation should reject
  a key reused with a different payload.
- The mock server's state is in memory, so restarting it "forgets" keys. That's fine for a mock, but it's worth
  knowing when testing by hand.
- `API_URL` is derived from the Expo dev host. That's fine for this exercise, but production needs real
  environment config.
- No auth or dealer identity on submissions.
- The UI uses `Alert` for feedback. A non-blocking toast would be kinder on a busy lot.
- `npm audit` reports moderate advisories in transitive dev dependencies of the scaffold. Not investigated.

## 8. How I used and checked the AI

- **I read the installed packages' type definitions** for `expo-file-system` (SDK 58's `File`/`Directory`/`Paths`
  API), `expo-image-picker` and RNTL v14 (whose `render` and `fireEvent` are now async), instead of trusting
  remembered APIs. These all changed recently.
- **Mutation-checked the important tests.** I broke the code on purpose and confirmed the test failed:
  - removed the queue pause → caught;
  - removed the "reset `sending` on load" step → caught;
  - removed the enqueue rollback → **not caught at first**: the test only checked the snapshot. I made it
    assert that the item never gets sent or resurfaces, then confirmed it was caught;
  - disabled server idempotency → integration test fails with duplicates;
  - cleared the form before the save resolved (the baseline bug) → form test fails.
- **The integration test asserts that retries actually happened**, so a too-gentle chaos setup can't pass
  vacuously.
- **Caught an environment trap:** jest-expo stubs global `fetch`, so the first integration run sent nothing at
  all. It now runs in a separate plain-Node Jest project.
- Verified `tsc --noEmit` and that `expo export` bundles for iOS and Android.

Transcripts are in `transcripts/`.
