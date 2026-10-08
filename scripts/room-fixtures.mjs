import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';

function unwrap(result, operation) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${operation} returned an invalid response.`);
  }
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message || String(result.error)}`);
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new Error(`${operation} returned no data.`);
  }
  return result.data;
}

function validateCount(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

export async function createOnlineRoomFixture({
  createClientFactory = createClient,
  url,
  anonKey,
  voterCount = 0,
  observerCount = 0,
  memberCount,
  concurrency = 10,
  heartbeatIntervalMs = 30_000,
  hostNickname = 'Host',
  voterNicknamePrefix = 'Voter',
  observerNicknamePrefix = 'Observer',
} = {}) {
  validateCount(voterCount, 'voterCount');
  validateCount(observerCount, 'observerCount');
  const expectedMemberCount = 1 + voterCount + observerCount;
  if (memberCount !== undefined && memberCount !== expectedMemberCount) {
    throw new Error(`Fixture member count must equal host plus requested roles (${expectedMemberCount}).`);
  }
  if (expectedMemberCount > 100) {
    throw new Error('Fixture member count cannot exceed the 100-member room limit.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Fixture concurrency must be a positive integer.');
  }
  if (!url || !anonKey) {
    throw new Error('Fixture requires a Supabase URL and anon key.');
  }

  const clients = [];
  const members = [];
  const heartbeatErrors = [];
  let heartbeatTimer;
  let heartbeatInFlight = Promise.resolve();
  let disposed = false;

  const createSession = async () => {
    const client = createClientFactory(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    clients.push(client);
    const session = unwrap(await client.auth.signInAnonymously(), 'Anonymous sign-in');
    if (!session.user?.id) {
      throw new Error('Anonymous sign-in returned no user.');
    }
    return { client, userId: session.user.id };
  };

  const startHeartbeats = () => {
    if (heartbeatTimer || heartbeatIntervalMs <= 0) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      heartbeatInFlight = heartbeat().catch((error) => {
        heartbeatErrors.push(error instanceof Error ? error : new Error(String(error)));
      });
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  };

  const heartbeat = async () => {
    const results = await Promise.allSettled(members.map(async ({ client, id }) => {
      const roomId = members[0].roomId;
      const result = await client.rpc('heartbeat_member', { p_room_id: roomId, p_member_id: id });
      if (result?.error) {
        throw new Error(`Member heartbeat failed: ${result.error.message || String(result.error)}`);
      }
    }));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(failures.map(({ reason }) => reason), 'One or more room member heartbeats failed.');
    }
  };

  const assertHealthy = () => {
    if (heartbeatErrors.length > 0) {
      throw new AggregateError(heartbeatErrors, 'Room fixture membership heartbeat failed.');
    }
  };

  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    await heartbeatInFlight;

    const failures = [...heartbeatErrors];
    for (const { client, id, roomId } of [...members].reverse()) {
      try {
        const result = await client.rpc('leave_room', { p_room_id: roomId, p_member_id: id });
        if (result?.error) {
          throw new Error(`Leave room failed: ${result.error.message || String(result.error)}`);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    for (const client of clients) {
      try {
        const result = await client.auth.signOut();
        if (result?.error) {
          throw new Error(`Anonymous sign-out failed: ${result.error.message || String(result.error)}`);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Room fixture cleanup failed.');
    }
  };

  const fixture = { clients, members, heartbeat, assertHealthy, dispose };

  try {
    const hostSession = await createSession();
    const hostClient = hostSession.client;
    const createRoomStartedAt = performance.now();
    const roomSnapshot = unwrap(await hostClient.rpc('create_room', {
      p_name: 'Poker E2E fixture',
      p_nickname: hostNickname,
    }), 'Room creation');
    const createRoomLatencyMs = performance.now() - createRoomStartedAt;
    const room = roomSnapshot.room;
    const round = roomSnapshot.round;
    if (!room?.id || !room?.code || !roomSnapshot.myMemberId || !round?.id) {
      throw new Error('Room creation returned an incomplete fixture snapshot.');
    }
    if (room.maxMembers !== 100) {
      throw new Error(`Fixture room capacity is ${room.maxMembers}; expected exactly 100.`);
    }
    members.push({
      client: hostClient,
      userId: hostSession.userId,
      id: roomSnapshot.myMemberId,
      roomId: room.id,
      nickname: hostNickname,
      role: 'host',
      online: true,
      joinLatencyMs: createRoomLatencyMs,
    });
    startHeartbeats();

    const requestedGuests = [
      ...Array.from({ length: voterCount }, (_, index) => ({
        nickname: `${voterNicknamePrefix} ${index + 1}`,
        role: 'voter',
      })),
      ...Array.from({ length: observerCount }, (_, index) => ({
        nickname: `${observerNicknamePrefix} ${index + 1}`,
        role: 'observer',
      })),
    ];

    let lastSnapshot = roomSnapshot;
    for (let offset = 0; offset < requestedGuests.length; offset += concurrency) {
      const batch = requestedGuests.slice(offset, offset + concurrency);
      const results = await Promise.allSettled(batch.map(async ({ nickname, role }) => {
        const session = await createSession();
        const client = session.client;
        const joinStartedAt = performance.now();
        const snapshot = unwrap(await client.rpc('join_room', {
          p_code: room.code,
          p_nickname: nickname,
          p_role: role,
        }), `Join ${nickname}`);
        const joinLatencyMs = performance.now() - joinStartedAt;
        if (!snapshot.myMemberId || !Array.isArray(snapshot.members)) {
          throw new Error(`Join ${nickname} returned an incomplete room snapshot.`);
        }
        const member = snapshot.members.find(({ id }) => id === snapshot.myMemberId);
        if (!member || member.online !== true) {
          throw new Error(`Join ${nickname} did not establish online room membership.`);
        }
        return {
          client,
          userId: session.userId,
          id: snapshot.myMemberId,
          roomId: room.id,
          nickname,
          role,
          online: true,
          joinLatencyMs,
          snapshot,
        };
      }));

      const failed = results.filter((result) => result.status === 'rejected');
      for (const result of results) {
        if (result.status === 'fulfilled') {
          members.push(result.value);
          lastSnapshot = result.value.snapshot;
        }
      }
      if (failed.length > 0) {
        if (failed.length === 1) {
          throw failed[0].reason;
        }
        throw new AggregateError(failed.map(({ reason }) => reason), 'One or more fixture members failed to join.');
      }
    }

    lastSnapshot = unwrap(await hostClient.rpc('build_room_snapshot', {
      p_room_id: room.id,
      p_user_id: hostSession.userId,
    }), 'Final room snapshot');

    if (members.length !== expectedMemberCount || lastSnapshot.members.length !== expectedMemberCount) {
      throw new Error(`Fixture created ${members.length} members; expected exactly ${expectedMemberCount}.`);
    }
    if (!lastSnapshot.members.every(({ online }) => online === true)) {
      throw new Error('Fixture members are not all online.');
    }

    fixture.room = room;
    fixture.round = round;
    fixture.snapshot = lastSnapshot;
    return fixture;
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Room fixture setup failed and cleanup was incomplete.');
    }
    throw error;
  }
}
