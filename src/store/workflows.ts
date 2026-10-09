"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OptionValues } from "@/types/tool";

export interface WorkflowStep {
  id: string;
  toolId: string;
  options: OptionValues;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowState {
  workflows: Workflow[];
  /** Currently selected workflow in the builder (persisted for convenience). */
  activeId: string | null;
  setActive: (id: string | null) => void;
  create: (name?: string, steps?: WorkflowStep[]) => Workflow;
  update: (id: string, patch: Partial<Pick<Workflow, "name" | "steps" | "favorite">>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => Workflow | undefined;
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export const useWorkflows = create<WorkflowState>()(
  persist(
    (set, get) => ({
      workflows: [],
      activeId: null,
      setActive: (id) => set({ activeId: id }),
      create: (name = "Untitled workflow", steps = []) => {
        const wf: Workflow = { id: uid(), name, steps, favorite: false, createdAt: Date.now(), updatedAt: Date.now() };
        set((s) => ({ workflows: [wf, ...s.workflows], activeId: wf.id }));
        return wf;
      },
      update: (id, patch) => set((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)) })),
      remove: (id) => set((s) => ({ workflows: s.workflows.filter((w) => w.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      duplicate: (id) => {
        const src = get().workflows.find((w) => w.id === id);
        if (!src) return undefined;
        const copy: Workflow = { ...src, id: uid(), name: `${src.name} (copy)`, favorite: false, createdAt: Date.now(), updatedAt: Date.now(), steps: src.steps.map((st) => ({ ...st, id: uid() })) };
        set((s) => ({ workflows: [copy, ...s.workflows], activeId: copy.id }));
        return copy;
      },
    }),
    { name: "omnifi-supertools-workflows" },
  ),
);

export const newStepId = uid;
