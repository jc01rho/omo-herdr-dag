import { createConnection } from 'node:net';
import { once } from 'node:events';

const stream = createConnection(process.env.HERDR_TEST_FRAME_PIPE);
await once(stream, 'connect', { signal: AbortSignal.timeout(5000) });
const write = process.stdout.write;
process.stdout.write = function (...args) {
  const result = write.apply(this, args);
  if (typeof args[0] === 'string' && args[0].startsWith('\x1b[H')) {
    stream.write(`${JSON.stringify({ frame: args[0] })}\n`);
  }
  return result;
};
