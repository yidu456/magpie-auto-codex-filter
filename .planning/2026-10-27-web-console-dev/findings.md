# Findings

- Legacy makeProxy captures mode in its closure; mode also determines service identity and recovery ownership.
- Exact Azure, encrypted-content, throttle, ALB, transport, incomplete-stream and availability handlers can be gated without broadening matching.
- Browser requests are rejected by the proxy; management must be a separate loopback server.
- Current stop forces connections closed after 10s; console will instead refuse exit while active.
- Node 24.12 SEA and current node.exe available. Runtime binary is 89935872 bytes, not a memory measurement.
- Default CLI runtime stays untouched; console runtime and tests are isolated.
