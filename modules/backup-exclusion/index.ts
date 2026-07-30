import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

// iOS-only native module (see ios/BackupExclusionModule.swift). On Android and
// web requireOptionalNativeModule returns null, so the exports below are no-ops
// there - Android keeps the store out of Google's cloud backup declaratively
// instead, via plugins/with-android-backup-exclusion.js.
const BackupExclusion = requireOptionalNativeModule<{
  exclude(path: string): Promise<boolean>
  isExcluded(path: string): Promise<boolean | null>
}>('BackupExclusion')

// Mark a directory as excluded from iCloud Backup. Best-effort: returns false off
// iOS, when the native module is missing, or when the path does not exist yet.
// Never throws - a failure here must not stop the app from starting.
export async function excludeFromBackup (path: string): Promise<boolean> {
  if (Platform.OS !== 'ios' || !BackupExclusion) return false
  try {
    return await BackupExclusion.exclude(path)
  } catch {
    return false
  }
}

// Read the flag back so a caller can verify rather than assume. null means
// "unknown" (off iOS, no module, or the path does not exist).
export async function isExcludedFromBackup (path: string): Promise<boolean | null> {
  if (Platform.OS !== 'ios' || !BackupExclusion) return null
  try {
    return await BackupExclusion.isExcluded(path)
  } catch {
    return null
  }
}
