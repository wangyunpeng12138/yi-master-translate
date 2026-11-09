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
  isLocalAsrProvider,
} from './registry';
export { localModelStatus, startModelDownload, removeLocalModel } from './providers/local-whisper';
export type { LocalModelState, LocalModelName } from './providers/local-whisper';
export { audioFingerprint, asrCacheKey, getAsrCache, setAsrCache, clearAsrCache } from './cache';
export type { AsrCacheArea, AsrCacheEntry } from './cache';
export { encodeWav, floatTo16BitPCM, parseWavHeader, wavToFloat32 } from './audio/wav';
export { arrayBufferToBase64, base64ToArrayBuffer } from './audio/codec';
export { resolveAsrEndpoint } from './providers/openai-asr';
