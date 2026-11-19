const request = require('supertest');
const { createApp } = require('../app');

const quiet = () => {};

describe('mock API', () => {
  it('stores a submission with photos', async () => {
    const app = createApp({ log: quiet });
    const res = await request(app)
      .post('/submissions')
      .field('category', 'excavator')
      .field('fields', JSON.stringify({ make: 'CAT' }))
      .attach('photos', Buffer.from('fake-jpeg'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    const list = await request(app).get('/submissions');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ category: 'excavator', fields: { make: 'CAT' }, photoCount: 1 });
  });

  it('rejects a missing category with 400', async () => {
    const res = await request(createApp({ log: quiet })).post('/submissions').field('fields', '{}');
    expect(res.status).toBe(400);
  });

  it('replays the original result for a repeated Idempotency-Key instead of duplicating', async () => {
    const app = createApp({ log: quiet });
    const send = () =>
      request(app).post('/submissions').set('Idempotency-Key', 'k-1').field('category', 'excavator').field('fields', '{}');
    const first = await send();
    const second = await send();
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((await request(app).get('/submissions')).body).toHaveLength(1);
  });

  it('can switch chaos profile at runtime', async () => {
    const app = createApp({ log: quiet });
    await request(app).post('/__chaos').send({ profile: 'bad', failRate: 1, hangRate: 0, resetRate: 0, latencyMs: [0, 0] });
    const res = await request(app).post('/submissions').field('category', 'excavator');
    expect(res.status).toBe(503);
  });
});
