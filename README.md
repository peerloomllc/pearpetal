# 🌸 PearPetal

**Private cycle & fertility tracking for Android and iOS.**

PearPetal keeps your menstrual and fertility cycle on your own devices - no accounts, no servers, no cloud. Your full log lives only on the phones you own, and you choose exactly what a partner sees. Your cycle blooms on a signature petal dial: a flower that furls and opens as you move through your cycle.

Part of the [PeerLoom](https://peerloomllc.com) suite of account-free, peer-to-peer apps.

---

## Features

- **The petal dial** - a living flower that tracks your phase across the cycle at a glance, plus a month calendar view
- **On-device predictions** - your next period, fertile window and ovulation are computed on your phone from your own history, and never sent anywhere
- **Log what matters** - period start and flow, symptoms, mood, notes, and basal body temperature (BBT)
- **Goal-aware** - general tracking, trying to conceive, avoiding, or a dedicated pregnancy mode; the goal tunes the guidance you see
- **Made for your body** - enter conditions (like PCOS, endometriosis or thyroid) or birth control and the predictions adjust
- **Scoped, consented partner sharing** - give a partner a read-only view of exactly what you choose (cycle phase only, your fertile window, or your full cycle), and end it any time
- **Gentle reminders** - optional local notifications for your period or fertile days, with a discreet mode that hides the wording on your lock screen
- **Backups you control** - export an optionally password-encrypted backup file to move to a new phone; nothing is ever uploaded
- **Five flowers** - pick the species that blooms on your dial
- **No accounts** - your identity is a cryptographic key pair generated on your device; nothing is tied to an email or phone number
- **No data collection** - PeerLoom, Google, Apple, and no third party ever sees your cycle

---

## How It Works

PearPetal uses **peer-to-peer technology** powered by [Hypercore Protocol](https://hypercore-protocol.org) to sync directly between your own devices - and a partner you have shared with.

### No servers
Most cycle-tracking apps route your most sensitive data through a central server. The app company can read it, sell it, get hacked, get subpoenaed, or shut down. PearPetal has no central server. Your cycle never leaves your devices.

### The privacy boundary is structural, not a promise
Your full private log and anything you share with a partner live in **two separate, separately-encrypted stores**:

- Your **private log** replicates only across your own devices. Its encryption key is never given to a partner.
- A **per-partner share** carries only the slice you consent to - phase only, fertility, or full - written by you and read-only for your partner. A partner can never edit your data or re-share it.

Predictions are computed on your device and never cross the wire. Ending a share stops it going forward.

### How sync works
When your devices - or you and a partner - are online at the same time, whether on the same Wi-Fi or anywhere on the internet, they find each other using a distributed hash table (DHT), similar to how BitTorrent works. Once connected, they sync directly, device to device, with no middleman.

### Encrypted and signed
All sync traffic is encrypted in transit, and every entry is cryptographically signed by the device that wrote it - so a partner's device can never forge entries in your log.

### Pairing
You link your own device, or accept a partner's invite, via a one-time link or QR code. The link encodes the cryptographic address - there is no server involved.

---

## Privacy

- No accounts or sign-up required
- No analytics, tracking, or telemetry
- No third-party SDKs
- All sync traffic is encrypted end-to-end
- Your cycle data stays on your own devices - never uploaded anywhere
- A partner only ever sees the scope you choose, and can never edit or re-share it

See the [full privacy policy](https://peerloomllc.com/pearpetal/privacy).

---

## Permissions

- **Camera** - used to scan an invite QR code when you link one of your own devices or accept a partner's share. Nothing from the camera is stored or transmitted.
- **Notifications** - used to deliver the optional reminders you turn on. Off by default. Their content never leaves the device, and you can keep the wording discreet.
- **Network and local network** - used exclusively for peer-to-peer connections between your own devices and a partner, including directly over your Wi-Fi. No data is sent to external servers. On iOS, the first-launch Local Network prompt lets same-Wi-Fi peers connect directly.

---

## Not medical advice

PearPetal is for personal tracking. Its predictions are estimates - not medical advice, not a diagnosis, and **not a contraceptive method**. Do not rely on them to prevent or achieve pregnancy. For medical questions, talk to a qualified healthcare professional.

---

## Known Limitations

- **Both devices must be online at the same time** to sync in real time - you can always read and edit your own log offline, and changes replicate the next time devices can reach each other.
- **Background sync depends on the OS** - iOS pauses apps in the background, so sync happens when someone has the app open.
- **A newly linked second device** may need an app reopen to finish syncing its first edits; moving to a new phone is best done with an encrypted backup export/import.
- **No web dashboard or desktop client** - PearPetal is mobile-only, because there is no server to back a web view.

---

## Feedback & Bug Reports

Please open an [issue](../../issues) on GitHub. Include your platform (Android or iOS), OS version, and a description of what happened. For anything sensitive, email [peerloomllc@proton.me](mailto:peerloomllc@proton.me?subject=[PearPetal]).

---

## License

[MIT](LICENSE) © 2026 PeerLoom LLC
