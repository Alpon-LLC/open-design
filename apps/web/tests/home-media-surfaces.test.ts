import { describe, expect, it } from 'vitest';

import {
  buildHomeMediaComposer,
  metadataForHomeMediaComposer,
  normalizeHomeMediaInputs,
  seedHomeMediaInputs,
} from '../src/components/home-hero/media-surfaces';

describe('Home image composer metadata', () => {
  it('persists the default Nano Banana model into project metadata', () => {
    const composer = buildHomeMediaComposer('image', []);

    expect(metadataForHomeMediaComposer('image', composer.inputs, [])).toEqual({
      kind: 'image',
      imageModel: 'gemini-3.1-flash-image-preview',
    });
  });

  it('preserves an explicitly selected OpenAI BYOK model', () => {
    const composer = buildHomeMediaComposer('image', [], { model: 'gpt-image-2' });

    expect(metadataForHomeMediaComposer('image', composer.inputs, [])).toEqual({
      kind: 'image',
      imageModel: 'gpt-image-2',
    });
  });

  it('maps a legacy curated seed to the default but preserves a later model override', () => {
    const templates = [{
      id: 'illustrated-city-food-map',
      surface: 'image' as const,
      title: 'Illustrated City Food Map',
      summary: 'Watercolor tourist map',
      category: 'Illustration',
      model: 'gpt-image-2',
      source: { repo: 'open-design', license: 'CC-BY-4.0' },
    }];
    const seeded = seedHomeMediaInputs('image', {
      template: 'illustrated-city-food-map',
      model: 'gpt-image-2',
    }, templates);
    const composer = buildHomeMediaComposer('image', templates, seeded);

    expect(metadataForHomeMediaComposer('image', composer.inputs, templates)).toMatchObject({
      kind: 'image',
      imageModel: 'gemini-3.1-flash-image-preview',
    });

    const overridden = normalizeHomeMediaInputs('image', {
      ...composer.inputs,
      model: 'gpt-image-2',
    }, templates);
    expect(metadataForHomeMediaComposer('image', overridden, templates)).toMatchObject({
      kind: 'image',
      imageModel: 'gpt-image-2',
    });
  });
});
