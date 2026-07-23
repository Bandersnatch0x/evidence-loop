import { AliyunSTTProvider } from './AliyunSTTProvider'
import { MockSTTProvider } from './MockSTTProvider'
import {
  resolveSTTProviderName,
  type STTProvider,
  type STTProviderName
} from './STTProvider'
import { WebSpeechSTTProvider } from './WebSpeechSTTProvider'

/**
 * Factory for the active STT provider. Prefer injecting a mock in tests.
 */
export function createSTTProvider(
  environment: NodeJS.ProcessEnv = process.env,
  name?: STTProviderName
): STTProvider {
  const resolved = name ?? resolveSTTProviderName(environment)
  switch (resolved) {
    case 'aliyun':
      return new AliyunSTTProvider({}, environment)
    case 'mock':
      return new MockSTTProvider()
    case 'webspeech':
    default:
      return new WebSpeechSTTProvider()
  }
}
