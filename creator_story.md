Author: Clarkian
Project: PearPetal
Summary: Private, account-free period and fertility tracking. Your cycle stays on the phones you own, and you choose exactly what a partner can see. No servers, no cloud.

## Backstory

I got tuned into the P2P protocols and development when Guy Swan interviewed Maf
on Bitcoin Audible podcast a few years ago about Keet.  The design and vision really resonated with
me (i.e. decentralization, privacy, etc.).  It was a perfect complement for Bitcoin rabbit hole
I was already going down, but from a more generic information-sharing protocol standpoint.

Once Opus 4.5 (or maybe 4.6) came out and people were raving about what it could do with coding,
I decided to try my hand at it because I wanted less of my daily-driver apps to be based upon
centralized services (i.e. account-based, server-based, subscription-based, etc).  Once
I saw what it was capable of I decided to start making p2p versions (based on the Pear stack and 
holepunching) of the apps that my family and I currently use.

My wife gave me the idea for PearPetal specifically when I mentioned another app idea
that involved sensitive medical information.  It would have never crossed my mind otherwise
because I don't have use for a period-tracking app.

## Ecosystem

PearPetal would not exist without the Hypercore ecosystem. It is my clearest case
of peer-to-peer building blocks making a product safe by design rather than by
promise. From the Pears / Holepunch stack:

- **Hypercore and Autobase** for the append-only logs each device writes to, read
  through a **Hyperbee** view. Nothing is ever silently rewritten.
- **Hyperswarm and the HyperDHT** for finding each other. Your two phones, or you
  and your partner, locate each other the same way BitTorrent works without a
  tracker, then sync directly, phone to phone.
- **Protomux** to carry that sync over one connection, **sodium-universal** for the
  identity keypair created on your phone the first time you open the app, and
  end-to-end encryption on every connection.
- The **Bare** runtime runs the whole data engine. PearPetal is a React Native
  shell, a WebView UI and a Bare worklet that owns identity, storage, sync and
  predictions. It ships as signed Android and iOS builds, but everything under that
  is the Pears stack.

^ That was AI-generated because I'm not a clever coder or anything, but it's accurate.

I'm not using the Pear CLI for P2P deployment, but it's something I'm thinking about.

## Architecture

AI summary incoming...

The whole product comes down to one decision: **two separate stores, not one.**

The obvious design gives a partner access to your one and only log, which quietly
gives away the entire promise. PearPetal instead keeps two Autobases with two
different encryption keys:

1. **Your private store** holds your full daily log and cycle history. It syncs only
   between phones you own. Its key never leaves them. All predictions are worked out
   locally from it.
2. **A shared store per partner** carries only what you agreed to share: your current
   phase, or your fertile window, or a fuller summary. A partner is let into that one
   and nothing else, and only to read. They cannot edit your log, add fake entries or
   pass it on.

That boundary is not a rule in the app's code that a bug could get around. **The
partner invite simply does not contain the key to your private store**, so there is
nothing to leak. Every entry is also signed by the device that wrote it and checked
before it is accepted, so a partner's phone cannot slip anything into your history.

Predictions - next period, fertile window, ovulation - are worked out on your phone
and never sent anywhere. Pairing a second phone of your own, or accepting a
partner's invite, is a one-time QR code or link. No server at any step.

## Trade-offs

AI summary incoming...

The upside falls straight out of that design. No server means no central breach, no
data sale and no shutdown that takes your history with it. No accounts means your
identity is a key on your phone, tied to no email and no phone number. Your consent
is built into the structure, not a setting a future update could quietly flip.

The costs are the honest price of having no server:

- **Both phones need to be on at the same time to sync.** You can read and edit your
  own log any time, offline included, and it catches up when your devices can reach
  each other. There is just no cloud copy syncing on your behalf.
- **Background sync depends on the phone.** iOS in particular pauses apps in the
  background, so sync is reliable when someone has the app open.
- **No account recovery.** No server means no backup to restore from. Instead, a
  second linked phone is your backup, and you can save a backup file (optionally
  password-protected) to move to a new one. Losing a phone is not losing your data,
  as long as you set that up beforehand.
- **Phones only.** No web dashboard or desktop app, because there is no server to
  put behind one.

I think every one of these is a fair trade, and the app says so plainly.

## Learnings

AI summary with some custom edits...

The biggest lesson changed how I build everything else in the suite: **a privacy
boundary enforced in code is a promise, a privacy boundary enforced in who holds the
key is a fact.** Once I stopped thinking "the app will make sure a partner only sees
the summary" and started thinking "the partner will not hold the key to anything
else," the design got simpler and the guarantee got stronger. Two stores is more
moving parts than one and worth every bit of it.

The second came from real use. The more partners a phone shares with, the more
connections it juggles, and announcing all of them made pairing slower over time.
The fix was to let partners connect quietly instead of advertising your address to
the wider network. You only find that by running real phones holding real data,
never in a demo.

The third is that shared foundations compound. PearPetal is my most sensitive app
and not my slowest to build, because pairing, signing and sync were already proven
on my calendar, location and list-sharing apps. Getting the basics right once pays out
across the whole family.

## Current Audience

PearPetal is for people who want to track their cycle in complete privacy, with no accounts and no ads, but also
want to be able to connect and share, through the app, with others.

- People who will not put reproductive data on someone else's server.
- Couples and people trying to conceive, where a partner sees a chosen slice, phase
  or fertile window, without getting the whole log.
- Early adopters who are fine with phones only and with "both phones on to sync."

It is a real, shipped app on the App Store, Zapstore and Github, not a prototype. (I have it on Google Play, but it's only available for Closed Testing through a Google Groups sign-up until I can get enough testers using it to meet Google's requirements for a production release).

## Next Milestone

Closing the gap between the guarantee and the everyday convenience people expect
from a mainstream tracker: smoother setup, sync that copes better when only one
phone is around, and the **two-way logging** couples ask for, which v1 deliberately
left out (a partner is read-only for now). Pulling temperature readings in from
Apple Health or Health Connect might be possible.

## Trajectory

The aim is not to out-feature the big apps. It is to be the app you can recommend
to someone the day they decide they no longer trust those apps with their data.
PeerLoom's thesis is a family of private, account-free apps replacing centralized
ones a category at a time, and PearPetal is ideal because reproductive data
is where that argument is hardest to dispute.

Mass adoption would take three things: sync that feels as effortless as a cloud app
despite there being no cloud, which likely means optional always-on helpers holding
only encrypted data they cannot read; setup that never asks anyone to understand
peer-to-peer; and enough public trust that "no server" reads as a feature rather
than a limitation.

Short of that, the worthwhile path is to own the privacy-first end of the category
and grow by trust rather than ad spend, the way privacy tools always have, by word
of mouth from people who checked the claim and found it true. 
