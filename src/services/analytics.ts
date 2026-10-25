export type AnalyticsEvent =
  | 'workout_started'
  | 'workout_completed'
  | 'rep_completed'
  | 'level_up'
  | 'achievement_unlocked'
  | 'daily_goal_completed'
  | 'pvp_plus_page_viewed'
  | 'pvp_plus_checkout_started'
  | 'pvp_plus_checkout_completed'
  | 'pvp_plus_portal_opened';

export interface AnalyticsService {
  track(event: AnalyticsEvent, properties?: Record<string, string | number | boolean>): void;
}

export const analytics: AnalyticsService = {
  track(event, properties) {
    if (__DEV__) {
      console.info('[analytics]', event, properties ?? {});
    }
  },
};
