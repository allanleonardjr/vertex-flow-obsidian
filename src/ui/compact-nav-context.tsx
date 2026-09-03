/**
 * Compact-pane drawer state.
 *
 * When a pane is narrower than the compact breakpoint (`@container 520px` on
 * `.vf-shell`) the persistent left sidebar and the task/project property rail
 * are replaced by two overlay drawers, opened from a slim toggle strip
 * (`[Navigation ..... Properties]`) pinned above the tab strip. This context is
 * the single source of truth for which drawer is open.
 *
 * The two drawers are mutually exclusive by design — opening one closes the
 * other — so there's never more than one backdrop at a time. In wide panes this
 * context is inert: the strip is `display:none` and the drawers are positioned
 * off-screen, so nothing here disturbs the normal sidebar / editor-rail layout.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface CompactNavCtxValue {
  /** Navigation (left) drawer open. */
  navOpen: boolean;
  /** Properties (right) drawer open. */
  propertiesOpen: boolean;
  openNav: () => void;
  openProperties: () => void;
  /** Toggle a specific drawer; opening one closes the other. */
  toggleNav: () => void;
  toggleProperties: () => void;
  /** Close both drawers. */
  closeDrawers: () => void;
}

const CompactNavCtx = createContext<CompactNavCtxValue | null>(null);

export function CompactNavProvider({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  const openNav = useCallback(() => {
    setNavOpen(true);
    setPropertiesOpen(false);
  }, []);
  const openProperties = useCallback(() => {
    setPropertiesOpen(true);
    setNavOpen(false);
  }, []);
  const closeDrawers = useCallback(() => {
    setNavOpen(false);
    setPropertiesOpen(false);
  }, []);
  const toggleNav = useCallback(() => {
    setNavOpen((open) => {
      if (open) return false;
      setPropertiesOpen(false);
      return true;
    });
  }, []);
  const toggleProperties = useCallback(() => {
    setPropertiesOpen((open) => {
      if (open) return false;
      setNavOpen(false);
      return true;
    });
  }, []);

  const value = useMemo(
    () => ({
      navOpen,
      propertiesOpen,
      openNav,
      openProperties,
      toggleNav,
      toggleProperties,
      closeDrawers,
    }),
    [
      navOpen,
      propertiesOpen,
      openNav,
      openProperties,
      toggleNav,
      toggleProperties,
      closeDrawers,
    ],
  );

  return (
    <CompactNavCtx.Provider value={value}>{children}</CompactNavCtx.Provider>
  );
}

export function useCompactNav(): CompactNavCtxValue {
  const ctx = useContext(CompactNavCtx);
  if (!ctx) {
    throw new Error("useCompactNav must be used inside <CompactNavProvider>");
  }
  return ctx;
}