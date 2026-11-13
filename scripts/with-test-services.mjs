#!/usr/bin/env node
/**
 * Runs a command with TEST_DATABASE_URL and TEST_REDIS_URL pointing at a disposable Postgres and
 * Redis.
 * - A variable already set (CI service containers) is used as is.
 * - Otherwise its server is started in Docker on a random localhost port and removed after.
 * Portable: Node and the docker CLI only. Usage: node scripts/with-test-services.mjs <cmd> [args…]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  process.stderr.write('usage: with-test-services.mjs <command> [args…]\n');
  process.exit(2);
}

const docker = (...dockerArgs) => execFileSync('docker', dockerArgs, { encoding: 'utf8' }).trim();

const services = [
  {
    variable: 'TEST_DATABASE_URL',
    image: 'postgres:17',
    env: ['POSTGRES_PASSWORD=test', 'POSTGRES_DB=todo_test'],
    containerPort: 5432,
    probe: ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
    url: (port) => `postgres://postgres:test@127.0.0.1:${port}/todo_test`,
  },
  {
    variable: 'TEST_REDIS_URL',
    image: 'redis:7',
    env: [],
    containerPort: 6379,
    probe: ['redis-cli', 'ping'],
    url: (port) => `redis://127.0.0.1:${port}`,
  },
].filter(({ variable }) => process.env[variable] === undefined);

const started = [];
const stopAll = () => {
  for (const name of started) {
    try {
      docker('stop', name);
    } catch {
      // Intentionally ignored.
    }
  }
};

const ready = async (name, probe, attempt = 0) => {
  if (attempt > 60) throw new Error(`${name} did not become ready in 30 s`);
  if (spawnSync('docker', ['exec', name, ...probe]).status === 0) return;
  await sleep(500);
  await ready(name, probe, attempt + 1);
};

try {
  const env = {};
  for (const { variable, image, env: containerEnv, containerPort, probe, url } of services) {
    const name = `todo-test-${image.split(':')[0]}-${String(process.pid)}`;
    docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      ...containerEnv.flatMap((value) => ['--env', value]),
      '--publish',
      `127.0.0.1::${String(containerPort)}`,
      image,
    );
    started.push(name);
    await ready(name, probe);
    const port = docker('port', name, `${String(containerPort)}/tcp`)
      .split(':')
      .at(-1);
    env[variable] = url(port);
  }
  process.exitCode =
    spawnSync(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    }).status ?? 1;
} finally {
  stopAll();
}
