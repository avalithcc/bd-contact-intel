"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { Activity } from "@/db/schema";
import styles from "./ActivityTimeline.module.css";

export interface ActivityTimelineProps {
  activities: Activity[];
  loading?: boolean;
}

export function ActivityTimeline({ activities, loading }: ActivityTimelineProps) {
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>Loading activity...</div>
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>No activity yet</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.timeline}>
        {activities.map((activity) => (
          <div key={activity.id} className={styles.entry}>
            <div className={styles.marker} data-type={activity.type} />
            <div className={styles.content}>
              <div className={styles.header}>
                <span className={styles.type}>{activity.type}</span>
                <span className={styles.time}>
                  {formatDistanceToNow(new Date(activity.createdAt), {
                    addSuffix: true,
                    locale: es,
                  })}
                </span>
              </div>
              {activity.metadata && Object.keys(activity.metadata as Record<string, unknown>).length > 0 ? (
                <div className={styles.metadata}>
                  {Object.entries(activity.metadata as Record<string, unknown>).map(
                    ([key, value]) => {
                      const displayValue =
                        typeof value === "string" ? value : JSON.stringify(value);
                      return (
                        <div key={key} className={styles.metadataItem}>
                          <span className={styles.key}>{key}</span>
                          <span className={styles.value}>{displayValue}</span>
                        </div>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
