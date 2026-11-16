import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AddFriendSheet } from '../screens/social/AddFriendSheet';

const AddFriendContext = createContext<() => void>(() => {});

/** Owns the Add friend sheet, so Profile, Friends and Activity open the same one through `useAddFriend`. */
export function AddFriendProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSheet = useCallback(() => setOpen(true), []);
  return (
    <AddFriendContext.Provider value={openSheet}>
      {children}
      {open && <AddFriendSheet onClose={() => setOpen(false)} />}
    </AddFriendContext.Provider>
  );
}

/** Opens the Add friend sheet. */
export const useAddFriend = (): (() => void) => useContext(AddFriendContext);
