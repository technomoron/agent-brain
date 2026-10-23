import * as path from 'node:path';
import { readBuiltInSkills } from './built-in-skills';
import { z } from 'zod';
import { BrainStore, readMarkdown, type Scope } from './store';
import { createNunjucksEnv, createSkillNunjucksEnv, buildRenderContext } from '@technomoron/agent-run/dist/templates';
import { loadManifest, normalizeManifest } from '@technomoron/agent-run/dist/manifest';

const metadata = z.object({
	name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
	description: z.string().trim().min(1),
	tags: z.array(z.string()).default([]),
	extends: z.string().regex(/^(?:global|pool):[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional()
});

type Skill = z.infer<typeof metadata> & { scope: Scope; source: string; content: string };

// Resolve bundled workflows and scope-specific skill overrides.
export function getSkills(store: BrainStore): Skill[] {
	const profile = store.profile ?? 'default';
	const directory = store.scopeDirectory(store.profile ? 'project' : 'default');
	const env = createNunjucksEnv(store.configRoot);
	const context = buildRenderContext(store.projectRoot, directory, store.configRoot,
		normalizeManifest(loadManifest(store.configRoot, directory, profile), profile), env);
	const skillEnv = createSkillNunjucksEnv(store.configRoot, directory, undefined, store.pool);
	const skills = new Map<string, Skill>();
	const parentSkills = new Map<string, Skill>();
	for (const [name, packaged] of Object.entries(readBuiltInSkills())) {
		const skill: Skill = { name, ...packaged, tags: [], scope: 'global', source: `builtin:${name}` };
		skills.set(name, skill);
		parentSkills.set(`global:${name}`, skill);
	}
	for (const { scope, directory } of store.scopes) {
		for (const file of store.files(path.join(directory, 'skills')).filter((file) => path.basename(file) === 'SKILL.md')) {
			const text = skillEnv.render(path.relative(store.configRoot, file), context);
			const document = readMarkdown(text);
			const parsed = metadata.parse(document.metadata);
			if (['brain-review', 'code-review-organizer', 'review-items'].includes(parsed.name)) continue;
			if (path.basename(path.dirname(file)) !== parsed.name) throw new Error(`Skill name must match directory: ${file}`);
			let content = document.content;
			if (parsed.extends) {
				const parent = parentSkills.get(parsed.extends);
				if (!parent || parent.scope === scope) throw new Error(`Missing ancestor ${parsed.extends} for skill ${parsed.name}`);
				content = `${parent.content}\n\n${content}`;
			}
			const skill = { ...parsed, scope, content, source: path.relative(store.configRoot, file) };
			skills.set(parsed.name, skill);
			parentSkills.set(`${scope}:${parsed.name}`, skill);
		}
	}
	return [...skills.values()];
}

export function listSkills(store: BrainStore): Omit<Skill, 'content'>[] {
	return getSkills(store).map(({ content: _content, ...skill }) => skill);
}

export function getSkill(store: BrainStore, name: string): Skill {
	const skill = getSkills(store).find((item) => item.name === name);
	if (!skill) throw new Error(`Skill not found: ${name}`);
	return skill;
}
