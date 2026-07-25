import { create } from 'zustand';

export interface UndoEntry {
  id: string;
  message: string;
  onUndo: () => void;
  expiresAt: number;
}

interface UndoState {
  toasts: UndoEntry[];
  addToast: (message: string, onUndo: () => void) => string;
  removeToast: (id: string) => void;
}

export const useUndoStore = create<UndoState>((set) => ({
  toasts: [],
  addToast: (message, onUndo) => {
    const id = Math.random().toString(36).substring(2, 9);
    const expiresAt = Date.now() + 5000;
    set((state) => ({
      toasts: [...state.toasts, { id, message, onUndo, expiresAt }],
    }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
    return id;
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
