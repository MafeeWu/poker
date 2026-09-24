export type ConnectionStatusValue = 'connecting' | 'connected' | 'reconnecting' | 'error';

export function ConnectionStatus({ status }: { status: ConnectionStatusValue }) {
  const labels: Record<ConnectionStatusValue, string> = {
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    error: 'Connection error',
  };

  return <p aria-live="polite">{labels[status]}</p>;
}
