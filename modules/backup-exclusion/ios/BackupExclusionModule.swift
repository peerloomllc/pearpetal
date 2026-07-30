import ExpoModulesCore

// Keeps the private cycle store out of iCloud Backup.
//
// WHY THIS EXISTS: the Corestore lives under the app's Documents directory
// (app/index.tsx passes FileSystem.documentDirectory to the worklet's init, and
// @peerloom/core opens `<dataDir>/pearpetal/store`). iOS includes Documents in
// iCloud Backup by DEFAULT, so without this the whole private cycle log - every
// logged day, flow, symptom, note and BBT - is eligible to leave the phone in the
// device backup, while onboarding promises "no accounts, no servers. Your data
// stays on your device."
//
// It also matters for the store: App Store Review Guideline 5.1.3 says apps "may
// not store personal health information in iCloud", which is a hard blocker for
// any future Apple Health import (proposals/2026-07-30-health-import.md).
//
// Setting NSURLIsExcludedFromBackupKey on the directory covers everything beneath
// it, so this is one call on `<Documents>/pearpetal` rather than per-file. It is
// re-asserted on every launch: the flag lives in the filesystem, not in our own
// state, and a restore onto a new device starts it out unset.
public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    // Mark `path` (a plain filesystem path, no file:// scheme) as excluded from
    // iCloud and iTunes backups. Returns false rather than throwing when the path
    // does not exist yet or the flag cannot be set - the caller treats this as
    // best-effort and the app must still run if it fails.
    AsyncFunction("exclude") { (path: String) -> Bool in
      var url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { return false }
      do {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        return true
      } catch {
        return false
      }
    }

    // Read the flag back, so the app can verify rather than assume. Returns nil
    // when the path does not exist or the value cannot be read.
    AsyncFunction("isExcluded") { (path: String) -> Bool? in
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return (try? url.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup
    }
  }
}
