import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { readMarkdown } from './store';

const directory = path.resolve(__dirname, '..', '..', 'skills');
const metadata = z.object({ name: z.string(), description: z.string().min(1) });

export function readBuiltInSkill(name: string): { description: string; content: string } {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`Invalid built-in skill name: ${name}`);
	const document = readMarkdown(fs.readFileSync(path.join(directory, name, 'SKILL.md'), 'utf8'));
	const parsed = metadata.parse(document.metadata);
	if (parsed.name !== name) throw new Error(`Built-in skill name must match directory: ${name}`);
	return { description: parsed.description, content: document.content };
}

export function readBuiltInSkills(): Record<string, { description: string; content: string }> {
	return Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => [entry.name, readBuiltInSkill(entry.name)]));
}
