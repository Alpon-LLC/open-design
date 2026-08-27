export interface SourceOverride {
  repo?: string;
  path?: string;
  bodyFile?: string;
  commit?: string;
  official?: boolean;
  evidence: string;
  skipPaths?: string[];
  allowFiles?: string[];
  allowUnsafe?: string[];
  excluded?: string;
}

// Only ambiguous, moved, bundled, or historical catalogue entries belong here.
// Exact directory names under a catalogue's advertised repository are discovered
// mechanically by the sync command.
export const SOURCE_OVERRIDES: Record<string, SourceOverride> = {
  'ai-music-album': {
    path: '.', bodyFile: 'README.md',
    allowFiles: ['README.md', 'LICENSE', 'config', 'genres', 'reference', 'skills', 'templates'],
    evidence: 'The advertised repository is a multi-skill album-production suite; its root README is the canonical router for the complete pack.',
  },
  'apple-hig': {
    path: '.', bodyFile: 'README.md', official: false,
    allowFiles: ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'skills'],
    evidence: 'The advertised repository intentionally publishes 14 complementary HIG skills; the root README is their canonical router.',
  },
  'color-expert': { path: '.', allowFiles: ['SKILL.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'references'], evidence: 'The advertised dedicated repository has a root SKILL.md with the exact color-expert purpose.' },
  'd3-visualization': { path: '.', allowFiles: ['SKILL.md', 'LICENSE', 'examples', 'references'], evidence: 'The advertised dedicated repository has one root SKILL.md and its complete D3 examples/references.' },
  'design-md': {
    repo: 'https://github.com/google-labs-code/stitch-skills', path: 'plugins/stitch-utilities/skills/design-md', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); Google Labs moved the exact design-md skill to its official stitch-skills repository.',
  },
  doc: {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/doc', commit: '45d05d75363abf13f99d09e899d61e07b8010685', official: true,
    evidence: 'OpenAI is the official publisher; this is the latest immutable parent commit containing the exact doc directory before its removal.',
  },
  'emilkowalski-motion': {
    repo: 'https://github.com/emilkowalski/skill', path: 'skills/improve-animations', official: true,
    evidence: 'The advertised author page links the official improve-animations skill, the exact follow-up audit workflow described by this catalogue entry.',
  },
  'enhance-prompt': {
    repo: 'https://github.com/google-labs-code/stitch-skills', path: 'plugins/stitch-utilities/skills/enhance-prompt', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); Google Labs moved the exact skill to its official stitch-skills repository.',
  },
  'fal-3d': { path: 'skills/fal-regenerate-3d', official: true, evidence: 'fal.ai reorganized its pack; fal-regenerate-3d is the official current 3D generation workflow.' },
  'fal-generate': { path: 'skills/genmedia', official: true, evidence: 'fal.ai documents genmedia as the official current execution surface for image/video generation.' },
  'fal-image-edit': { path: 'skills/fal-models-catalog', official: true, evidence: 'The official current model catalogue owns image-to-image and editing endpoint selection.' },
  'fal-kling-o3': { path: 'skills/fal-prompting', official: true, evidence: 'The official current prompting skill contains the maintained Kling family guidance.' },
  'fal-lip-sync': { path: 'skills/fal-recipes', official: true, evidence: 'The official current recipes skill contains the maintained lipsync workflow.' },
  'fal-realtime': { path: 'skills/genmedia', official: true, evidence: 'The official current genmedia skill owns streaming and endpoint execution.' },
  'fal-restore': { path: 'skills/fal-recipes', official: true, evidence: 'The official current recipes skill contains the maintained image-restoration workflow.' },
  'fal-train': { path: 'skills/genmedia', official: true, evidence: 'The official current genmedia execution skill is the closest maintained fal.ai operational source after the old catalogue alias was retired.' },
  'fal-tryon': { path: 'skills/fal-recipes', official: true, evidence: 'The official current recipes skill contains the maintained virtual try-on workflow.' },
  'fal-upscale': { path: 'skills/fal-models-catalog', official: true, evidence: 'The official current model catalogue owns upscaling endpoint selection.' },
  'fal-video-edit': { path: 'skills/fal-models-catalog', official: true, evidence: 'The official current model catalogue owns video-to-video/editing endpoint selection.' },
  'fal-vision': { path: 'skills/fal-models-catalog', official: true, evidence: 'The official current model catalogue owns image-to-text and vision endpoint selection.' },
  'flutter-animating-apps': {
    path: 'skills/flutter-animating-apps', commit: '430687774a92ab84e4fdf96de6415ee407dd4beb', official: true,
    evidence: 'Flutter is the official publisher; this immutable commit is the last parent containing the exact skill before the official pack removed it.',
  },
  'figma-code-connect-components': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-code-connect-components',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-create-design-system-rules': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-create-design-system-rules',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-create-new-file': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-create-new-file',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-generate-design': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-generate-design',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-generate-library': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-generate-library',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-implement-design': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-implement-design',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'figma-use': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/figma-use',
    evidence: 'The advertised Figma repository is dead (GitHub 404); OpenAI maintains the exact-name curated integration skill.',
  },
  'frontend-skill': {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/frontend-skill', commit: '30444aed500c00c85294d12074f6e3ee794f808a', official: true,
    evidence: 'OpenAI is the official publisher; this is the latest immutable parent commit containing the exact frontend-skill directory.',
  },
  'full-page-screenshot': { path: '.', evidence: 'The advertised dedicated repository has one root SKILL.md and its required capture script.' },
  'hand-drawn-diagrams': { path: '.', allowFiles: ['SKILL.md', 'LICENSE', 'assets', 'references', 'scripts', 'steps', 'workflow.md'], evidence: 'The advertised dedicated repository has one root SKILL.md and complete diagram assets/references.' },
  imagen: {
    excluded: 'Operator excluded image-generation integrations from this deployment.',
    evidence: 'Excluded by operator request; retain the existing OpenDesign catalogue entry without vendoring upstream files.',
  },
  'impeccable-design-polish': {
    path: 'plugin/skills/impeccable',
    evidence: 'The repository contains agent-specific duplicates; plugin/skills/impeccable is its canonical distributable copy.',
  },
  'nanobanana-ppt': { path: '.', evidence: 'The advertised dedicated repository has one root SKILL.md; unsafe environment examples and generated video are excluded by policy.' },
  'paywall-upgrade-cro': {
    path: 'skills/paywall-upgrade-cro', commit: 'f3990f7f99ae63b9e26eaa61114f60e0408742ff',
    evidence: 'This immutable parent is the last exact-name implementation before the publisher renamed the skill to paywalls.',
  },
  'pixelbin-media': {
    repo: 'https://github.com/anandpareek-hub/pixelbin-claude-skill', path: 'skills/pixelbin',
    evidence: 'The advertised PixelBin repository is dead (GitHub 404); this exact 85+ API media-pipeline implementation identifies PixelBin as its publisher.',
  },
  'platform-design': {
    path: '.', bodyFile: 'README.md',
    allowFiles: ['README.md', 'LICENSE', 'skills'],
    evidence: 'The advertised repository is an eight-skill cross-platform pack; its root README is the canonical router.',
  },
  remotion: {
    excluded: 'Operator does not use Remotion and excluded it from this deployment.',
    evidence: 'Excluded by operator request; retain the existing OpenDesign catalogue entry without vendoring upstream files.',
  },
  'slack-gif-creator': {
    excluded: 'Operator excluded Slack integrations from this deployment.',
    evidence: 'Excluded by operator request; retain the existing OpenDesign catalogue entry without vendoring upstream files.',
  },
  replicate: {
    path: '.', bodyFile: 'README.md', official: true,
    allowFiles: ['README.md', 'LICENSE', 'skills'],
    evidence: 'Replicate publishes seven complementary exact-purpose skills; the root README is the canonical router for the complete pack.',
  },
  'screenshots-marketing': {
    repo: 'https://github.com/github/awesome-copilot', path: 'skills/ui-screenshots', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); GitHub publishes the maintained canonical Playwright UI screenshot skill.',
  },
  'shadcn-ui': {
    repo: 'https://github.com/google-labs-code/stitch-skills', path: 'plugins/stitch-build/skills/shadcn-ui', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); Google Labs moved the exact skill to its official stitch-skills repository.',
  },
  slides: {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/slides', commit: 'e6afb0d74cc75d220df2faf3dd6c635c2dc6a108', official: true,
    evidence: 'OpenAI is the official publisher; this is the latest immutable parent commit containing the exact slides directory.',
  },
  sora: {
    repo: 'https://github.com/openai/skills', path: 'skills/.curated/sora', commit: '728a3e9ba7240b7dfdda961b67775ec324fd639a', official: true,
    evidence: 'OpenAI is the official publisher; this is the latest immutable parent commit containing the exact sora directory.',
  },
  'stitch-loop': {
    repo: 'https://github.com/google-labs-code/stitch-skills', path: 'plugins/stitch-utilities/skills/stitch-loop', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); Google Labs moved the exact skill to its official stitch-skills repository.',
  },
  'swiftui-design': { path: '.', allowFiles: ['SKILL.md', 'LICENSE', 'references', 'templates'], evidence: 'The advertised dedicated repository has one root SKILL.md and complete references/templates.' },
  threejs: {
    path: '.', bodyFile: 'README.md',
    evidence: 'The advertised repository is a ten-skill Three.js pack; its root README is the canonical router for the complete pack.',
  },
  'ui-skills': {
    path: 'skills/ui-skills-root',
    evidence: 'The advertised repository uses ui-skills-root as the exact umbrella skill for its evolving UI constraints.',
  },
  'web-design-guidelines': {
    path: '.', bodyFile: 'command.md', official: true,
    allowFiles: ['command.md', 'LICENSE', 'references'],
    evidence: 'Vercel is the official publisher; the repository root command.md is its canonical operational workflow (the source predates SKILL.md packaging).',
  },
  wpds: {
    repo: 'https://github.com/WordPress/agent-skills', path: 'skills/wpds', official: true,
    evidence: 'The advertised repository is dead (GitHub 404); WordPress moved the exact wpds skill to its official agent-skills repository.',
  },
  'writing-guidelines': {
    path: '.', bodyFile: 'command.md', official: true,
    allowFiles: ['command.md', 'LICENSE', 'references'],
    evidence: 'Vercel is the official publisher; the repository root command.md is its canonical operational workflow (the source predates SKILL.md packaging).',
  },
  'youtube-clipper': { path: '.', allowFiles: ['SKILL.md', 'LICENSE', 'scripts', 'references', 'templates'], evidence: 'The advertised dedicated repository has one root SKILL.md and complete scripts/references/templates.' },
};
