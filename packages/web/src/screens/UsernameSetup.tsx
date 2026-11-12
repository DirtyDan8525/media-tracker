import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ME_KEY } from '../data/useMe';
import type { Me } from '../api/types';
import { homePath } from '../nav';
import { UsernameForm } from './UsernameForm';

/** First run: the user picks the username friends will find them by. */
export function UsernameSetup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="setup">
      <div className="setup__card">
        <span className="brand-mark">Media Tracker</span>
        <h1 className="page-title">Pick a username</h1>
        <p className="muted">This is how friends will find you. You can change it later in Settings.</p>
        <UsernameForm
          submitLabel="Continue"
          onSaved={() => {
            const me = qc.getQueryData<Me>(ME_KEY);
            navigate(me ? homePath(me.settings) : '/', { replace: true });
          }}
        />
      </div>
    </div>
  );
}
