import { StatusPill } from '../../components/StatusPill';

export type ConnectionStatusValue = 'connecting' | 'connected' | 'reconnecting' | 'error';

export function ConnectionStatus({ status }: { status: ConnectionStatusValue }) {
  const labels: Record<ConnectionStatusValue, string> = {
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    error: 'Connection error',
  };

  const tones: Record<ConnectionStatusValue, 'neutral' | 'success' | 'warning' | 'danger'> = {
    connecting: 'neutral',
    connected: 'success',
    reconnecting: 'warning',
    error: 'danger',
  };

  return (
    <div data-testid="connection-status" aria-live="polite">
      <StatusPill tone={tones[status]}>{labels[status]}</StatusPill>
    </div>
  );
}
