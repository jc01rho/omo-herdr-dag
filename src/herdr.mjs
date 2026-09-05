import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function createHerdr(env = process.env) {
  return async (...args) => {
    const { stdout } = await execute('herdr', ['pane', ...args], { env, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    // pane run acknowledges success with an empty body in Herdr protocol 20.
    if (!stdout.trim()) return {};
    const reply = JSON.parse(stdout);
    if (reply.error) throw new Error(reply.error.message ?? JSON.stringify(reply.error));
    return reply.result;
  };
}
