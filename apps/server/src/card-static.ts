import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { bundledPaths } from './storage';

/** All sourcebooks share one art tree and URL scheme, independent of the persistent volume. */
export async function registerCardArt(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: bundledPaths.cards,
    prefix: '/cards/',
    decorateReply: false,
    // Filenames are stable across releases, so caches must revalidate before reusing art.
    maxAge: 0,
    setHeaders(reply) {
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  });
}
