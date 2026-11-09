import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** Paths that belong to the server. Any other GET path that is not a file gets the web app's index page. */
const SERVER_PATH = /^\/(api|cards|ws|health)(\/|$)/;

/**
 * Serves the built web app from one folder. Existing files are served as they are. A GET for any other
 * path without a file extension returns index.html, so the client router can handle the page. Missing API
 * paths, missing assets and other methods still return 404. Returns false when the build is missing.
 */
export async function registerWebApp(app: FastifyInstance, root: string): Promise<boolean> {
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) return false;
  const index = readFileSync(indexFile, 'utf8');
  await app.register(fastifyStatic, { root, prefix: '/' });
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const last = path.split('/').pop() ?? '';
    if (request.method === 'GET' && !SERVER_PATH.test(path) && extname(last) === '') {
      return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(index);
    }
    return reply.code(404).send({ message: 'Route ' + request.method + ':' + path + ' not found', error: 'Not Found', statusCode: 404 });
  });
  return true;
}
