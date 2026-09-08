import {
  Bell,
  Flame,
  MessageCircle,
  Snowflake,
  Sparkles,
  Star,
  UserPlus,
  UserRoundPlus,
} from "lucide-react";
import type { Notification } from "@/types";

/** Icon per notification type — the Record type forces a compile
 *  error if a new NotificationType value ships without an icon here.
 *  Shared between the flat notification row and the group row. */
export const NOTIFICATION_TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
  hot_lead_unanswered: Flame,
  lead_qualified: Star,
  new_lead: UserRoundPlus,
  lead_scored: Sparkles,
  new_message: MessageCircle,
  lead_stale: Snowflake,
};
