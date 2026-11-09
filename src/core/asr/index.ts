export type {
  AsrCue,
  AsrProvider,
  AsrProviderId,
  AsrCapabilities,
  AsrRequest,
} from './types';
export { AsrError } from './types';
export {
  listAsrProviders,
  createAsrProvider,
  getAsrChain,
  hasUsableAsrProvider,
  isAsrProviderImplemented,
} from './registry';
export { audioFingerprint, asrCacheKey, getAsrCache, setAsrCache, clearAsrCache } from './cache';
export type { AsrCacheArea, AsrCacheEntry } from './cache';
export { encodeWav, floatTo16BitPCM, parseWavHeader } from './audio/wav';
export { arrayBufferToBase64, base64ToArrayBuffer } from './audio/codec';
export { resolveAsrEndpoint } from './providers/openai-asr';
