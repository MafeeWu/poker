
## Follow-up fixes

### Review findings addressed
- Passed `pendingAction` into `HostControls` and disabled only the active Reveal, Archive, Next round, or Transfer host control while its request is pending.
- Gated vote, reveal, archive, next-round, and host-transfer mutations on `status === 'connected'`; disconnected room views show an inline action notice and retain the last server-confirmed snapshot.
- Removed the deep-link `Guest`/`voter` fallback. Rooms without recovery metadata now show an explicit join form with the room code prefilled and require nickname and role through the approved guest flow.

### Regression coverage
- Added tests for pending host control disabling, blocked voting during reconnect, and explicit deep-link joining without an implicit API call.

### Validation
- `npm test -- --run src/features`: 3 files passed; 13 tests passed.
- `npm run build`: successful production build.
