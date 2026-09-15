import { describe, expect, it } from 'vitest';

import { DEFAULT_IMAGE_MODEL, resolveDefaultImageModel } from '../../src/media/models';

describe('resolveDefaultImageModel', () => {
  it('uses the selected configured image provider', () => {
    expect(resolveDefaultImageModel({
      nanobanana: { defaultImageProvider: true },
    })).toBe('gemini-3.1-flash-image-preview');
  });

  it('keeps the product default without an explicit provider selection', () => {
    expect(resolveDefaultImageModel({ nanobanana: {} })).toBe(DEFAULT_IMAGE_MODEL);
  });
});
