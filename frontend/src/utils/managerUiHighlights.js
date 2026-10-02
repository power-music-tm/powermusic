/** Re-export shared highlight helpers for manager request history. */
export {
  ADMIN_NEW_ROW_HIGHLIGHT_CLASS as MANAGER_UPDATE_HIGHLIGHT_CLASS,
  countManagerHandledRequestUnseen,
  countManagerPendingUnseen,
  dismissAllManagerHandledHighlights,
  dismissManagerPendingHighlights,
  isManagerHandledRequestUnseen,
  isManagerPendingRequestUnseen,
  markManagerHandledRequestUnseen,
  markManagerHandledRequestViewed,
  registerManagerHandledPageVisit,
  syncManagerHandledHighlights,
  syncManagerPendingHighlights,
} from './adminUiHighlights';
