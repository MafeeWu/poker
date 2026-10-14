import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const container = process.env.POKER_DB_CONTAINER || 'supabase_db_poker-mvp-local';
if (!/^supabase_db_[a-zA-Z0-9_-]+$/.test(container)) {
  throw new Error('Concurrency checks require a local Supabase database container.');
}

function session(name) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']);
  let current;
  let sequence = 0;
  let stderr = '';
  let exited = false;
  const finished = new Promise((resolve) => {
    child.on('close', () => {
      exited = true;
      current?.reject(new Error(stderr.trim() || 'Database session closed'));
      current = undefined;
      resolve();
    });
  });
  child.on('error', (error) => current?.reject(error));
  child.stderr.on('data', (data) => { stderr += data; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!current) return;
    if (line === current.marker) {
      current.resolve(current.lines);
      current = undefined;
    } else {
      current.lines.push(line);
    }
  });
  const query = (sql) => new Promise((resolve, reject) => {
    assert.ok(!current, 'Each actor issues one command at a time');
    if (exited) return reject(new Error(stderr.trim() || 'Database session closed'));
    const marker = `done_${++sequence}`;
    current = { marker, lines: [], resolve, reject };
    child.stdin.write(`${sql}\n\\echo ${marker}\n`);
  });
  const ready = query(`SET application_name = '${name}'; SET statement_timeout = '8s';`);
  return {
    query,
    ready,
    async close() {
      if (!exited) child.stdin.end('\\q\n');
      await finished;
      lines.close();
    },
  };
}

function asUser(user) {
  return `SET ROLE authenticated; SET request.jwt.claim.sub = '${user}';`;
}

async function runScenario(order) {
  const prefix = `poker_lock_${randomUUID().replaceAll('-', '')}`;
  const admin = session(`${prefix}_admin`);
  const blocker = session(`${prefix}_blocker`);
  const next = session(`${prefix}_next`);
  const other = session(`${prefix}_other`);
  const hostUser = randomUUID();
  const targetUser = randomUUID();
  let roomId;
  const tasks = [];
  try {
    await Promise.all([admin.ready, blocker.ready, next.ready, other.ready]);
    const created = JSON.parse((await admin.query(`${asUser(hostUser)}
      SELECT public.create_room('Round lock regression', 'Lock Host'); RESET ROLE;`))[0]);
    roomId = created.room.id;
    const roundId = created.round.id;
    const hostId = created.myMemberId;
    const joined = JSON.parse((await admin.query(`${asUser(targetUser)}
      SELECT public.join_room('${created.room.code}', 'Lock Target', 'voter'); RESET ROLE;`))[0]);
    assert.equal(joined.members.find((member) => member.id === joined.myMemberId).role, 'voter');
    await admin.query(`${asUser(hostUser)}
      SELECT public.reveal_round('${roomId}', '${roundId}'); RESET ROLE;`);
    await next.query(asUser(hostUser));
    await other.query(asUser(targetUser));

    const waitForLock = async (actor) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [waiting] = await admin.query(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE application_name = '${prefix}_${actor}'
          AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0
        );`);
        if (waiting === 't') return;
        await delay(10);
      }
      throw new Error(`${order}: ${actor} did not reach the expected lock barrier`);
    };
    const start = (actor, sql) => {
      // Attach rejection handling immediately while another session observes its lock.
      const task = actor.query(sql).then((lines) => ({ lines }), (error) => ({ error }));
      tasks.push(task);
      return task;
    };
    const nextSql = `SELECT public.complete_round_and_start_next_round('${roomId}', '${roundId}', '8', 'Concurrent result');`;
    const otherNextSql = `SELECT public.complete_round_and_start_next_round('${roomId}', '${roundId}', '13', 'Late member result');`;
    let nextTask;
    let otherTask;
    if (order === 'host-first' || order === 'voter-first') {
      await blocker.query(`BEGIN; SELECT id FROM public.rounds WHERE id = '${roundId}' FOR UPDATE;`);
      if (order === 'voter-first') {
        await next.query(asUser(targetUser));
        await other.query(asUser(hostUser));
      }
      nextTask = start(next, nextSql);
      await waitForLock('next');
      otherTask = start(other, otherNextSql);
      await waitForLock('other');
    } else {
      await next.query(asUser(targetUser));
      await other.query(asUser(hostUser));
      await blocker.query(`BEGIN; SELECT id FROM public.room_members WHERE id = '${hostId}' FOR UPDATE;`);
      otherTask = start(other, `BEGIN; SELECT public.leave_room('${roomId}', '${hostId}'); ROLLBACK;`);
      await waitForLock('other');
      nextTask = start(next, nextSql);
      await waitForLock('next');
    }
    await blocker.query('COMMIT;');
    const [nextResult, otherResult] = await Promise.all([nextTask, otherTask]);
    assert.ifError(otherResult.error);
    assert.ifError(nextResult.error);

    const [stateLine] = await admin.query(`SELECT jsonb_build_object(
      'host', (SELECT host_member_id FROM public.rooms WHERE id = '${roomId}'),
      'hosts', (SELECT count(*) FROM public.room_members WHERE room_id = '${roomId}' AND role = 'host'),
      'rounds', (SELECT jsonb_agg(jsonb_build_object('status', status, 'estimate', final_estimate, 'note', note)
        ORDER BY round_number) FROM public.rounds WHERE room_id = '${roomId}')
    );`);
    const state = JSON.parse(stateLine);
    assert.equal(state.host, hostId);
    assert.equal(state.hosts, 1);
    assert.deepEqual(state.rounds,
      [{ status: 'archived', estimate: '8', note: 'Concurrent result' }, { status: 'voting', estimate: null, note: null }]);
    const retry = JSON.parse((await admin.query(`${asUser(targetUser)}
      SELECT public.complete_round_and_start_next_round('${roomId}', '${roundId}', '13', 'Safe retry'); RESET ROLE;`))[0]);
    assert.equal(retry.round.number, 2);
    assert.equal(retry.recentRounds[0].finalEstimate, '8');
    assert.equal(retry.recentRounds[0].note, 'Concurrent result');
    assert.equal(retry.members.filter((member) => member.role === 'host').length, 1);
    console.log(`PASS ${order}: independent members, no deadlock, unchanged host and atomic round/retry invariants`);
  } finally {
    // Release barriers before draining actors, then remove only this run's fixture.
    await blocker.close();
    await Promise.all(tasks);
    await Promise.all([next.close(), other.close()]);
    if (roomId) await admin.query(`RESET ROLE; DELETE FROM public.rooms WHERE id = '${roomId}';`);
    await admin.close();
  }
}

for (const order of ['host-first', 'voter-first', 'leave-first']) await runScenario(order);
