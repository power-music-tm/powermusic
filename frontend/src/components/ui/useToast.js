import { useState, useEffect, useCallback } from 'react';

let listeners = [];
let toasts = [];

const toastState = {
  getToasts: () => toasts,
  addToast: (message, type = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    toasts = [...toasts, { id, message, type }];
    listeners.forEach((listener) => listener(toasts));
    
    // Auto dismiss after 4 seconds
    setTimeout(() => {
      toastState.dismissToast(id);
    }, 4000);
  },
  dismissToast: (id) => {
    toasts = toasts.filter((t) => t.id !== id);
    listeners.forEach((listener) => listener(toasts));
  },
  clearToasts: () => {
    toasts = [];
    listeners.forEach((listener) => listener(toasts));
  },
};

export function useToast() {
  const [localToasts, setLocalToasts] = useState(toasts);

  useEffect(() => {
    listeners.push(setLocalToasts);
    return () => {
      listeners = listeners.filter((l) => l !== setLocalToasts);
    };
  }, []);

  const showToast = useCallback((message, type) => {
    toastState.addToast(message, type);
  }, []);

  const dismissToast = useCallback((id) => {
    toastState.dismissToast(id);
  }, []);

  const clearToasts = useCallback(() => {
    toastState.clearToasts();
  }, []);

  return {
    toasts: localToasts,
    showToast,
    dismissToast,
    clearToasts,
  };
}
