import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Toast from './Toast.jsx';

const MAX_TOASTS = 5;

const ToastContext = createContext({ addToast: () => {}, dismissToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ addToast, dismissToast }), [addToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false">
        <Toast toasts={toasts} onDismiss={dismissToast} />
      </div>
    </ToastContext.Provider>
  );
}
