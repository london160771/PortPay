import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBackendEnvironment, resolveBackendEnvPath } from './environment.js';

const fileValueKey = 'PORTPAY_ENV_PATH_TEST_FILE_VALUE';
const shellValueKey = 'PORTPAY_ENV_PATH_TEST_PRECEDENCE';
const temporaryDirectories: string[] = [];
const originalEnvironment = new Map<string, string | undefined>();

afterEach(async () => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('backend environment loading', () => {
  it('resolves backend/.env from source and build entrypoints, independent of cwd, and preserves shell values', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'portpay-env-path-'));
    temporaryDirectories.push(temporaryRoot);
    const backendRoot = join(temporaryRoot, 'backend');
    await mkdir(join(backendRoot, 'src'), { recursive: true });
    await mkdir(join(backendRoot, 'dist'), { recursive: true });
    await writeFile(
      join(backendRoot, '.env'),
      `${fileValueKey}=loaded-from-backend-env\n${shellValueKey}=file-value\n`,
      'utf8',
    );

    const sourceEntrypoint = pathToFileURL(join(backendRoot, 'src', 'index.ts')).href;
    const buildEntrypoint = pathToFileURL(join(backendRoot, 'dist', 'index.js')).href;
    expect(resolveBackendEnvPath(sourceEntrypoint)).toBe(resolve(backendRoot, '.env'));
    expect(resolveBackendEnvPath(buildEntrypoint)).toBe(resolve(backendRoot, '.env'));

    originalEnvironment.set(fileValueKey, process.env[fileValueKey]);
    originalEnvironment.set(shellValueKey, process.env[shellValueKey]);
    delete process.env[fileValueKey];
    process.env[shellValueKey] = 'shell-value';

    const previousCwd = process.cwd();
    try {
      process.chdir(temporaryRoot);
      loadBackendEnvironment(sourceEntrypoint);
    } finally {
      process.chdir(previousCwd);
    }

    expect(process.env[fileValueKey]).toBe('loaded-from-backend-env');
    expect(process.env[shellValueKey]).toBe('shell-value');
  });
});
