import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  SuccessMessage,
} from '../../components/ui.tsx';

const ROLES = ['owner', 'admin', 'manager', 'staff'] as const;

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: string;
  jobTitle: string | null;
  bookable: boolean;
  active: boolean;
  locationIds: string[];
}

/** Personal de la organización, roles e invitaciones. */
export default function Team() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', role: 'staff' });
  const [invited, setInvited] = useState(false);

  const members = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['members', organizationId],
    queryFn: () => api.get<Member[]>(`/organizations/${organizationId}/members`),
  });

  const invitations = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['invitations', organizationId],
    queryFn: () =>
      api.get<{ id: string; email: string; role: string; expires_at: string }[]>(
        `/organizations/${organizationId}/invitations`,
      ),
  });

  const sendInvite = useMutation({
    mutationFn: () => api.post(`/organizations/${organizationId}/invitations`, invite),
    onSuccess: () => {
      setInviteOpen(false);
      setInvited(true);
      setInvite({ email: '', role: 'staff' });
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/organizations/${organizationId}/members/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/members/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members'] }),
  });

  return (
    <div>
      <PageHeader
        title={t('admin.team.title')}
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
            {t('admin.team.invite')}
          </Button>
        }
      />

      {invited && <SuccessMessage>{t('admin.team.inviteSent')}</SuccessMessage>}
      <ErrorMessage error={update.error ?? remove.error} />

      {members.isLoading && <LoadingBlock rows={3} />}

      <ul className="space-y-2">
        {members.data?.map((member) => (
          <Card as="li" key={member.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {member.name}
                {!member.active && <Badge className="ml-2 bg-slate-200">{t('common.no')}</Badge>}
              </p>
              <p className="text-sm text-slate-500">
                {member.email}
                {member.jobTitle && ` · ${member.jobTitle}`}
              </p>
            </div>

            <Switch
              checked={member.bookable}
              onChange={(value) => update.mutate({ id: member.id, patch: { bookable: value } })}
              label={t('admin.team.bookable')}
            />

            <Select
              value={member.role}
              className="max-w-40"
              aria-label={t('admin.team.role')}
              onChange={(event) =>
                update.mutate({ id: member.id, patch: { role: event.target.value } })
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`admin.team.roles.${role}`)}
                </option>
              ))}
            </Select>

            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t('common.delete')}
              onClick={() => remove.mutate(member.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </Card>
        ))}
      </ul>

      {(invitations.data?.length ?? 0) > 0 && (
        <Card className="mt-5">
          <h2 className="mb-3 font-semibold">{t('admin.team.pendingInvitations')}</h2>
          <ul className="divide-y divide-slate-100">
            {invitations.data?.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <Mail className="size-4 text-slate-400" aria-hidden />
                  {invitation.email}
                  <Badge className="bg-slate-100">
                    {t(`admin.team.roles.${invitation.role}`)}
                  </Badge>
                </span>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    void api
                      .delete(`/organizations/${organizationId}/invitations/${invitation.id}`)
                      .then(() => queryClient.invalidateQueries({ queryKey: ['invitations'] }))
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('admin.team.invite')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={sendInvite.isPending} onClick={() => sendInvite.mutate()}>
              {t('admin.team.invite')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={sendInvite.error} />
        <Field label={t('auth.email')} required>
          <Input
            type="email"
            value={invite.email}
            onChange={(event) => setInvite({ ...invite, email: event.target.value })}
          />
        </Field>
        <Field label={t('admin.team.role')}>
          <Select
            value={invite.role}
            onChange={(event) => setInvite({ ...invite, role: event.target.value })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`admin.team.roles.${role}`)}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>
    </div>
  );
}
