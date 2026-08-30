import type { Session } from "@hypertracker/shared/auth/session";
import { useEffect, useRef, useState } from "react";
import { PriceTicker } from "./PriceTicker.js";
import "./header.css";

interface HeaderProps {
  session: Session;
  onSignOut: () => void;
  onOpenSubscription: () => void;
  onOpenGuide: () => void;
}

export function Header({ session, onSignOut, onOpenSubscription, onOpenGuide }: HeaderProps) {
  const displayName = session.username ? `@${session.username}` : (session.firstName ?? "Trader");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Starts false and only ever flips true on a real onLoad — the letter is the base layer
  // underneath, always rendered, so there is never a gap where neither shows. Telegram's
  // Login Widget photo_url is known to sometimes point at a dead/expired CDN link (404), so
  // relying on the photo alone (even with onError) risks an empty state if that fires late
  // or not at all.
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = (session.firstName ?? session.username ?? "?").charAt(0).toUpperCase();

  useEffect(() => {
    if (!isMenuOpen) return;
    function handlePointerDown(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setIsMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <header className="ht-header">
      <span className="ht-header-title">DeepSight</span>
      <PriceTicker />

      <div className="ht-header-user" ref={menuRef}>
        <span className="ht-header-name">{displayName}</span>
        <button
          type="button"
          className="ht-avatar-btn"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label="Account menu"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <div className="ht-avatar-stack">
            <div className="ht-avatar ht-avatar-fallback" aria-hidden="true">
              {initial}
            </div>
            {session.photoUrl && (
              <img
                className="ht-avatar ht-avatar-photo"
                style={{ opacity: photoLoaded ? 1 : 0 }}
                src={session.photoUrl}
                alt=""
                width={40}
                height={40}
                onLoad={() => setPhotoLoaded(true)}
              />
            )}
          </div>
        </button>

        {isMenuOpen && (
          <div className="ht-account-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="ht-account-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                onOpenGuide();
              }}
            >
              Guide
            </button>
            <button
              type="button"
              role="menuitem"
              className="ht-account-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                onOpenSubscription();
              }}
            >
              Subscription
            </button>
            <button
              type="button"
              role="menuitem"
              className="ht-account-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
