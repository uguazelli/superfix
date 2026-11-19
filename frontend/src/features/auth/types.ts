export type Role = 'PLATFORM_ADMIN' | 'COMPANY_ADMIN' | 'TECHNICIAN'
export interface User {
  id: string; name: string; email: string; role: Role; companyId: string | null
  active: boolean; mustChangePassword: boolean; locale: 'en' | 'pt-BR' | 'es' | null
}
export interface AuthSession { user: User; offlineUntil: string; offline?: boolean; offlineAccessEnabled?: boolean }
