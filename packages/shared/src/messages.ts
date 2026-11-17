import type { Category, SourceId } from './types';
import type { PublicUser } from './social';

/** Phase 6 (docs/plans/2026-11-17-phase6-messages.md, M1-M9). */
export const MESSAGE_MAX = 2000;
/** A group holds at most this many members, you included. */
export const GROUP_MAX = 20;
export const GROUP_NAME_MAX = 60;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Messages per page, and sent per minute per user (429 beyond it). */
export const MESSAGES_PAGE = 50;
export const MESSAGE_RATE_PER_MIN = 30;
/** Recommended-to-you list length. */
export const RECOMMENDED_MAX = 100;

export type ConversationKind = 'direct' | 'group';
export type MessageKind = 'text' | 'image' | 'rec';

/** The title a recommendation carries (M7): a snapshot, so it survives the sender editing or deleting the entry. */
export interface RecSnapshot {
  category: Category;
  title: string;
  creator: string | null;
  coverUrl: string;
  /** The sender's rating, if any. */
  rating: number | null;
  source: SourceId | null;
  sourceId: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  /** The text, or a recommendation's note. '' once deleted. */
  text: string;
  rec: RecSnapshot | null;
  /** A picture message: fetch GET /api/messages/:id/image. */
  image: boolean;
  /** Soft-deleted by its sender: text, rec and picture are gone. */
  deleted: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Groups only; null for a direct chat or an unnamed group. */
  name: string | null;
  createdBy: string;
  createdAt: string;
  /** Active members, you included. */
  members: PublicUser[];
  /** A direct chat whose two people are no longer friends: reading only. */
  readOnly: boolean;
}

export interface LastMessage {
  kind: MessageKind;
  /** A snippet (80 characters at most); '' for a picture or a deleted message. */
  text: string;
  senderId: string;
  deleted: boolean;
  createdAt: string;
}

export interface ConversationSummary extends Conversation {
  last: LastMessage | null;
  lastMessageAt: string;
  unread: boolean;
}

export interface ConversationList {
  conversations: ConversationSummary[];
}

export interface MessagePage {
  /** Newest first. */
  messages: Message[];
  users: Record<string, PublicUser>;
  /** Pass as `before` for the next (older) page; null on the last page. */
  next: string | null;
  readOnly: boolean;
}

export interface RecommendedItem {
  message: Message;
  sender: PublicUser;
}
