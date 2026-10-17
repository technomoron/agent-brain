import { z } from 'zod';

export const repositoryId = z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/)
	.refine((value) => !['.', '..'].includes(value.split('/')[1]!)).transform((value) => value.toLowerCase());
export const repositoryPattern = z.string().refine((value) => value === '*' ||
	(value.endsWith('/*') ? repositoryId.safeParse(value.slice(0, -1) + 'repository').success : repositoryId.safeParse(value).success), 'Use owner/repo, owner/* or *')
	.transform((value) => value.toLowerCase());

export function matchesRepository(pattern: string, repository: string): boolean {
	return pattern === '*' || pattern === repository || (pattern.endsWith('/*') && repository.startsWith(pattern.slice(0, -1)));
}

export function coversPattern(allowed: string, requested: string): boolean {
	if (requested === '*') return allowed === '*';
	if (requested.endsWith('/*')) return allowed === '*' || allowed === requested;
	return matchesRepository(allowed, requested);
}

export function githubRepository(remote: string): string {
	const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^?#]+?)(?:\.git)?\/?$/.exec(remote);
	if (!match) throw new Error('Expected a GitHub repository remote');
	return repositoryId.parse(match[1]);
}
