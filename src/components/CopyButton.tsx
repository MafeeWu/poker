import { useEffect, useState } from 'react';

export type CopyButtonProps = {
  value: string;
  label?: string;
};

export function CopyButton({ value, label = 'Copy link' }: CopyButtonProps) {
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const handle = window.setTimeout(() => setFeedback(null), 1500);
    return () => window.clearTimeout(handle);
  }, [feedback]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('copied');
    } catch {
      setFeedback('error');
    }
  };

  return (
    <div className="copy-button-wrap">
      <button type="button" className="copy-button" onClick={handleCopy}>
        {label}
      </button>
      {feedback ? (
        <span role="status" aria-live="polite" aria-atomic="true" className="copy-feedback">
          {feedback === 'copied' ? 'Copied' : 'Unable to copy link'}
        </span>
      ) : null}
    </div>
  );
}
