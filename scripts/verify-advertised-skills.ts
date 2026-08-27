#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyVendoredSkills } from './advertised-skills-lib.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const summary = await verifyVendoredSkills({ repoRoot });
process.stdout.write(`${JSON.stringify(summary)}\n`);
