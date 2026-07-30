import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

// iOS-only native module (see ios/HealthReadModule.swift). On Android and web
// requireOptionalNativeModule returns null, so every export below is a safe no-op
// there - Android's import path is the file one, which needs no permission at all.
//
// READ ONLY: the native side requests `toShare: nil`, so no write authorization to
// Apple Health exists. See proposals/2026-07-30-health-import.md.
const HealthRead = requireOptionalNativeModule<{
  isAvailable(): boolean
  requestRead(): Promise<boolean>
  read(days: number): Promise<Array<{ date: string; bbt?: number; flow?: string; at?: string }>>
}>('HealthRead')

export function healthReadAvailable (): boolean {
  if (Platform.OS !== 'ios' || !HealthRead) return false
  try { return HealthRead.isAvailable() } catch { return false }
}

// Prompt once for read access. Resolves true when the prompt has been ANSWERED,
// not when it was granted - HealthKit deliberately hides a refusal, so a caller
// must never treat false as "the user said no", only as "we could not ask".
export async function requestHealthRead (): Promise<boolean> {
  if (Platform.OS !== 'ios' || !HealthRead) return false
  try { return await HealthRead.requestRead() } catch { return false }
}

// Samples shaped exactly like the file parsers produce: ISO local dates, Celsius,
// sorted ascending. An empty array means "no data found", which on iOS covers both
// "there genuinely is none" and "access was refused" - they are indistinguishable
// by design, and the UI copy has to reflect that rather than accuse the user.
export async function readHealthSamples (days = 180): Promise<Array<{ date: string; bbt?: number; flow?: string; at?: string }>> {
  if (Platform.OS !== 'ios' || !HealthRead) return []
  try { return await HealthRead.read(days) } catch { return [] }
}
