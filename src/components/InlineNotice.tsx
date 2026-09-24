import type { ReactNode } from 'react';

export type InlineNoticeTone = 'info' | 'error' | 'success';

export type InlineNoticeProps = {
  tone: InlineNoticeTone;
  title: string;
  children?: ReactNode;
};

export function InlineNotice({ tone, title, children }: InlineNoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role="status" aria-live="polite">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
