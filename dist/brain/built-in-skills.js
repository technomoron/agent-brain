"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBuiltInSkill = readBuiltInSkill;
exports.readBuiltInSkills = readBuiltInSkills;
const fs = require("node:fs");
const path = require("node:path");
const zod_1 = require("zod");
const store_1 = require("./store");
const directory = path.resolve(__dirname, '..', '..', 'skills');
const metadata = zod_1.z.object({ name: zod_1.z.string(), description: zod_1.z.string().min(1) });
function readBuiltInSkill(name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
        throw new Error(`Invalid built-in skill name: ${name}`);
    const document = (0, store_1.readMarkdown)(fs.readFileSync(path.join(directory, name, 'SKILL.md'), 'utf8'));
    const parsed = metadata.parse(document.metadata);
    if (parsed.name !== name)
        throw new Error(`Built-in skill name must match directory: ${name}`);
    return { description: parsed.description, content: document.content };
}
function readBuiltInSkills() {
    return Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => [entry.name, readBuiltInSkill(entry.name)]));
}
