# PearPetal - App Store Listing

> Copy-paste reference for App Store Connect.
> Updated 2026-07-10.

## Name (30 char max, already set)

```
PearPetal
```

(9 chars - plenty of headroom; leave as is)

## Subtitle (30 char max)

Shown directly under the app name in store search results and the product page.

```
Cycle tracking, no servers
```

(26 characters)

Alternates:
- `Private period & cycle tracker` (30)
- `Your cycle, only on your phone` (30)
- `Peer-to-peer cycle tracker` (26)

## Promotional Text (170 char max)

Updatable anytime without a new app review. For launch:

```
Track your cycle and fertility in complete privacy. No accounts, no servers, no cloud - your data lives only on your own phone. Share a scoped view with a partner.
```

(161 characters)

## Description (4000 char max)

Same content as the Play full description, ASCII-safe. Keeping them aligned avoids drift.

```
Track your menstrual cycle and fertility in complete privacy. PearPetal keeps your data on your own phone - no account, no server, no cloud. Not even we can see it.

Your cycle blooms on a living petal dial: a flower that furls and opens as you move through your cycle, so a glance tells you your phase, your fertile window, and when your next period is due.

KEY FEATURES

- Private by design: your full cycle log lives only on your own devices, never on a server
- The petal dial: a signature flower that tracks your phase across the cycle, plus a month calendar view
- On-device predictions: next period, fertile window, and ovulation are computed on your phone from your own history - never sent anywhere
- Log what matters: period start and flow, symptoms, mood, notes, and basal body temperature (BBT)
- Goals that change the tone: general tracking, trying to conceive, avoiding, or a dedicated pregnancy mode
- Cycle-aware for your body: enter conditions (like PCOS, endometriosis, thyroid) or birth control and predictions adjust
- Share with a partner, on your terms: give a partner a scoped, read-only view - cycle phase only, your fertile window, or your full cycle - and end it any time
- Gentle reminders: optional local notifications for your period or fertile days, with a discreet mode that hides the wording on your lock screen
- Backups you control: export an encrypted, password-protected backup file to move to a new phone; nothing is ever uploaded
- No accounts: your identity is a cryptographic key pair generated on your device
- No data collection: PeerLoom, Apple, and no third party ever sees your cycle

HOW IT WORKS

PearPetal uses peer-to-peer technology powered by Hypercore Protocol. Your own devices - and a partner you have shared with - find each other and sync directly, device to device, with no middleman. All sync traffic is encrypted end to end, and every entry is cryptographically signed by the device that wrote it.

The privacy boundary is structural, not a promise. Your full private log and anything you share with a partner live in two separate, separately-encrypted stores. The private log replicates only across your own devices. A partner share carries only the slice you consent to, written by you and read-only for your partner. Predictions are computed on your device and never cross the wire. Ending a share stops it going forward.

PRIVACY

- No accounts or sign-up required
- No analytics, tracking, or telemetry
- No third-party SDKs
- All sync traffic is end-to-end encrypted
- Your cycle data stays on your own devices, never uploaded anywhere
- A partner only ever sees the scope you choose, and can never edit or re-share it

IMPORTANT

PearPetal is for personal tracking. Its predictions are estimates, not medical advice, not a diagnosis, and not a contraceptive method. Do not rely on them to prevent or achieve pregnancy. For medical questions, talk to a qualified healthcare professional.

Open source. No vendor lock-in. Built by PeerLoom.
```

## Keywords (100 char max, comma-separated, no spaces)

Don't repeat words from the name/subtitle (Apple folds those in). No competitor trademarks.

```
period,cycle,fertility,ovulation,menstrual,fertile,pregnancy,privacy,p2p,peer-to-peer,bbt,flow,tracker
```

(101 chars - trim one if the field rejects it; e.g. drop "tracker")

## URLs

- **Support URL** (required):
  ```
  https://peerloomllc.com/pearpetal/support
  ```
- **Marketing URL** (optional but recommended):
  ```
  https://peerloomllc.com/pearpetal/
  ```
- **Privacy Policy URL** (required):
  ```
  https://peerloomllc.com/pearpetal/privacy
  ```

## Copyright

```
2026 PeerLoom LLC
```

## Categories

Set in **App Information** (separate sidebar item, not Version-specific).

- **Primary Category**: Health & Fitness
- **Secondary Category**: Lifestyle (or Medical)

## App Privacy ("nutrition label")

In App Store Connect -> App Privacy. PearPetal collects NO data:

- **Data collection**: "Data Not Collected." There is no server; all cycle data
  stays on the user's own devices. Nothing is collected, tracked, or linked to the user.

If Apple's questionnaire asks whether the app handles health/fitness data: it is
stored and processed ON DEVICE ONLY and never collected by the developer, so it is
not declared as "data collected."

## Age Rating

In **App Information** -> **Age Rating** -> **Edit**:

- Sexual Content or Nudity: **None**
- Medical/Treatment Information: **None** (PearPetal tracks user-entered data and
  shows estimates; it gives no treatment or diagnostic information - reinforced by the
  in-app "not medical advice" disclaimer). If unsure, Apple's own guidance for period
  trackers typically lands at 4+ / 12+; answer honestly and let the tool compute it.
- Unrestricted Web Access: **No**
- Gambling / Contests / User Generated Content: **None / No**

Apple will compute a rating (expected 4+ or 12+).

## Export Compliance

PearPetal uses standard encryption (TLS + libsodium for backups/sync). In most cases
this qualifies for the exemption; set `ITSAppUsesNonExemptEncryption` to false in the
build, or answer the App Store Connect encryption questions accordingly at submission.
