export type OnlineRoomFixtureOptions = {
  createClientFactory?: (url: string, anonKey: string, options: object) => unknown;
  url: string;
  anonKey: string;
  voterCount?: number;
  observerCount?: number;
  memberCount?: number;
  concurrency?: number;
  heartbeatIntervalMs?: number;
  hostNickname?: string;
  voterNicknamePrefix?: string;
  observerNicknamePrefix?: string;
};

export type OnlineRoomFixture = {
  room: { id: string; code: string; maxMembers?: number };
  round: { id: string };
  members: Array<{
    client: unknown;
    userId: string;
    id: string;
    roomId: string;
    nickname: string;
    role: 'host' | 'voter' | 'observer';
    online: boolean;
    joinLatencyMs: number;
  }>;
  heartbeat(): Promise<void>;
  assertHealthy(): void;
  dispose(): Promise<void>;
};

export function createOnlineRoomFixture(options: OnlineRoomFixtureOptions): Promise<OnlineRoomFixture>;
