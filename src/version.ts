import * as fs from 'fs';
import * as path from 'path';

let cached: string | null = null;

// Read and cache the installed package version, falling back to 0.0.0.
export function packageVersion(): string {
	if (cached === null) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version?: unknown };
			cached = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
		} catch {
			cached = '0.0.0';
		}
	}
	return cached;
}
