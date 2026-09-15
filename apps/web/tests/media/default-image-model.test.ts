import { describe, expect, it } from 'vitest';

import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '../../src/media/models';

describe('default image model', () => {
  it('uses Nano Banana', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gemini-3.1-flash-image-preview');
    expect(IMAGE_MODELS.find((model) => model.default)?.provider).toBe('nanobanana');
  });
});
