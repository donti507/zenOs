import { Suspense, useEffect, useState, type ReactNode } from 'react';

/** Delay loading until first use, then retain state and allow close effects/animations. */
export default function OnFirstOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(open);
  useEffect(() => { if (open) setOpened(true); }, [open]);
  return open || opened ? <Suspense fallback={null}>{children}</Suspense> : null;
}
