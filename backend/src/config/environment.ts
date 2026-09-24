import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveBackendEnvPath(entrypointUrl: string): string {
  return resolve(dirname(fileURLToPath(entrypointUrl)), '../.env');
}

export function loadBackendEnvironment(entrypointUrl: string): void {
  dotenv.config({ path: resolveBackendEnvPath(entrypointUrl), override: false });
}
