'use client';

import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose: (id: string) => void;
}

export function Toast({ id, message, type, duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const typeStyles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const icons = {
    success: <CheckCircle size={20} className="text-green-600 flex-shrink-0" />,
    error: <XCircle size={20} className="text-red-600 flex-shrink-0" />,
    warning: <AlertCircle size={20} className="text-yellow-600 flex-shrink-0" />,
    info: <AlertCircle size={20} className="text-blue-600 flex-shrink-0" />,
  };

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border-2 shadow-lg min-w-[300px] max-w-md animate-slide-in ${typeStyles[type]}`}
    >
      {icons[type]}
      <p className="flex-1 text-sm font-medium whitespace-pre-line">{message}</p>
      <button
        onClick={() => onClose(id)}
        className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        aria-label="Close"
      >
        <X size={18} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts }: { toasts: ToastProps[] }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </div>
    </div>
  );
}
