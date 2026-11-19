import type { AuthSession } from '@/features/auth/types'
import type { Category, Intake, Repair } from '@/features/repairs/types'

type Stored = {key: string; ownerId: string; value: unknown; updatedAt: number}
const databaseName = 'superfix-device'
let databasePromise: Promise<IDBDatabase> | undefined
const keyCreations = new Map<string, Promise<string>>()

function database() {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records', {keyPath: 'key'})
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

async function read<T>(key: string): Promise<T | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('records', 'readonly').objectStore('records').get(key)
    request.onsuccess = () => resolve((request.result as Stored | undefined)?.value as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

async function write(ownerId: string, key: string, value: unknown) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite')
    transaction.objectStore('records').put({key, ownerId, value, updatedAt: Date.now()} satisfies Stored)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function remove(key: string) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite')
    transaction.objectStore('records').delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export interface CachedSession extends AuthSession { offlineAccessEnabled?: boolean }
export interface PendingOperation {
  path: string
  method: string
  value?: unknown
  idempotencyKey: string
  photo?: Blob
  photoName?: string
  photoKind?: 'SYMPTOM' | 'MODEL_PLATE'
}
export interface CachedCase {
  repair: Repair
  ownerId: string
  storageId?: string
  baseVersion: number
  operations: PendingOperation[]
  conflict: boolean
  localOnly?: boolean
  createKey?: string
  createIntake?: Intake
  serverRepair?: Repair
}

const sessionKey = (userId: string) => 'session:' + userId
const caseKey = (userId: string, caseId: string) => 'case:' + userId + ':' + caseId
const draftKey = (userId: string, key: string) => 'draft:' + userId + ':' + key

export async function saveSession(session: CachedSession) {
  let previous = await loadSession(session.user.id)
  if (previous && previous.user.companyId !== session.user.companyId) {
    await clearDeviceWork(session.user.id)
    previous = undefined
  }
  const saved = {...session, offlineAccessEnabled: previous?.offlineAccessEnabled ?? false}
  await Promise.all([
    write(session.user.id, sessionKey(session.user.id), saved),
    write(session.user.id, 'session:active', saved),
  ])
  return saved
}

export function loadSession(userId: string) {
  return read<CachedSession>(sessionKey(userId))
}

export function loadActiveSession() {
  return read<CachedSession>('session:active')
}

export async function updateOfflineAccess(userId: string, enabled: boolean) {
  const session = await loadSession(userId)
  if (!session) return undefined
  const updated = {...session, offlineAccessEnabled: enabled}
  await Promise.all([
    write(userId, sessionKey(userId), updated),
    write(userId, 'session:active', updated),
  ])
  return updated
}

export async function saveCase(userId: string, repair: Repair) {
  const current = await loadCase(userId, repair.id)
  if (current?.operations.length) return current
  const entry: CachedCase = {repair, ownerId: userId, storageId: repair.id,
    baseVersion: repair.version, operations: [], conflict: false}
  await write(userId, caseKey(userId, repair.id), entry)
  return entry
}

export function loadCase(userId: string, caseId: string) {
  return read<CachedCase>(caseKey(userId, caseId))
}

export async function listCachedCases(userId: string) {
  const db = await database()
  return new Promise<CachedCase[]>((resolve, reject) => {
    const request = db.transaction('records', 'readonly').objectStore('records').openCursor()
    const entries: CachedCase[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(entries)
        return
      }
      const record = cursor.value as Stored
      if (record.ownerId === userId && String(record.key).startsWith('case:' + userId + ':')) {
        entries.push(record.value as CachedCase)
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

export function saveCachedCase(entry: CachedCase) {
  return write(entry.ownerId, caseKey(entry.ownerId, entry.storageId ?? entry.repair.id), entry)
}

export function saveLocalCase(userId: string, repair: Repair, createKey: string, intake: Intake) {
  const entry: CachedCase = {
    repair, ownerId: userId, storageId: repair.id, baseVersion: repair.version, operations: [], conflict: false,
    localOnly: true, createKey, createIntake: intake,
  }
  return saveCachedCase(entry)
}

export async function queueCaseOperation(userId: string, repair: Repair, operation: PendingOperation,
                                         optimisticRepair: Repair) {
  const entry = await loadCase(userId, repair.id) ?? {
    repair, ownerId: userId, storageId: repair.id, baseVersion: repair.version, operations: [], conflict: false,
  }
  entry.repair = {...optimisticRepair, deviceState: 'PENDING'}
  entry.operations.push(operation)
  await saveCachedCase(entry)
  return entry
}

export function cacheCategories(userId: string, categories: Category[]) {
  return write(userId, 'categories:' + userId, categories)
}

export function loadCategories(userId: string) {
  return read<Category[]>('categories:' + userId)
}

export function setCaseConflict(entry: CachedCase, repair: Repair) {
  entry.repair = {...entry.repair, deviceState: 'CONFLICT'}
  entry.serverRepair = repair
  entry.conflict = true
  return saveCachedCase(entry)
}

export async function resolveCaseConflict(entry: CachedCase, useLocal: boolean): Promise<Repair | undefined> {
  if (!entry.serverRepair) return
  if (useLocal) {
    entry.baseVersion = entry.serverRepair.version
    entry.conflict = false
    entry.repair = {...entry.repair, deviceState: 'PENDING', version: entry.serverRepair.version}
    delete entry.serverRepair
    await saveCachedCase(entry)
    return entry.repair
  }
  const server = {...entry.serverRepair}
  await removeCase(entry.ownerId, entry.storageId ?? server.id)
  await saveCase(entry.ownerId, server)
  return server
}

export function removeCase(userId: string, caseId: string) {
  return remove(caseKey(userId, caseId))
}

export function saveDraft<T>(userId: string, key: string, value: T) {
  return write(userId, draftKey(userId, key), value)
}

export function loadDraft<T>(userId: string, key: string) {
  return read<T>(draftKey(userId, key))
}

export function removeDraft(userId: string, key: string) {
  return remove(draftKey(userId, key))
}

export function loadOrCreateKey(userId: string, key: string) {
  return resolveOperationKey(userId, key)
}

export function rotateKeyAfter(userId: string, key: string, acknowledgedId: string) {
  return resolveOperationKey(userId, key, acknowledgedId)
}

function resolveOperationKey(userId: string, key: string, acknowledgedId?: string) {
  const operationKey = userId + ':' + key
  const pending = keyCreations.get(operationKey)
  if (pending) return pending
  const creation = (async () => {
    const stored = await loadDraft<unknown>(userId, key)
    const value = typeof stored === 'string' ? stored :
      stored && typeof stored === 'object' && 'key' in stored && typeof stored.key === 'string' ? stored.key : undefined
    const rotatedFor = stored && typeof stored === 'object' && 'rotatedFor' in stored &&
      typeof stored.rotatedFor === 'string' ? stored.rotatedFor : undefined
    if (value && (!acknowledgedId || rotatedFor === acknowledgedId)) return value
    const created = crypto.randomUUID()
    await saveDraft(userId, key, acknowledgedId ? {key: created, rotatedFor: acknowledgedId} : created)
    return created
  })()
  keyCreations.set(operationKey, creation)
  return creation.finally(() => {
    if (keyCreations.get(operationKey) === creation) keyCreations.delete(operationKey)
  })
}

export async function hasDeviceWork(userId: string) {
  const db = await database()
  return new Promise<boolean>((resolve, reject) => {
    const request = db.transaction('records', 'readonly').objectStore('records').openCursor()
    let found = false
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || found) {
        resolve(found)
        return
      }
      const record = cursor.value as Stored
      const isCase = String(record.key).startsWith('case:' + userId + ':')
      const isDraft = String(record.key).startsWith('draft:' + userId + ':')
      const cached = record.value as CachedCase | undefined
      const draftName = isDraft ? String(record.key).slice(('draft:' + userId + ':').length) : ''
      if (record.ownerId === userId &&
          ((isDraft && meaningfulDraft(draftName, record.value)) ||
            (isCase && Boolean(cached?.localOnly || cached?.operations.length)))) {
        found = true
        resolve(true)
        return
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

function meaningfulDraft(key: string, value: unknown) {
  if (key.endsWith('-key')) return false
  if (value instanceof Blob) return true
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  if (key.includes('intake')) {
    return ['category', 'symptoms', 'brand', 'model', 'serialNumber', 'diagnosticTopic']
      .some(field => typeof draft[field] === 'string' && (draft[field] as string).trim().length > 0) ||
      draft.modelConfirmed === true || draft.hazard === true || draft.fuel != null
  }
  if (key.includes('work-log')) {
    return Boolean(draft.workStatus || draft.confirmedFault || draft.confirmedCauseCode || draft.workPerformed ||
      (Array.isArray(draft.parts) && draft.parts.length) || (Array.isArray(draft.readings) && draft.readings.length) || draft.verification)
  }
  return Object.keys(draft).length > 0
}

export async function clearDeviceWork(userId: string) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite')
    const store = transaction.objectStore('records')
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if ((cursor.value as Stored).ownerId === userId) cursor.delete()
      cursor.continue()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}
