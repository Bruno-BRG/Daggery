import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { cardsIndex, classes, cardUrl } from '@daggery/content';
import { registerCardArt } from './card-static';

// Exercise the real production registration, not a parallel static-server fixture.
test('all bundled cards and portraits serve WebP art and thumbnails with revalidation', async () => {
  const app = Fastify({ logger: false });
  await registerCardArt(app);
  try {
    const files = [...cardsIndex.map(card => card.file), ...classes.map(cls => `class/${cls.id}.webp`)];
    for (const file of new Set(files)) {
      for (const thumb of [false, true]) {
        const url = cardUrl(file, thumb);
        const response = await app.inject({ method: 'GET', url });
        assert.equal(response.statusCode, 200, url);
        assert.match(String(response.headers['content-type']), /image\/webp/, url);
        assert.equal(response.rawPayload.toString('ascii', 0, 4), 'RIFF', url);
        assert.equal(response.rawPayload.toString('ascii', 8, 12), 'WEBP', url);
        assert.match(String(response.headers['cache-control']), /max-age=0/, url);
        assert.match(String(response.headers['cache-control']), /must-revalidate/, url);
        assert.ok(response.headers.etag, url);
      }
    }
    const url = cardUrl('subclass/executioners-guild-foundation.webp');
    const first = await app.inject({ method: 'GET', url });
    const cached = await app.inject({ method: 'GET', url, headers: { 'if-none-match': String(first.headers.etag) } });
    assert.equal(cached.statusCode, 304);
    const missing = await app.inject({ method: 'GET', url: '/cards/subclass/missing.webp' });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});
