import type { Category, SourceId } from './types';
import type { PublicUser } from './social';

/** Phase 6 (docs/plans/2026-11-17-phase6-messages.md, M1-M9). */
export const MESSAGE_MAX = 2000;
/** A group holds at most this many members, you included. */
export const GROUP_MAX = 20;
export const GROUP_NAME_MAX = 60;
/** A photo after the phone/PC has resized and compressed it (longest side 1600 px, quality about 0.8). */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Voice memos: at most 2 minutes and 1 MB (about 24-32 kbps Opus or AAC is well under it). */
export const VOICE_MAX_BYTES = 1024 * 1024;
export const VOICE_MAX_MS = 120_000;
/** What MediaRecorder makes: WebM/Opus (Chrome, Android, Firefox), MP4/AAC (iPhone Safari), Ogg/Opus (older Firefox). */
export const VOICE_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg'] as const;
/** Media retention (admin, Settings > Media): files older than this many months are removed, and each person keeps at most capMb. */
export const MEDIA_RETENTION_RANGE = { min: 1, max: 24 } as const;
export const MEDIA_CAP_MB_RANGE = { min: 10, max: 10_000 } as const;
/** Messages per page, and sent per minute per user (429 beyond it). */
export const MESSAGES_PAGE = 50;
export const MESSAGE_RATE_PER_MIN = 30;
/** Recommended-to-you list length. */
export const RECOMMENDED_MAX = 100;

export type ConversationKind = 'direct' | 'group';
export type MessageKind = 'text' | 'image' | 'rec' | 'voice';

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
  /** The sender's own entry for this title, when it was shared from one of their lists (checked by the server); lets the card open it. */
  entryId?: string;
}

/** The message a reply answers, as the quote above the reply shows it (one batched join, no extra query per message). */
export interface ReplyInfo {
  /** The original message's id (the quote scrolls to it when it is loaded). */
  id: string;
  /** '' when the original was deleted. */
  senderId: string;
  /** Display name or @username of the original's sender; '' when deleted. */
  senderName: string;
  kind: MessageKind;
  /** One line (100 characters at most): the text, a recommendation's title, '' for a picture, a voice memo or a deleted message. */
  snippet: string;
  /** The original was deleted (or is gone): the quote reads "Original message deleted". */
  deleted: boolean;
}

/** One person's reaction to a message (one per person per message). */
export interface MessageReaction {
  userId: string;
  /** One emoji (isReaction: the activity reactions' rule). */
  emoji: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  /** The text, or a recommendation's note. '' once deleted. */
  text: string;
  rec: RecSnapshot | null;
  /** A picture message whose file is still there: fetch GET /api/messages/:id/media. */
  image: boolean;
  /** A voice memo whose file is still there (GET /api/messages/:id/media), with its length; null/absent otherwise. */
  voice?: { durationMs: number } | null;
  /** A photo or voice memo whose file was cleaned up (older than the admin's months, or over its sender's storage cap). */
  expired?: boolean;
  /** Soft-deleted by its sender: text, rec and picture are gone. */
  deleted: boolean;
  /** The message this one replies to; null when it is not a reply (or it was deleted itself). */
  replyTo: ReplyInfo | null;
  /** Reactions of the chat's active members, oldest first; [] (or absent) when none, and always none once deleted. */
  reactions?: MessageReaction[];
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
  /** A recommendation's title (the preview reads "Recommended <title>"). */
  recTitle?: string | null;
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
  /** Not read yet: its chat has not been opened since it arrived. "Recommended to you · N" counts these. */
  unread: boolean;
}
