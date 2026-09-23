"use client";

import {
  DndContext,
  DragEndEvent,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Lead } from "@/db/schema";
import styles from "./LeadsBoard.module.css";

interface LeadsBoardProps {
  leads: any[];
  onDragEnd?: (leadId: string, newStatus: string) => void;
}

const STATUSES = ["new", "contacted", "replied", "meeting", "discarded"];

export function LeadsBoard({ leads, onDragEnd }: LeadsBoardProps) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;
    const newStatus = over.id as string;
    onDragEnd?.(leadId, newStatus);
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className={styles.board}>
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            leads={leads.filter((lead) => lead.status === status)}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ status, leads }: { status: string; leads: Lead[] }) {
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <h3 className={styles.columnTitle}>{statusLabel}</h3>
        <span className={styles.columnCount}>{leads.length}</span>
      </div>

      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={styles.columnContent}>
          {leads.map((lead) => (
            <DraggableCard key={lead.id} lead={lead} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function DraggableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={styles.card}
    >
      <h4 className={styles.cardName}>
        {lead.firstName} {lead.lastName}
      </h4>
      {lead.companyDisplay && (
        <p className={styles.cardCompany}>{lead.companyDisplay}</p>
      )}
      {lead.jobTitle && (
        <p className={styles.cardRole}>{lead.jobTitle}</p>
      )}
      {lead.email && (
        <p className={styles.cardEmail}>{lead.email}</p>
      )}
      {lead.seniority && (
        <span className={styles.seniorityBadge}>{lead.seniority}</span>
      )}
    </div>
  );
}
