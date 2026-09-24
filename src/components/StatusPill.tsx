import type { ReactNode } from 'react';

export type StatusPillTone = 'neutral' | 'success' | 'warning' | 'danger';

export type StatusPillProps = {
  tone: StatusPillTone;
  children: ReactNode;
};

export function StatusPill({ tone, children }: StatusPillProps) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}
