'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
  iconSize?: number;
  successDuration?: number;
}

export function CopyButton({
  text,
  className = '',
  iconSize = 16,
  successDuration = 2000
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), successDuration);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`transition-colors ${className}`}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? (
        <Check size={iconSize} className="text-green-600" />
      ) : (
        <Copy size={iconSize} className="text-gray-400 hover:text-purple-600" />
      )}
    </button>
  );
}
