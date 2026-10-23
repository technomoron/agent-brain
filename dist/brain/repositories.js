"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repositoryPattern = exports.repositoryId = void 0;
exports.matchesRepository = matchesRepository;
exports.coversPattern = coversPattern;
exports.githubRepository = githubRepository;
const zod_1 = require("zod");
exports.repositoryId = zod_1.z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/)
    .refine((value) => !['.', '..'].includes(value.split('/')[1])).transform((value) => value.toLowerCase());
exports.repositoryPattern = zod_1.z.string().refine((value) => value === '*' ||
    (value.endsWith('/*') ? exports.repositoryId.safeParse(value.slice(0, -1) + 'repository').success : exports.repositoryId.safeParse(value).success), 'Use owner/repo, owner/* or *')
    .transform((value) => value.toLowerCase());
// Match a repository against an exact, owner-wide or wildcard grant.
function matchesRepository(pattern, repository) {
    return pattern === '*' || pattern === repository || (pattern.endsWith('/*') && repository.startsWith(pattern.slice(0, -1)));
}
// Check whether one repository grant fully covers another.
function coversPattern(allowed, requested) {
    if (requested === '*')
        return allowed === '*';
    if (requested.endsWith('/*'))
        return allowed === '*' || allowed === requested;
    return matchesRepository(allowed, requested);
}
// Extract and normalize a repository ID from a GitHub remote URL.
function githubRepository(remote) {
    const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^?#]+?)(?:\.git)?\/?$/.exec(remote);
    if (!match)
        throw new Error('Expected a GitHub repository remote');
    return exports.repositoryId.parse(match[1]);
}
