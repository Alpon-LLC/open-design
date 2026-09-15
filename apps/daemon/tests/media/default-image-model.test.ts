import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveProviderConfig } from '../../src/media/config';
import { IMAGE_MODELS } from '../../src/media/models';

const previousGoogleKey = process.env.GOOGLE_API_KEY;

afterEach(() => {
  if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = previousGoogleKey;
  vi.restoreAllMocks();
});

describe('default image model routing', () => {
  it('routes the default through Nano Banana credentials', async () => {
    const defaultModel = IMAGE_MODELS.find((model) => model.default);
    expect(defaultModel).toMatchObject({
      id: 'gemini-3.1-flash-image-preview',
      provider: 'nanobanana',
    });

    process.env.GOOGLE_API_KEY = 'test-google-key';
    await expect(resolveProviderConfig('/nonexistent-project-root', defaultModel!.provider)).resolves.toMatchObject({
      apiKey: 'test-google-key',
    });
  });
});
