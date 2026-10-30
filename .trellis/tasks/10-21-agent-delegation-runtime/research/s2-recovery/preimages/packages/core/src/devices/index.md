# core/devices/
- paired-device-store.ts — SANCTIONED node:fs site; atomic JSON persistence of paired devices (find/save)
- device-registry.ts — pairing-code lifecycle + loopback direct-trust + token issue/verify (sha256 at rest, timingSafeEqual, injected clock)
