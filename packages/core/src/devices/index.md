# core/devices/
- paired-device-store.ts — atomic paired-device persistence; failed writes never publish in-memory trust
- device-registry.ts — role-bound pairing/token authority; authenticated local enrollment preserves concurrent tokens
- local-connection-auth.ts — asynchronous cached profile-key bootstrap, socket-bound HMAC proof and atomic public endpoint discovery
