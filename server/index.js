// Usage: node server/index.js            (good connection)
//        CHAOS=bad node server/index.js  (bad dealership wifi)
// Switch at runtime: curl -XPOST localhost:4000/__chaos -H 'content-type: application/json' -d '{"profile":"bad"}'
const { createApp } = require('./app');

const port = Number(process.env.PORT || 4000);
const app = createApp({ profile: process.env.CHAOS || 'good' });

app.listen(port, '0.0.0.0', () => {
  console.log(`Mock appraisal API on http://0.0.0.0:${port} (chaos profile: ${app.locals.state.profile})`);
});
