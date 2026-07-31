import ExpoModulesCore
import HealthKit

// READ-ONLY HealthKit access, for importing basal body temperature and menstrual
// flow into PearPetal's own log.
//
// ONE WAY, STRUCTURALLY. `requestAuthorization` is called with `toShare: nil`, so
// this app holds no write authorization at all - not "does not call write", cannot.
// There is also no save() or delete() anywhere in this file. That is the iOS half
// of the guarantee in proposals/2026-07-30-health-import.md; the file-import path
// (the primary one) needs no permission whatever.
//
// The Info.plist DOES carry `NSHealthUpdateUsageDescription` as of 2026-07-31, and
// that is not a contradiction: Apple's asset validation requires the write string
// whenever the HealthKit entitlement is present, since the entitlement itself
// permits writing and has no read-only variant. A purpose string is prompt text,
// not an authorization - it grants nothing, and no user can ever see that one,
// because only a write request would display it. See DECISIONS.md 2026-07-31.
//
// A HEALTHKIT QUIRK THAT SHAPES THE UI: an app cannot tell whether a READ was
// denied. Apple deliberately makes refusal indistinguishable from "there is no
// such data", because the refusal itself would leak health information. So this
// module never reports "denied" - it reports what it found, and the UI says "no
// data found" rather than accusing the user of anything.
//
// Everything read here is normalised to exactly what src/healthFiles.js produces
// from an exported file - ISO local dates, Celsius, sorted ascending - so the
// worklet's merge rules are shared with every source and nothing is duplicated.
public class HealthReadModule: Module {
  private let store = HKHealthStore()

  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    if let bbt = HKObjectType.quantityType(forIdentifier: .basalBodyTemperature) { types.insert(bbt) }
    if let flow = HKObjectType.categoryType(forIdentifier: .menstrualFlow) { types.insert(flow) }
    return types
  }

  public func definition() -> ModuleDefinition {
    Name("HealthRead")

    // Is HealthKit usable at all? False on iPad and in odd configurations, so the
    // UI can hide the option rather than offer something that cannot work.
    Function("isAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    // Ask for READ access only. `toShare: nil` means no write authorization is
    // ever requested, so no write-back path exists. Resolves true once the prompt
    // has been answered either way - remember that a denial is invisible to us.
    AsyncFunction("requestRead") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else { promise.resolve(false); return }
      self.store.requestAuthorization(toShare: nil, read: self.readTypes) { ok, _ in
        promise.resolve(ok)
      }
    }

    // Read the two types over the last `days` days and return samples shaped
    // exactly like the file parsers': [{ date, bbt?, flow?, at }].
    AsyncFunction("read") { (days: Int, promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else { promise.resolve([]); return }
      let end = Date()
      let start = Calendar.current.date(byAdding: .day, value: -max(1, min(days, 730)), to: end) ?? end
      let period = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
      let sortAsc = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]

      // The user's LOCAL calendar day: a basal temperature is "the morning of the
      // 12th" to whoever took it, and PearPetal's own rows come from local dates.
      let dayFormatter = DateFormatter()
      dayFormatter.dateFormat = "yyyy-MM-dd"
      dayFormatter.timeZone = TimeZone.current
      let stampFormatter = ISO8601DateFormatter()

      var out: [[String: Any]] = []
      let group = DispatchGroup()

      if let bbtType = HKObjectType.quantityType(forIdentifier: .basalBodyTemperature) {
        group.enter()
        let q = HKSampleQuery(sampleType: bbtType, predicate: period, limit: HKObjectQueryNoLimit, sortDescriptors: sortAsc) { _, samples, _ in
          for s in (samples as? [HKQuantitySample]) ?? [] {
            // Always ask for Celsius, so the worklet only ever sees one unit.
            let c = s.quantity.doubleValue(for: .degreeCelsius())
            out.append([
              "date": dayFormatter.string(from: s.startDate),
              "bbt": c,
              "at": stampFormatter.string(from: s.startDate),
            ])
          }
          group.leave()
        }
        self.store.execute(q)
      }

      if let flowType = HKObjectType.categoryType(forIdentifier: .menstrualFlow) {
        group.enter()
        let q = HKSampleQuery(sampleType: flowType, predicate: period, limit: HKObjectQueryNoLimit, sortDescriptors: sortAsc) { _, samples, _ in
          for s in (samples as? [HKCategorySample]) ?? [] {
            // .none means the user explicitly recorded NO flow that day. It is not
            // a bleeding day and must never become one - the same rule the Apple
            // file parser follows. .unspecified means a period WAS logged without
            // an intensity, so medium is the honest middle.
            let flow: String?
            switch HKCategoryValueMenstrualFlow(rawValue: s.value) {
            case .light: flow = "light"
            case .medium: flow = "medium"
            case .heavy: flow = "heavy"
            case .unspecified: flow = "medium"
            default: flow = nil
            }
            if let flow = flow {
              out.append([
                "date": dayFormatter.string(from: s.startDate),
                "flow": flow,
                "at": stampFormatter.string(from: s.startDate),
              ])
            }
          }
          group.leave()
        }
        self.store.execute(q)
      }

      group.notify(queue: .main) {
        // Ascending by timestamp, so the worklet's "first reading of a day wins"
        // picks the waking temperature rather than a later one.
        let sorted = out.sorted { (a, b) in
          String(describing: a["at"] ?? "") < String(describing: b["at"] ?? "")
        }
        promise.resolve(sorted)
      }
    }
  }
}
