import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';

export function validateRuntimeConfig(env = process.env) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter((key) => !env[key] || !String(env[key]).trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase runtime configuration: ${missing.join(', ')}. Set SUPABASE_URL and SUPABASE_ANON_KEY before running the room load probe.`,
    );
  }

  return {
    SUPABASE_URL: String(env.SUPABASE_URL).trim(),
    SUPABASE_ANON_KEY: String(env.SUPABASE_ANON_KEY).trim(),
  };
}

export function createLoadProbe({
  supabase = null,
  logger = console,
  concurrency = 10,
  createClientFactory = createClient,
  env = process.env,
} = {}) {
  return async function runLoadProbe({
    roomCode = 'POKER101',
    memberCount = 100,
    hostNickname = 'Host',
    voterNicknamePrefix = 'Voter',
    observerNicknamePrefix = 'Observer',
  } = {}) {
    if (!supabase) {
      const config = validateRuntimeConfig(env);
      const client = createClientFactory(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      return runLoadProbeWithClient({
        client,
        roomCode,
        memberCount,
        hostNickname,
        voterNicknamePrefix,
        observerNicknamePrefix,
        logger,
        concurrency,
      });
    }

    return runLoadProbeWithClient({
      client: supabase,
      roomCode,
      memberCount,
      hostNickname,
      voterNicknamePrefix,
      observerNicknamePrefix,
      logger,
      concurrency,
    });
  };
}

async function runLoadProbeWithClient({
  client,
  roomCode,
  memberCount,
  hostNickname,
  voterNicknamePrefix,
  observerNicknamePrefix,
  logger,
  concurrency,
}) {
  const joinTimings = [];
  const voteTimings = [];
  const revealTimings = [];
  const createdChannels = [];
  let rejectedJoins = 0;
  let successfulJoins = 0;
  let failedOperations = 0;
  let totalRevealLatencyMs = 0;

  const isExpectedCapacityError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return /room is full|max members|capacity|full/i.test(message);
  };

  async function createRoom() {
    const started = performance.now();
    const snapshot = await client.rpc('create_room', {
      p_name: 'Sprint 24',
      p_nickname: hostNickname,
    });
    successfulJoins += 1;
    joinTimings.push({ phase: 'host-create', durationMs: performance.now() - started });
    return snapshot;
  }

  async function joinMember(p_nickname, p_role) {
    const started = performance.now();
    try {
      const snapshot = await client.rpc('join_room', {
        p_code: roomCode,
        p_nickname,
        p_role,
      });
      successfulJoins += 1;
      joinTimings.push({ phase: p_role, durationMs: performance.now() - started, nickname: p_nickname });
      return snapshot;
    } catch (error) {
      rejectedJoins += 1;
      if (!isExpectedCapacityError(error)) {
        failedOperations += 1;
      }
      logger.warn?.(`Rejected join request for ${p_nickname}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async function subscribeForRoom(roomId) {
    const channel = client.channel(`room:${roomId}`);
    createdChannels.push(channel);
    const subscription = await channel.subscribe();
    if (subscription.status !== 'SUBSCRIBED') {
      throw new Error(`Realtime subscription did not establish for room ${roomId}`);
    }
    return channel;
  }

  const room = await createRoom();
  const roomId = room?.room?.id ?? room?.id ?? 'room-local';
  const channel = await subscribeForRoom(roomId);

  const requestedMembers = Number(memberCount) || 100;
  const targetMembers = Math.min(Math.max(1, requestedMembers), 100);
  const guestJoinCount = Math.max(0, targetMembers - 1);
  const joinTargets = [];
  for (let index = 0; index < guestJoinCount; index += 1) {
    const isObserver = index >= 90;
    joinTargets.push({
      nickname: isObserver ? `${observerNicknamePrefix} ${index - 89}` : `${voterNicknamePrefix} ${index + 1}`,
      role: isObserver ? 'observer' : 'voter',
    });
  }

  for (let index = 0; index < joinTargets.length; index += concurrency) {
    const batch = joinTargets.slice(index, index + concurrency);
    const results = await Promise.allSettled(batch.map(({ nickname, role }) => joinMember(nickname, role)));
    const failedBatch = results.filter((result) => result.status === 'rejected');
    if (failedBatch.length > 0) {
      failedOperations += failedBatch.length;
    }
  }

  if (requestedMembers >= 100) {
    try {
      await joinMember(`${voterNicknamePrefix} 101`, 'voter');
    } catch (error) {
      logger.log(`Room capacity confirmation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (successfulJoins < 1 || successfulJoins > 100) {
    throw new Error(`Unexpected member count: ${successfulJoins} successful members observed.`);
  }

  const voteStarted = performance.now();
  const votedSnapshot = await client.rpc('submit_vote', {
    p_room_id: roomId,
    p_round_id: room.round?.id ?? room.round_id ?? 'round-1',
    p_value: '5',
  });
  voteTimings.push({ phase: 'vote', durationMs: performance.now() - voteStarted, nickname: hostNickname });
  if (!votedSnapshot || !votedSnapshot.myVote) {
    throw new Error('Vote submission did not return a valid vote snapshot.');
  }

  const revealStarted = performance.now();
  const revealed = await client.rpc('reveal_round', {
    p_room_id: roomId,
    p_round_id: room.round?.id ?? room.round_id ?? 'round-1',
  });
  totalRevealLatencyMs = performance.now() - revealStarted;
  revealTimings.push({ phase: 'reveal', durationMs: totalRevealLatencyMs, members: successfulJoins });

  if (!revealed || revealed.round?.status !== 'revealed') {
    throw new Error('Room reveal did not transition to revealed state.');
  }

  if (revealed.distribution && revealed.distribution['5'] !== successfulJoins) {
    throw new Error('Hidden vote leaked before reveal or distribution count is inconsistent.');
  }

  await channel.unsubscribe();

  const summary = {
    success: failedOperations === 0 && rejectedJoins <= 1,
    joinedMembers: successfulJoins,
    rejectedJoins,
    failedOperations,
    joinLatencyMs: joinTimings.length ? joinTimings.reduce((sum, entry) => sum + entry.durationMs, 0) / joinTimings.length : 0,
    voteLatencyMs: voteTimings.length ? voteTimings.reduce((sum, entry) => sum + entry.durationMs, 0) / voteTimings.length : 0,
    revealLatencyMs: revealTimings.length ? revealTimings.reduce((sum, entry) => sum + entry.durationMs, 0) / revealTimings.length : 0,
    createdChannels: createdChannels.length,
  };

  logger.log(
    `Load probe summary: ${summary.joinedMembers} members joined, ${summary.rejectedJoins} rejected, ${summary.joinLatencyMs.toFixed(1)} ms join latency, ${summary.voteLatencyMs.toFixed(1)} ms vote latency, ${summary.revealLatencyMs.toFixed(1)} ms reveal latency.`,
  );

  return summary;
}

export async function runLoadProbe() {
  const config = validateRuntimeConfig(process.env);
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const probe = createLoadProbe({ supabase: client });
  return probe({ roomCode: process.env.ROOM_CODE || 'POKER101', memberCount: Number(process.env.MEMBER_COUNT || 100) });
}

const isDirectExecution = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  runLoadProbe()
    .then((result) => {
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
