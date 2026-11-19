export interface Plan { id: string; name: string; maxUsers: number; monthlyAiLimit: number | null; active: boolean }
export interface Company { id: string; name: string; planId: string; active: boolean }
