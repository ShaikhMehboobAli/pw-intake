// Mock appraisal API with a "chaos" layer that simulates a poor dealership connection.
// createApp() is exported separately from the listener so tests can drive it in-process.
const express = require('express');
const multer = require('multer');

const PROFILES = {
  // Healthy connection.
  good: { latencyMs: [50, 200], failRate: 0, hangRate: 0, resetRate: 0, dropAfterCommitRate: 0 },
  // Bad dealership wifi: slow, flaky, sometimes the response never arrives.
  bad: { latencyMs: [800, 4000], failRate: 0.25, hangRate: 0.1, resetRate: 0.1, dropAfterCommitRate: 0.15 },
  // Nothing gets through.
  offline: { latencyMs: [0, 0], failRate: 0, hangRate: 0, resetRate: 1, dropAfterCommitRate: 0 },
};

function createApp({ profile = 'good', random = Math.random, log = console.log } = {}) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  const state = {
    chaos: { ...PROFILES[profile] },
    profile,
    submissions: [],
    byKey: new Map(),
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = ([min, max]) => min + Math.floor(random() * (max - min + 1));
  const roll = (rate) => rate > 0 && random() < rate;

  app.use(express.json());

  // --- control endpoints (not subject to chaos) ---
  app.get('/__chaos', (_req, res) => res.json({ profile: state.profile, ...state.chaos }));
  app.post('/__chaos', (req, res) => {
    const { profile: p, ...overrides } = req.body || {};
    if (p && !PROFILES[p]) return res.status(400).json({ error: `unknown profile ${p}` });
    if (p) {
      state.profile = p;
      state.chaos = { ...PROFILES[p] };
    }
    Object.assign(state.chaos, overrides);
    log(`[chaos] now ${JSON.stringify({ profile: state.profile, ...state.chaos })}`);
    res.json({ profile: state.profile, ...state.chaos });
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // --- chaos middleware for the real API ---
  const chaos = async (req, res, next) => {
    const c = state.chaos;
    if (roll(c.resetRate)) {
      log(`[chaos] reset ${req.method} ${req.path}`);
      return req.socket.destroy();
    }
    await sleep(pick(c.latencyMs));
    if (roll(c.hangRate)) {
      log(`[chaos] hang ${req.method} ${req.path}`);
      return; // never respond; client must time out
    }
    if (roll(c.failRate)) {
      log(`[chaos] 503 ${req.method} ${req.path}`);
      return res.status(503).json({ error: 'service unavailable' });
    }
    next();
  };

  app.get('/submissions', chaos, (_req, res) => {
    res.json(state.submissions.map(({ photos, ...s }) => ({ ...s, photoCount: photos.length })));
  });

  app.post('/submissions', chaos, upload.array('photos', 20), (req, res) => {
    // Idempotency: a retried request with the same key returns the original result instead of
    // creating a duplicate appraisal. Assumes the real backend can support this (see DECISIONS.md).
    const key = req.get('Idempotency-Key');
    if (key && state.byKey.has(key)) {
      const existing = state.byKey.get(key);
      log(`[api] replay ${existing.id} for key ${key}`);
      res.set('Idempotent-Replayed', 'true');
      return res.status(201).json({ id: existing.id, receivedAt: existing.receivedAt });
    }

    const { category, fields } = req.body;
    if (!category) return res.status(400).json({ error: 'category is required' });

    let parsedFields;
    try {
      parsedFields = fields ? JSON.parse(fields) : {};
    } catch {
      return res.status(400).json({ error: 'fields must be JSON' });
    }

    const submission = {
      id: `sub_${state.submissions.length + 1}`,
      category,
      fields: parsedFields,
      photos: (req.files || []).map((f) => ({ name: f.originalname, size: f.size, type: f.mimetype })),
      receivedAt: new Date().toISOString(),
    };
    state.submissions.push(submission);
    if (key) state.byKey.set(key, submission);
    log(`[api] stored ${submission.id} (${submission.photos.length} photos)`);

    if (roll(state.chaos.dropAfterCommitRate)) {
      // The worst case: we saved it, but the client never hears back.
      log(`[chaos] drop-after-commit ${submission.id}`);
      return req.socket.destroy();
    }
    res.status(201).json({ id: submission.id, receivedAt: submission.receivedAt });
  });

  app.locals.state = state;
  return app;
}

module.exports = { createApp, PROFILES };
