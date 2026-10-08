import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';
import { createOnlineRoomFixture } from './room-fixtures.mjs';
import { loadE2EEnv, verifyLocalSupabase } from './supabase-env.mjs';

const EXPECTED_MEMBER_COUNT = 100;
const VOTER_COUNT = 90;
const OBSERVER_COUNT = 9;
const VOTE_VALUE = '5';

export function validateRuntimeConfig(env = process.env) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter((key) => !env[key] || !String(env[key]).trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase runtime configuration: ${missing.join(', ')}. Set SUPABASE_URL and SUPABASE_ANON_KEY before running the room load probe.`,
    );
  }

  const config = {
    SUPABASE_URL: String(env.SUPABASE_URL).trim(),
    SUPABASE_ANON_KEY: String(env.SUPABASE_ANON_KEY).trim(),
  };
  let parsedUrl;
  try {
    parsedUrl = new URL(config.SUPABASE_URL);
  } catch {
    throw new Error('The room load probe requires a valid local Supabase HTTP URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, ''))) {
    throw new Error('The room load probe requires local Supabase at a loopback URL.');
  }

  return config;
}

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

function expectedVoteDistribution(snapshot) {
  return snapshot?.distribution
    && typeof snapshot.distribution === 'object'
    && snapshot.distribution[VOTE_VALUE] === VOTER_COUNT + 1
    && Object.values(snapshot.distribution).reduce((total, count) => total + count, 0) === VOTER_COUNT + 1;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function subscribe(channel, description, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${description} subscription timed out after ${timeoutMs} ms.`)), timeoutMs);
    try {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(new Error(`${description} subscription failed: ${error?.message || status}`));
        }
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function countFailedOperations(error) {
  if (error instanceof AggregateError) {
    return error.errors.reduce((count, child) => count + countFailedOperations(child), 0);
  }
  return 1;
}

export function createLoadProbe({
  logger = console,
  concurrency = 10,
  createClientFactory = createClient,
  env = process.env,
  propagationTimeoutMs = 30_000,
  subscriptionTimeoutMs = 10_000,
} = {}) {
  return async function runLoadProbe({
    roomCode: expectedRoomCode = env.ROOM_CODE,
    memberCount = Number(env.MEMBER_COUNT ?? EXPECTED_MEMBER_COUNT),
    hostNickname = 'Host',
    voterNicknamePrefix = 'Voter',
    observerNicknamePrefix = 'Observer',
  } = {}) {
    if (memberCount !== EXPECTED_MEMBER_COUNT) {
      throw new Error(`The load probe requires exactly 100 members; received ${memberCount}.`);
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
      throw new Error('Load probe concurrency must be an integer from 1 through 10.');
    }
    if (!Number.isInteger(propagationTimeoutMs) || propagationTimeoutMs < 1) {
      throw new Error('Reveal propagation timeout must be a positive integer.');
    }

    const config = validateRuntimeConfig(env);
    let fixture;
    try {
      fixture = await createOnlineRoomFixture({
        createClientFactory,
        url: config.SUPABASE_URL,
        anonKey: config.SUPABASE_ANON_KEY,
        voterCount: VOTER_COUNT,
        observerCount: OBSERVER_COUNT,
        memberCount: EXPECTED_MEMBER_COUNT,
        concurrency,
        hostNickname,
        voterNicknamePrefix,
        observerNicknamePrefix,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Load probe failed: ${countFailedOperations(error)} failed operation(s). ${message}`, { cause: error });
    }

    const channels = [];
    let capacityClient;
    let capacityMemberId;
    let result;
    let primaryError;
    const voteLatencyMs = [];
    const revealWaits = [];
    let revealStartedAt = 0;

    try {
      if (expectedRoomCode && String(expectedRoomCode).trim().toUpperCase() !== fixture.room.code) {
        throw new Error(`Created room ${fixture.room.code} does not match requested ROOM_CODE ${expectedRoomCode}.`);
      }

      capacityClient = createClientFactory(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const capacitySession = unwrap(await capacityClient.auth.signInAnonymously(), '101st member anonymous sign-in');
      if (!capacitySession.user?.id) {
        throw new Error('101st member anonymous sign-in returned no user.');
      }

      const rejectedJoin = await capacityClient.rpc('join_room', {
        p_code: fixture.room.code,
        p_nickname: 'Capacity check 101',
        p_role: 'voter',
      });
      if (!rejectedJoin?.error) {
        capacityMemberId = rejectedJoin?.data?.myMemberId;
        throw new Error('The 101st member unexpectedly joined a room with 100 online members.');
      }
      if (!/room is full/i.test(String(rejectedJoin.error.message || rejectedJoin.error))) {
        throw new Error(`The 101st join failed for an unexpected reason: ${rejectedJoin.error.message || String(rejectedJoin.error)}`);
      }

      const roundId = fixture.round.id;
      for (const member of fixture.members) {
        const observedReveal = deferred();
        const channel = member.client.channel(`room:${fixture.room.id}:${member.id}`);
        channels.push(channel);
        channel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `id=eq.${roundId}` },
          () => {
            void member.client.rpc('build_room_snapshot', {
              p_room_id: fixture.room.id,
              p_user_id: member.userId,
            }).then((response) => {
              const snapshot = unwrap(response, `Reveal snapshot for ${member.nickname}`);
              if (snapshot.round?.status !== 'revealed' || !expectedVoteDistribution(snapshot)) {
                throw new Error(`${member.nickname} did not receive the complete revealed distribution.`);
              }
              observedReveal.resolve({
                memberId: member.id,
                observedAt: performance.now(),
                distribution: snapshot.distribution,
              });
            }).catch((error) => observedReveal.reject(error));
          },
        );
        await subscribe(channel, `Room channel for ${member.nickname}`, subscriptionTimeoutMs);
        revealWaits.push(observedReveal.promise);
      }

      const maxConcurrentVotes = Math.min(concurrency, 10);
      for (let offset = 0; offset < fixture.members.length; offset += maxConcurrentVotes) {
        const batch = fixture.members.slice(offset, offset + maxConcurrentVotes).filter(({ role }) => role !== 'observer');
        const settled = await Promise.allSettled(batch.map(async (member) => {
          const startedAt = performance.now();
          const response = unwrap(await member.client.rpc('submit_vote', {
            p_room_id: fixture.room.id,
            p_round_id: roundId,
            p_value: VOTE_VALUE,
          }), `Vote submission for ${member.nickname}`);
          const duration = performance.now() - startedAt;
          if (response.myVote !== VOTE_VALUE) {
            throw new Error(`${member.nickname}'s vote was not returned in their snapshot.`);
          }
          voteLatencyMs.push(duration);
        }));
        const failures = settled.filter((entry) => entry.status === 'rejected');
        if (failures.length > 0) {
          throw new AggregateError(failures.map(({ reason }) => reason), 'One or more vote submissions failed.');
        }
      }

      const hiddenSnapshotResults = await Promise.all(fixture.members.map(async (member) => {
        const { data, error } = await member.client.rpc('build_room_snapshot', {
          p_room_id: fixture.room.id,
          p_user_id: member.userId,
        });
        if (error) {
          throw new Error(`Pre-Reveal snapshot for ${member.nickname} failed: ${error.message || String(error)}`);
        }
        return { member, snapshot: data };
      }));
      for (const { member, snapshot } of hiddenSnapshotResults) {
        const expectedOwnVote = member.role === 'observer' ? null : VOTE_VALUE;
        if (snapshot?.round?.status !== 'voting' || snapshot.distribution !== null || snapshot.myVote !== expectedOwnVote) {
          throw new Error(`A hidden vote value was exposed in ${member.nickname}'s pre-Reveal snapshot.`);
        }
      }

      fixture.assertHealthy();
      revealStartedAt = performance.now();
      const revealed = unwrap(await fixture.members[0].client.rpc('reveal_round', {
        p_room_id: fixture.room.id,
        p_round_id: roundId,
      }), 'Reveal round');
      const revealRpcLatencyMs = performance.now() - revealStartedAt;
      if (revealed.round?.status !== 'revealed' || !expectedVoteDistribution(revealed)) {
        throw new Error('The host did not receive the complete revealed vote distribution.');
      }

      let propagationTimeout;
      const timedOut = new Promise((_, reject) => {
        propagationTimeout = setTimeout(
          () => reject(new Error(`Reveal did not propagate to all 100 members within ${propagationTimeoutMs} ms.`)),
          propagationTimeoutMs,
        );
      });
      let propagated;
      try {
        propagated = await Promise.race([Promise.all(revealWaits), timedOut]);
      } finally {
        clearTimeout(propagationTimeout);
      }
      if (propagated.length !== EXPECTED_MEMBER_COUNT) {
        throw new Error(`Reveal reached ${propagated.length} members; expected exactly 100.`);
      }

      fixture.assertHealthy();
      const successfulJoinLatencies = fixture.members.map(({ joinLatencyMs }) => joinLatencyMs);
      result = {
        success: true,
        joinedMembers: fixture.members.length,
        rejectedJoins: 1,
        failedOperations: 0,
        joinLatencyMs: average(successfulJoinLatencies),
        voteLatencyMs: average(voteLatencyMs),
        revealRpcLatencyMs,
        revealLatencyMs: Math.max(...propagated.map(({ observedAt }) => observedAt - revealStartedAt)),
        revealPropagationLatencyMs: Math.max(...propagated.map(({ observedAt }) => observedAt - revealStartedAt)),
        revealedMembers: propagated.length,
        hiddenSnapshotsChecked: hiddenSnapshotResults.length,
        createdChannels: channels.length,
      };
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors = [];
      if (capacityMemberId) {
        try {
          const member = await capacityClient.rpc('leave_room', {
            p_room_id: fixture.room.id,
            p_member_id: capacityMemberId,
          });
          if (member?.error) {
            throw new Error(`Leaving the unexpectedly joined 101st member failed: ${member.error.message || String(member.error)}`);
          }
        } catch (error) {
          if (capacityClient) {
            cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
      const channelCleanup = await Promise.allSettled(
        channels.map((channel) => Promise.resolve().then(() => channel.unsubscribe())),
      );
      cleanupErrors.push(...channelCleanup
        .filter((entry) => entry.status === 'rejected')
        .map(({ reason }) => reason instanceof Error ? reason : new Error(String(reason))));
      if (capacityClient) {
        try {
          const result = await capacityClient.auth.signOut();
          if (result?.error) {
            throw new Error(`Capacity-check sign-out failed: ${result.error.message || String(result.error)}`);
          }
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await fixture.dispose();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
      if (cleanupErrors.length > 0) {
        const cleanupError = new AggregateError(cleanupErrors, 'Load probe cleanup failed.');
        primaryError = primaryError
          ? new AggregateError([primaryError, cleanupError], 'Load probe failed and cleanup was incomplete.')
          : cleanupError;
      }
    }

    if (primaryError) {
      const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
      throw new Error(`Load probe failed: ${countFailedOperations(primaryError)} failed operation(s). ${message}`, {
        cause: primaryError,
      });
    }
    if (!result) {
      throw new Error('Load probe completed without a result.');
    }

    logger.log(
      `Load probe summary: ${result.joinedMembers} online members, ${result.rejectedJoins} capacity rejection, ${result.failedOperations} failed operations, ${result.joinLatencyMs.toFixed(1)} ms average join latency, ${result.voteLatencyMs.toFixed(1)} ms average vote latency, ${result.revealPropagationLatencyMs.toFixed(1)} ms maximum Reveal propagation latency across ${result.revealedMembers} members.`,
    );
    return result;
  };
}

export async function runLoadProbe() {
  loadE2EEnv();
  const config = validateRuntimeConfig(process.env);
  await verifyLocalSupabase({ url: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY });
  const probe = createLoadProbe({ env: { ...process.env, ...config } });
  return probe({
    roomCode: process.env.ROOM_CODE,
    memberCount: Number(process.env.MEMBER_COUNT ?? EXPECTED_MEMBER_COUNT),
  });
}

const isDirectExecution = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  runLoadProbe().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
