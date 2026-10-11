import { readFileSync } from 'node:fs';

/** Reads the version from package.json (one level above both src/ and dist/). */
export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
