# PearPetal

Private, peer-to-peer menstrual and fertility cycle tracking. No accounts, no
servers, no cloud. Your cycle data lives only on your own devices, and you choose
exactly what a partner sees.

Part of the [PeerLoom](https://peerloomllc.com) suite of account-free P2P apps.

## Status

Pre-scaffold. The v1 wire protocol is locked; implementation has not started. See
[`proposals/2026-07-06-wire-protocol.md`](proposals/2026-07-06-wire-protocol.md)
for the spec and [`DECISIONS.md`](DECISIONS.md) for the design rationale.

## Why P2P

Cycle and fertility data is the textbook case for never touching a server.
PearPetal keeps the full log on the devices you control and shares only a
consented projection with a partner, over an encrypted peer-to-peer connection
with no server in the middle.
