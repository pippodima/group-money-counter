/**
 * Joining a group someone else already has.
 *
 * There is no invite link, because there is no server to host one. Scanning
 * a ledger you do not have simply creates it here — the first sync *is* the
 * join.
 */

import { useState } from 'react';
import { navigate } from '../lib/router.js';
import { merge, setActiveGroup, useLedger } from '../store/ledger.js';
import { Problems, Screen } from '../ui/Chrome.js';
import { Scanner } from '../ui/Scanner.js';
import { describeMerge } from './Sync.js';

export function Join() {
  const { groups } = useLedger();
  const [outcome, setOutcome] = useState<
    { name: string; summary: string; joined: string } | { problem: string } | undefined
  >();

  return (
    <Screen title="Join a group" onBack>
      {outcome === undefined && (
        <Scanner
          hint="Ask them to open Sync and tap “Show my ledger”, then point this at their screen."
          onCancel={() => navigate('/groups')}
          onScanned={async (envelopes) => {
            const result = await merge(envelopes);

            if (!result.groupId) {
              setOutcome({ problem: 'You already have everything from that phone.' });
              return;
            }

            const name =
              groups.find((group) => group.id === result.groupId)?.name ?? 'that group';
            setOutcome({
              name,
              summary: describeMerge(result),
              joined: result.groupId,
            });
          }}
        />
      )}

      {outcome !== undefined && 'problem' in outcome && (
        <>
          <Problems items={[outcome.problem]} />
          <button type="button" className="primary" onClick={() => setOutcome(undefined)}>
            Try again
          </button>
        </>
      )}

      {outcome !== undefined && 'joined' in outcome && (
        <>
          <p className="notice" role="status">
            {outcome.summary}
          </p>
          <p className="lede small">
            You are in. Show them yours next so they get anything you had, then you are both in
            step.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                await setActiveGroup(outcome.joined);
                navigate('/sync');
              }}
            >
              Show them mine
            </button>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                await setActiveGroup(outcome.joined);
                navigate('/');
              }}
            >
              Not now
            </button>
          </div>
        </>
      )}
    </Screen>
  );
}
