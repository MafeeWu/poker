import { useEffect, useState } from 'react';

export type CopyButtonProps = {
  value: string;
  label?: string;
};

export function CopyButton({ value, label = 'Copy link' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const handle = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(handle);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="copy-button-wrap">
      <button type="button" className="copy-button" onClick={handleCopy}>
        {label}
      </button>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {copied ? 'Copied' : 'Copied'}
      </span>
    </div>
  );
}
