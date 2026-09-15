import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/components/HomeView.tsx', import.meta.url), 'utf8');

describe('Home image default route audit', () => {
  it('passes the selected image default to every home media composer entry path', () => {
    const calls = [...source.matchAll(/buildHomeMediaComposer\([\s\S]*?\n\s*\);/g)].map((match) => match[0]);

    expect(calls).toHaveLength(5);
    for (const call of calls) expect(call).toContain('defaultImageModel');
  });
});
