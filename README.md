# Purple Wave Intake (Expo)

Dealers photograph a machine, describe its condition and submit it for appraisal.

## Setup

Requires Node 20+ and Expo Go (SDK 58) on a phone, iOS simulator or Android emulator.

```bash
npm install
npm run server        # mock API on :4000, healthy connection
npm run server:bad    # mock API simulating bad dealership wifi
npm start             # Expo dev server; scan the QR code with Expo Go
```

The app finds the mock server on the same host that serves the bundle. Override it with
`EXPO_PUBLIC_API_URL=http://<ip>:4000 npm start` (Android emulator: `http://10.0.2.2:4000`).

Change the network conditions while running:

```bash
curl -XPOST localhost:4000/__chaos -H 'content-type: application/json' -d '{"profile":"bad"}'   # good | bad | offline
curl localhost:4000/submissions   # what the server actually received
```

## Tests

```bash
npm test          # unit (outbox, transport, validation, form), integration (bad-connection run), server
npm run typecheck
```

`src/outbox/__tests__/badConnection.integration.test.ts` runs the real outbox against the mock server on the
`bad` profile and asserts every submission arrives exactly once.

## Trying the fix by hand

1. `npm run server:bad` and `npm start`, then open the app in Expo Go.
2. Submit a few machines. The Outbox tab shows retries as the chaos bites.
3. Switch to `offline`, submit more, and kill the app. Reopen it and switch back to `good`: everything sends.
4. `curl localhost:4000/submissions` should list each machine exactly once.

## Layout

```
src/outbox/       durable submission queue (engine is plain TS; index.ts wires Expo/RN)
src/categories/   equipment category definitions + validation
src/screens/      Intake form and Outbox list
server/           mock API with chaos profiles
DECISIONS.md      assumptions, trade-offs, next steps
```
