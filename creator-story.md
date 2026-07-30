Author: Clarkian
Project: PearPetal
Summary: Private, account-free menstrual and fertility tracking. Your cycle lives only on your own phones, and you choose exactly what a partner sees. No servers, no cloud.

## Backstory

I built a suite of account-free peer-to-peer apps under PeerLoom, all on the same principle: the private data-sharing products people rely on should not require a company in the middle that can read, sell, or lose your data.

Cycle and fertility tracking is the sharpest possible case for that principle. It is the most sensitive data class I have ever shipped against - and the mainstream period apps route exactly that data through a central server. The company can read it. It can be sold to advertisers, breached by an attacker, or simply vanish when the company shuts down. For a lot of people that is not a hypothetical risk.

So PearPetal is the flagship not because it was the easiest to build, but because it is the app where "why peer-to-peer" needs no explanation. The data itself makes the argument. If your cycle never leaves the phones you own, none of those failure modes exist. There is no server to breach, no company to trust, and no database sitting on someone else's machine.

## Ecosystem

PearPetal is impossible without the Hypercore ecosystem, and it is the clearest example I have of P2P primitives making a product safe by construction instead of by policy.

From the Pears / Holepunch stack I use:

- **Hypercore / Autobase** for the append-only, multi-writer logs. Each store is an Autobase applied into a **Hyperbee** view.
- **Hyperswarm and the HyperDHT** for discovery and connection. Two of my own devices, or me and a partner, find each other over a distributed hash table - the same idea that lets BitTorrent work without a tracker - and then sync directly, device to device, with no middleman.
- **Protomux** for multiplexing replication over a single connection, **sodium-universal** for the Ed25519 identity keypair generated on-device at first launch, and end-to-end encryption on every connection.
- The **Bare** runtime is where the whole data engine runs. PearPetal is a mobile app: a React Native shell, a WebView UI, and a Bare worklet that owns identity, storage, sync and prediction. It ships as signed Android and iOS builds, but everything beneath that delivery layer - the protocol, the DHT, the replication, the crypto - is the Pears stack.

One ecosystem point matters more than any single library: because all six apps in my suite are the same shape, I have been factoring the pairing, ledger and sync machinery into a shared internal core (`@peerloom/core`) and a device-linking package (`@peerloom/device-link`). PearPetal proves those on the hardest privacy requirements in the suite, and every future app inherits that work.

## Architecture

The whole product is one architectural decision: **two bases, not one.**

A naive design uses a single shared Autobase - a partner joins it and sees everything. That quietly violates the entire pitch. So PearPetal splits storage into two separate Autobases with two separate encryption keys:

1. **The private base** holds your full daily log and cycle history. It replicates only across your own devices. Its encryption key never leaves a device you control. This is the source of truth, and all predictions are computed locally from it.
2. **A per-partner shared base** - one per partner you link - carries only the consented projection you choose to write: your current phase, or your fertile window, or a fuller summary. A partner is admitted to that base and nowhere else. They are read-only. They cannot edit your log, forge entries, or re-share.

The privacy boundary is not a rule enforced in application code that a bug could bypass. **Withholding the private base key from the partner invite is the boundary.** A partner literally does not possess the key to your private data, so there is nothing to leak. Every entry is cryptographically signed by the device that wrote it, verified in the Autobase apply pass before it is accepted, so a partner's device can never forge history into your log.

Predictions - next period, fertile window, ovulation - are computed on your device from your own history and never cross the wire. Pairing, whether linking a second phone of your own or accepting a partner's invite, is a one-time QR code or link that encodes the cryptographic address. No server is involved at any step.

## Trade-offs

The benefits fall straight out of the architecture. No server means no central breach, no data sale, no shutdown that takes your data with it. No accounts means your identity is a keypair on your phone, tied to no email and no phone number. Consent is structural, not a toggle a future update could betray.

The downsides are the honest cost of having no server:

- **Both devices have to be online at the same time to sync in real time.** You can always read and edit your own log offline, and it replicates the next time your devices can reach each other - but there is no always-on cloud copy catching up for you.
- **Background sync is at the mercy of the OS**, especially on iOS, which pauses apps in the background. Sync happens reliably when someone has the app open.
- **No account recovery.** There is no server holding a backup to restore from. Instead, a second linked device *is* your backup, and you can export an optionally-encrypted backup file to move to a new phone. A single lost device is not data loss - but you have to have set that up.
- **Mobile only.** There is no web dashboard or desktop client, because there is no server to back one.

I consider every one of these a fair trade for the guarantee, and I say so plainly in the app.

## Learnings

The biggest lesson is philosophical, and it reshaped how I build every app in the suite: **a privacy boundary you enforce in code is a promise; a privacy boundary you enforce in key custody is a fact.** The moment I stopped thinking "the app will make sure a partner only sees the projection" and started thinking "the partner will not hold the key to anything else," the design got simpler and the guarantee got stronger. Two bases is more moving parts than one, and it is worth every bit of it.

The systemic lesson came from scale of a different kind. As a device accumulates partner shares, it accumulates Hyperswarm topics and connections, and naive announcing made pairing slower over time. The fix was to let pure viewers join client-only - a partner connects to you without re-announcing your topic to the whole DHT. That is the kind of thing you only learn by running real devices holding real state, not from the happy-path demo.

The technical lesson is that the same substrate really does compound. PearPetal is my most sensitive app, and it was not my slowest to build, because the pairing, signing and sync were already proven on the calendar, location and list apps before it. Getting the primitives right once pays out across the whole family.

## Current Audience

Right now PearPetal is for people who want to track their cycle and refuse to hand that data to a company - and who are comfortable with the shape of a no-server app. That is:

- Privacy-conscious people who will not put reproductive data on someone else's server.
- Couples and people trying to conceive who want a partner to see a chosen slice - phase, or fertile window - without handing over the whole log.
- Early adopters who are fine with mobile-only, who understand "both phones online to sync," and who value the guarantee enough to accept those edges.

It is a real, working, shipped app on both the App Store and Google Play, not a prototype. It is just honest about who it fits today.

## Next Milestone

The near-term milestone is closing the gap between the guarantee and the everyday convenience people expect from a mainstream tracker: smoother onboarding, more resilient sync when only one device is around, and the couples-oriented **two-way logging** that v1 deliberately left out (in v1 a partner is strictly read-only). Health-platform import - pulling BBT from Apple Health or Health Connect - is the other frequently-asked v2 item.

## Trajectory

The aim is not to out-feature the incumbents. It is to be the app you can recommend to someone the day they decide they no longer trust the incumbents with this data. PeerLoom's whole thesis is a family of private, account-free apps that replace centralized data-sharing products one category at a time, and PearPetal is the flagship because reproductive data is where that thesis is least arguable.

What would mass adoption actually require? Honestly, three things: sync that feels as effortless as a cloud app despite there being no cloud - which likely means optional always-on seeder infrastructure that stores only encrypted blocks it cannot read; onboarding that never once asks the user to understand peer-to-peer; and enough public trust in the category that "no server" reads as a feature, not a limitation.

If not mass adoption, the realistic and still-worthwhile trajectory is to own the privacy-first end of the category and grow it by trust rather than by ad spend - the audience that will never be served by a server-based app, reached the way privacy tools have always spread, by word of mouth from people who checked the claim and found it true. Because the guarantee here is structural, that claim survives inspection. That is the durable moat, and it is the one thing a better-funded competitor cannot copy without throwing away their server.
