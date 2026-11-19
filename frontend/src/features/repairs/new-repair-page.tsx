import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { send } from '@/lib/api'
import { IntakeForm } from './intake-form'
import type { Intake, Repair } from './types'
import type { AuthSession } from '@/features/auth/types'
import { loadOrCreateKey, queueCaseOperation, removeDraft, saveLocalCase } from '@/lib/device-vault'

export function NewRepairPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const ownerId = client.getQueryData<AuthSession>(['me'])?.user.id
  const [keys, setKeys] = useState<{create: string; photo: string} | null>(null)
  const [keyStorageFailed, setKeyStorageFailed] = useState(false)
  useEffect(() => {
    let active = true
    setKeys(null)
    setKeyStorageFailed(false)
    if (!ownerId) return () => { active = false }
    void Promise.all([
      loadOrCreateKey(ownerId, 'new-intake:create-key'),
      loadOrCreateKey(ownerId, 'new-intake:model-plate-key'),
    ]).then(([create, photo]) => {
      if (active) setKeys({create, photo})
    }).catch(() => { if (active) setKeyStorageFailed(true) })
    return () => { active = false }
  }, [ownerId])
  const createRepair = useMutation({
    mutationFn: async ({input, modelPlate}: {input: Intake; modelPlate?: File}) => {
      if (!keys) throw new TypeError('Could not prepare a stable create key')
      try {
        let repair = await send<Repair>('/cases', 'POST', input, {idempotencyKey: keys.create})
        if (modelPlate) {
          const form = new FormData()
          form.append('file', modelPlate)
          form.append('kind', 'MODEL_PLATE')
          repair = await send<Repair>('/cases/' + repair.id + '/photos', 'POST', form,
            {idempotencyKey: keys.photo})
        }
        return repair
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        const session = client.getQueryData<AuthSession>(['me'])
        if (!session?.user.companyId) throw error
        const id = crypto.randomUUID()
        const timestamp = new Date().toISOString()
        const local: Repair = {
          id, jobReference: 'LOCAL-' + id.slice(0, 8).toUpperCase(), category: input.category,
          status: 'DRAFT', version: 0, createdAt: timestamp, updatedAt: timestamp,
          technicianId: session.user.id, createdBy: session.user.id, parentCaseId: null, archivedAt: null, appliance: null,
          returnVisit: null, returnHistory: [], applianceHistory: [], assignments: [], timeline: [], checklist: [
            {id: 'tools', alwaysRequired: true}, {id: 'workspace', alwaysRequired: true},
            {id: 'appliance', alwaysRequired: true}, {id: 'handover', alwaysRequired: false},
          ],
          details: {intake: input, demo: true, procedure: null, resumeStatus: null, photos: [], rounds: [],
            finding: null, issue: null, checks: {}, feedback: null, workLog: null, attempts: []},
        }
        const localWithPhoto = modelPlate ? {...local, details: {...local.details, photos: [{
          id: 'LOCAL-' + keys.photo, contentType: modelPlate.type || 'image/jpeg', size: modelPlate.size,
          kind: 'MODEL_PLATE' as const, clientKey: keys.photo,
        }]}} : local
        await saveLocalCase(session.user.id, localWithPhoto, keys.create, input)
        if (modelPlate) {
          await queueCaseOperation(session.user.id, localWithPhoto, {
            path: '/photos', method: 'POST', idempotencyKey: keys.photo, photo: modelPlate,
            photoName: modelPlate.name, photoKind: 'MODEL_PLATE',
          }, localWithPhoto)
        }
        return localWithPhoto
      }
    },
    onSuccess: async (result) => {
      const session = client.getQueryData<AuthSession>(['me'])
      if (session) {
        await removeDraft(session.user.id, 'new-intake')
        await removeDraft(session.user.id, 'new-intake:model-plate')
        await removeDraft(session.user.id, 'new-intake:create-key')
        await removeDraft(session.user.id, 'new-intake:model-plate-key')
      }
      void client.invalidateQueries({queryKey: ['repairs']})
      navigate('/repairs/' + result.id)
    },
  })
  return <>
    <Link className="back-link" to="/repairs"><ArrowLeft size={16} />{t('backToRepairs')}</Link>
    <header className="page-head"><div><h1>{t('newRepair')}</h1><p>{t('newDescription')}</p></div></header>
    <Card className="form-panel">
      {keyStorageFailed && <p className="notice notice-error" role="alert">{t('offline.storageError')}</p>}
      <IntakeForm draftKey="new-intake"
        onSubmit={(input, modelPlate) => createRepair.mutate({input, modelPlate})}
        pending={createRepair.isPending || !keys || keyStorageFailed}
        error={createRepair.error} submitLabel="createDraft" />
    </Card>
  </>
}
